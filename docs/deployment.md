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
  --build-arg VERSION="$VERSION" \
  --build-arg REVISION="$(git rev-parse HEAD)" \
  --build-arg CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg SOURCE="https://github.com/niklhut/libroo" \
  -t ghcr.io/OWNER/libroo:"$VERSION" \
  .
```

The Docker CI workflow builds `linux/amd64` on pull requests for a faster production-image smoke check. Pushes to `main` and release tags build both `linux/amd64` and `linux/arm64`. It uses Docker metadata rules so pull requests are tagged as `pr-<number>`, release tags like `v1.2.3` produce `1.2.3` and `1.2`, and branch/SHA tags are available for traceability. The same metadata is written as OCI image labels.

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
| `NUXT_EMAIL_PROVIDER` | `smtp` | Self-host supports `smtp` or `plunk`. |
| `NUXT_EMAIL_FROM` | empty | Required when email sending is enabled. |
| `NUXT_SMTP_HOST` / `NUXT_SMTP_PORT` / `NUXT_SMTP_SECURE` | empty / `587` / `false` | SMTP transport settings. |
| `NUXT_SMTP_USER` / `NUXT_SMTP_PASSWORD` | empty | SMTP credentials, if required by the provider. |
| `NUXT_PLUNK_API_KEY` / `NUXT_PLUNK_BASE_URL` | empty / `https://next-api.useplunk.com` | Plunk delivery settings. |

### Persistent Data

Mount `/data` as the durable volume. It contains:

- `/data/db/sqlite.db`: application database.
- `/data/blob`: uploaded assets and generated cover images.

The image creates both directories and runs `scripts/migrate-selfhost.mjs` before starting Nuxt. A fresh empty volume is migrated automatically. Before upgrading an existing install, back up the whole `/data` volume while the container is stopped.

Secrets should be injected through the orchestrator, an env file outside source control, or a secret manager. Do not bake secrets into the image.

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

The generated Worker uses NuxtHub D1 and R2 bindings from `nuxt.config.ts`. The project default Worker name is `libroo` through `nitro.cloudflare.wrangler.name`; set `NUXT_CLOUDFLARE_WORKER_NAME` to target a different Worker. The hosted beta CI sets it to `libroo-beta`. The CI workflow applies D1 migrations immediately before the beta deploy because Cloudflare D1 migrations are not applied by `wrangler deploy` automatically.

### Promotion Policy

Beta policy:

- Protect `main`.
- Require the `Lint`, `Unit Tests`, and `Docker Image` checks before merge.
- Require the Cloudflare Worker build check before merge.
- Merging to `main` deploys the beta hosted Worker, `libroo-beta`.
- Beta D1 migrations run only on `push` to `main`, after required checks have passed and the merge has completed.

Pull requests build the Cloudflare profile but do not deploy and do not apply D1 migrations. This is intentional: a preview Worker that points at the hosted beta D1 database could mutate beta data or apply schema migrations before the PR is merged.

Use a separate `prod` branch and production Worker when Libroo reaches the 1.0 release path. Until then, `main` is the protected beta integration and deploy branch. If manual promotion becomes necessary, prefer a GitHub Environment approval or a workflow dispatch input over a permanently diverging production branch.

### Preview Deployments

Preview deployments are disabled by default. They should not reuse the hosted beta D1 database or hosted beta R2 bucket.

Safe preview options:

- Per-PR preview infrastructure: create a D1 database and R2 bucket per pull request, deploy that PR against those resources, and delete them when the PR closes.
- Shared non-production preview infrastructure: use one preview D1 database and R2 bucket for all previews, accepting that concurrent PRs can conflict and migrations from one PR can affect another.
- Build-only previews: keep the current default, where PRs prove that the Worker builds but do not run hosted preview traffic.

The default is build-only previews because shared preview data can make multiple open pull requests interfere with each other, and per-PR D1/R2 lifecycle automation is not implemented yet.

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

Put these in repository or organization secrets. Pull request builds do not need these secrets because the deploy job only runs on `push` to protected `main`. If GitHub Environment protection is enabled later, move the same secrets into a `production` environment and add the workflow `environment` key back after confirming the repository validator accepts it.

Repository or environment variables:

| Variable | Recommended value |
| --- | --- |
| `NUXT_EMAIL_FROM` | Hosted sender address. |
| `NUXT_EMAIL_VERIFICATION_ENABLED` | `true` |
| `NUXT_PUBLIC_REGISTRATION_ENABLED` | `false` after the first admin exists. |
| `NUXT_CLOUDFLARE_WORKER_NAME` | Optional override. Defaults to `libroo`; hosted beta CI sets `libroo-beta`. |

### Hosted Migrations

For beta hosted deploys, CI runs on `push` to `main`:

```bash
pnpm build:cloudflare
pnpm dlx wrangler@latest d1 migrations apply DB --remote --config .output/server/wrangler.json
pnpm dlx wrangler@latest deploy --config .output/server/wrangler.json
```

Migration files live in `server/db/migrations`. After beta, append new migrations; do not rewrite migration history for existing hosted data. For manual hosted migrations, use the same generated `.output/server/wrangler.json` after a Cloudflare build.

Do not run hosted migrations from pull request workflows. If a PR contains a migration, it is validated by build/typecheck/test, then applied only after that PR is merged to protected `main`.

### Hosted Rollback

Rollback application code through the Cloudflare or NuxtHub deployment history by promoting the previous known-good deployment. Database migrations are forward-only unless a release explicitly ships a rollback plan. If a bad deploy includes a destructive migration, restore D1 from backup or apply a corrective forward migration, then redeploy the known-good application version.

Before promoting a release that changes schema or storage behavior, confirm that export/import or backup coverage is current for the hosted instance.
