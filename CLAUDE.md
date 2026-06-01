# Organizer — Claude Code Scaffold Instructions

You are scaffolding a full-stack serverless organizer list application on AWS. Read this entire file before writing a single file or running any command.

---

## Stack Overview

| Layer       | Technology                              |
|-------------|------------------------------------------|
| Frontend    | React + Vite (TypeScript)                |
| Backend     | Node.js Express wrapped with serverless-http, running on AWS Lambda via Function URL |
| Database    | AWS DynamoDB (single table)              |
| Auth        | AWS Cognito User Pool + hosted UI — JWT verified in Express middleware |
| IaC         | AWS SAM (template.yaml)                  |
| CI/CD       | GitHub Actions                           |
| Hosting     | S3 + CloudFront (also proxies Lambda — single domain, no CORS) |

---

## Target Folder Structure

Create exactly this structure. Do not deviate.

```
organizer/
├── frontend/                        # React + Vite app
│   ├── src/
│   │   ├── components/
│   │   │   ├── OrganizerItem.tsx
│   │   │   └── OrganizerList.tsx
│   │   ├── hooks/
│   │   │   └── useOrganizers.ts
│   │   ├── auth/
│   │   │   ├── AuthContext.tsx       # React context: current user + accessToken
│   │   │   ├── useAuth.ts            # Hook: login(), logout(), getAccessToken()
│   │   │   └── AuthCallback.tsx      # Handles Cognito hosted UI redirect (?code=...)
│   │   ├── api/
│   │   │   └── client.ts            # All fetch calls to /api/* — injects Bearer token
│   │   ├── types/
│   │   │   └── organizer.ts              # Shared TypeScript types
│   │   ├── App.tsx                  # Guards routes: redirect to Cognito if not logged in
│   │   └── main.tsx
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── backend/                         # Express app running on Lambda
│   ├── src/
│   │   ├── routes/
│   │   │   └── organizers.ts             # CRUD route handlers
│   │   ├── db/
│   │   │   └── dynamo.ts            # DynamoDB client + helper functions
│   │   ├── middleware/
│   │   │   ├── originVerify.ts      # Blocks requests not from CloudFront
│   │   │   └── auth.ts              # Verifies Cognito JWT; attaches userId to req.user
│   │   ├── app.ts                   # Express app (no listen() call)
│   │   └── handler.ts               # Lambda entry: exports.handler = serverless(app)
│   ├── tsconfig.json
│   └── package.json
│
├── iac/                             # AWS SAM infrastructure-as-code
│   ├── template.yaml                # SAM template (Lambda + DynamoDB + S3 + CloudFront + Cognito)
│   └── samconfig.toml               # SAM deploy defaults (stack name, region, S3 bucket)
│
├── .github/
│   └── workflows/
│       ├── deploy-frontend.yml      # Build Vite app → sync to S3 → invalidate CloudFront
│       └── deploy-backend.yml       # sam build + sam deploy
│
├── .env.example                     # Document required env vars (never commit .env)
├── .gitignore
└── README.md
```

---

## Step-by-Step Instructions

### Step 1 — Scaffold the root

```bash
mkdir organizer && cd organizer
git init
```

Create `.gitignore` with entries for: `node_modules`, `dist`, `.env`, `.aws-sam`, `samconfig.toml` (the toml can contain secrets).

---

### Step 2 — Frontend (`frontend/`)

```bash
cd frontend
npm create vite@latest . -- --template react-ts
npm install
npm install @aws-sdk/client-cognito-identity-provider
```

**`frontend/src/auth/AuthContext.tsx`**
- React context that holds: `{ user: CognitoUser | null, accessToken: string | null, login, logout }`
- On mount: check `localStorage` for a stored access token; validate it is not expired (check `exp` claim in the JWT payload — decode with `atob`, no library needed); if expired call `logout()`
- `login()`: redirect to the Cognito Hosted UI login URL. Construct the URL as:
  ```
  https://<VITE_COGNITO_DOMAIN>/login
    ?client_id=<VITE_COGNITO_CLIENT_ID>
    &response_type=code
    &scope=openid+email
    &redirect_uri=<VITE_APP_URL>/callback
  ```
  Read all values from `import.meta.env`
- `logout()`: clear `localStorage`, redirect to Cognito logout endpoint:
  ```
  https://<VITE_COGNITO_DOMAIN>/logout
    ?client_id=<VITE_COGNITO_CLIENT_ID>
    &logout_uri=<VITE_APP_URL>
  ```

**`frontend/src/auth/AuthCallback.tsx`**
- Rendered at the `/callback` route
- On mount: extract `?code=` from the URL, POST it to `/api/auth/token` (a Lambda route — see backend), receive `{ accessToken, idToken, expiresIn }`, store `accessToken` in `localStorage`, redirect to `/`
- Show a loading spinner while the exchange is in progress
- Show an error message if the exchange fails

**`frontend/src/auth/useAuth.ts`**
- Simple hook: `return useContext(AuthContext)`

**`frontend/src/api/client.ts`**
- Base URL is `/api`
- Before every request, call `getAccessToken()` from `AuthContext` — if null, redirect to login
- Inject header: `Authorization: Bearer <accessToken>` on every request
- If any response returns `401`, clear the token and redirect to login
- Export typed async functions: `getOrganizers()`, `createOrganizer(text)`, `updateOrganizer(id, done)`, `deleteOrganizer(id)`
- No CORS configuration needed — same origin

**`frontend/src/App.tsx`**
- Wrap the app in `<AuthProvider>`
- Define routes: `/` → `<OrganizerList>` (protected), `/callback` → `<AuthCallback>`
- If user is not authenticated and route is not `/callback`, redirect to Cognito login immediately

**`frontend/src/types/organizer.ts`**
```ts
export interface Organizer {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  userId: string;
}
```

**`frontend/src/hooks/useOrganizers.ts`**
- Custom hook managing organizers state + loading/error state
- Calls api/client.ts functions

**`frontend/src/components/OrganizerList.tsx` and `OrganizerItem.tsx`**
- Clean, minimal UI — no external component library needed
- OrganizerItem: checkbox to toggle done, delete button, inline text
- Show a logout button in the header

**`frontend/vite.config.ts`**
- Set `base: '/'`
- Build output: `dist/`

---

### Step 3 — Backend (`backend/`)

```bash
cd backend
npm init -y
npm install express serverless-http @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb uuid jwks-rsa jsonwebtoken node-fetch
npm install -D typescript @types/express @types/node @types/uuid @types/jsonwebtoken ts-node esbuild
```

**`backend/src/handler.ts`** — Lambda entry point:
```ts
import serverless from 'serverless-http';
import { app } from './app';
export const handler = serverless(app);
```

**`backend/src/app.ts`** — Express setup:
- Mount `/api/auth` router (token exchange — unauthenticated)
- Mount `/api/organizers` router (protected — auth middleware runs first)
- Add JSON body parser middleware
- **Do NOT add CORS headers** — frontend and API share the same CloudFront domain
- Apply `originVerify` middleware globally (before all routes)
- Apply `auth` middleware only on `/api/organizers` routes, not on `/api/auth`
- Do NOT call `app.listen()` — Lambda handles that

**`backend/src/routes/auth.ts`** — Token exchange route:
- `POST /api/auth/token` — accepts `{ code: string }` in the body
- Exchanges the authorization code for tokens by calling the Cognito token endpoint:
  ```
  POST https://<COGNITO_DOMAIN>/oauth2/token
  Content-Type: application/x-www-form-urlencoded

  grant_type=authorization_code
  &client_id=<COGNITO_CLIENT_ID>
  &code=<code>
  &redirect_uri=<APP_URL>/callback
  ```
  All values from `process.env`
- Returns `{ accessToken, idToken, expiresIn }` to the frontend
- Returns `400` if code is missing, `502` if Cognito exchange fails

**`backend/src/routes/organizers.ts`** — CRUD routes:
- `GET /api/organizers` — list all organizers for the requesting user
- `POST /api/organizers` — create organizer `{ text }` → returns new organizer
- `PUT /api/organizers/:id` — update `{ done?, text? }`
- `DELETE /api/organizers/:id` — delete by id
- Each handler reads `userId` from `req.user.sub` (set by auth middleware from the JWT `sub` claim)

**`backend/src/db/dynamo.ts`** — DynamoDB helpers:
- Single table name from `process.env.DYNAMO_TABLE`
- Use `@aws-sdk/lib-dynamodb` (DocumentClient style)
- Partition key: `userId` (String), Sort key: `organizerId` (String)
- Export: `listOrganizers(userId)`, `createOrganizer(userId, text)`, `updateOrganizer(userId, id, updates)`, `deleteOrganizer(userId, id)`

**`backend/src/middleware/originVerify.ts`**
- Check `x-origin-verify` header against `process.env.ORIGIN_SECRET`
- Return `403` if missing or wrong — blocks direct Lambda URL access bypassing CloudFront

**`backend/src/middleware/auth.ts`** — Cognito JWT verification:
- Extract `Authorization: Bearer <token>` header — return `401` if missing
- Verify the JWT using `jwks-rsa` + `jsonwebtoken`:
  ```ts
  // JWKS endpoint for your User Pool:
  // https://cognito-idp.<REGION>.amazonaws.com/<USER_POOL_ID>/.well-known/jwks.json
  const client = jwksClient({
    jwksUri: `https://cognito-idp.${process.env.AWS_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}/.well-known/jwks.json`,
    cache: true,
    rateLimit: true,
  });
  ```
- Check claims: `token_use` must be `'access'`, `iss` must match the User Pool URL, `exp` must not be in the past
- Attach decoded payload to `req.user` — routes read `req.user.sub` as the userId
- Return `401` on any verification failure

**`backend/tsconfig.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

**Build command** (add to `package.json` scripts):
```json
"build": "esbuild src/handler.ts --bundle --platform=node --target=node20 --outfile=dist/handler.js"
```

---

### Step 4 — IaC (`iac/`)

**`iac/template.yaml`** — SAM template. Create all resources below:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Serverless Organizer

Globals:
  Function:
    Runtime: nodejs20.x
    Timeout: 15
    MemorySize: 256
    Environment:
      Variables:
        DYNAMO_TABLE: !Ref OrganizerTable
        ORIGIN_SECRET: !Sub '{{resolve:ssm:/organizer/origin-secret}}'
        COGNITO_USER_POOL_ID: !Ref UserPool
        COGNITO_CLIENT_ID: !Ref UserPoolClient
        COGNITO_DOMAIN: !Sub 'https://${UserPoolDomain}.auth.${AWS::Region}.amazoncognito.com'
        APP_URL: !Sub 'https://${CloudFrontDistribution.DomainName}'

Resources:

  # --- Cognito User Pool ---
  UserPool:
    Type: AWS::Cognito::UserPool
    Properties:
      UserPoolName: organizer-users
      UsernameAttributes:
        - email
      AutoVerifiedAttributes:
        - email
      Policies:
        PasswordPolicy:
          MinimumLength: 8
          RequireUppercase: true
          RequireLowercase: true
          RequireNumbers: true
          RequireSymbols: false
      Schema:
        - Name: email
          AttributeDataType: String
          Required: true
          Mutable: true

  UserPoolClient:
    Type: AWS::Cognito::UserPoolClient
    Properties:
      ClientName: organizer-client
      UserPoolId: !Ref UserPool
      GenerateSecret: false                 # Public client — no secret needed for SPA
      AllowedOAuthFlows:
        - code                              # Authorization code flow only
      AllowedOAuthScopes:
        - openid
        - email
      AllowedOAuthFlowsUserPoolClient: true
      CallbackURLs:
        - !Sub 'https://${CloudFrontDistribution.DomainName}/callback'
      LogoutURLs:
        - !Sub 'https://${CloudFrontDistribution.DomainName}'
      SupportedIdentityProviders:
        - COGNITO
      ExplicitAuthFlows:
        - ALLOW_REFRESH_TOKEN_AUTH
        - ALLOW_USER_SRP_AUTH

  UserPoolDomain:
    Type: AWS::Cognito::UserPoolDomain
    Properties:
      Domain: !Sub 'organizer-${AWS::AccountId}'   # Must be globally unique
      UserPoolId: !Ref UserPool

  # --- Lambda ---
  OrganizerFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      CodeUri: ../backend/dist/
      FunctionUrlConfig:
        AuthType: NONE          # Auth is handled in Express middleware
        Cors:
          AllowOrigins:
            - !Sub 'https://${CloudFrontDistribution.DomainName}'
          AllowMethods: ['GET','POST','PUT','DELETE','OPTIONS']
          AllowHeaders: ['content-type','authorization']
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref OrganizerTable

  # --- DynamoDB ---
  OrganizerTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: organizer-items
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: userId
          AttributeType: S
        - AttributeName: organizerId
          AttributeType: S
      KeySchema:
        - AttributeName: userId
          KeyType: HASH
        - AttributeName: organizerId
          KeyType: RANGE

  # --- S3 Bucket for frontend ---
  FrontendBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub 'organizer-frontend-${AWS::AccountId}'
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true

  FrontendBucketPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref FrontendBucket
      PolicyDocument:
        Statement:
          - Effect: Allow
            Principal:
              Service: cloudfront.amazonaws.com
            Action: s3:GetObject
            Resource: !Sub '${FrontendBucket.Arn}/*'
            Condition:
              StringEquals:
                AWS:SourceArn: !Sub 'arn:aws:cloudfront::${AWS::AccountId}:distribution/${CloudFrontDistribution}'

  # --- CloudFront ---
  CloudFrontOAC:
    Type: AWS::CloudFront::OriginAccessControl
    Properties:
      OriginAccessControlConfig:
        Name: organizer-oac
        OriginAccessControlOriginType: s3
        SigningBehavior: always
        SigningProtocol: sigv4

  CloudFrontDistribution:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Enabled: true
        DefaultRootObject: index.html
        Origins:
          # Origin 1: S3 for static frontend assets
          - Id: S3Origin
            DomainName: !GetAtt FrontendBucket.RegionalDomainName
            OriginAccessControlId: !Ref CloudFrontOAC
            S3OriginConfig: {}

          # Origin 2: Lambda Function URL for API calls
          - Id: LambdaOrigin
            DomainName: !Select [2, !Split ["/", !GetAtt OrganizerFunctionUrl.FunctionUrl]]
            CustomOriginConfig:
              HTTPSPort: 443
              OriginProtocolPolicy: https-only
            OriginCustomHeaders:
              - HeaderName: x-origin-verify
                HeaderValue: !Sub '{{resolve:ssm:/organizer/origin-secret}}'

        # Route /api/* to Lambda; everything else to S3
        CacheBehaviors:
          - PathPattern: /api/*
            TargetOriginId: LambdaOrigin
            ViewerProtocolPolicy: https-only
            CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad        # CachingDisabled
            OriginRequestPolicyId: b689b0a8-53d0-40ab-baf2-68738e2966ac # AllViewerExceptHostHeader
            AllowedMethods: [GET, HEAD, OPTIONS, PUT, PATCH, POST, DELETE]

        DefaultCacheBehavior:
          TargetOriginId: S3Origin
          ViewerProtocolPolicy: redirect-to-https
          CachePolicyId: 658327ea-f89d-4fab-a63d-7e88639e58f6            # CachingOptimized

        CustomErrorResponses:
          - ErrorCode: 403
            ResponseCode: 200
            ResponsePagePath: /index.html
          - ErrorCode: 404
            ResponseCode: 200
            ResponsePagePath: /index.html

Outputs:
  CloudFrontUrl:
    Description: Single URL for both frontend and API
    Value: !Sub 'https://${CloudFrontDistribution.DomainName}'
  LambdaFunctionUrl:
    Description: Direct Lambda URL (keep secret — only CloudFront should call this)
    Value: !GetAtt OrganizerFunctionUrl.FunctionUrl
  UserPoolId:
    Value: !Ref UserPool
  UserPoolClientId:
    Value: !Ref UserPoolClient
  CognitoDomain:
    Value: !Sub 'https://${UserPoolDomain}.auth.${AWS::Region}.amazoncognito.com'
  TableName:
    Value: !Ref OrganizerTable
```

**`iac/samconfig.toml`**:
```toml
[default.deploy.parameters]
stack_name = "organizer"
region = "us-east-1"
confirm_changeset = false
capabilities = "CAPABILITY_IAM"
s3_prefix = "organizer"
# s3_bucket = "your-sam-deployment-bucket"   ← fill this in before first deploy
```

---

### Step 5 — GitHub Actions (`.github/workflows/`)

**`deploy-backend.yml`**:
```yaml
name: Deploy Backend

on:
  push:
    branches: [main]
    paths: ['backend/**', 'iac/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Build Lambda
        working-directory: backend
        run: npm ci && npm run build
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - name: SAM Deploy
        working-directory: iac
        run: |
          sam build
          sam deploy --no-confirm-changeset
```

**`deploy-frontend.yml`**:
```yaml
name: Deploy Frontend

on:
  push:
    branches: [main]
    paths: ['frontend/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Build
        working-directory: frontend
        env:
          VITE_COGNITO_DOMAIN: ${{ secrets.VITE_COGNITO_DOMAIN }}
          VITE_COGNITO_CLIENT_ID: ${{ secrets.VITE_COGNITO_CLIENT_ID }}
          VITE_APP_URL: ${{ secrets.VITE_APP_URL }}
        run: npm ci && npm run build
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - name: Sync to S3
        run: aws s3 sync frontend/dist/ s3://${{ secrets.FRONTEND_BUCKET }} --delete
      - name: Invalidate CloudFront
        run: aws cloudfront create-invalidation --distribution-id ${{ secrets.CF_DISTRIBUTION_ID }} --paths "/*"
```

---

### Step 6 — `.env.example`

```
# Backend (Lambda env vars — set via SAM template referencing SSM; use .env for local dev only)
DYNAMO_TABLE=organizer-items
ORIGIN_SECRET=change-me-before-deploy        # Must match /organizer/origin-secret in SSM
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX     # From SAM deploy output: UserPoolId
COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX  # From SAM deploy output: UserPoolClientId
COGNITO_DOMAIN=https://organizer-<accountId>.auth.us-east-1.amazoncognito.com
APP_URL=https://<your-cloudfront-domain>      # From SAM deploy output: CloudFrontUrl

# Frontend (Vite build-time — baked into the JS bundle at build time)
VITE_COGNITO_DOMAIN=https://organizer-<accountId>.auth.us-east-1.amazoncognito.com
VITE_COGNITO_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_APP_URL=https://<your-cloudfront-domain>
```

---

### Step 7 — README.md

Write a README with these sections:
1. **Architecture diagram** (ASCII is fine) — show: `User → Cognito Hosted UI (login) → CloudFront → S3 (/*) and Lambda (/api/*) → DynamoDB`
2. **Prerequisites** — AWS CLI, SAM CLI, Node 20, GitHub repo with secrets
3. **First deploy** — step-by-step:
   - Create SSM param: `aws ssm put-parameter --name /organizer/origin-secret --value "..." --type String`
   - Run `sam build && sam deploy` from `iac/`
   - Copy all Outputs (CloudFrontUrl, UserPoolId, UserPoolClientId, CognitoDomain)
   - Create initial users in Cognito: `aws cognito-idp admin-create-user --user-pool-id <id> --username user@example.com`
   - Set GitHub Secrets, push to `main`
4. **Local development** — `npm run dev` in frontend with a `.env` file; configure Vite proxy to forward `/api/*` to the deployed Lambda URL for local testing
5. **GitHub Secrets required** — `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `VITE_COGNITO_DOMAIN`, `VITE_COGNITO_CLIENT_ID`, `VITE_APP_URL`, `FRONTEND_BUCKET`, `CF_DISTRIBUTION_ID`
6. **Security notes** — Lambda Function URL is internal only; Cognito tokens expire in 1 hour and are refreshed automatically; users are managed in the Cognito console or via CLI

---

## Constraints & Rules

- **Never call `app.listen()`** in backend — Lambda handles it
- **Never hardcode credentials** — use SSM Parameter Store for `ORIGIN_SECRET`; all Cognito values come from SAM template outputs injected as Lambda env vars
- **DynamoDB BillingMode must be `PAY_PER_REQUEST`** — no provisioned throughput
- **Lambda Function URL, not API Gateway** — keeps cost at zero
- **Lambda sits behind CloudFront** — all traffic (frontend and API) goes through a single CloudFront distribution
- **All API routes must be prefixed `/api/`** — CloudFront routes `/api/*` to Lambda, everything else to S3
- **No CORS config in Express** — frontend and API share the same domain via CloudFront
- **Origin verify middleware is mandatory** — every Lambda request must validate `x-origin-verify` against `ORIGIN_SECRET` before any other logic. Return `403` if absent or wrong.
- **Auth middleware uses Cognito JWT only** — no static API keys. Extract `Authorization: Bearer` header, verify signature against Cognito JWKS, check `token_use === 'access'`, extract `sub` as userId.
- **`/api/auth/token` is unauthenticated** — it is the token exchange endpoint; do NOT apply JWT auth middleware to it, only `originVerify`
- **`userId` always comes from `req.user.sub`** — never trust a userId passed in the request body or query string
- **Use `AllViewerExceptHostHeader` origin request policy for Lambda origin** — required so Lambda doesn't reject requests due to Host header mismatch
- **All TypeScript** — no plain JS files in `src/` directories
- **esbuild for Lambda bundling** — not tsc, not webpack
- Frontend build output must go to `frontend/dist/`
- Backend build output must go to `backend/dist/handler.js` (single bundled file)
- The SAM template lives in `iac/` but references `../backend/dist/` as CodeUri
- **`UserPoolDomain` must be globally unique** — use `organizer-${AWS::AccountId}` as the domain prefix

---

## Do This Last

After all files are created, run:
```bash
cd frontend && npm install
cd ../backend && npm install
```

Then print a summary of what was created and the following manual steps the user must take before first deploy:

1. Create the SSM parameter for the origin secret:
   ```bash
   aws ssm put-parameter --name /organizer/origin-secret --value "$(openssl rand -hex 32)" --type String
   ```
2. Create an S3 bucket for SAM deployment artifacts and fill it into `iac/samconfig.toml`
3. Run first deploy from `iac/`:
   ```bash
   sam build && sam deploy
   ```
4. Copy all stack Outputs: `CloudFrontUrl`, `UserPoolId`, `UserPoolClientId`, `CognitoDomain`
5. Create initial users in Cognito (repeat for each of the 5 users):
   ```bash
   aws cognito-idp admin-create-user \
     --user-pool-id <UserPoolId> \
     --username user@example.com \
     --temporary-password TempPass1! \
     --message-action SUPPRESS
   ```
6. Set GitHub Secrets:
   - `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
   - `VITE_COGNITO_DOMAIN` — value of `CognitoDomain` output
   - `VITE_COGNITO_CLIENT_ID` — value of `UserPoolClientId` output
   - `VITE_APP_URL` — value of `CloudFrontUrl` output
   - `FRONTEND_BUCKET` — the S3 bucket name from the stack
   - `CF_DISTRIBUTION_ID` — the CloudFront distribution ID
7. Push to `main` to trigger both deploy workflows
8. Open `CloudFrontUrl` in a browser — you should be redirected to the Cognito hosted login page
