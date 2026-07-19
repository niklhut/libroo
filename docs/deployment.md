# Deployment

Libroo supports two deployment paths:

- Self-hosted Docker for private installs that keep SQLite and uploaded assets on a mounted volume.
- Hosted Cloudflare for the managed Libroo instance using NuxtHub, D1, and R2.

## Self-Hosted Docker

Build the production image from a clean checkout:

```bash
docker build -t libroo:local .
```

Build a semantically versioned release image with OCI labels:

```bash
VERSION=1.2.3
REVISION="$(git rev-parse HEAD)"
CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

docker build \
  --build-arg VERSION="$VERSION" \
  --build-arg REVISION="$REVISION" \
  --build-arg CREATED="$CREATED" \
  --build-arg SOURCE="https://github.com/niklhut/libroo" \
  -t ghcr.io/OWNER/libroo:"$VERSION" \
  .
```

Build both supported CPU architectures for publishing:

```bash
VERSION=1.2.3

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --push \
  --build-arg VERSION="$VERSION" \
  --build-arg REVISION="$(git rev-parse HEAD)" \
  --build-arg CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg SOURCE="https://github.com/niklhut/libroo" \
  -t ghcr.io/OWNER/libroo:"$VERSION" \
  .
```

The Docker CI workflow builds `linux/amd64` on pull requests for a faster production-image check. Same-repository pull requests push `ghcr.io/OWNER/libroo:pr-<number>` so the image can be inspected from GitHub Packages. Pull requests from forks are build-only and load the image into the runner instead of pushing, because forked PRs should not receive package write access. Pushes to `main` and release tags build and push both `linux/amd64` and `linux/arm64`. It uses Docker metadata rules so release tags like `v1.2.3` produce `1.2.3` and `1.2`, and branch/SHA tags are available for traceability. The same metadata is written as OCI image labels.

### Base-Image Pinning

The Node base image in the `Dockerfile` retains its readable version tag and is pinned to an immutable SHA-256 digest for reproducible builds. To obtain the current multi-platform image digest, run:

```bash
docker buildx imagetools inspect node:24.16.0-alpine --format '{{.Manifest}}'
```

Update the `FROM node:24.16.0-alpine@sha256:...` line with that digest. Renovate automatically proposes digest updates; as with other dependency PRs, those changes must pass the existing Docker image build check before review and merge.

Run locally with Docker Compose:

```bash
cp .env.example .env
openssl rand -base64 32
# Put the generated value in NUXT_BETTER_AUTH_SECRET.
docker compose up --build
```

The container listens on port `3000` and exposes `GET /api/health`. The image and Docker Compose healthchecks call that endpoint and fail if the app cannot query the database.

### Runtime Environment

Required:

| Variable | Example | Notes |
| --- | --- | --- |
| `NUXT_BETTER_AUTH_SECRET` | output of `openssl rand -base64 32` | Required in every production install. Keep stable across restarts. |
| `NUXT_BETTER_AUTH_URL` | `https://libroo.example.com` | Public origin used by auth links and callbacks. |

Self-host defaults baked into the image:

| Variable | Default | Notes |
| --- | --- | --- |
| `NUXT_LIBROO_RUNTIME_PROFILE` | `selfhost` | Uses local SQLite, local blob storage, SMTP-capable email, and Sharp image conversion. |
| `NUXT_DATABASE_URL` | `file:/data/db/sqlite.db` | libSQL/SQLite database path inside the persistent volume. |
| `NUXT_LOCAL_STORAGE_DIR` | `/data/blob` | Uploaded assets and generated cover WebP files. |
| `NUXT_TRUSTED_IP_HEADERS` | empty | Optional comma-separated trusted client-IP header names for self-hosted reverse proxy deployments. Leave empty for direct access. The Cloudflare profile does not require this setting. |

Optional email and registration settings:

| Variable | Default | Notes |
| --- | --- | --- |
| `NUXT_EMAIL_VERIFICATION_ENABLED` | `false` | Set `true` for public installs. |
| `NUXT_PUBLIC_REGISTRATION_ENABLED` | `true` | Set `false` after creating the first admin for invite-only operation. |
| `NUXT_PUBLIC_TURNSTILE_ENABLED` | `false` | Enables Cloudflare Turnstile server enforcement and client widget rendering for signup and password-reset email requests. Public installs should set it to `true`; private LAN, VPN/Tailscale, Cloudflare Access, or otherwise access-controlled installs may leave it `false` intentionally. |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` / `NUXT_TURNSTILE_SECRET_KEY` | empty | Cloudflare Turnstile site key and secret key. Required when Turnstile is enabled. |
| `NUXT_TURNSTILE_ALLOWED_HOSTNAMES` | empty | Optional comma-separated hostname allow-list for Turnstile token responses, such as `libroo.example.com,app.libroo.example.com`. |
| `NUXT_PUBLIC_OPEN_LIBRARY_LINKS_ENABLED` | `false` in production, `true` in development | Shows outbound Open Library edition/work links on book detail pages. Keep disabled for the hosted/product experience; enable intentionally for self-hosted source visibility or metadata debugging. |
| `NUXT_OPEN_LIBRARY_REQUEST_TIMEOUT_SECONDS` | `12` | Timeout for Open Library metadata and cover existence requests. Increase if the upstream API is slow in your deployment region. |
| `NUXT_OPEN_LIBRARY_COVER_TIMEOUT_SECONDS` | `20` | Timeout for downloading and repairing cover images from Open Library. |
| `NUXT_OPEN_LIBRARY_CONTACT_EMAIL` | empty | Contact included in the Open Library `User-Agent`. When configured, the shared outbound limiter permits three requests per second; otherwise it permits one. |
| `NUXT_BOOKS_BULK_LOOKUP_RATE_LIMIT_WINDOW_SECONDS` / `NUXT_BOOKS_BULK_LOOKUP_RATE_LIMIT_MAX_REQUESTS` | `60` / `10` | Dedicated database-backed inbound limit for authenticated bulk ISBN lookup requests. |
| `NUXT_LEGAL_MARKDOWN_FETCH_TIMEOUT_SECONDS` | `5` | Timeout for fetching configured legal Markdown source documents. |
| `NUXT_PLUNK_SEND_TIMEOUT_SECONDS` | `5` | Timeout for Plunk email delivery requests. |
| `NUXT_EMAIL_PROVIDER` | `smtp` | Self-host supports `smtp` or `plunk`. |
| `NUXT_EMAIL_FROM` | empty | Required when email sending is enabled. |
| `NUXT_EMAIL_REPLY_TO` | empty | Optional reply-to address for sent mail. |
| `NUXT_SMTP_HOST` / `NUXT_SMTP_PORT` / `NUXT_SMTP_SECURE` | empty / `587` / `false` | SMTP transport settings. |
| `NUXT_SMTP_USER` / `NUXT_SMTP_PASSWORD` | empty | SMTP credentials, if required by the provider. |
| `NUXT_PLUNK_API_KEY` / `NUXT_PLUNK_BASE_URL` | empty / `https://next-api.useplunk.com` | Plunk delivery settings. |

Optional legal page settings:

For a hosted setup with a separate public information website, prefer making that
website the canonical legal home and point the app at those pages with the URL
variables below. Self-hosters who only deploy the application can point the app
at Markdown documents hosted on S3, R2, a static web server, or a similar source.
Libroo does not ship legally sufficient privacy-policy, imprint, or terms templates.

| Variable | Default | Notes |
| --- | --- | --- |
| `NUXT_PUBLIC_LEGAL_PRIVACY_POLICY_URL` / `NUXT_PUBLIC_LEGAL_IMPRINT_URL` / `NUXT_PUBLIC_LEGAL_TERMS_URL` | empty | Canonical legal page URLs. If set, footer links point to these URLs and the local route redirects there. |
| `NUXT_LEGAL_PRIVACY_POLICY_MARKDOWN_URL` / `NUXT_LEGAL_IMPRINT_MARKDOWN_URL` / `NUXT_LEGAL_TERMS_MARKDOWN_URL` | empty | Server-side Markdown source URLs. Used only when the matching canonical URL is empty. |

If both values for a legal page are empty, the footer link is hidden and the
direct route shows an empty state.

### Email Delivery And Verification

Libroo supports two outbound email providers:

- `smtp`: self-host default, delivered through Nodemailer with `NUXT_SMTP_HOST`, `NUXT_SMTP_PORT`, `NUXT_SMTP_SECURE`, and optional `NUXT_SMTP_USER` / `NUXT_SMTP_PASSWORD`.
- `plunk`: hosted Cloudflare provider and also available to self-hosted installs with `NUXT_PLUNK_API_KEY` and optional `NUXT_PLUNK_BASE_URL`.

Set `NUXT_EMAIL_PROVIDER=smtp` or `NUXT_EMAIL_PROVIDER=plunk`. All providers require `NUXT_EMAIL_FROM` when email sending is used. `NUXT_EMAIL_REPLY_TO` is optional; SMTP sends it as the message `Reply-To`, and Plunk sends it as `reply`.

`NUXT_EMAIL_VERIFICATION_ENABLED=false` disables Better Auth email-verification gating. Signups can sign in immediately, and email changes use the direct Better Auth `change-email` endpoint when available.

`NUXT_EMAIL_VERIFICATION_ENABLED=true` enables:

- Verification email on signup and sign-in for unverified accounts.
- `requireEmailVerification` and disabled automatic sign-in after signup until verification completes.
- Verification links that expire after 24 hours.
- Password-reset links that expire after 1 hour.
- The custom pending-email-change flow in Settings.

When verification is enabled, Libroo blocks the direct `/api/auth/change-email` endpoint. Settings instead collects the desired email and current password, stores it in `user.pending_email`, and sends a verification link to the pending address. When the link succeeds, Better Auth updates the email and Libroo clears `pending_email`.

User-facing effects:

- Settings shows the current verification status and any pending email change.
- Resend sends a current-email verification when the account is unverified.
- Resend sends the pending-email-change verification when `pending_email` is set.
- A fully verified account with no pending email change treats resend as a no-op success.

### Turnstile Bot Protection

Libroo can protect the public account creation flow and password-reset email request flow with Cloudflare Turnstile. This is operator-controlled rather than globally enforced by the application.

Use Cloudflare's Turnstile dashboard to create a widget for the public hostname, then set:

```bash
NUXT_PUBLIC_TURNSTILE_ENABLED=true
NUXT_PUBLIC_TURNSTILE_SITE_KEY=0x...
NUXT_TURNSTILE_SECRET_KEY=0x...
NUXT_TURNSTILE_ALLOWED_HOSTNAMES=libroo.example.com
```

When enabled, signup and password-reset email requests must include a valid Turnstile token. Missing or invalid tokens are rejected before Better Auth creates the account or sends a reset email. Login is not protected by Turnstile in this sprint.

Public/hosted deployments should enable Turnstile before leaving public signup or password-reset email enabled. If those flows are public without Turnstile, operators should treat the deployment as more exposed to automated account creation and reset-email spam.

Private self-hosted deployments may intentionally opt out by leaving `NUXT_PUBLIC_TURNSTILE_ENABLED=false`, especially when Libroo is only reachable on a LAN, behind VPN/Tailscale, behind Cloudflare Access, or behind another access-control layer. The app does not refuse to run when Turnstile is disabled.

### Client IP Handling And Rate Limiting

Libroo uses the request client IP for Better Auth and ISBN rate limiting. Better Auth stores its counters in the shared database. ISBN lookup/add requests use one atomic database-backed fixed-window limiter on both Cloudflare and self-hosted runtimes; Cloudflare D1 coordinates across isolates.

For a single self-host process, the local SQLite file needs no additional infrastructure. Multiple self-host instances must set `NUXT_DATABASE_URL` to the same shared/remote libSQL database (for example Turso) so limiter decisions coordinate. A separate local SQLite file per instance cannot provide a global limit.

The default is safe: no self-hosted forwarding header is trusted unless the operator explicitly configures `NUXT_TRUSTED_IP_HEADERS`. If Libroo cannot resolve an ISBN caller IP, it uses a shared `unknown` bucket; it deliberately does not trust a caller-supplied `x-libroo-client-ip` header, since doing so would permit rate-limit evasion.

Use the setting that matches the runtime topology:

| Topology | Configuration |
| --- | --- |
| Cloudflare | No `NUXT_TRUSTED_IP_HEADERS` setting is needed. Cloudflare Workers expose the real client address through `cf-connecting-ip`, and Libroo reads it automatically in the Cloudflare profile. |
| Self-hosted, direct access | Leave `NUXT_TRUSTED_IP_HEADERS` empty. Libroo falls back to the connection IP supplied by the runtime. |
| Self-hosted behind a trusted reverse proxy | Set `NUXT_TRUSTED_IP_HEADERS` to the exact header your proxy controls, then configure that proxy to overwrite and forward the same header. Prefer a single-hop header such as `X-Real-IP` when possible. |
| Private access layers such as Cloudflare Access or Tailscale | Rate-limiting identity may collapse to an access proxy, subnet router, or shared egress address. That can make unrelated users share the same Better Auth rate-limit bucket. This is acceptable for many private installs, but operators should understand that the bucket may represent the access layer instead of the human user. |

Example Nginx forwarding:

```nginx
location / {
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_pass http://libroo:3000;
}
```

```bash
NUXT_TRUSTED_IP_HEADERS=X-Real-IP
```

Example Caddy forwarding:

```caddyfile
libroo.example.com {
  reverse_proxy libroo:3000 {
    header_up X-Real-IP {remote_host}
  }
}
```

```bash
NUXT_TRUSTED_IP_HEADERS=X-Real-IP
```

Never forward client-controlled `X-Forwarded-For` from untrusted sources. If you choose to trust `X-Forwarded-For`, the edge proxy must strip any incoming value and replace it with a value it computed itself; otherwise clients can spoof IP addresses and evade or poison rate limits.

If logs show a warning that Libroo cannot determine the client IP, resolve it according to the topology: on Cloudflare, use the `cloudflare` runtime profile; on direct self-hosted access, verify the runtime exposes a connection address; behind a reverse proxy, set `NUXT_TRUSTED_IP_HEADERS` and configure the proxy to overwrite that header. Do not silence the warning by trusting arbitrary forwarded headers from the public internet.

Better Auth rate limiting and Turnstile CAPTCHA are independent, complementary controls. Better Auth throttles requests by IP bucket; Turnstile challenges likely bots before selected auth flows proceed. Configuring `NUXT_TRUSTED_IP_HEADERS` does not change Turnstile behavior.

### Persistent Data

Mount `/data` as the durable volume. It contains:

- `/data/db/sqlite.db`: application database.
- `/data/blob`: uploaded assets and generated cover images.

The image creates both directories and runs `scripts/migrate-selfhost.mjs` before starting Nuxt. A fresh empty volume is migrated automatically. Before upgrading an existing install, back up the whole `/data` volume while the container is stopped.

Prefer the scripted online backup workflow in [Backup And Restore](./backup-restore.md):

```bash
pnpm backup:selfhost -- --output-dir /backups/libroo
```

The backup script snapshots SQLite first, copies blobs second, writes a versioned manifest, and packages the artifact for restore with `pnpm restore:selfhost`.

Secrets should be injected through the orchestrator, an env file outside source control, or a secret manager. Do not bake secrets into the image.

### Scheduled Tasks

Libroo runs a daily audit cleanup task at 03:00 and a daily Open Library cover repair task at 03:30. The cover repair task checks a small random batch of Open Library books that were saved without a generated cover image, retries the cover download, and fills `cover_path` only when a cover is successfully stored.

### Account Deletion Operations

Users can delete their own accounts from Settings. Deletion is immediate after current-password verification and destructive confirmation. It removes the Better Auth account/session records, personal library records, owned loans, borrowed-loan associations, user-created manual metadata that is not still referenced by another user, and user-specific uploaded assets.

Operators should use the self-service flow for support requests whenever possible. If an operator restores an old `/data` backup, they must re-run any account deletions that happened after the restored backup point. See [Account Deletion And Retention](./account-deletion.md) for the cleanup semantics, lending behavior, backup notes, and manual support process.

### Self-Hosted Troubleshooting

If startup fails during migration with `SQLITE_FULL`, SQLite cannot write to the database volume. On Docker Desktop this often means the Docker disk image is full even when the host filesystem still has free space. Check `docker system df`, prune unused images/build cache/volumes, increase Docker Desktop's disk image size, or recreate the `libroo-data` volume after taking any needed backup.

For bind mounts, make sure the container can write to the mounted database directory. The Compose example uses a named volume mounted at `/data`.

### Self-Hosted Rollback

Rollback is image-based: stop the new container and start the previous known-good image against the same `/data` volume. If a release introduced database migrations, prefer restoring the matching backup with `scripts/restore-selfhost.mjs`. SQLite migrations are not assumed to be reversible, and a backup whose migration tag/idx or app version is ahead of the target code must not be restored.

## Hosted Cloudflare

The hosted instance uses the Cloudflare runtime profile:

```bash
NUXT_LIBROO_RUNTIME_PROFILE=cloudflare
pnpm build:cloudflare
```

The generated Worker uses NuxtHub D1 and R2 bindings from `nuxt.config.ts`. The
active production resources are:

- Worker: `libroo-production`
- D1 database: `libroo-production`
- R2 bucket: `libroo-production`

Set `NUXT_CLOUDFLARE_WORKER_NAME` to select the Worker; the production workflow
pins it to `libroo-production`. Same-repository PRs validate the Cloudflare
build as part of their full preview deployment. The `Build Cloudflare Worker`
workflow is retained only for fork PRs, which cannot receive preview
Environment secrets. The push-only `Deploy to Cloudflare` workflow validates
the generated Wrangler configuration and applies D1 migrations immediately
before deploy because Cloudflare D1 migrations are not applied by
`wrangler deploy` automatically.

### First Admin Setup

Deploy the first hosted production instance with an empty D1 database and public registration enabled:

```bash
NUXT_PUBLIC_REGISTRATION_ENABLED=true
```

Open `/register` on the hosted origin and create the first account. Libroo's Better Auth policy plugin promotes the first created user to `admin` by setting Better Auth's `user.role` field. Confirm that account can access `/admin/users`, then set `NUXT_PUBLIC_REGISTRATION_ENABLED=false` for invite-only operation and redeploy.

Do not create a separate Libroo auth table. User roles and bans are Better Auth state: roles are read from `user.role`, and bans are read from `user.banned`, `user.ban_reason`, and `user.ban_expires`.

### Promotion Policy

Hosted production policy:

- Protect `main`.
- Require the `Lint`, `Typecheck`, `Unit Tests`, `Docker Image`, and
  `Build Cloudflare Worker` checks before merge.
- Merging to `main` deploys `libroo-production` through the protected
  `production` GitHub Environment.
- D1 migrations run only on `push` to `main`, after required checks have passed and the merge has completed.

Same-repository pull requests receive isolated Cloudflare previews. Fork pull requests remain build-only because they must not receive the `preview` GitHub Environment secrets. Production D1 migrations still run only after merge to protected `main`.

After the `Typecheck` workflow has completed at least once, add
`Typecheck` to the required status checks in the `main` branch protection
settings before relying on it as a merge gate.

If manual promotion becomes necessary, prefer a GitHub Environment approval or a workflow dispatch input over a permanently diverging production branch.

### Preview Deployments

Same-repository pull requests targeting `main` receive disposable, physical-first preview infrastructure:

- Worker: `libroo-pr-<number>`
- D1 database: `libroo-preview-pr-<number>`
- R2 bucket: `libroo-preview-pr-<number>`

The Worker keeps the generated NuxtHub binding names `DB` and `BLOB`. These are application-level variable names, not shared infrastructure: `DB` resolves to the D1 UUID embedded in that Worker's generated Wrangler config, and `BLOB` resolves to its configured R2 bucket name. Preview and production Workers can therefore use the same code-facing binding names while pointing at completely different physical resources.

The preview workflow keeps those resource identities separate and explicit:

- `PREVIEW_D1_DATABASE_NAME` identifies the D1 database being provisioned.
- `NUXT_HUB_CLOUDFLARE_DATABASE_ID` is captured from that named D1 database and becomes the generated `DB` target.
- `NUXT_HUB_CLOUDFLARE_BUCKET_NAME` becomes the generated `BLOB` target.
- `NUXT_CLOUDFLARE_WORKER_NAME` selects the per-PR Worker.

Immediately after the build and before migrations, `scripts/preview/validate-wrangler-config.mjs` fails closed unless the generated config targets the expected `libroo-pr-<number>` Worker, the expected `libroo-preview-pr-<number>` D1 UUID, and the expected preview R2 bucket. It also rejects custom routes, custom domains, cron triggers, missing `workers_dev`, additional D1/R2 bindings, and non-preview resource names. Only after that assertion passes can `wrangler d1 migrations apply DB` run. No preview uses the hosted D1 database, hosted R2 bucket, production Worker, or a custom domain.

Each preview is served from:

```text
https://libroo-pr-<number>.<account-subdomain>.workers.dev
```

The workflows bind to the `preview` GitHub Environment. Keep its Cloudflare token, account ID, and Better Auth secret isolated from production. Environment approvals can be used when same-repository contributors should not deploy without review. Every preview hostname is protected by a per-PR Cloudflare Access application which attaches one existing reusable Access policy.

The lifecycle is:

1. A same-repository pull request is opened, synchronized, or reopened.
2. `.github/workflows/preview-cloudflare.yml` checks the concurrent-preview ceiling.
3. The workflow creates or updates `libroo-preview-pr-<number>` as a Cloudflare Access application for the exact `workers.dev` hostname and attaches the configured reusable policy.
4. It idempotently creates the per-PR D1 database and R2 bucket.
5. It builds the Worker with the Access audience and captured D1 ID, validates the generated bindings, applies migrations to that isolated database, and optionally loads synthetic fixtures.
6. It syncs only the preview Better Auth secret and deploys the Worker.
7. It registers a transient GitHub deployment and creates or updates a sticky PR comment with the Access-protected `workers.dev` URL and status.
8. When the pull request closes, `.github/workflows/preview-cloudflare-cleanup.yml` deletes the Worker first, removes its Access application only after the Worker is confirmed absent, then deletes D1 and R2.
9. `.github/workflows/preview-cloudflare-sweep.yml` runs daily as a backstop and removes prefixed Worker, Access, D1, and R2 resources whose PR is no longer open.

Deploy, close cleanup, and scheduled sweep workflows share the
`cloudflare-preview-lifecycle` concurrency group. This serializes the quota
check with resource creation and prevents simultaneous PR runs from both
claiming the final available preview slot.

Fork pull requests never receive preview credentials. They continue through the build-only `.github/workflows/build-cloudflare.yml` path.

#### Safe Non-Production Defaults

The canonical checked-in values are in `scripts/preview/runtime.env`; the deployment workflow consumes that file rather than duplicating the values in workflow YAML.

| Setting | Preview behavior |
| --- | --- |
| Email verification | Disabled. No Plunk API key is synced, so email-dependent flows must degrade gracefully. |
| Turnstile | Disabled. Cloudflare's always-pass public test site and secret keys are used as non-secret test values. |
| Public access | Denied by Cloudflare Access unless the visitor matches the reusable preview policy. Libroo also validates the Access JWT and fails closed when it is missing or invalid. |
| Legal Markdown and canonical URLs | Empty, so no production legal content endpoint is contacted. |
| Registration | Enabled for tester convenience. |
| Scheduled tasks | Wrangler cron triggers are omitted when `NUXT_CLOUDFLARE_PREVIEW=true`. |
| Better Auth origin | `NUXT_BETTER_AUTH_URL` is the exact generated origin, `https://libroo-pr-<number>.<account-subdomain>.workers.dev`. |
| Custom domain | `NUXT_CLOUDFLARE_CUSTOM_DOMAIN` must be unset. The generated Worker keeps `workers_dev: true`. |

The optional seed is disabled unless the `preview` Environment variable `PREVIEW_SEED_ENABLED` is `true`. `scripts/preview/seed.sql` contains only obviously fictional `example.invalid` users and imaginary books. It never contains production-derived data. Because seeded users can affect first-user role behavior, leave seeding disabled when testing initial admin setup.

#### Cloudflare Access Setup

Reuse an existing Cloudflare Zero Trust organization and identity provider. Create one reusable **Allow** policy specifically for preview testers under **Zero Trust → Access controls → Policies**. The policy can allow individual email addresses, an email domain, an identity-provider group, or another suitable identity rule. Do not use a reusable Bypass or Everyone policy, because that would make every generated preview public.

The preview workflow creates the applications; do not manually create an application for every PR. Each generated application:

- is named `libroo-preview-pr-<number>`;
- targets the exact `libroo-pr-<number>.<account-subdomain>.workers.dev` hostname;
- attaches the configured reusable policy;
- allows only the configured Authentik identity provider;
- enables instant authentication so Cloudflare redirects directly to Authentik
  instead of showing an identity-provider picker;
- is hidden from the App Launcher;
- uses a 24-hour application session;
- uses `SameSite=Lax` for the application authorization cookie so redirects
  from external identity providers can complete;
- supplies its unique audience to the Worker for JWT verification.

Configure these variables on the GitHub `preview` Environment:

| Variable | Where to find it |
| --- | --- |
| `CLOUDFLARE_ACCESS_IDP_ID` | The Cloudflare Access identity-provider UUID for the Authentik OIDC integration. This is Cloudflare's provider `id`, not Authentik's application/client ID. Use the API command below to list it. |
| `CLOUDFLARE_ACCESS_POLICY_ID` | The UUID of the reusable preview policy. List it with the API command below after granting the token Access read/write permission. |
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | In Cloudflare, open **Zero Trust → Settings → Team name and domain**. Store the complete origin, for example `https://my-team.cloudflareaccess.com`. |

List reusable policy IDs:

```bash
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/access/policies" \
  | jq '.result[] | { id, name, decision }'
```

List Cloudflare Access identity-provider IDs:

```bash
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/access/identity_providers" \
  | jq '.result[] | { id, name, type }'
```

The selected Cloudflare token needs the existing Workers Scripts, D1, and R2 edit permissions plus the account-level **Access: Apps and Policies Write** permission. Scope the token to only the Cloudflare account used for previews. The reusable policy itself remains operator-managed; workflows only link it to and unlink it from per-PR applications.

Libroo's `server/middleware/preview-access.ts` is defense in depth behind Cloudflare's edge enforcement. It is enabled only when `NUXT_CLOUDFLARE_PREVIEW=true`, validates `Cf-Access-Jwt-Assertion` against the team domain's JWKS and the generated application's audience, and returns `403` for absent or invalid tokens. It returns `503` if a preview build somehow lacks its Access configuration. Production and self-hosted deployments do not enable this middleware path.

#### Cost and Quota Safeguards

One open same-repository PR consumes one Access application, one Worker, one D1 database, and one R2 bucket. The expected steady state is therefore one complete resource set per open same-repository PR.

Set `PREVIEW_CONCURRENT_LIMIT` as a variable on the `preview` GitHub Environment to lower or raise the D1/R2 ceiling; the default workflow value is `10`. Before creating anything, the deploy workflow counts existing `libroo-preview-` D1 databases and R2 buckets. It fails with a remediation message when either resource type would exceed the ceiling. Updating an already-provisioned PR remains allowed at the ceiling. Workers and Access applications are not independently counted by this gate; close cleanup and the orphan sweep inventory all four resource types so incomplete or leaked sets are still removed.

Current Cloudflare allowances should be checked before changing the ceiling:

- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) measures rows read, rows written, and total storage across the account. The Workers Free allowance currently includes 5 million rows read per day, 100,000 rows written per day, and 5 GB total storage. Empty databases still consume a small amount of storage, and preview migrations count as usage.
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/) currently includes 10 GB-month of Standard storage, 1 million Class A operations, and 10 million Class B operations per month. Uploads, object listings during cleanup, and test traffic share those account-wide allowances.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) currently include 100,000 requests per day on the Free plan. Preview Workers share the account limit; they do not each receive a separate allowance.
- [Cloudflare One account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/) currently allow 500 Access applications by default. Cleanup and sweeping prevent disposable preview applications from accumulating toward that account-wide limit.

The daily orphan sweep is the quota backstop behind close-event cleanup. In a healthy steady state, every preview Worker, Access application, D1 database, and R2 bucket maps to an open pull request. D1 and R2 counts stay at or below the configured ceiling; orphan count across every resource type should normally be zero.

#### Preview Limitations

- Preview URLs are `workers.dev` origins only. They do not validate production DNS, custom-domain routing, certificates, or hostname-specific policy.
- Email delivery and email verification are intentionally unavailable.
- Turnstile enforcement is intentionally unavailable because Access restricts the whole preview to authenticated testers before Libroo account flows are reached.
- Cron-driven audit cleanup and cover repair do not run.
- Cloudflare account-wide limits and API availability can still block provisioning or cleanup.
- The preview environment is disposable. Testers must not rely on its data surviving a force-push, manual cleanup, PR close, or sweep.

#### Troubleshooting and Manual Cleanup

To retry a failed close cleanup, open the failed `Cleanup Cloudflare Preview` run in GitHub Actions and choose **Re-run failed jobs**. The scheduled sweep can also be started immediately with **Run workflow** on `Sweep Cloudflare Preview Resources`.

Cleanup and sweep jobs write a summary containing detected, deleted, and failed resources. A cleanup failure also updates the sticky PR comment. An R2 failure that mentions emptying usually means the temporary remote cleaner could not start or access the bucket. D1 and Worker failures normally indicate missing token permissions, an API outage, or a resource that changed outside the workflow.

Manual cleanup for PR `123`:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...

# If the bucket contains known objects, delete them first.
pnpm exec wrangler r2 object delete libroo-preview-pr-123/path/to/object
pnpm exec wrangler r2 bucket delete libroo-preview-pr-123

pnpm exec wrangler d1 delete libroo-preview-pr-123 --skip-confirmation
node scripts/preview/worker-delete.mjs libroo-pr-123

# Find and delete a leaked Access application.
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/access/apps" \
  | jq '.result[] | select(.name == "libroo-preview-pr-123") | { id, name, domain }'

curl --fail-with-body --request DELETE --silent --show-error \
  --header "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/access/apps/ACCESS_APP_ID"
```

If the R2 bucket contains unknown object keys, prefer re-running the cleanup workflow because it uses `scripts/preview/empty-r2-worker.mjs` to list and delete every object through the bucket binding. The Cloudflare dashboard is the other practical way to inspect and remove unknown objects before running `wrangler r2 bucket delete`.

All delete operations are intended to be idempotent: an already-absent resource is success. Worker cleanup uses Cloudflare's Workers service API directly instead of `wrangler delete`, because Wrangler also queries legacy Workers KV asset namespaces and would otherwise require unrelated KV permissions. If a command fails for another reason, verify that the token in the `preview` Environment has D1, R2, and Workers edit permissions and that `CLOUDFLARE_ACCOUNT_ID` targets the expected account.

### Required GitHub Configuration

Repository or environment secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Wrangler deploy, D1 migration, R2, and custom-domain route access. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account for Wrangler. |
| `NUXT_HUB_CLOUDFLARE_DATABASE_ID` | D1 database ID used during the Cloudflare build. |
| `NUXT_HUB_CLOUDFLARE_BUCKET_NAME` | R2 bucket name used during the Cloudflare build. |
| `NUXT_BETTER_AUTH_SECRET` | Hosted auth secret. |
| `NUXT_PLUNK_API_KEY` | Hosted email delivery. |
| `NUXT_OPEN_LIBRARY_CONTACT_EMAIL` | Contact address sent in Open Library requests so hosted Workers are identified and receive the documented identified-client limit. Configure this separately in both the `production` and `preview` GitHub Environments. |
| `NUXT_TURNSTILE_SECRET_KEY` | Hosted Turnstile server-side verification secret. |

Create a GitHub Environment named `production`, mirroring the general shape of
the `preview` Environment but containing only production values. Restrict
deployment branches to `main`, optionally require reviewer approval, and set
the Environment URL to the canonical production origin. The
`.github/workflows/deploy-cloudflare.yml` job binds to this Environment so its
secrets and variables are unavailable until protection rules pass.

Move these secrets from repository scope to the `production` Environment:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `NUXT_HUB_CLOUDFLARE_DATABASE_ID`
- `NUXT_HUB_CLOUDFLARE_BUCKET_NAME`
- `NUXT_BETTER_AUTH_SECRET`
- `NUXT_PLUNK_API_KEY`
- `NUXT_OPEN_LIBRARY_CONTACT_EMAIL`
- `NUXT_TURNSTILE_SECRET_KEY`

Move all production runtime settings, including
`NUXT_CLOUDFLARE_CUSTOM_DOMAIN`, into `production` Environment variables using
the same generic names. Store the custom domain as the hostname expected in the
Wrangler route, for example `libroo.example.com`; the workflow converts it to
an HTTPS URL for GitHub deployment statuses. Keep the native GitHub Environment
URL set to the same canonical HTTPS origin.

The production Cloudflare token needs these permissions:

- Account scope for the production account: D1 Read/Write, Workers Scripts
  Read/Write, Workers R2 Storage Read/Write, and Account Settings Read.
- Zone scope for the custom-domain zone: Workers Routes Write. Cloudflare may
  label this permission **Workers Routes Edit** in parts of the dashboard.

Add `CLOUDFLARE_ZONE_ID` as a `production` Environment variable using the zone
ID that contains `NUXT_CLOUDFLARE_CUSTOM_DOMAIN`. Before building, registering
a deployment, or migrating D1, the workflow creates and immediately deletes a
uniquely named route on an unused hostname beneath the custom domain. This
proves zone-level Workers Routes Write access without changing the production
hostname.

Separately, retain the `preview` GitHub Environment with preview-scoped
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`NUXT_BETTER_AUTH_SECRET`, and `NUXT_OPEN_LIBRARY_CONTACT_EMAIL`, plus the `CLOUDFLARE_ACCESS_IDP_ID`,
`CLOUDFLARE_ACCESS_POLICY_ID`, and `CLOUDFLARE_ACCESS_TEAM_DOMAIN` variables
documented above. Do not put `NUXT_PLUNK_API_KEY`, the production Better Auth
secret, or production resource IDs in the preview Environment. No preview
workflow may reference the `production` Environment.

The Cloudflare deploy workflow syncs `NUXT_BETTER_AUTH_SECRET`, `NUXT_PLUNK_API_KEY`,
`NUXT_OPEN_LIBRARY_CONTACT_EMAIL`, and, when Turnstile is enabled,
`NUXT_TURNSTILE_SECRET_KEY` with `wrangler secret bulk`. Do not configure these
values as plain GitHub variables or Wrangler vars.

Repository or environment variables:

| Variable | Recommended value |
| --- | --- |
| `CLOUDFLARE_ZONE_ID` | Zone ID containing the production custom domain. |
| `NUXT_BETTER_AUTH_URL` | Canonical production origin, including `https://`. |
| `NUXT_EMAIL_FROM` | Hosted sender address. Must be on a verified Plunk sender domain. |
| `NUXT_EMAIL_REPLY_TO` | Optional hosted reply-to address. |
| `NUXT_EMAIL_VERIFICATION_ENABLED` | `true` |
| `NUXT_PUBLIC_REGISTRATION_ENABLED` | `false` after the first admin exists. |
| `NUXT_PUBLIC_TURNSTILE_ENABLED` | `true` for hosted public deployments. |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` | Hosted Turnstile public site key. |
| `NUXT_TURNSTILE_ALLOWED_HOSTNAMES` | Hosted public hostname, or a comma-separated list if multiple hostnames serve the app. |
| `NUXT_PUBLIC_OPEN_LIBRARY_LINKS_ENABLED` | `false` unless the hosted operator intentionally wants third-party source links visible. |
| `NUXT_OPEN_LIBRARY_REQUEST_TIMEOUT_SECONDS` | `12` |
| `NUXT_OPEN_LIBRARY_COVER_TIMEOUT_SECONDS` | `20` |
| `NUXT_BOOKS_BULK_LOOKUP_RATE_LIMIT_WINDOW_SECONDS` / `NUXT_BOOKS_BULK_LOOKUP_RATE_LIMIT_MAX_REQUESTS` | `60` / `10` |
| `NUXT_LEGAL_MARKDOWN_FETCH_TIMEOUT_SECONDS` | `5` |
| `NUXT_PLUNK_SEND_TIMEOUT_SECONDS` | `5` |
| `NUXT_PUBLIC_LEGAL_PRIVACY_POLICY_URL` / `NUXT_PUBLIC_LEGAL_IMPRINT_URL` / `NUXT_PUBLIC_LEGAL_TERMS_URL` | Optional canonical hosted legal page URLs. |
| `NUXT_LEGAL_PRIVACY_POLICY_MARKDOWN_URL` / `NUXT_LEGAL_IMPRINT_MARKDOWN_URL` / `NUXT_LEGAL_TERMS_MARKDOWN_URL` | Optional Markdown source URLs, used when the matching canonical URL is empty. |
| `NUXT_CLOUDFLARE_CUSTOM_DOMAIN` | Production hostname used for the Wrangler custom-domain route and GitHub deployment URL. |
| `NUXT_CLOUDFLARE_WORKER_NAME` | The workflow pins this to `libroo-production`. |

The deploy workflow defaults hosted production Turnstile enforcement to `true`.
To intentionally deploy a private or access-controlled Cloudflare Worker
without Turnstile, set the `production` Environment variable
`NUXT_PUBLIC_TURNSTILE_ENABLED=false`.

### Hosted Migrations

For hosted deploys, CI runs on `push` to `main` in this order:

```bash
pnpm build:cloudflare
node scripts/production/validate-wrangler-config.mjs .output/server/wrangler.json
pnpm exec wrangler d1 migrations apply DB --remote --config .output/server/wrangler.json
# CI pipes required Worker secrets into wrangler secret bulk here.
pnpm exec wrangler deploy --config .output/server/wrangler.json
```

Before migration, the workflow registers a non-transient production deployment
through the GitHub Deployments API and publishes an `in_progress` status with
the production Environment URL. The validator fails closed unless the generated
config targets `libroo-production`, the configured production custom domain,
both scheduled tasks, and exactly the configured production D1 and R2
bindings. Migration and deploy cannot run if validation fails. A final
always-running step publishes `success` or `failure` against the captured
deployment ID; if registration failed before returning an ID, the status call
is safely skipped.

Migration files live in `server/db/migrations/sqlite`. Append new migrations; do not rewrite migration history for existing hosted data. For manual hosted migrations, use the same generated `.output/server/wrangler.json` after a Cloudflare build.

Do not run hosted migrations from pull request workflows. If a PR contains a
migration, it is validated by the `Lint`, `Typecheck`, `Unit Tests`,
`Docker Image`, and `Build Cloudflare Worker` checks, then applied only after
that PR is merged to protected `main`.

### Hosted Rollback

Rollback application code through the Cloudflare or NuxtHub deployment history by promoting the previous known-good deployment. Database migrations are forward-only unless a release explicitly ships a rollback plan. If a bad deploy includes a destructive migration, restore D1 and R2 from the documented backup workflow or apply a corrective forward migration, then redeploy the known-good application version. Do not restore hosted data from a backup whose manifest migration state or app version is ahead of the deployed code.

Before promoting a release that changes schema or storage behavior, confirm that export/import or backup coverage is current for the hosted instance. Hosted D1/R2 backup and restore commands live in [Backup And Restore](./backup-restore.md).

## Production Resource Migration Runbook

This is the operator-executed cutover from the historical `libroo-beta`
Worker, D1 database, and R2 bucket to the new production resources. Record every
resource ID, export location, object-copy report, verification result, cutover
time, and approval in the migration ticket. Do not alter the old resources
during the rollback window. Use the D1-first, R2-second backup order and
manifest guidance from [Backup And Restore](./backup-restore.md) for every
captured backup/export set.

### Create Production Resources (pre-maintenance)

1. Authenticate Wrangler to the production Cloudflare account and confirm the
   account ID before creating anything:

   ```bash
   export CLOUDFLARE_API_TOKEN=...
   export CLOUDFLARE_ACCOUNT_ID=...
   pnpm exec wrangler whoami
   ```

2. Create the D1 database and capture its UUID from both command output and a
   fresh inventory:

   ```bash
   pnpm exec wrangler d1 create libroo-production
   pnpm exec wrangler d1 list --json | tee d1-inventory-production.json
   ```

   Record the UUID for `libroo-production` as the future
   `NUXT_HUB_CLOUDFLARE_DATABASE_ID`.

3. Build a production config with the new UUID and resource names, then apply
   the complete checked-in migration history:

   ```bash
   export NUXT_CLOUDFLARE_WORKER_NAME=libroo-production
   export NUXT_CLOUDFLARE_CUSTOM_DOMAIN=libroo.example.com
   export NUXT_HUB_CLOUDFLARE_DATABASE_ID=NEW_D1_UUID
   export NUXT_HUB_CLOUDFLARE_BUCKET_NAME=libroo-production
   pnpm build:cloudflare
   node scripts/production/validate-wrangler-config.mjs .output/server/wrangler.json
   pnpm exec wrangler d1 migrations apply DB --remote \
     --config .output/server/wrangler.json
   ```

4. Create the R2 bucket and reproduce the existing beta bucket's region,
   jurisdiction, storage-class, CORS, lifecycle, and private-access posture.
   Do not add public development URLs or public bucket access:

   ```bash
   pnpm exec wrangler r2 bucket create libroo-production
   pnpm exec wrangler r2 bucket list
   ```

   Record `libroo-production` as the future
   `NUXT_HUB_CLOUDFLARE_BUCKET_NAME`.

5. Take an initial full D1 export from the beta database using Cloudflare's
   supported D1 export command. Keep this timestamped file immutable. Then
   create a data-only export of application tables so the already-applied
   production schema and `_hub_migrations` state are not overwritten:

   ```bash
   pnpm exec wrangler d1 export libroo-beta --remote \
     --output beta-initial-YYYYMMDDTHHMMSSZ.sql
   pnpm exec wrangler d1 export libroo-beta --remote --no-schema \
     --table account \
     --table admin_audit_log \
     --table session \
     --table signup_invites \
     --table user \
     --table verification \
     --table authors \
     --table book_authors \
     --table book_system_tags \
     --table books \
     --table loans \
     --table locations \
     --table tags \
     --table user_book_tags \
     --table user_books \
     --output beta-initial-data-YYYYMMDDTHHMMSSZ.sql
   pnpm exec wrangler d1 execute libroo-production --remote \
     --file beta-initial-data-YYYYMMDDTHHMMSSZ.sql
   ```

   Update the explicit table list whenever the schema gains a table. Review the
   export for transaction/pragma statements required by the current Wrangler
   version. Rehearse the export/import against a disposable D1 database before
   touching `libroo-production`, and verify that the import does not replace or
   duplicate migration-history rows.

6. Configure audited S3-compatible remotes for the beta and production R2
   buckets, then perform the initial bulk copy with `rclone` or an equivalent
   tool. Use copy semantics, not move or sync-with-delete:

   ```bash
   rclone copy r2-beta:libroo-beta r2-production:libroo-production \
     --checksum --fast-list --log-file r2-initial-copy.log --log-level INFO
   rclone check r2-beta:libroo-beta r2-production:libroo-production \
     --checksum --one-way --combined r2-initial-check.txt
   ```

   Prefer the checksum-based `rclone check` above. If either R2 remote cannot
   expose compatible hashes, rerun it with `--size-only` and record that result
   as a coarse key-and-size sanity check rather than integrity verification.
   Preserve the command version, configuration scope, logs, object counts, and
   bytes transferred in the migration record. Never expose private cover
   objects to make copying easier.

### Final Synchronization (maintenance window)

1. Announce the maintenance window and put the existing application into
   maintenance/read-only mode. Block account changes, invites, loans, library
   edits, metadata edits, and blob uploads. Confirm no background or operator
   process can write to D1 or R2.
2. Wait for in-flight requests to finish, then take a final full timestamped D1
   export from `libroo-beta`. Repeat the data-only export with the complete
   application-table list above. Use the rehearsed clear-and-reimport procedure
   or an audited delta import so the initial copy is replaced without duplicate
   rows while the target schema and `_hub_migrations` state remain intact.
3. Run a final `rclone copy` from the beta bucket to `libroo-production`, again
   without deletion, followed by `rclone check`.
4. Verify D1 row counts table by table and inspect representative critical
   records:

   - Better Auth users, accounts, sessions, verification records, and auth
     secrets/identifiers where applicable.
   - Roles, bans, invites, admin audit, and auth audit records.
   - Books, authors, locations, tags, loans, user-library records, and their
     join tables.
   - The D1 migration table and its applied migration sequence.

   Save source and destination query output. Counts must match unless a
   documented transformation explains the difference.
5. Compare R2 object counts and total bytes. Use checksums where the tool and
   object metadata support them; otherwise compare keys and sizes, and manually
   read a representative sample including private cover objects.
6. Update the `production` GitHub Environment secret
   `NUXT_HUB_CLOUDFLARE_DATABASE_ID` to the new D1 UUID and
   `NUXT_HUB_CLOUDFLARE_BUCKET_NAME` to `libroo-production`. Reconfirm all
   production runtime variables and secrets before allowing the deployment.

### Deploy Production Worker and Custom Domain Cutover

1. Merge or push the approved release commit to protected `main` to trigger
   `.github/workflows/deploy-cloudflare.yml`.
2. Confirm the workflow binds to the `production` Environment, registers the
   GitHub deployment, builds, validates, migrates, syncs secrets, and deploys in
   that order.
3. In Cloudflare, inspect `libroo-production` before cutover:

   - Cron triggers are `0 3 * * *` and `30 3 * * *`.
   - Observability and logs are enabled.
   - Source maps are uploaded.
   - Runtime variables and encrypted Worker secrets contain production values.
   - `workers_dev` is disabled and the intended custom-domain route is present.
   - D1 `DB` and R2 `BLOB` point to the new production resources.

4. Remove or detach the canonical custom-domain route from `libroo-beta`, then
   attach the same custom domain to `libroo-production`. Make only one Worker
   authoritative for the hostname. Verify DNS, certificate, route ownership,
   and an HTTPS response from the canonical origin.
5. Run the post-cutover smoke checklist while writes remain controlled:

   - Login, logout, signup/invite policy, password reset, and auth callbacks.
   - Plunk email delivery and configured sender/reply-to behavior.
   - Turnstile on every enabled public flow.
   - Representative D1 reads and writes, including admin/audit behavior.
   - R2 read and write, including private cover upload and retrieval.
   - Privacy policy, imprint, and terms links/content.
   - Manual execution or observation of both scheduled tasks.

6. Treat the deployment as accepted only after the smoke checklist passes.
   Preserve the results with the GitHub deployment/migration record. The
   workflow publishes its terminal API status from the job result; if smoke
   testing finds a defect afterward, immediately publish a failed/inactive
   operational status in the incident record and begin rollback.
7. Exit maintenance/read-only mode and resume writes only after acceptance.

### Rollback Window and Retirement

Keep `libroo-beta`, its old D1 database, and its old R2 bucket unchanged and
read-only for the explicitly recorded rollback window. Do not run cleanup,
migrations, lifecycle changes, or object deletions against them.

If rollback is required:

1. Re-enter maintenance/read-only mode and stop writes to
   `libroo-production`.
2. Assess whether production accepted writes after cutover. Export and preserve
   them before rollback; do not silently discard them.
3. Detach the canonical custom domain from `libroo-production` and reattach it
   to `libroo-beta`.
4. Verify DNS/certificate routing, run the critical smoke checks against the
   beta Worker, then resume writes only when the rollback target is healthy.
5. Record the failed release, data divergence, exports, and follow-up recovery
   plan.

Delete the beta Worker, old D1 database, or old R2 bucket only after all of the
following gates are satisfied:

- The rollback window has expired.
- Production smoke tests and normal usage remain healthy.
- D1 and R2 migration verification is recorded and approved.
- Required backups/exports and copy logs are retained under the backup policy.
- An authorized operator gives explicit deletion approval.
