import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { setup, url } from '@nuxt/test-utils/e2e'
import { createClient } from '@libsql/client'
import { ACCOUNT_DELETION_CONFIRMATION_TEXT } from '../../shared/utils/account-settings'

const databasePath = resolve('.data/test/auth-session-ssr.sqlite')
const databaseUrl = `file:${databasePath}`
const SESSION_COOKIE_NAME = 'better-auth.session_token'
const integrationPort = 31743
const authBaseUrl = `http://127.0.0.1:${integrationPort}`

process.env.NUXT_LIBROO_RUNTIME_PROFILE = 'selfhost'
process.env.NITRO_PRESET = 'node_server'
process.env.NUXT_DATABASE_URL = databaseUrl
process.env.NUXT_BETTER_AUTH_URL = authBaseUrl
process.env.NUXT_BETTER_AUTH_SECRET = 'integration-auth-session-secret'
process.env.NUXT_EMAIL_VERIFICATION_ENABLED = 'false'
process.env.NUXT_PUBLIC_TURNSTILE_ENABLED = 'false'
process.env.NUXT_PUBLIC_LEGAL_TERMS_URL = 'https://example.test/terms'

rmSync(databasePath, { force: true })
mkdirSync(dirname(databasePath), { recursive: true })
execFileSync(process.execPath, ['scripts/migrate-selfhost.mjs'], {
  cwd: resolve('.'),
  env: process.env,
  stdio: 'inherit'
})

setup({
  rootDir: resolve('.'),
  browser: false,
  server: true,
  build: true,
  port: integrationPort,
  setupTimeout: 300_000,
  serverStartTimeout: 120_000,
  env: {
    NUXT_LIBROO_RUNTIME_PROFILE: 'selfhost',
    NITRO_PRESET: 'node_server',
    NUXT_DATABASE_URL: databaseUrl,
    NUXT_BETTER_AUTH_URL: authBaseUrl,
    NUXT_BETTER_AUTH_SECRET: 'integration-auth-session-secret',
    NUXT_EMAIL_VERIFICATION_ENABLED: 'false',
    NUXT_PUBLIC_TURNSTILE_ENABLED: 'false',
    NUXT_PUBLIC_LEGAL_TERMS_URL: 'https://example.test/terms'
  }
})

afterAll(() => {
  rmSync(databasePath, { force: true })
  rmSync(`${databasePath}-shm`, { force: true })
  rmSync(`${databasePath}-wal`, { force: true })
})

describe('cookie-backed SSR auth restoration', () => {
  it('runs auth lifecycle flows with Libroo server-owned fields declared', async () => {
    const email = `ada-${Date.now()}@example.test`
    const password = 'correct horse battery staple'
    const inviteToken = `invite-${randomUUID()}`
    await seedSignupInvite(email, inviteToken)

    await expectAuthColumns()

    const signupResponse = await betterAuthRequest('/api/auth/sign-up/email', {
      email,
      password,
      name: 'Ada Lovelace',
      inviteToken,
      acceptTerms: true
    })
    const signupBody = await signupResponse.clone().json() as { user: Record<string, unknown> }
    expect(signupBody.user.pendingEmail).toBeUndefined()
    expect(signupBody.user.termsAcceptedAt).toBeUndefined()
    await expectUserFields(email, {
      pendingEmail: null,
      termsAccepted: true
    })

    const signInResponse = await betterAuthRequest('/api/auth/sign-in/email', {
      email,
      password
    })
    const cookie = sessionCookie(signInResponse)

    const blockedUpdate = await betterAuthRequest('/api/auth/update-user', {
      name: 'Ada Byron',
      pendingEmail: 'attacker@example.test'
    }, { cookie, allowError: true })
    expect(blockedUpdate.status).toBe(400)
    expect(await blockedUpdate.text()).toContain('pendingEmail is not allowed to be set')
    await expectUserFields(email, {
      name: 'Ada Lovelace',
      pendingEmail: null,
      termsAccepted: true
    })

    const changedEmail = `ada-new-${Date.now()}@example.test`
    await betterAuthRequest('/api/auth/change-email', {
      newEmail: changedEmail
    }, { cookie })
    await expectUserFields(changedEmail, {
      pendingEmail: null,
      termsAccepted: true
    })

    const libraryResponse = await fetch(url('/library'), {
      redirect: 'manual',
      headers: {
        cookie,
        accept: 'text/html'
      }
    })
    const html = await libraryResponse.text()

    expect(libraryResponse.status).toBe(200)
    expect(libraryResponse.headers.get('location') ?? '').not.toContain('/login')
    expect(html).toContain('My Library')
    expect(html).not.toContain('Welcome back!')

    const deletionResponse = await betterAuthRequest('/api/account/delete', {
      currentPassword: password,
      confirmation: ACCOUNT_DELETION_CONFIRMATION_TEXT
    }, { cookie })
    expect(deletionResponse.status).toBe(200)
    await expectUserDeleted(changedEmail)
  })

  it('redirects protected SSR routes to login without a session cookie', async () => {
    const response = await fetch(url('/library'), {
      redirect: 'manual',
      headers: {
        accept: 'text/html'
      }
    })

    expect(response.status).toBeGreaterThanOrEqual(300)
    expect(response.status).toBeLessThan(400)
    expect(response.headers.get('location')).toContain('/login')
  })
})

async function betterAuthRequest(
  path: string,
  body: Record<string, unknown>,
  options: { cookie?: string, allowError?: boolean } = {}
) {
  const response = await fetch(url(path), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      ...(options.cookie ? { cookie: options.cookie } : {})
    },
    body: JSON.stringify(body)
  })

  if (!options.allowError && !response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${await response.text()}`)
  }

  return response
}

async function expectAuthColumns() {
  const client = createClient({ url: databaseUrl })

  try {
    const result = await client.execute('PRAGMA table_info(user)')
    const columns = result.rows.map(row => ({
      name: String(row.name),
      type: String(row.type)
    }))

    expect(columns).toEqual(expect.arrayContaining([
      { name: 'pending_email', type: 'TEXT' },
      { name: 'terms_accepted_at', type: 'INTEGER' }
    ]))
  } finally {
    client.close()
  }
}

async function expectUserFields(
  email: string,
  expected: {
    name?: string
    pendingEmail: string | null
    termsAccepted: boolean
  }
) {
  const client = createClient({ url: databaseUrl })

  try {
    const result = await client.execute({
      sql: 'SELECT name, pending_email, terms_accepted_at FROM user WHERE email = ?',
      args: [email]
    })
    const row = result.rows[0]

    expect(row).toBeTruthy()
    if (expected.name) {
      expect(row.name).toBe(expected.name)
    }
    expect(row.pending_email ?? null).toBe(expected.pendingEmail)
    if (expected.termsAccepted) {
      expect(Number(row.terms_accepted_at)).toBeGreaterThan(0)
    } else {
      expect(row.terms_accepted_at ?? null).toBeNull()
    }
  } finally {
    client.close()
  }
}

async function expectUserDeleted(email: string) {
  const client = createClient({ url: databaseUrl })

  try {
    const result = await client.execute({
      sql: 'SELECT id FROM user WHERE email = ?',
      args: [email]
    })

    expect(result.rows).toHaveLength(0)
  } finally {
    client.close()
  }
}

async function seedSignupInvite(email: string, token: string) {
  const client = createClient({ url: databaseUrl })
  const now = Date.now()
  const adminId = 'integration-admin'

  try {
    await client.execute({
      sql: `
        INSERT OR IGNORE INTO user (
          id, name, email, email_verified, role, banned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [adminId, 'Integration Admin', 'admin@example.test', 1, 'admin', 0, now, now]
    })
    await client.execute({
      sql: `
        INSERT INTO signup_invites (
          id, token_hash, email, status, created_by_user_id, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        randomUUID(),
        hashInviteToken(token),
        email,
        'pending',
        adminId,
        now + 24 * 60 * 60 * 1000,
        now,
        now
      ]
    })
  } finally {
    client.close()
  }
}

function hashInviteToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function sessionCookie(response: Response) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers)
  const setCookies = getSetCookie
    ? getSetCookie()
    : splitSetCookieHeader(response.headers.get('set-cookie'))
  const cookie = setCookies
    .map(value => value.split(';')[0])
    .find((value) => {
      const [name] = value.split('=')
      return name === SESSION_COOKIE_NAME
    })

  if (!cookie) {
    throw new Error(`No session cookie in response headers: ${setCookies.join(', ')}`)
  }

  return cookie
}

function splitSetCookieHeader(header: string | null) {
  return header?.split(/,(?=\s*[^;,]+=)/).map(value => value.trim()).filter(Boolean) ?? []
}
