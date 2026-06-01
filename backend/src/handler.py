"""Lambda entry point. Mangum adapts the FastAPI ASGI app to the Lambda
Function URL event format (API Gateway HTTP API / payload format v2)."""

from mangum import Mangum

from src.app import app

handler = Mangum(app)
