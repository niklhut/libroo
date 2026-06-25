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

Optional email and registration settings:

| Variable | Default | Notes |
| --- | --- | --- |
| `NUXT_EMAIL_VERIFICATION_ENABLED` | `false` | Set `true` for public installs. |
| `NUXT_PUBLIC_REGISTRATION_ENABLED` | `true` | Set `false` after creating the first admin for invite-only operation. |
| `NUXT_PUBLIC_TURNSTILE_ENABLED` | `false` | Enables Cloudflare Turnstile server enforcement and client widget rendering for signup and password-reset email requests. Public installs should set it to `true`; private LAN, VPN/Tailscale, Cloudflare Access, or otherwise access-controlled installs may leave it `false` intentionally. |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` / `NUXT_TURNSTILE_SECRET_KEY` | empty | Cloudflare Turnstile site key and secret key. Required when Turnstile is enabled. |
| `NUXT_TURNSTILE_ALLOWED_HOSTNAMES` | empty | Optional comma-separated hostname allow-list for Turnstile token responses, such as `libroo.example.com,beta.libroo.example.com`. |
| `NUXT_PUBLIC_OPEN_LIBRARY_LINKS_ENABLED` | `false` in production, `true` in development | Shows outbound Open Library edition/work links on book detail pages. Keep disabled for the hosted/product experience; enable intentionally for self-hosted source visibility or metadata debugging. |
| `NUXT_OPEN_LIBRARY_REQUEST_TIMEOUT_SECONDS` | `12` | Timeout for Open Library metadata and cover existence requests. Increase if the upstream API is slow in your deployment region. |
| `NUXT_OPEN_LIBRARY_COVER_TIMEOUT_SECONDS` | `20` | Timeout for downloading and repairing cover images from Open Library. |
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

### Persistent Data

Mount `/data` as the durable volume. It contains:

- `/data/db/sqlite.db`: application database.
- `/data/blob`: uploaded assets and generated cover images.

The image creates both directories and runs `scripts/migrate-selfhost.mjs` before starting Nuxt. A fresh empty volume is migrated automatically. Before upgrading an existing install, back up the whole `/data` volume while the container is stopped.

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

Rollback is image-based: stop the new container and start the previous known-good image against the same `/data` volume. If a release introduced database migrations, prefer restoring the matching `/data` backup. SQLite migrations are not assumed to be reversible.

## Hosted Cloudflare

The hosted instance uses the Cloudflare runtime profile:

```bash
NUXT_LIBROO_RUNTIME_PROFILE=cloudflare
pnpm build:cloudflare
```

The generated Worker uses NuxtHub D1 and R2 bindings from `nuxt.config.ts`. The project default Worker name is `libroo` through `nitro.cloudflare.wrangler.name`; set `NUXT_CLOUDFLARE_WORKER_NAME` to target a different Worker. Same-repository PRs validate the Cloudflare build as part of their full preview deployment. The `Build Cloudflare Worker` workflow is retained only for fork PRs, which cannot receive preview Environment secrets. The push-only `Deploy to Cloudflare` workflow applies D1 migrations immediately before deploy because Cloudflare D1 migrations are not applied by `wrangler deploy` automatically.

### First Admin Setup

Deploy the first hosted beta with an empty D1 database and public registration enabled:

```bash
NUXT_PUBLIC_REGISTRATION_ENABLED=true
```

Open `/register` on the hosted origin and create the first account. Libroo's Better Auth policy plugin promotes the first created user to `admin` by setting Better Auth's `user.role` field. Confirm that account can access `/admin/users`, then set `NUXT_PUBLIC_REGISTRATION_ENABLED=false` for invite-only operation and redeploy.

Do not create a separate Libroo auth table. User roles and bans are Better Auth state: roles are read from `user.role`, and bans are read from `user.banned`, `user.ban_reason`, and `user.ban_expires`.

### Promotion Policy

Hosted beta policy:

- Protect `main`.
- Require the `Lint`, `Unit Tests`, and `Docker Image` checks before merge.
- Require the Cloudflare Worker build check before merge.
- Merging to `main` deploys the configured hosted Worker.
- D1 migrations run only on `push` to `main`, after required checks have passed and the merge has completed.

Same-repository pull requests receive isolated Cloudflare previews. Fork pull requests remain build-only because they must not receive the `preview` GitHub Environment secrets. Production D1 migrations still run only after merge to protected `main`.

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
| Better Auth origin | `NUXT_BETTER_AUTH_URL` is the exact per-PR `https://*.workers.dev` origin. |
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

One open same-repository PR consumes one Access application, one Worker, one D1 database, and one R2 bucket. The expected steady state is therefore the number of open same-repository PRs, bounded by `PREVIEW_CONCURRENT_LIMIT`; the default workflow value is `10`.

Set `PREVIEW_CONCURRENT_LIMIT` as a variable on the `preview` GitHub Environment to lower or raise the ceiling. Before creating anything, the deploy workflow counts existing `libroo-preview-` D1 databases and R2 buckets. It fails with a remediation message when a new resource would exceed the ceiling. Updating an already-provisioned PR remains allowed at the ceiling.

Current Cloudflare allowances should be checked before changing the ceiling:

- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) measures rows read, rows written, and total storage across the account. The Workers Free allowance currently includes 5 million rows read per day, 100,000 rows written per day, and 5 GB total storage. Empty databases still consume a small amount of storage, and preview migrations count as usage.
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/) currently includes 10 GB-month of Standard storage, 1 million Class A operations, and 10 million Class B operations per month. Uploads, object listings during cleanup, and test traffic share those account-wide allowances.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) currently include 100,000 requests per day on the Free plan. Preview Workers share the account limit; they do not each receive a separate allowance.
- [Cloudflare One account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/) currently allow 500 Access applications by default. Cleanup and sweeping prevent disposable preview applications from accumulating toward that account-wide limit.

The daily orphan sweep is the quota backstop behind close-event cleanup. In a healthy steady state, every `libroo-preview-pr-<number>` resource maps to an open pull request and the count stays at or below the configured ceiling. Orphan count should normally be zero.

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
pnpm exec wrangler delete libroo-pr-123 --force

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

All delete operations are intended to be idempotent: an already-absent resource is success. If a command fails for another reason, verify that the token in the `preview` Environment has D1, R2, and Workers edit permissions and that `CLOUDFLARE_ACCOUNT_ID` targets the expected account.

### Required GitHub Configuration

Repository or environment secrets:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Wrangler deploy and D1 migration access. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account for Wrangler. |
| `NUXT_HUB_CLOUDFLARE_DATABASE_ID` | D1 database ID used during the Cloudflare build. |
| `NUXT_HUB_CLOUDFLARE_BUCKET_NAME` | R2 bucket name used during the Cloudflare build. |
| `NUXT_BETTER_AUTH_SECRET` | Hosted auth secret. |
| `NUXT_BETTER_AUTH_URL` | Hosted public origin. |
| `NUXT_PLUNK_API_KEY` | Hosted email delivery. |
| `NUXT_TURNSTILE_SECRET_KEY` | Hosted Turnstile server-side verification secret. |

Production deploy secrets can remain repository-scoped or move to a protected production Environment. Separately, create a `preview` GitHub Environment containing preview-scoped `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `NUXT_BETTER_AUTH_SECRET`, plus the `CLOUDFLARE_ACCESS_IDP_ID`, `CLOUDFLARE_ACCESS_POLICY_ID`, and `CLOUDFLARE_ACCESS_TEAM_DOMAIN` variables documented above. Do not put `NUXT_PLUNK_API_KEY`, the production Better Auth secret, or production resource IDs in the preview Environment.

The Cloudflare deploy workflow syncs `NUXT_BETTER_AUTH_SECRET`, `NUXT_PLUNK_API_KEY`, and, when Turnstile is enabled, `NUXT_TURNSTILE_SECRET_KEY` with `wrangler secret bulk`. Do not configure the Turnstile secret as a plain GitHub variable or Wrangler var.

Repository or environment variables:

| Variable | Recommended value |
| --- | --- |
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
| `NUXT_LEGAL_MARKDOWN_FETCH_TIMEOUT_SECONDS` | `5` |
| `NUXT_PLUNK_SEND_TIMEOUT_SECONDS` | `5` |
| `NUXT_PUBLIC_LEGAL_PRIVACY_POLICY_URL` / `NUXT_PUBLIC_LEGAL_IMPRINT_URL` / `NUXT_PUBLIC_LEGAL_TERMS_URL` | Optional canonical hosted legal page URLs. |
| `NUXT_LEGAL_PRIVACY_POLICY_MARKDOWN_URL` / `NUXT_LEGAL_IMPRINT_MARKDOWN_URL` / `NUXT_LEGAL_TERMS_MARKDOWN_URL` | Optional Markdown source URLs, used when the matching canonical URL is empty. |
| `NUXT_CLOUDFLARE_WORKER_NAME` | Optional override. Defaults to `libroo`. |

The deploy workflow defaults hosted beta Turnstile enforcement to `true`. To intentionally deploy a private or access-controlled Cloudflare Worker without Turnstile, set repository variable `NUXT_PUBLIC_TURNSTILE_ENABLED=false`.

### Hosted Migrations

For hosted deploys, CI runs on `push` to `main`:

```bash
pnpm build:cloudflare
pnpm exec wrangler d1 migrations apply DB --remote --config .output/server/wrangler.json
# CI pipes required Worker secrets into wrangler secret bulk here.
pnpm exec wrangler deploy --config .output/server/wrangler.json
```

Migration files live in `server/db/migrations/sqlite`. Append new migrations; do not rewrite migration history for existing hosted data. For manual hosted migrations, use the same generated `.output/server/wrangler.json` after a Cloudflare build.

Do not run hosted migrations from pull request workflows. If a PR contains a migration, it is validated by build/typecheck/test, then applied only after that PR is merged to protected `main`.

### Hosted Rollback

Rollback application code through the Cloudflare or NuxtHub deployment history by promoting the previous known-good deployment. Database migrations are forward-only unless a release explicitly ships a rollback plan. If a bad deploy includes a destructive migration, restore D1 from backup or apply a corrective forward migration, then redeploy the known-good application version.

Before promoting a release that changes schema or storage behavior, confirm that export/import or backup coverage is current for the hosted instance.
