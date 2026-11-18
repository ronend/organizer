"""POST /api/link-preview: title extraction and SSRF guards (network mocked)."""

import socket

import pytest

from src.routes import links


class FakeResp:
    def __init__(self, status=200, body=b"", ctype="text/html; charset=utf-8", location=None):
        self.status_code = status
        self._body = body
        self.headers = {"Content-Type": ctype}
        if location:
            self.headers["Location"] = location
        self.encoding = "utf-8" if "charset" in ctype else None

    @property
    def is_redirect(self):
        return self.status_code in (301, 302, 303, 307, 308)

    def iter_content(self, n):
        for i in range(0, len(self._body), n):
            yield self._body[i : i + n]

    def close(self):
        pass


def public_dns(monkeypatch, ip="93.184.216.34"):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(socket.AF_INET, 1, 6, "", (ip, 443))])


def serve(monkeypatch, responses):
    calls = []

    def fake_get(self, url, **kwargs):
        calls.append(url)
        assert kwargs["allow_redirects"] is False and kwargs["stream"] is True
        return responses.pop(0)

    monkeypatch.setattr(links.requests.Session, "get", fake_get)
    return calls


def test_og_title_preferred(client, monkeypatch):
    public_dns(monkeypatch)
    serve(monkeypatch, [FakeResp(body=b'<html><head><title>Plain</title><meta property="og:title" content="Pena &amp; Park"></head></html>')])
    res = client.post("/api/link-preview", json={"url": "https://example.com/pena"})
    assert res.status_code == 200
    assert res.json() == {"url": "https://example.com/pena", "title": "Pena & Park"}


def test_title_tag_whitespace_collapsed(client, monkeypatch):
    public_dns(monkeypatch)
    serve(monkeypatch, [FakeResp(body=b"<title>\n  Sintra   ridge\n loop </title>")])
    assert client.post("/api/link-preview", json={"url": "https://example.com"}).json()["title"] == "Sintra ridge loop"


def test_redirect_followed_and_rechecked(client, monkeypatch):
    public_dns(monkeypatch)
    calls = serve(monkeypatch, [FakeResp(status=301, location="/final"), FakeResp(body=b"<title>Final</title>")])
    assert client.post("/api/link-preview", json={"url": "https://example.com/start"}).json()["title"] == "Final"
    assert calls == ["https://example.com/start", "https://example.com/final"]


def test_redirect_to_private_address_refused(client, monkeypatch):
    def dns(host, *a, **k):
        ip = "10.0.0.5" if host == "internal.example" else "93.184.216.34"
        return [(socket.AF_INET, 1, 6, "", (ip, 80))]

    monkeypatch.setattr(socket, "getaddrinfo", dns)
    calls = serve(monkeypatch, [FakeResp(status=302, location="http://internal.example/admin")])
    assert client.post("/api/link-preview", json={"url": "https://example.com"}).json()["title"] is None
    assert calls == ["https://example.com"]


@pytest.mark.parametrize(
    "url,ip",
    [
        ("http://localhost/", "127.0.0.1"),
        ("http://169.254.169.254/latest/meta-data/", "169.254.169.254"),
        ("http://192.168.1.1/", "192.168.1.1"),
        ("http://[::1]/", "::1"),
        ("https://example.com:8443/", "93.184.216.34"),
        ("ftp://example.com/", "93.184.216.34"),
        ("file:///etc/passwd", "93.184.216.34"),
        ("https://user:pw@example.com/", "93.184.216.34"),
    ],
)
def test_unsafe_urls_never_fetched(client, monkeypatch, url, ip):
    public_dns(monkeypatch, ip)
    calls = serve(monkeypatch, [])
    res = client.post("/api/link-preview", json={"url": url})
    assert res.status_code == 200 and res.json()["title"] is None
    assert calls == []


def test_non_html_ignored(client, monkeypatch):
    public_dns(monkeypatch)
    serve(monkeypatch, [FakeResp(body=b"%PDF-1.7", ctype="application/pdf")])
    assert client.post("/api/link-preview", json={"url": "https://example.com/a.pdf"}).json()["title"] is None


def test_requires_auth():
    import os
    from fastapi.testclient import TestClient
    from src.app import app

    c = TestClient(app, headers={"x-origin-verify": os.environ["ORIGIN_SECRET"]})
    assert c.post("/api/link-preview", json={"url": "https://example.com"}).status_code == 401


def test_long_task_notes_accepted(client, sub):
    from tests.samples import samples

    # A general task: no subject, source or appointment to reference.
    task = {**samples(sub)["task"], "subjectId": None, "source": None, "appointment": None,
            "notes": "<p>" + "x" * 15000 + "</p>"}
    assert client.post("/api/batch", json={"put": [task], "delete": []}).status_code == 200
