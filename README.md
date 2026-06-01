# Serverless Organizer

A full-stack, serverless organizer list on AWS. React SPA + FastAPI-on-Lambda API,
fronted by a single CloudFront distribution (no CORS), authenticated with
Cognito, persisted in DynamoDB.

## Architecture

```
                         ┌──────────────────────────┐
   ┌──────────┐  login   │   Cognito Hosted UI       │
   │  Browser │─────────▶│   (login / logout)        │
   │  (SPA)   │◀─────────│   redirect ?code=…        │
   └────┬─────┘  callback└──────────────────────────┘
        │
        │ https (single domain)
        ▼
   ┌─────────────────────────────────────────────────┐
   │                 CloudFront                        │
   │   /*      → S3   (static React assets)            │
   │   /api/*  → Lambda Function URL                   │
   │            (+ x-origin-verify custom header)      │
   └───────┬─────────────────────────┬─────────────────┘
           │                         │
           ▼                         ▼
     ┌──────────┐            ┌─────────────────┐
     │   S3     │            │  Lambda          │
     │ frontend │            │  (FastAPI via    │
     │  bucket  │            │  Mangum)         │
     └──────────┘            └────────┬─────────┘
                                      │  originVerify → auth (JWT)
                                      ▼
                              ┌───────────────────┐
                              │   DynamoDB         │
                              │   organizer-items  │
                              │   PK userId        │
                              │   SK organizerId   │
                              └───────────────────┘
```

- The SPA and the API live behind **one** CloudFront domain, so requests are
  same-origin → no CORS configuration anywhere.
- The Lambda Function URL is `AuthType: NONE`; access control is the FastAPI
  `origin_verify` middleware (checks the `x-origin-verify` header CloudFront
  injects) plus Cognito JWT verification on `/api/organizers`.

## Project layout

```
frontend/   React + Vite (TypeScript) SPA
backend/    FastAPI app run on Lambda via Mangum (Python 3.12)
iac/        AWS SAM template + deploy config
.github/    GitHub Actions deploy workflows
```

## Prerequisites

- AWS CLI v2, configured with credentials
- AWS SAM CLI
- Python 3.12 (backend) and Node.js 20 (frontend build)
- Docker (for `sam build --use-container`)
- A GitHub repository with the secrets listed below

## First deploy

0. **Bootstrap GitHub → AWS OIDC (one time, with admin credentials).** This
   creates the OIDC trust + the deploy role the workflows assume — there are no
   long-lived AWS access keys anywhere. It is a separate stack from the app on
   purpose (the workflows need the role *before* they can deploy the app):

   ```bash
   aws cloudformation deploy \
     --stack-name organizer-github-oidc \
     --template-file iac/github-oidc.yaml \
     --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides GitHubOrg=ronend GitHubRepo=organizer Branch=main

   # Read the role ARN to set as the AWS_DEPLOY_ROLE_ARN GitHub secret:
   aws cloudformation describe-stacks --stack-name organizer-github-oidc \
     --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" --output text
   ```

   > If the account already has a GitHub OIDC provider, add
   > `CreateOIDCProvider=false ExistingOIDCProviderArn=<arn>` to the
   > `--parameter-overrides`.

1. **Create the origin-secret SSM parameter** (shared between CloudFront and
   the Lambda). Use `--type String`: the template resolves it via the plain
   `{{resolve:ssm:...}}` prefix, which CloudFormation does not allow for
   `SecureString`, and `ssm-secure` isn't supported in the CloudFront/Lambda
   properties that consume it. (The value is also exposed in the resolved Lambda
   env and CloudFront header anyway, so a SecureString here adds little.)

   ```bash
   aws ssm put-parameter \
     --name /organizer/origin-secret \
     --value "$(openssl rand -hex 32)" \
     --type String
   ```

2. **SAM deployment bucket** — none needed: [iac/samconfig.toml](iac/samconfig.toml)
   sets `resolve_s3 = true`, so SAM manages the artifact bucket automatically.

3. **Build & first deploy** (from `iac/`). `--use-container` builds the Python
   package inside a Lambda-like image so native wheels (PyJWT's `cryptography`)
   match the runtime. Leave `AppUrl` empty on this first pass — CloudFront's
   domain doesn't exist yet (wiring it in up front would be a circular
   dependency):

   ```bash
   cd iac
   sam build --use-container
   sam deploy
   ```

4. **Copy the stack Outputs** (`CloudFrontUrl`, `UserPoolId`, `UserPoolClientId`,
   `CognitoDomain`, `TableName`, distribution ID, frontend bucket name), then
   **re-deploy with `AppUrl`** to wire up OAuth (Lambda `APP_URL`, Cognito
   callback/logout URLs, Function URL CORS):

   ```bash
   sam deploy --parameter-overrides AppUrl=$(aws cloudformation describe-stacks \
     --stack-name organizer-app \
     --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" --output text)
   ```

5. **Create initial users** in Cognito (repeat per user):

   ```bash
   aws cognito-idp admin-create-user \
     --user-pool-id <UserPoolId> \
     --username user@example.com \
     --temporary-password 'TempPass1!' \
     --message-action SUPPRESS
   ```

6. **Set the GitHub Secrets** (see below), then push to `main` to trigger both
   deploy workflows.

7. **Open `CloudFrontUrl`** in a browser — you should be redirected to the
   Cognito hosted login page.

## Local development

Run the SPA locally and proxy `/api/*` to the deployed Lambda:

1. Create `frontend/.env` (do **not** commit it):

   ```
   VITE_COGNITO_DOMAIN=https://organizer-<accountId>.auth.us-east-1.amazoncognito.com
   VITE_COGNITO_CLIENT_ID=<UserPoolClientId>
   VITE_APP_URL=http://localhost:5173
   ```

2. Point the Vite dev proxy at the deployed CloudFront/Lambda by exporting
   `VITE_API_PROXY_TARGET` (see [frontend/vite.config.ts](frontend/vite.config.ts)),
   then:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   > Note: the Cognito client's callback/logout URLs point at the CloudFront
   > domain. To test the full login flow locally, add `http://localhost:5173/callback`
   > and `http://localhost:5173` to the User Pool client's allowed URLs.

## GitHub Secrets required

No AWS access keys — auth is via OIDC role assumption (see step 0).

| Secret                  | Value                                            |
|-------------------------|--------------------------------------------------|
| `AWS_DEPLOY_ROLE_ARN`   | `DeployRoleArn` output from the OIDC bootstrap stack |
| `VITE_COGNITO_DOMAIN`   | `CognitoDomain` output                           |
| `VITE_COGNITO_CLIENT_ID`| `UserPoolClientId` output                        |
| `VITE_APP_URL`          | `CloudFrontUrl` output                           |
| `FRONTEND_BUCKET`       | S3 frontend bucket name (`organizer-frontend-…`)  |
| `CF_DISTRIBUTION_ID`    | CloudFront distribution ID                       |

## Security notes

- The Lambda Function URL is **internal only** — only CloudFront should call it.
  The `x-origin-verify` shared secret (stored in SSM) blocks direct access.
- `userId` is **always** taken from the verified JWT `sub` claim, never from the
  request body or query string.
- Cognito access tokens expire in ~1 hour. This scaffold redirects the user back
  to login on expiry; see [IMPROVEMENTS.md](IMPROVEMENTS.md) for silent-refresh
  options.
- Manage users via the Cognito console or the AWS CLI.
- **CI/CD uses GitHub OIDC, not stored AWS keys.** The deploy role
  ([iac/github-oidc.yaml](iac/github-oidc.yaml)) trusts only this repo's `main`
  branch (`sub = repo:ronend/organizer:ref:refs/heads/main`) and issues
  short-lived (≤1h) credentials per run. IAM permissions are scoped to this
  app's resources; `iam:*` is restricted to `organizer*` roles to prevent
  privilege escalation.

## Reviewing the design

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for an architecture review covering
correctness bugs, scalability, and performance — recommendations you can opt
into deliberately.
