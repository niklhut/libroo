# Beta Follow-ups

## Dependency refresh notes

Manual refresh completed on 2026-06-19 before the first beta.

- Updated app dependencies, dev dependencies, transitive lockfile entries, and the pinned project package manager to `pnpm@11.8.0`.
- Reviewed `nodemailer` 8 to 9 before applying it. The documented breaking change is stricter TLS certificate validation for remote HTTPS fetches; Libroo's SMTP path sends generated messages through a configured SMTP server and does not rely on remote attachment/OAuth proxy fetches, so the upgrade is accepted for beta.
- `pnpm peers check` still reports transitive optional-peer mismatches from Nuxt/UI/Effect internals (`rolldown`, Tiptap, `@effect/cluster`, TypeScript, and `vue-tsc`). These are not direct Libroo dependencies and are being treated as dependency ecosystem noise unless lint, typecheck, tests, or builds expose runtime impact.
- No major upgrades were intentionally deferred in this refresh.

## Renovate dependency updates

Renovate configuration is enabled after the manual dependency refresh. Once the Renovate GitHub app is installed for the repository, it should open scheduled dependency update PRs weekly, plus vulnerability PRs when GitHub or OSV security alerts apply.

Review and merge policy:

- Dependency PRs must pass the normal protected-branch checks documented in `docs/deployment.md`: lint, unit tests, Docker image build, and Cloudflare Worker build.
- Patch and minor PRs may be merged after a changelog/release-note skim confirms there are no Libroo-relevant behavior changes.
- Major PRs require a closer review of migration notes, breaking changes, runtime compatibility, and any effect on Cloudflare, NuxtHub, Better Auth, Drizzle, or database migrations.
- Security PRs should be reviewed before routine scheduled updates and can be merged outside the weekly cadence once checks pass.
- Grouped PRs should be split or closed in favor of individual updates if one package in the group blocks CI or needs deeper manual review.

## Library bulk actions

The pre-beta library select mode was removed from the visible library page because it only supported bulk deletion and did not match the broader action model Libroo needs.

Future bulk actions should be redesigned as a polished workflow that can support actions such as:

- Move selected books to a location
- Add or remove tags
- Delete selected books
- Export selected books
- Other collection operations that fit the physical library workflow

The existing backend batch delete path can be reused or replaced when that design is implemented, but it should not be exposed again without a complete multi-action selection experience.

## Camera scan default

Camera barcode scanning now defaults to continuous mode because user testing showed the toggle was easy to miss and bulk intake is the primary physical-library workflow. Single-scan mode remains available through the Continuous toggle for one-off ISBN lookups.
