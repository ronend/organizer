"""FastAPI application for the coo API.

- JSON in/out (FastAPI default)
- NO CORS — the frontend and API share the same CloudFront domain
- origin_verify middleware runs globally, before any route
- auth runs only on the data routes (declared as a dependency on each router)
- /api/auth/token is unauthenticated (only origin_verify guards it)

There is no `uvicorn.run()` — Lambda (via Mangum) drives the app directly.
"""

from fastapi import FastAPI

from src.middleware.origin_verify import origin_verify
from src.routes.auth import router as auth_router
from src.routes.documents import router as documents_router
from src.routes.files import router as files_router
from src.routes.links import router as links_router
from src.routes.migrate import router as migrate_router
from src.routes.state import router as state_router

app = FastAPI(title="coo API")

# Blocks requests that did not come through CloudFront (which injects the
# x-origin-verify header).
app.middleware("http")(origin_verify)

# Token exchange — unauthenticated (only origin_verify guards it).
app.include_router(auth_router)

# Data routes — require a Cognito access token.
app.include_router(state_router)
app.include_router(documents_router)
app.include_router(files_router)
app.include_router(links_router)
app.include_router(migrate_router)
