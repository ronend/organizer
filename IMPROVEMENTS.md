# Architecture Review & Improvements

This scaffold was built **strictly to the CLAUDE.md spec**. This document
records the issues found during review so they can be addressed deliberately.
Items are grouped by severity.

## 🔴 Correctness bugs (recommend fixing before production)

### 1. CloudFront `CustomErrorResponses` corrupt API error responses — ✅ FIXED
**Original problem:** `CustomErrorResponses` are **distribution-wide**, not
per-cache-behavior. The template mapped `403 → 200 /index.html` and
`404 → 200 /index.html` so the SPA could deep-link. But:
- `originVerify` returns **403**
- unknown / not-found API routes return **404**

CloudFront rewrote these into `200` + the HTML page, so a `fetch('/api/...')`
that should fail received HTML with status `200`, silently breaking API error
handling on the client.

**Fix applied (in [iac/template.yaml](iac/template.yaml)):** removed the
distribution-wide `CustomErrorResponses` and added a `SpaRoutingFunction`
(CloudFront Function, `viewer-request`) attached **only to the default S3 cache
behavior**. It rewrites extensionless URIs (e.g. `/callback`) to `/index.html`
for client-side routing, while static assets (paths containing `.`) pass
through. Because the function is scoped to the S3 behavior, `/api/*` responses
are never touched — the API's real `401`/`403`/`404` status codes reach the
browser intact.

### 2. PKCE is missing (public client + auth code flow)
`UserPoolClient` is a public client (`GenerateSecret: false`) using the
authorization-code flow. Without PKCE, an intercepted `?code=` could be redeemed
by an attacker. SPAs should use PKCE.

**Fix:** generate a `code_verifier` in `AuthContext.login()`, send
`code_challenge` (`S256`) + `code_challenge_method=S256` on the `/login`
redirect, persist the verifier (sessionStorage), and forward `code_verifier` in
the `/api/auth/token` exchange.

### 3. "Auto-refresh" claim doesn't match the implementation
`scope=openid email` has no `offline_access`, and only the access token is
stored. On expiry the user is bounced to login — there is no silent refresh,
despite what a naive reading of the design implies.

**Fix:** either (a) document that sessions last ~1h and re-login is required
(what this scaffold does), or (b) request `offline_access`, store the refresh
token securely, and add a refresh path.

## 🟠 Scalability & performance

### 4. `listOrganizers` has no pagination
A DynamoDB `Query` returns at most 1 MB per page. A user with a very large
number of organizers gets a truncated list. Add `LastEvaluatedKey` paging (or accept
and document the cap).

### 5. Organizer ordering is undefined
The sort key is `organizerId` (a UUIDv4), so `listOrganizers` returns organizers in UUID order,
not by `createdAt`. Use a sortable ID (ULID/KSUID) as the sort key, or sort
client-side by `createdAt`. ULID also spreads writes better.

### 6. Cold-start latency
`PyJWKClient` is instantiated at module scope (good — warm containers reuse
keys), but every cold start refetches the JWKS. For higher scale consider Lambda
**SnapStart for Python** or a small amount of provisioned concurrency. FastAPI +
its dependencies also add import time; trimming unused deps helps.

### 7. boto3 in the package — tradeoff
The `python3.12` runtime already includes `boto3`/`botocore`. `requirements.txt`
pins `boto3` so local dev/tests have it and builds are reproducible (the
runtime's bundled version can drift). The cost is a slightly larger deployment
package / marginally slower cold start. If you want the leanest package and
don't need a pinned SDK, drop `boto3` from `requirements.txt` and rely on the
runtime's copy.

### 8. Edge rate limiting / WAF
`x-origin-verify` stops direct Lambda access but does nothing for abuse coming
*through* CloudFront. For real multi-user scale, attach AWS WAF (rate-based rule)
to the distribution.

## 🟡 Security hardening

### 9. `localStorage` token storage is XSS-exposed
Any XSS can exfiltrate the bearer token. The single-domain CloudFront layout
makes `httpOnly; Secure; SameSite` cookies viable for a production version.

### 10. Rotate the origin secret
`ORIGIN_SECRET` is static. It lives in SSM, so schedule periodic rotation
(update SSM + redeploy / update the CloudFront origin custom header).
