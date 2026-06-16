# Libroo

Libroo is a personal library tracker built to help you manage your books, collections, and track who borrowed what.

## Features

- Add books manually or via ISBN using Open Library API
- Organize books into custom collections
- Track borrowing/lending history
- Mark books as "reading", "finished", etc.
- Rate and review finished books

## Setup

Create a production environment file from the example:

```bash
cp .env.example .env
```

Generate a strong auth secret:

```bash
openssl rand -base64 32
```

Set these values in `.env` or in your hosting provider's environment settings:

```bash
NUXT_BETTER_AUTH_SECRET=<output from openssl rand -base64 32>
NUXT_BETTER_AUTH_URL=https://your-libroo.example.com
```

## Runtime Profiles

Libroo has two runtime profiles. Runtime-specific database, storage, email, and HTTP client implementations are composed as Effect layers under `server/runtime/`, so route handlers, services, and repositories stay shared. The build defaults to `selfhost`; set `NUXT_LIBROO_RUNTIME_PROFILE=cloudflare` explicitly for the hosted Worker profile.

Hosted Cloudflare/NuxtHub:

```bash
NUXT_LIBROO_RUNTIME_PROFILE=cloudflare
NUXT_EMAIL_PROVIDER=plunk
pnpm build:cloudflare

# Verify the Worker bundle locally before deploying.
pnpm dlx wrangler@latest --cwd .output deploy --dry-run --outdir /tmp/libroo-wrangler-dry-run

# Deploy to Cloudflare after verification.
pnpm dlx wrangler@latest --cwd .output deploy
```

This profile uses NuxtHub D1, NuxtHub/R2 blob storage, Plunk email delivery, and stores cover images without server-side conversion. It does not import the self-hosted `sharp`, `nodemailer`, or local filesystem storage implementations.

Self-hosted Docker:

```bash
NUXT_LIBROO_RUNTIME_PROFILE=selfhost
NUXT_DATABASE_URL=file:.data/db/sqlite.db
NUXT_LOCAL_STORAGE_DIR=.data/blob
pnpm build:selfhost
docker build .
```

This profile uses local libSQL/SQLite storage through Drizzle, local filesystem blob storage, WebP cover conversion through `sharp`, and SMTP or Plunk email delivery. The Docker image defaults to `NUXT_DATABASE_URL=file:/data/db/sqlite.db` and `NUXT_LOCAL_STORAGE_DIR=/data/blob`; mount `/data` as the persistent volume. The image pre-creates `/data/db/` and `/data/blob/`, and the application also creates missing database and blob parent directories at runtime, so a fresh mounted `/data` volume can be empty.

## Email Verification

Email verification is disabled by default so local and private installs keep the existing registration, sign-in, and email-change flow.

For hosted or self-hosted deployments where account ownership should be enforced, enable verification and choose an email provider.

SMTP delivery is available in the self-hosted profile:

```bash
NUXT_EMAIL_VERIFICATION_ENABLED=true
NUXT_EMAIL_PROVIDER=smtp
NUXT_EMAIL_FROM="Libroo <no-reply@your-libroo.example.com>"
NUXT_SMTP_HOST=smtp.example.com
NUXT_SMTP_PORT=587
NUXT_SMTP_SECURE=false
NUXT_SMTP_USER=your-smtp-user
NUXT_SMTP_PASSWORD=your-smtp-password
```

Plunk delivery is available in both profiles and is the only email provider in the hosted Cloudflare profile:

```bash
NUXT_EMAIL_VERIFICATION_ENABLED=true
NUXT_EMAIL_PROVIDER=plunk
NUXT_PLUNK_API_KEY=sk_your_secret_key
NUXT_PLUNK_BASE_URL=https://next-api.useplunk.com
```

For a self-hosted Plunk instance, set `NUXT_PLUNK_BASE_URL` to your Plunk API origin. Libroo renders the email subject, HTML, and plain text locally, then sends the same rendered message through SMTP or Plunk.

When verification is enabled, Libroo fails startup if required email delivery settings are missing. New users must verify before normal app access, and email changes remain pending until the new address is verified. Users can resend verification mail from Settings. Verification links show clear success, expired-link, and invalid-link states.

If `NUXT_EMAIL_VERIFICATION_ENABLED=false` or unset, Libroo does not send verification mail and email changes apply immediately after the current password is confirmed. Security notifications, password reset emails, invite emails, and future reminder emails are available whenever SMTP or Plunk delivery is configured, even if email verification itself is disabled. If delivery is not configured, password changes still succeed without sending a notification and admins can create invite links instead of invite emails.

## Email Capability Matrix

Libroo derives email feature visibility from one server-side capability source. The client receives only safe boolean flags, never SMTP, Plunk, or sender configuration.

| Deployment state | Visible behavior |
| --- | --- |
| No email configured | Forgot password, resend verification, invite email, and reminder email actions are hidden. Email changes are applied after current-password confirmation. Password changes complete without notification email. Admins can create invite links and share them manually. |
| Email sending configured, verification disabled | Forgot password, invite email, password-change notification attempts, and future reminder email actions are available. Registration does not show verification messaging. Email changes apply after current-password confirmation. |
| Email verification enabled | All sending-backed features are available. Registration tells users to verify by email. Unverified users are kept on Settings until verified. Resend verification and pending-email-change verification are available. |
| Hosted/public deployments requiring verification or reset | Configure SMTP or Plunk and set `NUXT_EMAIL_VERIFICATION_ENABLED=true`. Password reset and verification actions are shown only when delivery is configured; otherwise the APIs reject email-only requests instead of pretending mail was sent. |

Deploy the application with an empty database, then open `/register` on your deployed instance and create the first account. The first registered account becomes the administrator automatically.

## Invite-Only Hosted Mode

Public registration is enabled by default. Hosted admins can turn it off so only invited users can join:

```bash
NUXT_PUBLIC_REGISTRATION_ENABLED=false
```

When public registration is disabled, `/register` requires an invite token. Admins can create invite links from `/admin/users`; if email delivery is configured, admins can also send invite emails. Invites start as pending, then become accepted after Better Auth creates the account, expired after their expiration date, or revoked when an admin cancels them. Expired and revoked invites cannot be used.

Invite emails use the same SMTP or Plunk settings as verification emails. Link-only invites can still be created without configuring email delivery.

For a new private hosted instance, leave public registration enabled until the first account is created and promoted automatically to administrator. Then set `NUXT_PUBLIC_REGISTRATION_ENABLED=false`, restart the deployment, and create invites from the admin users page.

## Local Development

```bash
git clone https://github.com/niklhut/libroo
cd libroo
cp .env.example .env
pnpm install
pnpm dev
```

For local development, set `NUXT_BETTER_AUTH_URL=http://localhost:3000`. You can generate a local secret with the same `openssl rand -base64 32` command, or use any stable development-only value.

Open `http://localhost:3000/register` and create the first account. The first registered account becomes the administrator automatically.

## Stack

- [Nuxt 4](https://nuxt.com/)
- [Nuxt UI](https://ui.nuxt.com)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Better Auth](https://better-auth.com/)
- [Open Library API](https://openlibrary.org/developers/api)

## Roadmap

- [ ] ISBN-based book search and auto-fill
- [ ] Create/read/update/delete books
- [ ] Lending tracker with borrower info
- [ ] Collections UI
- [ ] Reading status + rating

## License

This project is licensed under the [GNU AGPLv3](LICENSE). This means you are free to use, modify, and self-host the app, but if you run a modified version as a public service, you must also make your source code available.
