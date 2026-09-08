import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createClient } from '@libsql/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('Better Auth account identity migration', () => {
  let dbDir: string
  let client: ReturnType<typeof createClient> | null = null

  beforeEach(async () => {
    dbDir = await mkdtemp(join(tmpdir(), 'libroo-account-identity-migration-'))
    client = createClient({ url: `file:${join(dbDir, 'test.db')}` })
    await client.execute('PRAGMA foreign_keys = ON')
    await client.execute(`
      CREATE TABLE user (
        id text PRIMARY KEY NOT NULL
      )
    `)
    await client.execute(`
      CREATE TABLE account (
        id text PRIMARY KEY NOT NULL,
        issuer text NOT NULL,
        account_id text NOT NULL,
        provider_id text NOT NULL,
        user_id text NOT NULL,
        access_token text,
        refresh_token text,
        id_token text,
        access_token_expires_at integer,
        refresh_token_expires_at integer,
        scope text,
        password text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        FOREIGN KEY (user_id) REFERENCES user(id) ON UPDATE no action ON DELETE cascade
      )
    `)
    await client.execute('CREATE UNIQUE INDEX account_issuer_accountId_uidx ON account (issuer, account_id)')
    await client.execute('CREATE INDEX account_userId_idx ON account (user_id)')
    await client.execute('CREATE TABLE books (id text PRIMARY KEY NOT NULL, title text NOT NULL)')
    await client.execute({ sql: 'INSERT INTO user (id) VALUES (?)', args: ['user-1'] })
    await client.execute({
      sql: `INSERT INTO account (
        id, issuer, account_id, provider_id, user_id, access_token, refresh_token,
        id_token, access_token_expires_at, refresh_token_expires_at, scope, password,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'account-credential',
        'local:credential',
        'user-1',
        'credential',
        'user-1',
        null,
        null,
        null,
        null,
        null,
        null,
        'hashed-password',
        1700000000000,
        1700000001000
      ]
    })
    await client.execute({
      sql: `INSERT INTO account (
        id, issuer, account_id, provider_id, user_id, access_token, refresh_token,
        id_token, access_token_expires_at, refresh_token_expires_at, scope, password,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'account-oidc',
        'https://issuer.example',
        'oidc-subject-1',
        'oidc',
        'user-1',
        'access-token',
        'refresh-token',
        'id-token',
        1800000000000,
        1800003600000,
        'openid profile email',
        null,
        1700000000000,
        1700000001000
      ]
    })
    await client.execute({
      sql: 'INSERT INTO books (id, title) VALUES (?, ?)',
      args: ['book-1', 'A book outside the account table']
    })
  })

  afterEach(async () => {
    client?.close()
    client = null
    await rm(dbDir, { recursive: true, force: true })
  })

  it('preserves account credentials, linked providers, and unrelated data', async () => {
    const migrationPath = new URL('../../server/db/migrations/sqlite/0020_better_auth_restore_account_identity.sql', import.meta.url)
    const migration = await readFile(migrationPath, 'utf8')
    const beforeAccounts = await client!.execute('SELECT * FROM account ORDER BY id')
    const beforeUsers = await client!.execute('SELECT * FROM user')
    const beforeBooks = await client!.execute('SELECT * FROM books')

    for (const statement of migration.split('--> statement-breakpoint')) {
      const sql = statement.trim()
      if (sql) await client!.execute(sql)
    }

    const afterAccounts = await client!.execute(`
      SELECT id, account_id, provider_id, user_id, access_token, refresh_token, id_token,
        access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at
      FROM account
      ORDER BY id
    `)
    const afterUsers = await client!.execute('SELECT * FROM user')
    const afterBooks = await client!.execute('SELECT * FROM books')
    const accountColumns = await client!.execute('SELECT name FROM pragma_table_info(\'account\')')
    const accountIndexes = await client!.execute('SELECT name FROM pragma_index_list(\'account\') ORDER BY name')

    expect(afterAccounts.rows).toEqual(beforeAccounts.rows.map(({ issuer: _issuer, ...account }) => account))
    expect(afterUsers.rows).toEqual(beforeUsers.rows)
    expect(afterBooks.rows).toEqual(beforeBooks.rows)
    expect(accountColumns.rows.map(row => row.name)).not.toContain('issuer')
    expect(accountIndexes.rows
      .map(row => row.name)
      .filter(name => !String(name).startsWith('sqlite_autoindex_'))).toEqual([
      'account_providerId_accountId_uidx',
      'account_userId_idx'
    ])
  })
})
