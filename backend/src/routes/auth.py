"""Token exchange route (unauthenticated — only originVerify guards it).

POST /api/auth/token exchanges a Cognito authorization code for tokens. This
runs server-side so the (public) SPA never handles the raw token endpoint.
"""

import logging
import os
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth")


class TokenRequest(BaseModel):
    code: Optional[str] = None


@router.post("/token")
def exchange_token(body: TokenRequest):
    if not body.code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    domain = os.environ["COGNITO_DOMAIN"]
    client_id = os.environ["COGNITO_CLIENT_ID"]
    app_url = os.environ["APP_URL"]

    try:
        resp = requests.post(
            f"{domain}/oauth2/token",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "code": body.code,
                "redirect_uri": f"{app_url}/callback",
            },
            timeout=10,
        )
    except requests.RequestException as e:
        logger.error("Cognito token exchange error: %s", e)
        raise HTTPException(status_code=502, detail="Token exchange failed")

    if not resp.ok:
        logger.error("Cognito token exchange failed: %s %s", resp.status_code, resp.text)
        raise HTTPException(status_code=502, detail="Token exchange failed")

    data = resp.json()
    return {
        "accessToken": data["access_token"],
        "idToken": data["id_token"],
        "expiresIn": data["expires_in"],
    }
