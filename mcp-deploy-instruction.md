# Deploy MCP Server to AWS Lambda + CloudFront

## Context

The todo webapp already runs on:
- **S3** — static frontend
- **Lambda Function URLs** — app backend
- **CloudFront** — single distribution in front of both
- **GitHub Actions** — automated deploys on push

This instruction adds the MCP server from `INSTRUCTIONS.md` as a **second Lambda function** behind the same CloudFront distribution, reusing every piece of existing infrastructure. No new AWS services. No new pipelines.

## Prerequisites

Before starting, confirm the following exist in the repo:
- A working GitHub Actions workflow that deploys the existing Lambda (call it `workflow-deploy.yml` — use whatever the actual filename is)
- AWS credentials already stored as GitHub Actions secrets (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` or an OIDC role — match whatever the existing workflow uses)
- The existing Lambda's IAM execution role ARN (you will reuse or clone it)
- The CloudFront distribution ID (stored somewhere in the workflow or AWS console)

---

## Step 1 — Adapt `mcp-server/` for Lambda

The MCP server code from `INSTRUCTIONS.md` uses `express` for the HTTP transport. Lambda does not run a persistent HTTP server — instead it receives individual invocations via the Lambda Function URL. Replace the express listener with a Lambda-compatible handler.

### 1a — Add the Lambda adapter dependency

Inside `mcp-server/`:

```bash
npm install @modelcontextprotocol/sdk serverless-http
npm install -D @types/aws-lambda
```

`serverless-http` wraps the express app so it handles Lambda `event`/`context` invocations without changing any tool or resource code.

### 1b — Update `src/index.ts` to export a Lambda handler

The entry point must detect whether it is running in Lambda (no persistent server) or locally (stdio or express). Use the presence of the `AWS_LAMBDA_FUNCTION_NAME` environment variable as the signal.

Structure the entry point with three branches:

**Branch 1 — Lambda (HTTP transport via Function URL)**
- Create the express app exactly as described in `INSTRUCTIONS.md` Steps 5 and 6
- Wrap it with `serverless-http` instead of calling `app.listen()`
- Export the result as `handler`

**Branch 2 — Local HTTP (for local testing with `MCP_TRANSPORT=http`)**
- Same express app, but call `app.listen()` as before

**Branch 3 — stdio (for Claude Code)**
- `StdioServerTransport` as before

The key constraint: when exporting `handler` for Lambda, do **not** call `app.listen()` — Lambda manages the HTTP lifecycle.

### 1c — Build output

Lambda needs a CommonJS bundle or ESM with a file it can import. Configure `tsconfig.json` for Lambda:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true
  }
}
```

Note: this differs from the `Node16` module setting used for local stdio mode. If you want to keep both, use two tsconfig files (`tsconfig.json` for Lambda build, `tsconfig.local.json` for stdio dev).

Add a build script to `package.json`:

```json
"scripts": {
  "build:lambda": "tsc -p tsconfig.json",
  "build:local": "tsc -p tsconfig.local.json",
  "start": "node dist/index.js",
  "dev": "tsx src/index.ts"
}
```

---

## Step 2 — Create the Lambda deployment package script

Add `mcp-server/scripts/package.sh`. This script is called from GitHub Actions to produce the zip file Lambda expects.

The script must:
1. Run `npm ci --omit=dev` to install production dependencies only
2. Run `npm run build:lambda` to compile TypeScript
3. Zip `dist/` and `node_modules/` together into `mcp-server.zip`
4. Output the zip to the repo root (or a known path the Actions step can reference)

The zip structure Lambda expects:
```
mcp-server.zip
  dist/
    index.js      ← compiled entry point exporting `handler`
    tools.js
    resources.js
    client.js
  node_modules/
    ...
```

The Lambda handler setting (configured in AWS) must be: `dist/index.handler`

---

## Step 3 — Create the Lambda function in AWS (one-time setup)

This step is performed once manually (or via the AWS CLI). After this, all subsequent deploys are handled by GitHub Actions.

### 3a — IAM execution role

The MCP Lambda needs an execution role with:
- `AWSLambdaBasicExecutionRole` (for CloudWatch logs)
- No additional permissions needed — the function only calls the webapp's own API over HTTPS

If the existing app Lambda already has a minimal role like this, reuse it. If not, create a new role with only `AWSLambdaBasicExecutionRole` attached. Record the role ARN.

### 3b — Create the function

Use the AWS CLI or console:

- **Runtime:** `nodejs20.x`
- **Handler:** `dist/index.handler`
- **Architecture:** `arm64` (cheaper, ~20% faster for Node.js workloads on Lambda)
- **Memory:** `256 MB` (sufficient for a stateless MCP proxy)
- **Timeout:** `30 seconds` (MCP tool calls are synchronous; 30s is a safe ceiling)
- **Execution role:** the role ARN from 3a

Environment variables to set on the function:
```
TODO_API_URL        = <the existing Lambda Function URL or internal API base>
TODO_API_KEY        = <webapp API key — see Step 4 for how to inject this safely>
MCP_SERVER_SECRET   = <random string — Claude.ai will send this as Bearer token>
AWS_LAMBDA_FUNCTION_NAME is set automatically by Lambda — used to detect Lambda context
```

Do **not** set `MCP_TRANSPORT` — the Lambda branch in `index.ts` is selected by the presence of `AWS_LAMBDA_FUNCTION_NAME`, not this variable.

### 3c — Enable Lambda Function URL

On the function, enable a Function URL:
- **Auth type:** `NONE` — CloudFront will enforce the `MCP_SERVER_SECRET` Bearer token check; Lambda auth is redundant and incompatible with CloudFront origins
- **CORS:** Leave disabled — CloudFront handles CORS headers if needed

Record the Function URL (format: `https://<id>.lambda-url.<region>.on.aws`).

---

## Step 4 — Store secrets in GitHub Actions

Add the following secrets to the GitHub repository (Settings → Secrets and variables → Actions):

| Secret name | Value |
|---|---|
| `MCP_LAMBDA_FUNCTION_NAME` | The Lambda function name you created |
| `TODO_API_KEY` | The webapp API key the MCP server uses to call the todo API |
| `MCP_SERVER_SECRET` | The Bearer token Claude.ai will send to authenticate with the MCP endpoint |
| `CLOUDFRONT_DISTRIBUTION_ID` | If not already present from the existing workflow |

`TODO_API_KEY` and `MCP_SERVER_SECRET` are injected into the Lambda environment by the deploy step (Step 5), so they never appear in the repo or build logs.

---

## Step 5 — Add the MCP deploy job to the GitHub Actions workflow

Open the existing deploy workflow file. Add a new job `deploy-mcp` that runs **after** the existing deploy job succeeds (use `needs: <existing-job-name>`).

The job must perform these steps in order:

### Step 5a — Checkout and build
```
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with: { node-version: '20' }
- run: cd mcp-server && npm ci
- run: cd mcp-server && npm run build:lambda
```

### Step 5b — Package
```
- run: bash mcp-server/scripts/package.sh
```
This produces `mcp-server.zip` at the repo root.

### Step 5c — Deploy to Lambda
```
- uses: aws-actions/configure-aws-credentials@v4
  with:
    aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
    aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    aws-region: <your region>

- run: |
    aws lambda update-function-code \
      --function-name ${{ secrets.MCP_LAMBDA_FUNCTION_NAME }} \
      --zip-file fileb://mcp-server.zip

    aws lambda wait function-updated \
      --function-name ${{ secrets.MCP_LAMBDA_FUNCTION_NAME }}

    aws lambda update-function-configuration \
      --function-name ${{ secrets.MCP_LAMBDA_FUNCTION_NAME }} \
      --environment "Variables={
        TODO_API_URL=${{ vars.TODO_API_URL }},
        TODO_API_KEY=${{ secrets.TODO_API_KEY }},
        MCP_SERVER_SECRET=${{ secrets.MCP_SERVER_SECRET }}
      }"
```

Use `aws lambda wait function-updated` between `update-function-code` and `update-function-configuration` — Lambda rejects configuration updates while a code update is still propagating.

`TODO_API_URL` is non-secret and can be a GitHub Actions variable (`vars.TODO_API_URL`) rather than a secret.

### Step 5d — Invalidate CloudFront cache (optional)
Only needed if CloudFront caches `/mcp` responses. Since you will configure the cache behavior with `CachingDisabled` (Step 6), this step can be skipped. Add it anyway as a safety net:

```
- run: |
    aws cloudfront create-invalidation \
      --distribution-id ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }} \
      --paths "/mcp" "/mcp/*"
```

---

## Step 6 — Add `/mcp` behavior to CloudFront (one-time setup)

In the CloudFront distribution, add a new **cache behavior** for the MCP endpoint. This is a one-time manual step in the AWS console or via CloudFormation/CDK if the existing infra uses it.

Settings for the new behavior:

| Setting | Value |
|---|---|
| Path pattern | `/mcp*` |
| Origin | The MCP Lambda Function URL (add as a new origin if not already present) |
| Viewer protocol policy | Redirect HTTP to HTTPS |
| Allowed HTTP methods | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE |
| Cache policy | `CachingDisabled` (AWS managed policy ID: `4135ea2d-6df8-44a3-9df3-4b5a84be39ad`) |
| Origin request policy | `AllViewerExceptHostHeader` — forwards all headers except `Host` (Lambda Function URLs reject requests with a mismatched Host header) |
| Response headers policy | None required unless you need CORS |

**Why `AllViewerExceptHostHeader`**: CloudFront rewrites the `Host` header to its own domain. Lambda Function URL origins require the `Host` header to match the Function URL domain, not the CloudFront domain. This managed policy strips `Host` while forwarding everything else (including `Authorization`).

After saving, the MCP server is reachable at:
```
https://<your-cloudfront-domain>/mcp
```

---

## Step 7 — Verify the deployment

### 7a — Smoke test the endpoint directly

```bash
curl -X POST https://<your-cloudfront-domain>/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MCP_SERVER_SECRET>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expected response: a JSON-RPC response with a `tools` array listing `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`, `list_lists`, `create_list`.

### 7b — Check Lambda logs

```bash
aws logs tail /aws/lambda/<function-name> --follow
```

Each MCP request should log the tool being called and the response status. Errors appear here before they surface to Claude.

### 7c — Connect to Claude.ai

In Claude.ai → Settings → Connectors → Add custom connector:
- **Name:** Todo
- **URL:** `https://<your-cloudfront-domain>/mcp`
- **Auth:** Bearer token → paste `MCP_SERVER_SECRET`

Test with: `List all my tasks`

### 7d — Connect to Claude Code (stdio still works locally)

The stdio path from `INSTRUCTIONS.md` Step 8 is unaffected by this deployment. Local dev still uses stdio; production uses the Lambda/CloudFront endpoint.

---

## Resulting architecture

```
Claude.ai / Claude API
        │  POST /mcp  (Bearer: MCP_SERVER_SECRET)
        ▼
  CloudFront  (/mcp* behavior → Lambda origin)
        │
        ▼
  Lambda: todo-mcp-server
  (stateless, 256 MB, arm64, 30s timeout)
        │  Bearer: TODO_API_KEY
        ▼
  Lambda: todo-app-backend  (existing)
        │
        ▼
  DynamoDB / data store  (existing)


GitHub Actions (on push to main)
  ├── deploy-app   → S3 + app Lambda  (existing job)
  └── deploy-mcp   → MCP Lambda       (new job, needs: deploy-app)
```

---

## Cost profile

At typical personal/team usage levels:

| Resource | Free tier | Expected usage |
|---|---|---|
| Lambda invocations | 1M/month free | ~100–1000 MCP calls/month |
| Lambda compute | 400,000 GB-seconds/month free | 256 MB × 30s max = well within free tier |
| CloudFront requests | 10M/month free (first 12 months) | Negligible |
| CloudWatch logs | 5 GB ingest/month free | Negligible |

Expected monthly cost: **$0** at this usage level.

---

## Rollback

If the MCP Lambda has a bad deploy, roll back to the previous version without touching the existing app:

```bash
# List versions
aws lambda list-versions-by-function --function-name <mcp-function-name>

# Point the unpublished alias back to a known good version
aws lambda update-alias \
  --function-name <mcp-function-name> \
  --name live \
  --function-version <previous-version-number>
```

Or simply re-run the GitHub Actions workflow at the last good commit — `update-function-code` is idempotent.

---

## References

- Lambda Function URLs: https://docs.aws.amazon.com/lambda/latest/dg/lambda-urls.html
- CloudFront with Lambda URL origins: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html
- `AllViewerExceptHostHeader` origin request policy: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html
- MCP server code: see `INSTRUCTIONS.md` in this directory
