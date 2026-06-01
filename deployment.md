# Deployment

End-to-end deployment steps, in order.

## One-time bootstrap (run locally with admin AWS credentials)

### 0. Set up GitHub → AWS OIDC + deploy role

```bash
aws cloudformation deploy \
  --stack-name organizer-github-oidc \
  --template-file iac/github-oidc.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides GitHubOrg=ronend GitHubRepo=organizer Branch=main

# Grab the role ARN for the GitHub secret:
aws cloudformation describe-stacks --stack-name organizer-github-oidc \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" --output text
```

> If the account already has a GitHub OIDC provider, add
> `CreateOIDCProvider=false ExistingOIDCProviderArn=<arn>` to the
> `--parameter-overrides`.

### 1. Create the origin-secret in SSM (shared by CloudFront + Lambda)

Use `--type String` (not `SecureString`): the template resolves it with the
plain `{{resolve:ssm:...}}` prefix, which CloudFormation rejects for
`SecureString`, and `ssm-secure` isn't supported in the CloudFront/Lambda
properties that consume it.

```bash
aws ssm put-parameter --name /organizer/origin-secret \
  --value "$(openssl rand -hex 32)" --type String
```

> Already created it as `SecureString`? You can't change a parameter's type
> in place — delete and recreate:
> ```bash
> aws ssm delete-parameter --name /organizer/origin-secret
> aws ssm put-parameter --name /organizer/origin-secret \
>   --value "$(openssl rand -hex 32)" --type String
> ```

### 2. SAM deployment bucket

[iac/samconfig.toml](iac/samconfig.toml) sets `resolve_s3 = true`, so SAM
creates/manages the artifact bucket automatically — no manual step needed. (To
bring your own bucket instead, comment out `resolve_s3` and set
`s3_bucket = "..."`.)

## First deploy of the app stack (locally, needs Docker)

### 3. Build + first deploy (no AppUrl yet)

CloudFront's domain is auto-generated, so the OAuth wiring (Lambda `APP_URL`,
Cognito callback URLs, Function URL CORS) can't reference it up front without
creating a circular dependency. The first deploy leaves `AppUrl` empty (a
placeholder is used); you supply the real value in step 4.

`--use-container` ensures PyJWT's `cryptography` native wheels match the Lambda
runtime.

```bash
cd iac
sam build --use-container
sam deploy
```

### 4. Copy outputs, then re-deploy with AppUrl (wires up OAuth)

Read the outputs — `CloudFrontUrl`, `UserPoolId`, `UserPoolClientId`,
`CognitoDomain`, `TableName`, plus the CloudFront **distribution ID** and the
**frontend bucket name** (`organizer-frontend-<acct>`):

```bash
aws cloudformation describe-stacks --stack-name organizer-app \
  --query "Stacks[0].Outputs" --output table
```

Then re-deploy, passing the CloudFront URL so the Lambda `APP_URL`, Cognito
callback/logout URLs, and Function URL CORS point at the real domain:

```bash
sam deploy --parameter-overrides AppUrl=$(aws cloudformation describe-stacks \
  --stack-name organizer-app \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" --output text)
```

### 5. Create initial Cognito users (repeat per user)

```bash
aws cognito-idp admin-create-user --user-pool-id <UserPoolId> \
  --username user@example.com --temporary-password 'TempPass1!' --message-action SUPPRESS
```

## Wire up CI/CD

### 6. Set GitHub Secrets

Settings → Secrets and variables → Actions:

| Secret                   | Value                                   |
|--------------------------|-----------------------------------------|
| `AWS_DEPLOY_ROLE_ARN`    | `DeployRoleArn` from step 0             |
| `VITE_COGNITO_DOMAIN`    | `CognitoDomain` output                  |
| `VITE_COGNITO_CLIENT_ID` | `UserPoolClientId` output               |
| `VITE_APP_URL`           | `CloudFrontUrl` output                  |
| `FRONTEND_BUCKET`        | frontend bucket name                    |
| `CF_DISTRIBUTION_ID`     | CloudFront distribution ID              |

## Ongoing (automated)

### 7. Push to `main`

Path-filtered workflows assume the OIDC role and deploy:

- changes under `backend/**` or `iac/**` →
  [deploy-backend.yml](.github/workflows/deploy-backend.yml) runs
  `sam build --use-container && sam deploy`
- changes under `frontend/**` →
  [deploy-frontend.yml](.github/workflows/deploy-frontend.yml) builds Vite,
  `s3 sync`s to the bucket, and invalidates CloudFront

### 8. Open `CloudFrontUrl`

You should be redirected to the Cognito hosted login.

## Ordering notes

- **Step 0 must come before any workflow run** — the workflows can't create the
  role they depend on.
- **The first app deploy is manual (step 3)**, because the frontend workflow
  needs `FRONTEND_BUCKET` / `CF_DISTRIBUTION_ID`, which only exist after the
  stack is created. After that, pushes to `main` handle everything.
- The backend deploy (`sam deploy`) provisions the S3 bucket + CloudFront; the
  frontend deploy only *populates* them — so a brand-new environment needs a
  backend deploy before the frontend has somewhere to publish to.
