"""Cognito access-token verification + OAuth discovery wiring for HTTP transport.

Mirrors backend/src/middleware/auth.py: verifies the bearer token's signature
against the User Pool's JWKS, confirms it is an *access* token from this pool, and
returns the decoded claims.

Two layers use this:
  - `CognitoTokenVerifier` plugs into FastMCP's built-in auth so the deployed /mcp
    endpoint advertises OAuth 2.0 discovery (RFC 9728 protected-resource metadata
    + a 401 `WWW-Authenticate` challenge) pointing at Cognito as the authorization
    server. Clients (e.g. Claude.ai connectors) can then run the OAuth dance
    themselves instead of pasting a token.
  - The asgi `_Gate` falls back to plain validation in the brief pre-AppUrl deploy
    state (when discovery can't yet be advertised).

The same caller token validated here is forwarded to the Organizer API by tools
(per-user pass-through).

Config (all from env, set by SAM on Lambda):
  COGNITO_USER_POOL_ID + AWS_REGION → token validation can run  (auth_enabled)
  ...plus APP_URL                   → OAuth discovery advertised (oauth_enabled)
"""

from __future__ import annotations

import os
from typing import Optional

import jwt

_region = os.environ.get("AWS_REGION")
_user_pool_id = os.environ.get("COGNITO_USER_POOL_ID")
_app_url = (os.environ.get("APP_URL") or "").rstrip("/")

ISSUER = (
    f"https://cognito-idp.{_region}.amazonaws.com/{_user_pool_id}"
    if _region and _user_pool_id
    else None
)

# Scopes advertised in the discovery metadata (what clients request at Cognito)
# and required on the token. Must be a subset of the connector app client's
# AllowedOAuthScopes (see MCPUserPoolClient in iac/template.yaml).
OAUTH_SCOPES = (os.environ.get("MCP_OAUTH_SCOPES") or "openid email").split()

# Created lazily so warm invocations reuse cached signing keys.
_jwks_client: Optional[jwt.PyJWKClient] = None


def auth_enabled() -> bool:
    """Token validation is possible (pool + region known)."""
    return ISSUER is not None


def oauth_enabled() -> bool:
    """OAuth discovery can be advertised (also need the public app URL)."""
    return auth_enabled() and bool(_app_url)


def issuer_url() -> str:
    assert ISSUER is not None
    return ISSUER


def resource_server_url() -> str:
    """This MCP resource's URL — the audience clients bind tokens to."""
    return f"{_app_url}/mcp"


def _client() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(f"{ISSUER}/.well-known/jwks.json", cache_keys=True)
    return _jwks_client


class AuthError(Exception):
    """Raised when a token is missing or invalid."""


def verify_access_token(token: str) -> dict:
    """Verify a Cognito access token and return its claims, or raise AuthError."""
    if not token:
        raise AuthError("Missing bearer token")
    try:
        signing_key = _client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=ISSUER,
            # Access tokens carry no `aud`; PyJWT still verifies exp & iss.
            options={"verify_aud": False},
        )
    except Exception as exc:  # signature, expiry, issuer, malformed, JWKS fetch
        raise AuthError("Invalid token") from exc

    if claims.get("token_use") != "access":
        raise AuthError("Wrong token type")
    if not claims.get("sub"):
        raise AuthError("Token missing subject")
    return claims


class CognitoTokenVerifier:
    """FastMCP TokenVerifier: validate a Cognito access token for the /mcp endpoint.

    Returns an AccessToken on success or None (→ 401) on failure. We union the
    required scopes into the returned scopes so a validly-signed access token never
    trips FastMCP's scope check (403): security rests on the signature, issuer and
    token_use checks above, not on the token's scope set.
    """

    def __init__(self, required_scopes: Optional[list[str]] = None) -> None:
        self._required = list(required_scopes or OAUTH_SCOPES)

    async def verify_token(self, token: str):  # -> AccessToken | None
        from mcp.server.auth.provider import AccessToken

        try:
            claims = verify_access_token(token)
        except AuthError:
            return None

        scopes = sorted(set((claims.get("scope") or "").split()) | set(self._required))
        return AccessToken(
            token=token,
            client_id=claims.get("client_id", ""),
            scopes=scopes,
            expires_at=claims.get("exp"),
            subject=claims.get("sub"),
        )
