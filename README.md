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
BETTER_AUTH_SECRET=<output from openssl rand -base64 32>
BETTER_AUTH_URL=https://your-libroo.example.com
```

## Email Verification

Email verification is disabled by default so local and private installs keep the existing registration, sign-in, and email-change flow.

For hosted or self-hosted deployments where account ownership should be enforced, enable verification and choose an email provider.

SMTP delivery:

```bash
LIBROO_EMAIL_VERIFICATION_ENABLED=true
LIBROO_EMAIL_PROVIDER=smtp
LIBROO_EMAIL_FROM="Libroo <no-reply@your-libroo.example.com>"
LIBROO_SMTP_HOST=smtp.example.com
LIBROO_SMTP_PORT=587
LIBROO_SMTP_SECURE=false
LIBROO_SMTP_USER=your-smtp-user
LIBROO_SMTP_PASSWORD=your-smtp-password
```

Plunk delivery:

```bash
LIBROO_EMAIL_VERIFICATION_ENABLED=true
LIBROO_EMAIL_PROVIDER=plunk
LIBROO_PLUNK_API_KEY=sk_your_secret_key
LIBROO_PLUNK_BASE_URL=https://next-api.useplunk.com
```

For a self-hosted Plunk instance, set `LIBROO_PLUNK_BASE_URL` to your Plunk API origin. Libroo renders the email subject, HTML, and plain text locally, then sends the same rendered message through SMTP or Plunk.

When verification is enabled, Libroo fails startup if required email delivery settings are missing. New users must verify before normal app access, and email changes remain pending until the new address is verified. Users can resend verification mail from Settings. Verification links show clear success, expired-link, and invalid-link states.

If `LIBROO_EMAIL_VERIFICATION_ENABLED=false` or unset, Libroo does not send verification mail and email changes apply immediately.

Deploy the application with an empty database, then open `/register` on your deployed instance and create the first account. The first registered account becomes the administrator automatically.

## Invite-Only Hosted Mode

Public registration is enabled by default. Hosted admins can turn it off so only invited users can join:

```bash
LIBROO_PUBLIC_REGISTRATION_ENABLED=false
```

When public registration is disabled, `/register` requires an invite token. Admins can create invite links from `/admin/users`; if email delivery is configured, admins can also send invite emails. Invites start as pending, then become accepted after Better Auth creates the account, expired after their expiration date, or revoked when an admin cancels them. Expired and revoked invites cannot be used.

Invite emails use the same SMTP or Plunk settings as verification emails. Link-only invites can still be created without configuring email delivery.

For a new private hosted instance, leave public registration enabled until the first account is created and promoted automatically to administrator. Then set `LIBROO_PUBLIC_REGISTRATION_ENABLED=false`, restart the deployment, and create invites from the admin users page.

## Local Development

```bash
git clone https://github.com/niklhut/libroo
cd libroo
cp .env.example .env
pnpm install
pnpm dev
```

For local development, set `BETTER_AUTH_URL=http://localhost:3000`. You can generate a local secret with the same `openssl rand -base64 32` command, or use any stable development-only value.

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
