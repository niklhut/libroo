# Libroo

Libroo is a private, physical-first library management system for home and small-library inventories. It tracks books, shelf locations, reading state, lending logistics, borrower links, and admin-managed access.

## Current Stack

- Nuxt 4, Nuxt UI v4, Pinia, and Nuxt Image.
- Effect services and repositories for server-side business logic.
- Drizzle ORM with SQLite-compatible storage.
- Better Auth for accounts, sessions, roles, bans, password reset, and email verification.
- NuxtHub on Cloudflare for hosted D1 database and R2/blob storage.
- Self-hosted Docker profile with local libSQL/SQLite, local blob storage, and Sharp WebP cover conversion.

Database migrations live under `server/db/migrations/sqlite`.

## Beta Release Features

- Email/password authentication through Better Auth.
- First-user admin promotion for empty installs.
- Admin user management, role changes, bans, invites, and audit log.
- Optional public registration or invite-only registration.
- Manual book creation and ISBN lookup with Open Library metadata.
- Library list/detail views, authors, locations, tags, ratings, notes, and reading progress.
- Borrowing and lending workflows, including public borrower invite links.
- CSV import/export for library transfer.
- Local and hosted cover/blob storage.
- Optional SMTP or Plunk email delivery for verification, password reset, invites, and security notifications.
- Self-hosted Docker deployment and hosted Cloudflare/NuxtHub deployment.

## Requirements

- Node.js 22 or newer.
- pnpm 11.8.0, or Corepack configured for the package manager in `package.json`.
- Docker, only for self-hosted container runs.
- Wrangler and Cloudflare credentials, only for hosted Cloudflare deploys.

## Local Development

```bash
git clone https://github.com/niklhut/libroo
cd libroo
pnpm install
cp .env.example .env
openssl rand -base64 32
```

Put the generated secret in `.env`:

```bash
NUXT_BETTER_AUTH_SECRET=<output from openssl rand -base64 32>
NUXT_BETTER_AUTH_URL=http://localhost:3000
NUXT_LIBROO_RUNTIME_PROFILE=selfhost
NUXT_DATABASE_URL=file:.data/db/sqlite.db
NUXT_LOCAL_STORAGE_DIR=.data/blob
```

Apply the SQLite baseline migration, then start Nuxt:

```bash
pnpm exec node scripts/migrate-selfhost.mjs
pnpm dev
```

Open `http://localhost:3000/register` and create the first account. The Better Auth policy plugin in `server/utils/libroo-admin-auth-plugin.ts` promotes the first created user in an empty database to `admin`.

Useful checks before shipping changes:

```bash
pnpm lint:fix
pnpm typecheck
pnpm test:unit
```

The full first-release manual QA pass lives in [docs/first-release-qa.md](docs/first-release-qa.md).

## Environment Configuration

Better Auth documentation refers to `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`. In this Nuxt app, set them with the Nuxt runtime-config prefix:

| Variable | Required | Notes |
| --- | --- | --- |
| `NUXT_BETTER_AUTH_SECRET` | Production yes | Stable secret used to sign Better Auth sessions. Generate with `openssl rand -base64 32` and keep it unchanged across restarts. |
| `NUXT_BETTER_AUTH_URL` | Production yes | Public origin of the app, for example `https://libroo.example.com` or `http://localhost:3000`. |
| `NUXT_LIBROO_RUNTIME_PROFILE` | Optional | `selfhost` by default. Use `cloudflare` for NuxtHub/D1/R2 builds. |
| `NUXT_DATABASE_URL` | Self-host | libSQL/SQLite URL. Local default is `file:.data/db/sqlite.db`; Docker uses `file:/data/db/sqlite.db`. |
| `NUXT_LOCAL_STORAGE_DIR` | Self-host | Local blob directory. Local default is `.data/blob`; Docker uses `/data/blob`. |
| `NUXT_PUBLIC_REGISTRATION_ENABLED` | Optional | `true` by default. Set `false` after the first admin exists to make registration invite-only. |
| `NUXT_PUBLIC_OPEN_LIBRARY_LINKS_ENABLED` | Optional | `true` in development and `false` in production unless explicitly set. |

Email is optional, but password reset, invite emails, security notifications, and verification emails require a provider.

SMTP is available in the self-hosted profile:

```bash
NUXT_EMAIL_PROVIDER=smtp
NUXT_EMAIL_FROM="Libroo <no-reply@your-libroo.example.com>"
NUXT_SMTP_HOST=smtp.example.com
NUXT_SMTP_PORT=587
NUXT_SMTP_SECURE=false
NUXT_SMTP_USER=your-smtp-user
NUXT_SMTP_PASSWORD=your-smtp-password
```

Plunk is available in both profiles and is the hosted Cloudflare profile's email provider:

```bash
NUXT_EMAIL_PROVIDER=plunk
NUXT_EMAIL_FROM=no-reply@your-libroo.example.com
NUXT_EMAIL_REPLY_TO=support@your-libroo.example.com
NUXT_PLUNK_API_KEY=sk_your_secret_key
NUXT_PLUNK_BASE_URL=https://next-api.useplunk.com
```

Set `NUXT_EMAIL_VERIFICATION_ENABLED=true` when users should verify email ownership before normal app access. When it is `false` or unset, registration and sign-in work without verification; email changes apply after current-password confirmation.

## Database Migrations

The current baseline migration is `server/db/migrations/sqlite/0000_initial_beta.sql`. Fresh local and self-hosted installs should apply migrations to an empty SQLite database with:

```bash
pnpm exec node scripts/migrate-selfhost.mjs
```

The Docker image runs that script automatically before starting Nuxt. It creates the database directory, checks writable space, and applies migrations from `server/db/migrations/sqlite`.

Hosted Cloudflare deployments apply the same SQLite migration files to D1 after `pnpm build:cloudflare`:

```bash
pnpm build:cloudflare
pnpm exec wrangler d1 migrations apply DB --remote --config .output/server/wrangler.json
```

After the beta release, add new Drizzle migrations linearly. Do not rewrite existing migration history for installations with live data.

## Self-Hosted Docker

```bash
cp .env.example .env
openssl rand -base64 32
# Put the generated value in NUXT_BETTER_AUTH_SECRET.
docker build -t libroo:local .
docker compose up
```

The Compose file exposes `http://localhost:3000`, mounts a persistent `libroo-data` volume at `/data`, and stores:

- `/data/db/sqlite.db` for the database.
- `/data/blob` for uploaded assets and generated WebP covers.

Back up the whole `/data` volume before upgrades. SQLite migrations are treated as forward-only unless a release explicitly ships a rollback plan.

Scripted self-hosted backup and restore tooling is available:

```bash
pnpm backup:selfhost -- --output-dir /backups/libroo
pnpm restore:selfhost -- /backups/libroo/libroo-selfhost-backup-YYYY-MM-DDTHH-MM-SSZ.tar.gz
```

See [docs/backup-restore.md](docs/backup-restore.md) for self-hosted archives, hosted D1/R2 exports, manifests, verification, and retention guidance. The hosted-service backup retention target is 30 days before public launch.

## Hosted Cloudflare/NuxtHub

The hosted profile uses NuxtHub with Cloudflare D1 and R2-compatible blob storage:

```bash
NUXT_LIBROO_RUNTIME_PROFILE=cloudflare pnpm build:cloudflare
```

Hosted deployment secrets and environment variables:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `NUXT_HUB_CLOUDFLARE_DATABASE_ID`
- `NUXT_HUB_CLOUDFLARE_BUCKET_NAME`
- `NUXT_BETTER_AUTH_SECRET`
- `NUXT_BETTER_AUTH_URL`
- `NUXT_PLUNK_API_KEY`, when email delivery is enabled

Recommended hosted variables:

- `NUXT_EMAIL_PROVIDER=plunk`
- `NUXT_EMAIL_FROM=no-reply@your-domain.example`
- `NUXT_EMAIL_VERIFICATION_ENABLED=true`
- `NUXT_PUBLIC_REGISTRATION_ENABLED=false`, after the first admin account exists
- `NUXT_PUBLIC_OPEN_LIBRARY_LINKS_ENABLED=false`

Deployments should apply D1 migrations immediately before `wrangler deploy`. The repository's deployment notes include the CI promotion policy, preview caveats, rollback expectations, and full variable tables in [docs/deployment.md](docs/deployment.md).

## First Admin Setup

Start every new install with an empty database and public registration enabled:

```bash
NUXT_PUBLIC_REGISTRATION_ENABLED=true
```

Open `/register` and create the first account. The `librooAdminPolicyPlugin` runs after Better Auth creates the user and atomically assigns `user.role = 'admin'` if no admin user exists. After confirming the account can access `/admin/users`, set `NUXT_PUBLIC_REGISTRATION_ENABLED=false` for private or hosted invite-only operation and restart/redeploy.

The policy also prevents common lockouts: admins cannot demote or ban themselves, and Libroo rejects demoting or banning the last active admin.

## Operator Guide: Users And Auth

Libroo uses Better Auth as the source of truth for user authentication and account state.

- Roles are stored on Better Auth's `user.role` field. Libroo treats any role token containing `admin` as admin.
- Bans are stored on Better Auth's `user.banned`, `user.ban_reason`, and `user.ban_expires` fields.
- There is no separate Libroo user-auth table. Do not create or update a parallel user table for auth state.
- Manage users from `/admin/users` whenever possible. That UI uses Better Auth admin APIs and Libroo policy/audit plugins.
- Admin invite links live in `signup_invites` and create normal Better Auth users when accepted.
- Account deletion removes Better Auth records and the user's Libroo library data. See [docs/account-deletion.md](docs/account-deletion.md) for retention and support operations.

## Legal And Self-Hosting

Libroo is licensed under the [GNU AGPLv3](LICENSE). You may use, modify, and self-host it. If you run a modified version as a network service for other users, the AGPL expects you to provide the corresponding source code for that modified version.

The app does not ship legally sufficient privacy-policy or imprint text. Operators can configure public legal URLs or Markdown sources with:

```bash
NUXT_PUBLIC_LEGAL_PRIVACY_POLICY_URL=
NUXT_PUBLIC_LEGAL_IMPRINT_URL=
NUXT_LEGAL_PRIVACY_POLICY_MARKDOWN_URL=
NUXT_LEGAL_IMPRINT_MARKDOWN_URL=
```

## Roadmap

Available in the beta release:

- Core private-library catalog, locations, reading progress, ratings, notes, and tags.
- ISBN lookup and manual entry.
- Lending, borrower links, and loan return/cancel flows.
- Better Auth-backed registration, login, password reset, email verification, first-admin promotion, invites, role management, bans, and audit log.
- SQLite self-hosting and Cloudflare/NuxtHub hosted deployment.
- CSV import/export and account deletion.
- Backup/restore tooling for self-hosted operators and documented hosted D1/R2 backup procedures.

Future work toward v1:

- Richer shelf mapping and physical inventory workflows.
- Reminders and notification scheduling for loans.
- Barcode scanner polish and bulk inventory flows.
- More import sources and metadata reconciliation tools.
- Hardened preview environments for Cloudflare deployments.

## More Documentation

- [Deployment](docs/deployment.md)
- [Backup And Restore](docs/backup-restore.md)
- [Account Deletion And Retention](docs/account-deletion.md)
