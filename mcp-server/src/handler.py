"""AWS Lambda entry point — wraps the Streamable HTTP ASGI app with Mangum.

Why build per invocation (not once at module load):
  Mangum runs the ASGI *lifespan* (startup + shutdown) on every invocation, but
  the MCP `StreamableHTTPSessionManager.run()` may be entered only ONCE per
  instance — re-entry raises "StreamableHTTPSessionManager .run() can only be
  called once per instance". A module-level `Mangum(build_asgi_app())` reused
  across warm invocations therefore 500s on the 2nd request to a container
  (the 1st enters run(), shutdown exits it, the 2nd re-enters → RuntimeError).

  So we construct a fresh ASGI app — hence a fresh session manager — per
  invocation and let Mangum drive its lifespan once. The build is cheap
  (FastMCP + tool/resource registration), and the server runs in
  stateless + json_response mode, so each request is self-contained anyway —
  per-request construction is correct as well as simple. There is no uvicorn
  here; Lambda drives the ASGI app via Mangum.
"""

from mangum import Mangum

from .asgi import build_asgi_app


def handler(event, context):
    # Fresh app (fresh StreamableHTTPSessionManager) each invocation, so
    # Mangum's per-invocation lifespan never re-enters the same run().
    return Mangum(build_asgi_app(), lifespan="on")(event, context)
