"""Builds the FastMCP server instance and registers tools + resources.

stateless_http + json_response make the Streamable HTTP transport serverless-
friendly (each request is self-contained, single JSON response, no SSE session to
keep alive across Lambda invocations). These settings are inert for stdio.

When OAuth is enabled (Cognito pool + public APP_URL known), we hand FastMCP an
AuthSettings + TokenVerifier. FastMCP then advertises OAuth 2.0 discovery:
  - serves RFC 9728 protected-resource metadata at
    /.well-known/oauth-protected-resource/mcp (authorization_servers = [Cognito]),
  - challenges unauthenticated calls with 401 + WWW-Authenticate resource_metadata,
  - validates the bearer via CognitoTokenVerifier on every call.
Cognito itself serves the authorization-server metadata + authorize/token endpoints.
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP

from . import auth
from .resources import register_resources
from .tools import register_tools


def build_server() -> FastMCP:
    kwargs: dict = dict(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "3100")),
        stateless_http=True,
        json_response=True,
    )

    if auth.oauth_enabled():
        from mcp.server.auth.settings import AuthSettings

        kwargs["auth"] = AuthSettings(
            issuer_url=auth.issuer_url(),
            resource_server_url=auth.resource_server_url(),
            required_scopes=auth.OAUTH_SCOPES,
        )
        kwargs["token_verifier"] = auth.CognitoTokenVerifier()

    mcp = FastMCP("organizer-mcp-server", **kwargs)
    register_tools(mcp)
    register_resources(mcp)
    return mcp
