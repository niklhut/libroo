# E2E Tests

Run the full suite locally with:

```bash
pnpm test:e2e
```

The Playwright harness builds the self-host Nuxt server, starts a local OpenLibrary fixture server, and runs against a disposable SQLite database plus local blob directory under the OS temp directory. No production data, external OpenLibrary calls, email delivery, or Turnstile checks are used.

Debug with:

```bash
pnpm test:e2e:ui
```

On failures, Playwright writes screenshots, retained videos, and retry traces under `test-results/`; the HTML report is written to `playwright-report/`.

Automated coverage currently includes auth/bootstrap/session redirects, ISBN add, manual book creation with cover upload, library search and detail mutation persistence, lending lifecycle, admin authorization, banned-user rejection, and private cover access.
