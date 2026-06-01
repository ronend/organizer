"""Blocks requests that did not arrive through CloudFront.

CloudFront is configured to inject `x-origin-verify: <ORIGIN_SECRET>` on every
request to the Lambda origin; direct calls to the Function URL won't have it.
"""

import os

from fastapi import Request
from fastapi.responses import JSONResponse


async def origin_verify(request: Request, call_next):
    expected = os.environ.get("ORIGIN_SECRET")
    provided = request.headers.get("x-origin-verify")

    if not expected or not provided or provided != expected:
        return JSONResponse(status_code=403, content={"error": "Forbidden"})

    return await call_next(request)
