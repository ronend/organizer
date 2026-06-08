"""AWS Lambda entry point — wraps the Streamable HTTP ASGI app with Mangum.

CloudFront routes /mcp to this function's Function URL (injecting x-origin-verify).
lifespan="on" runs the MCP session manager's startup once per cold start and keeps
its task group alive for the container's life, so stateless requests can spawn into
it. There is no uvicorn here — Lambda drives the ASGI app via Mangum.
"""

from mangum import Mangum

from .asgi import build_asgi_app

handler = Mangum(build_asgi_app(), lifespan="on")
