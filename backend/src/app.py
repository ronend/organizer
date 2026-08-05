"""FastAPI application.

- JSON in/out (FastAPI default)
- NO CORS — the frontend and API share the same CloudFront domain
- originVerify middleware runs globally, before any route
- auth runs only on the data routes (wired in via Depends in each router)
- /api/auth/token is unauthenticated (only originVerify guards it)

There is no `uvicorn.run()` — Lambda (via Mangum) drives the app directly.
"""

from fastapi import FastAPI

from src.middleware.origin_verify import origin_verify
from src.routes.auth import router as auth_router
from src.routes.items import router as items_router
from src.routes.views import reminders_router

app = FastAPI(title="Organizer API")

# Origin verification runs globally, before route logic. Blocks requests that
# did not come through CloudFront (which injects the x-origin-verify header).
app.middleware("http")(origin_verify)

# Token exchange — unauthenticated (only originVerify guards it).
app.include_router(auth_router)

# Data routes — the auth dependency is declared on each router itself.
app.include_router(items_router)
app.include_router(reminders_router)
