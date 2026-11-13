"""Link titles for task notes.

POST /api/link-preview  {url}  →  {url, title}   (title is null when unknown)

The browser can't read other sites' pages (CORS), so the API fetches the page
and returns its title. Because this makes the server fetch a user-supplied URL,
it is locked down against SSRF:

- http/https only, default ports only, no credentials in the URL
- every address the host resolves to must be public (no loopback, private,
  link-local, multicast, reserved or unspecified ranges)
- redirects are followed by hand (at most 3) and each hop is re-checked
- short timeouts, HTML responses only, at most 256 KB read

Failures never raise: the endpoint answers 200 with ``title: null`` so the UI
simply doesn't offer a suggestion.
"""

from __future__ import annotations

import html
import ipaddress
import logging
import re
import socket
from html.parser import HTMLParser
from typing import Annotated, Optional
from urllib.parse import urljoin, urlsplit

import requests
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from src.middleware.auth import require_auth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])

MAX_BYTES = 256 * 1024
MAX_REDIRECTS = 3
TIMEOUT = (3.0, 4.0)  # connect, read
MAX_TITLE = 200
USER_AGENT = "Mozilla/5.0 (compatible; coo-link-preview/1.0)"


class LinkPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: Annotated[str, Field(min_length=1, max_length=2048)]


class UnsafeUrl(Exception):
    pass


def _check_url(url: str) -> str:
    """Returns the URL if it is safe to fetch, else raises UnsafeUrl."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise UnsafeUrl("scheme")
    if not parts.hostname or parts.username or parts.password:
        raise UnsafeUrl("host")
    try:
        port = parts.port
    except ValueError:
        raise UnsafeUrl("port")
    if port not in (None, 80, 443):
        raise UnsafeUrl("port")
    try:
        infos = socket.getaddrinfo(parts.hostname, port or (443 if parts.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise UnsafeUrl("dns")
    if not infos:
        raise UnsafeUrl("dns")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
            or not ip.is_global
        ):
            raise UnsafeUrl("address")
    return url


class _TitleParser(HTMLParser):
    """Collects og:title / twitter:title and the first <title>."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.og: Optional[str] = None
        self.twitter: Optional[str] = None
        self.title: Optional[str] = None
        self._in_title = False
        self._buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key == "og:title" and not self.og:
                self.og = a.get("content")
            elif key == "twitter:title" and not self.twitter:
                self.twitter = a.get("content")
        elif tag == "title" and self.title is None:
            self._in_title = True

    def handle_endtag(self, tag):
        if tag == "title" and self._in_title:
            self._in_title = False
            self.title = "".join(self._buf)

    def handle_data(self, data):
        if self._in_title:
            self._buf.append(data)


def extract_title(markup: str) -> Optional[str]:
    p = _TitleParser()
    try:
        p.feed(markup)
        p.close()
    except Exception:  # malformed markup: use whatever was collected
        pass
    for candidate in (p.og, p.twitter, p.title):
        if candidate:
            text = re.sub(r"\s+", " ", html.unescape(candidate)).strip()
            if text:
                return text[:MAX_TITLE]
    return None


def fetch_title(url: str) -> Optional[str]:
    current = url
    with requests.Session() as session:
        for _ in range(MAX_REDIRECTS + 1):
            _check_url(current)
            resp = session.get(
                current,
                stream=True,
                timeout=TIMEOUT,
                allow_redirects=False,
                headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
            )
            try:
                if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
                    location = resp.headers.get("Location")
                    if not location:
                        return None
                    current = urljoin(current, location)
                    continue
                if resp.status_code != 200:
                    return None
                ctype = resp.headers.get("Content-Type", "").lower()
                if "html" not in ctype:
                    return None
                body = b""
                for chunk in resp.iter_content(16 * 1024):
                    body += chunk
                    if len(body) >= MAX_BYTES:
                        break
                encoding = resp.encoding if resp.encoding and "charset" in ctype else None
                if not encoding:
                    m = re.search(rb'<meta[^>]+charset=["\']?([\w-]+)', body[:4096], re.I)
                    encoding = m.group(1).decode() if m else "utf-8"
                try:
                    text = body.decode(encoding, errors="replace")
                except LookupError:
                    text = body.decode("utf-8", errors="replace")
                return extract_title(text)
            finally:
                resp.close()
    return None


@router.post("/link-preview")
def link_preview(body: LinkPreviewRequest) -> dict:
    url = body.url.strip()
    try:
        title = fetch_title(url)
    except UnsafeUrl as exc:
        logger.info("link-preview refused %s: %s", url, exc)
        title = None
    except requests.RequestException as exc:
        logger.info("link-preview failed %s: %s", url, exc)
        title = None
    return {"url": url, "title": title}
