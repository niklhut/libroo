import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runId = process.env.LIBROO_E2E_RUN_ID || 'default'
const root = process.env.LIBROO_E2E_TMP_ROOT || join(tmpdir(), 'libroo-e2e', runId)
const appPort = process.env.NUXT_PORT || '3010'
const fixturePort = process.env.LIBROO_OPENLIBRARY_FIXTURE_PORT || '3011'

export const e2eRuntimePaths = {
  root,
  databasePath: join(root, 'sqlite.db'),
  storageDir: join(root, 'blob'),
  authDir: join(root, 'auth'),
  logDir: join(root, 'logs'),
  markerPath: join(root, 'prepared')
}

export const e2eRuntimeEnv = {
  ...process.env,
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: appPort,
  NUXT_PORT: appPort,
  NUXT_HOST: '127.0.0.1',
  NUXT_DATABASE_URL: `file:${e2eRuntimePaths.databasePath}`,
  NUXT_LOCAL_STORAGE_DIR: e2eRuntimePaths.storageDir,
  NUXT_LIBROO_RUNTIME_PROFILE: 'selfhost',
  NUXT_BETTER_AUTH_SECRET: 'libroo-e2e-fixed-better-auth-secret-at-least-32-bytes',
  NUXT_BETTER_AUTH_URL: `http://127.0.0.1:${appPort}`,
  NUXT_BETTER_AUTH_RATE_LIMIT_ENABLED: 'false',
  NUXT_EMAIL_VERIFICATION_ENABLED: 'false',
  NUXT_PUBLIC_TURNSTILE_ENABLED: 'false',
  NUXT_PUBLIC_REGISTRATION_ENABLED: 'true',
  LIBROO_OPENLIBRARY_FIXTURE_PORT: fixturePort,
  LIBROO_OPENLIBRARY_API_BASE: `http://127.0.0.1:${fixturePort}`,
  LIBROO_OPENLIBRARY_COVERS_BASE: `http://127.0.0.1:${fixturePort}`
}
