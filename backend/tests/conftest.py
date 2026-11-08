"""Test setup: moto-mocked DynamoDB + S3, a TestClient, and a fake Cognito user.

Env vars are set before anything under ``src`` is imported (auth.py and the
routes read them at import time / first use).
"""

import os
import uuid

os.environ.update(
    {
        "AWS_REGION": "us-east-1",
        "AWS_DEFAULT_REGION": "us-east-1",
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_SESSION_TOKEN": "testing",
        "DYNAMO_TABLE": "coo-test-table",
        "FILES_BUCKET": "coo-test-files",
        "ORIGIN_SECRET": "test-origin-secret",
        "COGNITO_USER_POOL_ID": "us-east-1_TEST",
        "COGNITO_CLIENT_ID": "test-client",
        "COGNITO_DOMAIN": "https://example.auth.us-east-1.amazoncognito.com",
        "APP_URL": "https://app.example.com",
    }
)

import boto3  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from moto import mock_aws  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def aws():
    with mock_aws():
        ddb = boto3.client("dynamodb")
        ddb.create_table(
            TableName=os.environ["DYNAMO_TABLE"],
            AttributeDefinitions=[
                {"AttributeName": "userId", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "userId", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        boto3.client("s3").create_bucket(Bucket=os.environ["FILES_BUCKET"])
        yield


@pytest.fixture()
def sub():
    """A fresh user per test, so tests never see each other's rows."""
    return f"user-{uuid.uuid4()}"


@pytest.fixture()
def client(sub):
    from src.app import app
    from src.middleware.auth import require_auth

    app.dependency_overrides[require_auth] = lambda: {"sub": sub, "token_use": "access"}
    with TestClient(app, headers={"x-origin-verify": os.environ["ORIGIN_SECRET"]}) as c:
        yield c
    app.dependency_overrides.clear()
