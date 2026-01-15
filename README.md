# 📚 Libroo

Libroo is a personal library tracker built to help you manage your books, collections, and track who borrowed what.

## ✨ Features

- Add books manually or via ISBN using Open Library API
- Organize books into custom collections
- Track borrowing/lending history
- Mark books as "reading", "finished", etc.
- Rate and review finished books

## 🛠️ Stack

- [Nuxt 4](https://nuxt.com/)
- [Nuxt UI](https://ui.nuxt.com)
- [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL
- [Better Auth](https://better-auth.com/)
- [Open Library API](https://openlibrary.org/developers/api)

## 📦 Local Setup

```bash
git clone https://github.com/niklhut/libroo
cd libroo
cp .env.example .env # add DB + auth credentials
pnpm install
pnpm dev
```

## 🗺️ Roadmap

- [ ] ISBN-based book search and auto-fill
- [ ] Create/read/update/delete books
- [ ] Lending tracker with borrower info
- [ ] Collections UI
- [ ] Reading status + rating

## License

This project is licensed under the [GNU AGPLv3](LICENSE). This means you are free to use, modify, and self-host the app, but if you run a modified version as a public service, you must also make your source code available.
