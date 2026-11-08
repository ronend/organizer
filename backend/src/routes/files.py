"""File routes — presigned S3 URLs for the private files bucket (FILES_BUCKET).

The browser talks to S3 directly (the bucket's CORS allows the app origin); the
API only hands out short-lived presigned URLs, scoped to the caller's own key
prefix ``u/<sub>/``.

POST /api/files/upload-url  {name, contentType, size}
    → {file: FileRef, uploadUrl}   presigned PUT, 15 min, Content-Type bound
POST /api/files/urls        {keys: string[]}  (≤100)
    → {urls: {key: url}}           presigned GET, 1 hour
"""

from __future__ import annotations

import os
import re
import uuid
from functools import lru_cache
from typing import Annotated

import boto3
from botocore.config import Config
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from src.middleware.auth import require_auth
from src.models import FileRef
from src.routes.state import user_prefix

MAX_FILE_BYTES = 20 * 1024 * 1024
UPLOAD_URL_TTL = 15 * 60
DOWNLOAD_URL_TTL = 60 * 60
MAX_KEYS = 100
DEFAULT_CONTENT_TYPE = "application/octet-stream"

_CONTENT_TYPE_RE = re.compile(r"^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$")

router = APIRouter(prefix="/api/files", dependencies=[Depends(require_auth)])


@lru_cache(maxsize=1)
def _s3():
    # Regional endpoint + virtual-host addressing + SigV4, so presigned URLs
    # point straight at https://<bucket>.s3.<region>.amazonaws.com/... — the
    # browser's CORS preflight/PUT never hits a cross-region 307 redirect.
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1"
    return boto3.client(
        "s3",
        region_name=region,
        endpoint_url=f"https://s3.{region}.amazonaws.com",
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


def _bucket() -> str:
    return os.environ["FILES_BUCKET"]


def sanitize_filename(name: str) -> str:
    """Reduce a user-supplied file name to a safe S3 key segment."""
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._")
    base = re.sub(r"_+", "_", base)
    if len(base) > 100:
        stem, dot, ext = base.rpartition(".")
        if dot and 0 < len(ext) <= 10:
            base = stem[: 99 - len(ext)] + "." + ext
        else:
            base = base[:100]
    return base or "file"


class UploadUrlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1, max_length=255)]
    contentType: Annotated[str, Field(max_length=255)] = ""
    size: Annotated[int, Field(ge=0)]


class FileUrlsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keys: Annotated[list[Annotated[str, Field(min_length=1, max_length=1024)]], Field(max_length=MAX_KEYS)]


@router.post("/upload-url")
def create_upload_url(body: UploadUrlRequest, claims: dict = Depends(require_auth)) -> dict:
    if body.size > MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 20 MB)")

    content_type = body.contentType.strip() or DEFAULT_CONTENT_TYPE
    if not _CONTENT_TYPE_RE.match(content_type):
        raise HTTPException(status_code=400, detail="Invalid content type")

    key = f"{user_prefix(claims['sub'])}{uuid.uuid4()}/{sanitize_filename(body.name)}"
    upload_url = _s3().generate_presigned_url(
        "put_object",
        Params={"Bucket": _bucket(), "Key": key, "ContentType": content_type},
        ExpiresIn=UPLOAD_URL_TTL,
        HttpMethod="PUT",
    )
    file = FileRef(key=key, name=body.name, contentType=content_type, size=body.size)
    return {"file": file.model_dump(), "uploadUrl": upload_url}


@router.post("/urls")
def create_download_urls(body: FileUrlsRequest, claims: dict = Depends(require_auth)) -> dict:
    prefix = user_prefix(claims["sub"])
    if any(not k.startswith(prefix) for k in body.keys):
        raise HTTPException(status_code=403, detail="File key outside your storage")

    s3 = _s3()
    bucket = _bucket()
    urls = {
        key: s3.generate_presigned_url(
            "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=DOWNLOAD_URL_TTL
        )
        for key in dict.fromkeys(body.keys)
    }
    return {"urls": urls}
