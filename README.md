# coo

coo is a household "chief of operations": a secretary for one household that
tracks what repeats, what expires and what is coming, and brings it all to one
agenda. It covers people (health and identity documents), cars (insurance,
inspection, registration, service, glovebox documents), trips (a timeline of
reservations) and ad-hoc tasks. The UI/UX is specified in
[coo-ui-ux-spec.md](coo-ui-ux-spec.md); the data model in
[data-structure.md](data-structure.md).

React SPA + FastAPI-on-Lambda API, fronted by a single CloudFront distribution
(no CORS for the API), authenticated with Cognito, persisted in DynamoDB, with
user files in a private S3 bucket.

## Architecture

```
                         ┌──────────────────────────┐
   ┌──────────┐  login   │   Cognito Hosted UI       │
   │  Browser │─────────▶│   (login / logout)        │
   │  (SPA)   │◀─────────│   redirect ?code=…        │
   └────┬─┬───┘  callback└──────────────────────────┘
        │ │
        │ │ presigned PUT/GET (CORS)        ┌──────────────────┐
        │ └────────────────────────────────▶│ S3 files bucket   │
        │ https (single domain)              │ u/<sub>/…         │
        ▼                                    └──────────────────┘
   ┌─────────────────────────────────────────────────┐
   │                 CloudFront                        │
   │   /*      → S3   (static React assets)            │
   │   /api/*  → API Lambda Function URL               │
   │   /mcp    → MCP Lambda Function URL               │
   │            (+ x-origin-verify custom header)      │
   └───────┬─────────────────────────┬─────────────────┘
           ▼                         ▼
     ┌──────────┐            ┌─────────────────┐
     │   S3     │            │  Lambda          │
     │ frontend │            │  (FastAPI via    │
     │  bucket  │            │  Mangum)         │
     └──────────┘            └────────┬─────────┘
                                      │  originVerify → auth (JWT)
                                      ▼
                              ┌──────────────────────────┐
                              │ DynamoDB (single table)   │
                              │ PK userId                 │
                              │ SK COO#<kind>#<id>        │
                              └──────────────────────────┘
```

- The SPA and the API live behind **one** CloudFront domain, so API requests
  are same-origin. Only the files bucket has CORS, because the browser talks
  to S3 directly with short-lived presigned URLs.
- The Lambda Function URL is `AuthType: NONE`; access control is the FastAPI
  `origin_verify` middleware (checks the `x-origin-verify` header CloudFront
  injects) plus Cognito JWT verification on every data route.
- The API is a thin, validated store: `GET /api/state` returns the whole
  household, `POST /api/batch` applies a change set. Domain logic (step
  planning, renewals, status, the Agenda drag rules) lives in the frontend as
  pure functions in `frontend/src/lib/`, which is what makes generic Undo work.

> **Naming.** The app was rebranded from "organizer" to "coo". AWS resource
> names and CloudFormation logical IDs (stack `organizer-app`, the
> `organizer-users` pool, the `organizer-<accountId>` hosted-UI domain,
> `OrganizerTable`, `/organizer/origin-secret`, …) keep the old prefix on
> purpose: renaming them would replace the Cognito pool (losing users), the
> table (losing data) and the login domain. New resources use `coo`.

## Project layout

```
frontend/   React + Vite (TypeScript) SPA
  src/types/coo.ts   data model (the contract with the backend)
  src/lib/           domain logic: templates, ops (mutations), model (status), seed
  src/pages/         Home, Agenda, Trips, Routines, Person, Car, Contacts
  src/dialogs/       every modal: tasks, routines, documents, trips, people/cars
backend/    FastAPI app run on Lambda via Mangum (Python 3.12) + pytest suite
mcp-server/ MCP server (Claude connector) over the same API
iac/        AWS SAM template + deploy config
scripts/    legacy one-off scripts for the pre-coo data model
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
     --parameter-overrides GitHubOrg=ronend GitHubRepo=organizer GitHubEnvironment=prod

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

**Without AWS (mock mode).** The quickest way to work on the UI. The API is
served by an in-browser mock that persists to `localStorage`; there is no login.
On the empty Home screen, use "Load a demo household" for the spec's seed data.

```bash
cd frontend
npm install
npm run dev:mock
```

**Backend tests** (moto-mocked DynamoDB and S3):

```bash
python3 -m venv /tmp/coo-venv
/tmp/coo-venv/bin/pip install -r backend/requirements-dev.txt
cd backend && /tmp/coo-venv/bin/python -m pytest -q tests
```

`tests/test_frontend_contract.py` round-trips a household captured from the
real frontend through the API, so a drift between `frontend/src/types/coo.ts`
and `backend/src/models.py` fails the build.

**Against the deployed backend.** Run the SPA locally and proxy `/api/*` to the deployed Lambda:

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

## GitHub config (Environment: `prod`)

No AWS access keys — auth is via OIDC role assumption (see step 0). The
workflows declare `environment: prod` and read these as **Environment
*variables*** (via the `vars` context), not secrets — none of them are
sensitive (an ARN, names, and `VITE_*` values that are baked into the public JS
bundle anyway). Set them under **Settings → Environments → prod → Environment
variables**.

| Variable                | Value                                            |
|-------------------------|--------------------------------------------------|
| `AWS_DEPLOY_ROLE_ARN`   | `DeployRoleArn` output from the OIDC bootstrap stack |
| `VITE_COGNITO_DOMAIN`   | `CognitoDomain` output                           |
| `VITE_COGNITO_CLIENT_ID`| `UserPoolClientId` output                        |
| `VITE_APP_URL`          | `CloudFrontUrl` output                           |
| `FRONTEND_BUCKET`       | S3 frontend bucket name (`organizer-frontend-…`)  |
| `CF_DISTRIBUTION_ID`    | CloudFront distribution **ID** (e.g. `E2ABC123XYZ`) — not the URL |

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

- Files live under `u/<sub>/` in the private files bucket; the API refuses
  presigned URLs or record references outside the caller's prefix. ID numbers
  are masked in lists and shown in full only in the full-screen viewer.

## Reviewing the design

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for an architecture review covering
correctness bugs, scalability, and performance — recommendations you can opt
into deliberately.
