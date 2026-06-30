import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runId = process.env.LIBROO_E2E_RUN_ID || 'default'
const root = process.env.LIBROO_E2E_TMP_ROOT || join(tmpdir(), 'libroo-e2e', runId)
const appPort = process.env.NUXT_PORT || '3010'
const fixturePort = process.env.LIBROO_OPENLIBRARY_FIXTURE_PORT || '3011'
const emailAppPort = process.env.LIBROO_E2E_EMAIL_APP_PORT || '3012'
const mailSinkSmtpPort = process.env.LIBROO_MAIL_SINK_SMTP_PORT || '3013'
const mailSinkHttpPort = process.env.LIBROO_MAIL_SINK_HTTP_PORT || '3014'

export const e2eRuntimePaths = {
  root,
  databasePath: join(root, 'sqlite.db'),
  storageDir: join(root, 'blob'),
  authDir: join(root, 'auth'),
  logDir: join(root, 'logs'),
  markerPath: join(root, 'prepared')
}

export const e2eRuntimeEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  CI: process.env.CI,
  TMPDIR: process.env.TMPDIR,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
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

export const e2eEmailRuntimePaths = {
  root: join(root, 'email-runtime'),
  databasePath: join(root, 'email-runtime', 'sqlite.db'),
  storageDir: join(root, 'email-runtime', 'blob'),
  authDir: join(root, 'email-runtime', 'auth'),
  logDir: join(root, 'email-runtime', 'logs'),
  markerPath: join(root, 'email-runtime', 'prepared')
}

export const e2eEmailRuntimeEnv = {
  ...e2eRuntimeEnv,
  PORT: emailAppPort,
  NUXT_PORT: emailAppPort,
  NUXT_DATABASE_URL: `file:${e2eEmailRuntimePaths.databasePath}`,
  NUXT_LOCAL_STORAGE_DIR: e2eEmailRuntimePaths.storageDir,
  NUXT_BETTER_AUTH_URL: `http://127.0.0.1:${emailAppPort}`,
  NUXT_EMAIL_VERIFICATION_ENABLED: 'true',
  NUXT_EMAIL_PROVIDER: 'smtp',
  NUXT_EMAIL_FROM: 'Libroo E2E <no-reply@e2e.libroo.test>',
  NUXT_EMAIL_REPLY_TO: 'support@e2e.libroo.test',
  NUXT_SMTP_HOST: '127.0.0.1',
  NUXT_SMTP_PORT: mailSinkSmtpPort,
  NUXT_SMTP_SECURE: 'false',
  NUXT_SMTP_USER: '',
  NUXT_SMTP_PASSWORD: '',
  LIBROO_MAIL_SINK_SMTP_PORT: mailSinkSmtpPort,
  LIBROO_MAIL_SINK_HTTP_PORT: mailSinkHttpPort
}
