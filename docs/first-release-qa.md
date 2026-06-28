# First Release QA Checklist

Use this checklist before tagging or promoting the first public Libroo release. Run the
local pass against a fresh self-host profile database, then repeat the hosted pass
against the release candidate deployment.

## Release Candidate

- Date:
- Tester:
- Commit SHA:
- Local URL:
- Hosted URL:
- Browser/device matrix:
  - Desktop Chromium:
  - Desktop Safari or Firefox:
  - Mobile viewport, 390 x 844:
  - Mobile viewport, 430 x 932:

## Required Commands

Run these from the repository root before release.

```bash
pnpm lint:fix
pnpm typecheck
pnpm test:unit
pnpm test:e2e
pnpm build
```

- [ ] `pnpm lint:fix` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test:unit` passes.
- [ ] `pnpm test:e2e` passes against the isolated Playwright self-host runtime.
- [ ] `pnpm build` passes.
- [ ] Any code formatting changes from `lint:fix` are reviewed and committed.

## Automated E2E Coverage

The Playwright suite in `test/e2e/` now covers these journeys with an isolated
SQLite database, temp blob directory, and local OpenLibrary fixture server:

- [ ] Auth bootstrap, login, logout, session persistence, and protected-route redirects.
- [ ] Add by ISBN using fixture OpenLibrary metadata and covers.
- [ ] Manual book creation with uploaded private cover.
- [ ] Library search, opening detail pages, and representative detail mutation persistence.
- [ ] Multi-user lending invite acceptance and return lifecycle.
- [ ] Admin authorization, banned-user rejection, and cover access rules.

Keep the following checks manual because they depend on hardware, hosted
providers, or exploratory release judgment:

- [ ] Camera and barcode scanning on real devices.
- [ ] Hosted email-provider behavior for verification, password reset, and invite delivery.
- [ ] Hosted deployment smoke checks, cross-browser exploratory layout review, import/export spot checks, and release-specific regression exploration.

## Local Environment Setup

- [ ] Copy `.env.example` to `.env`.
- [ ] Set a stable `NUXT_BETTER_AUTH_SECRET`.
- [ ] Set `NUXT_BETTER_AUTH_URL=http://localhost:3000`.
- [ ] Open the local app at `http://localhost:3000`, not `http://127.0.0.1:3000`, unless `NUXT_BETTER_AUTH_URL` is also changed to that exact origin. Better Auth rejects mismatched origins.
- [ ] Set `NUXT_LIBROO_RUNTIME_PROFILE=selfhost`.
- [ ] Set `NUXT_DATABASE_URL=file:.data/db/sqlite.db`.
- [ ] Set `NUXT_LOCAL_STORAGE_DIR=.data/blob`.
- [ ] Start from a clean `.data` directory or record the seed data used below.
- [ ] Run `pnpm exec node scripts/migrate-selfhost.mjs`.
- [ ] Start `pnpm dev` and open `http://localhost:3000`.

## Hosted Environment Setup

- [ ] Confirm `NUXT_LIBROO_RUNTIME_PROFILE=cloudflare`.
- [ ] Confirm `NUXT_BETTER_AUTH_URL` matches the hosted origin.
- [ ] Confirm `NUXT_BETTER_AUTH_SECRET` is stable and not shared with previews.
- [ ] Confirm D1 migrations are applied to the target database.
- [ ] Confirm the configured blob bucket is the release candidate bucket.
- [ ] Confirm email provider variables are set when verification, reset, or invites are enabled.
- [ ] Confirm registration is intentionally enabled or disabled for the release candidate.

## Auth And Session

- [ ] Visit `/library` while signed out; verify redirect to `/login`.
- [ ] Register the first local user.
- [ ] Verify the first user becomes an admin on an empty database.
- [ ] Log out from the header or settings surface.
- [ ] Log in with the same account.
- [ ] Refresh `/library`; verify the session persists.
- [ ] Close and reopen the browser tab; verify the session persists.
- [ ] Visit `/login` while signed in; verify the app routes to the authenticated area.
- [ ] Visit `/register` when registration is disabled; verify the invite-only or disabled state is clear.
- [ ] Attempt login with an incorrect password; verify a safe error message and no session.
- [ ] Attempt register with an invalid email and weak password; verify validation feedback.

## Better Auth Admin Behavior

Complete this section when admin user management has shipped.

- [ ] As admin, visit `/admin/users`; verify the user list loads.
- [ ] As non-admin, visit `/admin/users`; verify access is rejected or redirected.
- [ ] As non-admin, visit `/admin/invites`; verify access is rejected or redirected.
- [ ] As non-admin, visit `/admin/audit`; verify access is rejected or redirected.
- [ ] Verify an admin cannot demote or ban themself.
- [ ] Verify the last active admin cannot be demoted or banned.
- [ ] Ban a test user; verify that user cannot access authenticated app pages.
- [ ] Unban the test user; verify login and app access recover.
- [ ] Create an invite from `/admin/invites`; verify the invite can register a user.
- [ ] Revoke an unused invite; verify the revoked link cannot register a user.
- [ ] Verify admin actions appear in `/admin/audit`.

## Add Books

- [ ] From `/library/add`, add a book by ISBN lookup.
- [ ] Verify lookup checks local library state before adding external metadata.
- [ ] Verify duplicate ISBN handling is clear and does not silently create unexpected duplicates.
- [ ] Use the camera scan tab on a mobile viewport or physical phone.
- [ ] Approve camera permission only for this test, then scan an ISBN barcode.
- [ ] Verify the scanned ISBN can be added successfully.
- [ ] Deny camera permission in a fresh browser profile; verify a helpful recovery state.
- [ ] Add a book through manual entry with title and author.
- [ ] Add a book through manual entry with optional metadata and cover where available.
- [ ] Run a bulk import with a small valid CSV.
- [ ] Run a bulk import containing one invalid row; verify row-level feedback and no corrupt records.
- [ ] Verify imported tags, notes, ratings, locations, and reading progress display correctly.

## Library And Book Details

- [ ] Search by title.
- [ ] Search by author.
- [ ] Filter by tag.
- [ ] Filter by location.
- [ ] Filter by reading status or progress where available.
- [ ] Clear filters; verify the full library returns.
- [ ] Open a detail page from the library grid.
- [ ] Refresh a detail page directly at `/library/:id`; verify it loads.
- [ ] Add a tag and verify it appears in the grid and detail view.
- [ ] Remove a tag and verify it disappears in both views.
- [ ] Promote or normalize a suggested tag where the UI offers it.
- [ ] Add a note; verify it persists after refresh.
- [ ] Update a rating; verify it persists after refresh.
- [ ] Update reading progress; verify status and percent/page display are correct.
- [ ] Delete a test book; verify it disappears from search and detail URLs handle the deleted state.

## Shelves And Locations

- [ ] Visit `/library/locations`.
- [ ] Create a top-level location.
- [ ] Create a nested shelf or child location.
- [ ] Assign a book to the location from its detail page.
- [ ] Rename a location and verify assigned books keep the updated path.
- [ ] Move a nested location and verify assigned books keep the updated path.
- [ ] Remove a location with no assigned books.
- [ ] Attempt to remove a location with assigned books; verify the app prevents data loss or explains the result.

## Lending

- [ ] Create a loan from a book detail page.
- [ ] Verify the owner sees the loan in `/library/loans`.
- [ ] Open the public invite link while signed out.
- [ ] Accept the invite as a borrower.
- [ ] Verify the borrower sees the loan in the borrowed view.
- [ ] Verify the owner sees the accepted borrower state.
- [ ] Return the accepted loan and verify the book becomes lendable again.
- [ ] Create a second loan and cancel it before acceptance.
- [ ] Verify a cancelled invite cannot be accepted.
- [ ] Verify a currently loaned book cannot be loaned again unless the UI explicitly supports multiple active loans.

## Import, Export, And Private Covers

- [ ] Export CSV from the library transfer/export surface.
- [ ] Open the CSV and verify headers and representative row values.
- [ ] Import the exported CSV into a clean local database; verify representative records.
- [ ] Add or import a book with a private cover blob.
- [ ] While signed in, verify the cover serves from `/api/blob/...`.
- [ ] While signed out, request the private blob URL and verify access is rejected.
- [ ] Verify public invite cover serving works only for the invited book when applicable.

## Mobile Layouts

Use real devices when available. Otherwise use browser responsive viewports at
390 x 844 and 430 x 932.

- [ ] Camera scanning screen fits without clipped controls.
- [ ] Camera permission, denied, no-camera, and scanned-result states are readable.
- [ ] Library grid supports search/filter use without horizontal scrolling.
- [ ] Book cards remain tappable and cover images do not distort.
- [ ] Detail pages keep cover, metadata, notes, tags, rating, progress, location, and lending controls usable.
- [ ] Location editing modals fit and can be submitted.
- [ ] Lending modal and invite pages fit and can be submitted.
- [ ] Admin users page is usable on mobile.
- [ ] Admin invites page is usable on mobile.
- [ ] Admin audit page is usable on mobile.

## Hosted Smoke Pass

Run this after the local pass and before promotion.

- [ ] Register or invite a release-candidate user according to the hosted registration policy.
- [ ] Log in, refresh, log out, and log back in.
- [ ] Add one ISBN book and one manual book.
- [ ] Add a note, tag, rating, reading progress, and location.
- [ ] Create and accept one lending invite.
- [ ] Export CSV.
- [ ] Verify a private cover blob while signed in and signed out.
- [ ] Verify admin role gates and banned-user rejection if admin management is enabled.
- [ ] Check mobile library grid, detail page, scanner, and admin pages.

## Blockers And Follow-up Tasks

Release-blocking issues must be fixed before promotion or logged here with an
explicit decision to defer the release.

| ID | Severity | Environment | Workflow | Status | Owner | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| QA-001 |  |  |  |  |  |  |

## Current Pass Notes

- Use this section during the active release candidate pass.
- Record command results, environment details, workflow coverage, blockers, and
  any manual checks that still need a hosted or device-specific follow-up.
- Move completed dated notes into the gitignored `docs/qa-runs.local.md`
  before reusing this checklist.
