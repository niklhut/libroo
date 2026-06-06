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

Deploy the application with an empty database, then open `/register` on your deployed instance and create the first account. The first registered account becomes the administrator automatically.

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
