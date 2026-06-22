"""Cognito JWT verification, exposed as a FastAPI dependency.

Used on the data routers (events, templates, reminders, views). Verifies the
bearer token's signature against
the User Pool's JWKS, checks it is an *access* token issued by this pool, and
returns the decoded claims. Route handlers read `user["sub"]` as the userId.
"""

import os

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_region = os.environ.get("AWS_REGION")
_user_pool_id = os.environ.get("COGNITO_USER_POOL_ID")

# Issuer URL for this User Pool — tokens must declare this as `iss`.
ISSUER = f"https://cognito-idp.{_region}.amazonaws.com/{_user_pool_id}"

# Created once at module scope so warm Lambda invocations reuse cached signing
# keys instead of refetching the JWKS on every request.
_jwks_client = jwt.PyJWKClient(f"{ISSUER}/.well-known/jwks.json", cache_keys=True)

_bearer = HTTPBearer(auto_error=False)


def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = credentials.credentials

    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=ISSUER,
            # Access tokens have no `aud` claim; PyJWT verifies exp & iss for us.
            options={"verify_aud": False},
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    if claims.get("token_use") != "access":
        raise HTTPException(status_code=401, detail="Wrong token type")
    if not claims.get("sub"):
        raise HTTPException(status_code=401, detail="Token missing subject")

    return claims
