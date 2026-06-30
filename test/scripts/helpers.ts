import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client/node'
import { drizzle } from 'drizzle-orm/libsql/node'
import { migrate } from 'drizzle-orm/libsql/migrator'

export const repoRoot = resolve(new URL('../..', import.meta.url).pathname)
export const fixturesDir = resolve(repoRoot, 'test/scripts/__fixtures__')

export type TemporaryBackupTarget = {
  rootDir: string
  databasePath: string
  databaseUrl: string
  blobDir: string
  client: Client
  cleanup: () => Promise<void>
}

export type ScriptResult = {
  status: number
  stdout: string
  stderr: string
}

export async function buildTemporaryBackupTarget({
  applyMigrations = true,
  seedData = true,
  integrityIssues = true
}: {
  applyMigrations?: boolean
  seedData?: boolean
  integrityIssues?: boolean
} = {}): Promise<TemporaryBackupTarget> {
  const rootDir = await mkdtemp(join(tmpdir(), 'libroo-script-test-'))
  const databasePath = join(rootDir, 'sqlite.db')
  const databaseUrl = `file:${databasePath}`
  const blobDir = join(rootDir, 'blob')
  const client = createClient({ url: databaseUrl })

  if (applyMigrations) {
    await migrate(drizzle(client), {
      migrationsFolder: resolve(repoRoot, 'server/db/migrations/sqlite')
    })
  }

  if (applyMigrations && seedData) {
    await seedDatabase(client, integrityIssues)
    await seedBlobDirectory(blobDir, integrityIssues)
  }

  return {
    rootDir,
    databasePath,
    databaseUrl,
    blobDir,
    client,
    cleanup: async () => {
      client.close()
      await rm(rootDir, { recursive: true, force: true })
    }
  }
}

export function runScript(scriptPath: string, args: string[] = [], {
  env = {},
  cwd = repoRoot
}: {
  env?: NodeJS.ProcessEnv
  cwd?: string
} = {}): ScriptResult {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd,
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        ...env
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const failure = error as {
      status?: number
      stdout?: Buffer | string
      stderr?: Buffer | string
    }
    return {
      status: failure.status ?? 1,
      stdout: bufferishToString(failure.stdout),
      stderr: bufferishToString(failure.stderr)
    }
  }
}

export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

export async function writeJsonFile(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function copyFixture(name: string, targetPath: string) {
  await mkdir(dirname(targetPath), { recursive: true })
  await cp(join(fixturesDir, name), targetPath)
}

export function scriptPath(pathname: string) {
  return resolve(repoRoot, pathname)
}

export function fileExists(pathname: string) {
  return existsSync(pathname)
}

async function seedDatabase(client: Client, integrityIssues: boolean) {
  const now = Date.parse('2026-06-30T10:00:00.000Z')
  const secondCoverPath = integrityIssues
    ? 'covers/manual/user-1/missing.webp'
    : 'covers/manual/user-1/second.webp'

  await client.batch([
    statement('insert into user (id, name, email, email_verified, role, banned, created_at, updated_at, terms_accepted_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      'user-1',
      'Reader',
      'reader@example.test',
      1,
      'user',
      0,
      now,
      now,
      now
    ]),
    statement('insert into account (id, account_id, provider_id, user_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?)', [
      'account-1',
      'reader-account',
      'credential',
      'user-1',
      now,
      now
    ]),
    statement('insert into session (id, expires_at, token, created_at, updated_at, user_id) values (?, ?, ?, ?, ?, ?)', [
      'session-1',
      now + 86_400_000,
      'session-token',
      now,
      now,
      'user-1'
    ]),
    statement('insert into authors (id, name, normalized_name, created_at, updated_at) values (?, ?, ?, ?, ?)', [
      'author-1',
      'Ada Lovelace',
      'ada lovelace',
      now,
      now
    ]),
    statement('insert into books (id, isbn, title, cover_path, source, created_by_user_id, created_at) values (?, ?, ?, ?, ?, ?, ?)', [
      'book-1',
      '9780000000001',
      'Present Cover',
      'covers/manual/user-1/present.webp',
      'manual',
      'user-1',
      now
    ]),
    statement('insert into books (id, isbn, title, cover_path, source, created_by_user_id, created_at) values (?, ?, ?, ?, ?, ?, ?)', [
      'book-2',
      '9780000000002',
      'Second Cover',
      secondCoverPath,
      'manual',
      'user-1',
      now
    ]),
    statement('insert into book_authors (book_id, author_id, sort_order, created_at) values (?, ?, ?, ?)', [
      'book-1',
      'author-1',
      0,
      now
    ]),
    statement('insert into locations (id, user_id, name, normalized_name, path, depth, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)', [
      'location-1',
      'user-1',
      'Shelf A',
      'shelf a',
      'Shelf A',
      0,
      now,
      now
    ]),
    statement('insert into user_books (id, user_id, book_id, location_id, reading_status, added_at) values (?, ?, ?, ?, ?, ?)', [
      'user-book-1',
      'user-1',
      'book-1',
      'location-1',
      'reading',
      now
    ]),
    statement('insert into tags (id, name, normalized_name, created_at, updated_at) values (?, ?, ?, ?, ?)', [
      'tag-1',
      'Favorite',
      'favorite',
      now,
      now
    ]),
    statement('insert into book_system_tags (book_id, tag_id, created_at, updated_at) values (?, ?, ?, ?)', [
      'book-1',
      'tag-1',
      now,
      now
    ]),
    statement('insert into user_book_tags (id, user_book_id, tag_id, created_at, updated_at) values (?, ?, ?, ?, ?)', [
      'user-book-tag-1',
      'user-book-1',
      'tag-1',
      now,
      now
    ]),
    statement('insert into loans (id, owner_user_id, user_book_id, borrower_display_name, status, loaned_at, snapshot_book_title, snapshot_book_author, snapshot_cover_path, snapshot_owner_name, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      'loan-1',
      'user-1',
      'user-book-1',
      'Borrower',
      'active',
      now,
      'Present Cover',
      'Ada Lovelace',
      'covers/loans/loan-present.webp',
      'Reader',
      now,
      now
    ]),
    statement('insert into signup_invites (id, token_hash, status, created_by_user_id, expires_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)', [
      'invite-1',
      'token-hash',
      'pending',
      'user-1',
      now + 86_400_000,
      now,
      now
    ]),
    statement('insert into admin_audit_log (id, category, actor_user_id, action, created_at) values (?, ?, ?, ?, ?)', [
      'audit-1',
      'admin',
      'user-1',
      'fixture.seed',
      now
    ])
  ])
}

async function seedBlobDirectory(blobDir: string, integrityIssues: boolean) {
  const files = [
    'covers/manual/user-1/present.webp',
    'covers/loans/loan-present.webp',
    integrityIssues ? 'covers/orphaned.webp' : 'covers/manual/user-1/second.webp'
  ]

  for (const file of files) {
    const pathname = join(blobDir, file)
    await mkdir(dirname(pathname), { recursive: true })
    await writeFile(pathname, `fixture:${file}`)
  }
}

function statement(sql: string, args: Array<string | number | null>) {
  return { sql, args }
}

function bufferishToString(value: Buffer | string | undefined) {
  if (!value) return ''
  return Buffer.isBuffer(value) ? value.toString('utf8') : value
}
