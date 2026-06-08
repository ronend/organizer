"""Builds the Streamable HTTP ASGI app, gated by origin-verify (+ Cognito).

Used by both the Lambda handler (wrapped with Mangum) and local `MCP_TRANSPORT=http`.
The MCP server runs in stateless + JSON-response mode, which is what makes it
Lambda-friendly: each request is self-contained, with no SSE session to persist.

Gating:
  - origin-verify — if ORIGIN_SECRET is set, require a matching x-origin-verify
    header (CloudFront injects it). Blocks direct Function URL access. -> 403.
    Applied here as a streaming-safe ASGI guard (not Starlette BaseHTTPMiddleware,
    which buffers and would break responses).
  - Cognito       — when OAuth is enabled, FastMCP itself validates the bearer and
    advertises OAuth discovery (see server.py). The `_Gate` only falls back to
    plain token validation in the brief pre-AppUrl deploy state, where discovery
    can't be advertised yet but we still don't want an open endpoint.

The caller's bearer token is forwarded to the Organizer API by the tools
(per-user pass-through), so no separate MCP secret is needed.
"""

from __future__ import annotations

import os

from starlette.responses import JSONResponse

from . import auth
from .server import build_server


class _Gate:
    """Streaming-safe ASGI guard. Non-http scopes (lifespan, etc.) pass through."""

    def __init__(self, app) -> None:
        self.app = app
        self.origin_secret = os.environ.get("ORIGIN_SECRET", "")
        # Validate the bearer here only when the SDK's OAuth layer isn't active.
        self.fallback_auth = auth.auth_enabled() and not auth.oauth_enabled()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode().lower(): v.decode() for k, v in (scope.get("headers") or [])}

        # 1. Origin verification (only if configured).
        if self.origin_secret:
            if headers.get("x-origin-verify") != self.origin_secret:
                await JSONResponse({"error": "Forbidden"}, status_code=403)(scope, receive, send)
                return

        # 2. Fallback Cognito validation (pre-AppUrl state only).
        if self.fallback_auth:
            token = ""
            authz = headers.get("authorization", "")
            if authz.lower().startswith("bearer "):
                token = authz.split(" ", 1)[1].strip()
            try:
                auth.verify_access_token(token)
            except auth.AuthError as exc:
                await JSONResponse({"error": str(exc)}, status_code=401)(scope, receive, send)
                return

        await self.app(scope, receive, send)


def build_asgi_app():
    """Return the gated Streamable HTTP ASGI app."""
    mcp = build_server()
    return _Gate(mcp.streamable_http_app())
