"""Local entry point. Selects the transport via MCP_TRANSPORT:

  - "stdio" (default) → Claude Code / local
  - "http"            → Streamable HTTP (same gated ASGI app the Lambda serves)

Run with:  python -m src   (from the mcp-server directory, or with PYTHONPATH set)

In the cloud the server runs on Lambda via src/handler.py, not this module.
"""

from __future__ import annotations

import os
import sys

from .server import build_server


def _run_http() -> None:
    import uvicorn

    from .asgi import build_asgi_app

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "3100"))
    print(f"Organizer MCP server listening on http://{host}:{port}/mcp", file=sys.stderr)
    uvicorn.run(build_asgi_app(), host=host, port=port)


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio")

    if transport == "http":
        _run_http()
    else:
        print("Organizer MCP server running on stdio", file=sys.stderr)
        build_server().run(transport="stdio")


if __name__ == "__main__":
    main()
