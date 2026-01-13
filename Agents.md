# Libroo Agent Instructions

## Project Overview

**Libroo** is a private, physical-first library management system for inventory, lending logistics, and shelf mapping.

---

## Tech Stack & Architecture

- **Framework:** Nuxt 4 (SSR, Auto-imports) + NuxtHub (DB/Blob).
- **UI:** Nuxt UI v4 (UPageHeader, UPageBody, UCard, etc.).
- **Logic:** Effect-ts (Functional DI) + Drizzle ORM.

### The 3-Tier Architecture (Mandatory)

Every feature MUST be split into these three layers. No exceptions.

1. **Route Handler (`/server/api`):** The "Entry Point."
   - Responsibilities: Extracting params, calling the Service, and running the Effect.
   - Guardrail: **Never** call Drizzle/DB/blob storage directly. **Never** write business logic here.
2. **Service Layer (`/server/services`):** The "Brain."
   - Responsibilities: Validation, orchestrating multiple repositories, business rules (e.g., "Can this book be lent?").
   - Pattern: Use `Effect.Tag` and `Layer`.
3. **Repository Layer (`/server/repositories`):** The "Data Gatekeeper."
   - Responsibilities: Pure CRUD (Create, Read, Update, Delete) and external API fetches.
   - Guardrail: No business logic. Just data transformation and persistence.

---

## Code Conventions

### Effect-TS & Dependency Injection

Always use `Effect.gen` and provide the required layers at the entry point.

```typescript
// server/api/example.post.ts
export default effectHandler((event, user) => 
  Effect.gen(function* () {
    const service = yield* _(LendingService);
    return yield* _(service.lendBook(yield* _(parseBody(event))));
  }).pipe(
    Effect.provide(LendingServiceLive),
    Effect.provide(BookRepositoryLive)
  )
)
```

### Strict Guardrails

- **No Fat Handlers**: If an API route logic exceeds 15 lines, move it to a Service.
- **Error Handling**: Use `Data.TaggedError` for domain errors.
- **Local-First**: Check `BookRepository` before calling `OpenLibraryRepository`.
- **Images**: All uploads must pass through a `StorageService` for WebP conversion via `sharp`.

### UI Implementation

- Always use [NuxtUI](https://ui.nuxt.com/) components, when possible instead of writing your own components or inline styles.
- Use `#links` slot in `UPageHeader` for primary actions.
- Wrap all content in `UPageBody` for consistent spacing.
- Use `NuxtImg` for optimized image loading.

---

## Development Workflow

- Define Schema: Update `server/database/schema.ts`.
- Create Repository: Implement data access in `server/repositories/`.
- Create Service: Implement business logic in `server/services/`.
- Expose API: Link service to route in `server/api/`.
- Finalize: Run `pnpm lint:fix` and `pnpm typecheck`.