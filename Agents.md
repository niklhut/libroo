# Libroo Agent Instructions

## Project Overview

**Libroo** is a private, physical-first library management system. It helps book lovers organize their physical book collections, track lending, and manage shelf locations.

### Core Features
- **Book Inventory**: Add books via ISBN with automatic metadata from OpenLibrary
- **Lending Ledger**: Track who borrowed which books (planned)
- **Shelf Mapping**: Assign books to physical locations (planned)
- **Cover Art**: WebP-optimized cover images stored in blob storage

---

## Tech Stack

### Framework
- **Nuxt 4** with SSR (server-side rendering)
- **NuxtHub** for database and blob storage
- **Nuxt UI v4** for components (UHeader, UPageHeader, UPageBody, UCard, etc.)

### Backend
- **Effect-TS** for all server-side logic (type-safe, composable error handling)
- **Drizzle ORM** with SQLite (via NuxtHub)
- **Better Auth** for authentication (email/password)

### Storage
- **NuxtHub Blob** for cover images (WebP format)
- **NuxtHub Database** for SQLite

---

## Code Conventions

### Effect-TS Patterns
All API handlers use Effect wrappers with required authentication:
```typescript
// All endpoints require auth
export default effectHandler((event, user) =>
  Effect.gen(function* () {
    // user is guaranteed authenticated
    // Use Effect.tryPromise for async operations
    // Use Effect.fail for errors
  })
)
```

### Repository Pattern
Services are organized as Effect Context Tags with Layer implementations:
- `BookRepository` - Book CRUD operations
- `OpenLibraryRepository` - External API calls
- `StorageService` - Blob storage operations
- `DbService` - Database access

### Nuxt UI Components
Always prefer [Nuxt UI](https://ui.nuxt.com/) components:
- `UHeader` for app header
- `UPageHeader` for page titles (use `#links` slot for actions)
- `UPageBody` for page content (provides proper padding)
- `UCard`, `UButton`, `UBadge`, `UForm`, `UFormField`

### Authentication
- Middleware at `/app/middleware/auth.ts` handles SSR auth checks
- Use `auth.api.getSession({ headers: event.headers })` for server-side session

### Images
- Store covers as WebP (converted via `sharp`)
- Use `<NuxtImg>` for images

---

## Development Commands

```bash
pnpm dev          # Start dev server
pnpm typecheck    # Run TypeScript checks
pnpm build        # Build for production
pnpm drizzle-kit push  # Apply schema changes
pnpm lint         # Run ESLint
pnpm lint:fix     # Run ESLint with autofix
pnpm preview      # Preview production build
```

Always run `pnpm lint:fix` before finishing a task.

---

## User Preferences

- **Clean, modern UI** with proper padding and spacing
- **Local-first**: Check local DB before external APIs
