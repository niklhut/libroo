import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Effect, Layer } from 'effect'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { account, adminAuditLog, books, locations, loans, session, signupInvites, tags, user, userBookTags, userBooks, verification } from '../../../../server/db/schema'
import { AccountDeletionRepository, AccountDeletionRepositoryLive, LastAdminAccountDeletionError } from '../../../../server/repositories/account-deletion.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'

describe('AccountDeletionRepository', () => {
  let db: ReturnType<typeof drizzle>
  let dbDir: string
  let client: ReturnType<typeof createClient> | null = null

  beforeEach(async () => {
    dbDir = await mkdtemp(join(tmpdir(), 'libroo-account-deletion-'))
    client = createClient({ url: `file:${join(dbDir, 'test.db')}` })
    db = drizzle(client)
    await client.execute('PRAGMA foreign_keys = ON')

    for (const migrationFile of ['0000_initial_beta.sql', '0001_add_terms_acceptance.sql', '0002_prevent_location_delete_cascade.sql', '0003_add_library_state.sql', '0006_huge_tiger_shark.sql', '0008_brave_saracen.sql', '0010_owner_private_loan_note.sql']) {
      const migrationPath = fileURLToPath(
        new URL(`../../../../server/db/migrations/sqlite/${migrationFile}`, import.meta.url)
      )
      const migration = await readFile(migrationPath, 'utf8')
      for (const statement of migration.split('--> statement-breakpoint')) {
        const sql = statement.trim()
        if (sql) {
          await client.execute(sql)
        }
      }
    }
  })

  afterEach(async () => {
    client?.close()
    client = null
    await rm(dbDir, { recursive: true, force: true })
  })

  it('deletes the target account while preserving other users and shared Open Library metadata', async () => {
    await seedDeletionScenario(db)

    const result = await runRepository(db, Effect.flatMap(AccountDeletionRepository, repository =>
      repository.deleteAccountData('user-1')
    ))

    expect(result).toMatchObject({
      deletedUserId: 'user-1',
      deletedManualBooks: 1,
      deletedUserBooks: 2,
      deletedOwnedLoans: 1,
      anonymizedBorrowedLoans: 1
    })
    expect(result.blobPaths).toEqual(expect.arrayContaining([
      'profiles/user-1.webp',
      'covers/manual/user-1/private.webp'
    ]))
    expect(result.blobPaths).not.toContain('covers/manual/user-1/shared.webp')
    expect(result.blobPaths).not.toContain('covers/open-library/shared.webp')

    await expect(selectIds(db, user)).resolves.toEqual(['user-2'])
    await expect(selectIds(db, account)).resolves.toEqual(['account-2'])
    await expect(selectIds(db, session)).resolves.toEqual(['session-2'])
    await expect(selectIds(db, userBooks)).resolves.toEqual(['ub-other', 'ub-shared-other'])
    await expect(selectIds(db, locations)).resolves.toEqual(['loc-other'])
    await expect(selectIds(db, userBookTags)).resolves.toEqual(['ubt-other'])
    await expect(selectIds(db, tags)).resolves.toEqual(['tag-1'])

    const remainingBooks = await db
      .select({ id: books.id, source: books.source, createdByUserId: books.createdByUserId })
      .from(books)
      .orderBy(books.id)
    expect(remainingBooks).toEqual([
      { id: 'manual-shared', source: 'manual', createdByUserId: null },
      { id: 'open-book', source: 'open_library', createdByUserId: null }
    ])

    const remainingLoans = await db
      .select({
        id: loans.id,
        ownerUserId: loans.ownerUserId,
        borrowerUserId: loans.borrowerUserId,
        acceptedAt: loans.acceptedAt,
        borrowerDisplayName: loans.borrowerDisplayName
      })
      .from(loans)
    expect(remainingLoans).toEqual([
      {
        id: 'loan-borrowed-by-user-1',
        ownerUserId: 'user-2',
        borrowerUserId: null,
        acceptedAt: null,
        borrowerDisplayName: 'Ada'
      }
    ])

    const remainingInvites = await db
      .select({ id: signupInvites.id, createdByUserId: signupInvites.createdByUserId, acceptedByUserId: signupInvites.acceptedByUserId })
      .from(signupInvites)
    expect(remainingInvites).toEqual([
      { id: 'invite-accepted-by-user-1', createdByUserId: 'user-2', acceptedByUserId: null }
    ])

    await expect(selectIds(db, verification)).resolves.toEqual(['verify-other'])

    const auditRows = await db
      .select({ actorUserId: adminAuditLog.actorUserId, targetUserId: adminAuditLog.targetUserId })
      .from(adminAuditLog)
    expect(auditRows).toEqual([
      { actorUserId: null, targetUserId: 'user-2' }
    ])
  })

  it('blocks the last active admin from deleting their account', async () => {
    const now = new Date('2026-06-19T10:00:00.000Z')
    await db.insert(user).values({
      id: 'admin-1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      role: 'admin',
      createdAt: now,
      updatedAt: now
    })
    await db.insert(account).values({
      id: 'account-admin-1',
      accountId: 'ada@example.com',
      providerId: 'credential',
      userId: 'admin-1',
      createdAt: now,
      updatedAt: now
    })

    const result = await runRepository(db, Effect.either(Effect.flatMap(AccountDeletionRepository, repository =>
      repository.deleteAccountData('admin-1')
    )))

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(LastAdminAccountDeletionError)
    await expect(selectIds(db, user)).resolves.toEqual(['admin-1'])
    await expect(selectIds(db, account)).resolves.toEqual(['account-admin-1'])
  })

  it('preserves wrapped last-admin errors from atomic adapters', async () => {
    const now = new Date('2026-06-19T10:00:00.000Z')
    await db.insert(user).values({
      id: 'admin-1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      role: 'user',
      createdAt: now,
      updatedAt: now
    })

    const result = await runRepositoryWithService({
      db: db as unknown as DbServiceInterface['db'],
      executeAtomic: async () => {
        throw {
          _tag: 'LastAdminAccountDeletionError',
          message: 'Cannot delete the last remaining active admin account'
        }
      }
    }, Effect.either(Effect.flatMap(AccountDeletionRepository, repository =>
      repository.deleteAccountData('admin-1')
    )))

    expect(result._tag).toBe('Left')
    expect(result.left).toMatchObject({
      _tag: 'LastAdminAccountDeletionError',
      message: 'Cannot delete the last remaining active admin account'
    })
  })

  it('allows an admin to delete their account when another active admin remains', async () => {
    const now = new Date('2026-06-19T10:00:00.000Z')
    await db.insert(user).values([
      {
        id: 'admin-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: true,
        role: 'admin',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'admin-2',
        name: 'Grace',
        email: 'grace@example.com',
        emailVerified: true,
        role: 'user, admin',
        createdAt: now,
        updatedAt: now
      }
    ])

    await expect(runRepository(db, Effect.flatMap(AccountDeletionRepository, repository =>
      repository.deleteAccountData('admin-1')
    ))).resolves.toMatchObject({
      deletedUserId: 'admin-1'
    })

    await expect(selectIds(db, user)).resolves.toEqual(['admin-2'])
  })
})

async function seedDeletionScenario(db: ReturnType<typeof drizzle>) {
  const now = new Date('2026-06-19T10:00:00.000Z')

  await db.insert(user).values([
    {
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      pendingEmail: 'ada.new@example.com',
      image: 'profiles/user-1.webp',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'user-2',
      name: 'Grace',
      email: 'grace@example.com',
      emailVerified: true,
      createdAt: now,
      updatedAt: now
    }
  ])

  await db.insert(account).values([
    { id: 'account-1', accountId: 'ada@example.com', providerId: 'credential', userId: 'user-1', createdAt: now, updatedAt: now },
    { id: 'account-2', accountId: 'grace@example.com', providerId: 'credential', userId: 'user-2', createdAt: now, updatedAt: now }
  ])
  await db.insert(session).values([
    { id: 'session-1', token: 'token-1', userId: 'user-1', expiresAt: now, createdAt: now, updatedAt: now },
    { id: 'session-2', token: 'token-2', userId: 'user-2', expiresAt: now, createdAt: now, updatedAt: now }
  ])
  await db.insert(verification).values([
    { id: 'verify-user', identifier: 'ada@example.com', value: 'token', expiresAt: now, createdAt: now, updatedAt: now },
    { id: 'verify-pending', identifier: 'ada.new@example.com', value: 'token', expiresAt: now, createdAt: now, updatedAt: now },
    { id: 'verify-other', identifier: 'grace@example.com', value: 'token', expiresAt: now, createdAt: now, updatedAt: now }
  ])

  await db.insert(books).values([
    {
      id: 'open-book',
      isbn: '9780000000001',
      title: 'Shared Catalog Book',
      coverPath: 'covers/open-library/shared.webp',
      source: 'open_library',
      createdAt: now
    },
    {
      id: 'manual-private',
      title: 'Private Manual Book',
      coverPath: 'covers/manual/user-1/private.webp',
      source: 'manual',
      createdByUserId: 'user-1',
      createdAt: now
    },
    {
      id: 'manual-shared',
      title: 'Referenced Manual Book',
      coverPath: 'covers/manual/user-1/shared.webp',
      source: 'manual',
      createdByUserId: 'user-1',
      createdAt: now
    }
  ])

  await db.insert(locations).values([
    { id: 'loc-user', userId: 'user-1', name: 'Shelf', normalizedName: 'shelf', path: 'Shelf', depth: 0, createdAt: now, updatedAt: now },
    { id: 'loc-other', userId: 'user-2', name: 'Desk', normalizedName: 'desk', path: 'Desk', depth: 0, createdAt: now, updatedAt: now }
  ])

  await db.insert(userBooks).values([
    { id: 'ub-open-user', userId: 'user-1', bookId: 'open-book', locationId: 'loc-user', rating: 5, note: 'private note', readingStatus: 'read', addedAt: now },
    { id: 'ub-manual-user', userId: 'user-1', bookId: 'manual-private', addedAt: now },
    { id: 'ub-other', userId: 'user-2', bookId: 'open-book', locationId: 'loc-other', rating: 4, readingStatus: 'reading', addedAt: now },
    { id: 'ub-shared-other', userId: 'user-2', bookId: 'manual-shared', addedAt: now }
  ])

  await db.insert(tags).values({ id: 'tag-1', name: 'Favorite', normalizedName: 'favorite', createdAt: now, updatedAt: now })
  await db.insert(userBookTags).values([
    { id: 'ubt-user', userBookId: 'ub-open-user', tagId: 'tag-1', createdAt: now, updatedAt: now },
    { id: 'ubt-other', userBookId: 'ub-other', tagId: 'tag-1', createdAt: now, updatedAt: now }
  ])

  await db.insert(loans).values([
    {
      id: 'loan-owned-by-user-1',
      ownerUserId: 'user-1',
      userBookId: 'ub-open-user',
      borrowerUserId: 'user-2',
      borrowerDisplayName: 'Grace',
      borrowerEmail: 'grace@example.com',
      status: 'active',
      loanedAt: now,
      snapshotBookTitle: 'Shared Catalog Book',
      snapshotBookAuthor: 'Author',
      snapshotCoverPath: 'covers/open-library/shared.webp',
      snapshotOwnerName: 'Ada',
      acceptedAt: now,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'loan-borrowed-by-user-1',
      ownerUserId: 'user-2',
      userBookId: 'ub-other',
      borrowerUserId: 'user-1',
      borrowerDisplayName: 'Ada',
      borrowerEmail: 'ada@example.com',
      status: 'active',
      loanedAt: now,
      snapshotBookTitle: 'Shared Catalog Book',
      snapshotBookAuthor: 'Author',
      snapshotCoverPath: 'covers/open-library/shared.webp',
      snapshotOwnerName: 'Grace',
      acceptedAt: now,
      createdAt: now,
      updatedAt: now
    }
  ])

  await db.insert(signupInvites).values([
    {
      id: 'invite-created-by-user-1',
      tokenHash: 'token-hash-1',
      status: 'pending',
      createdByUserId: 'user-1',
      expiresAt: now,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'invite-accepted-by-user-1',
      tokenHash: 'token-hash-2',
      status: 'accepted',
      createdByUserId: 'user-2',
      acceptedByUserId: 'user-1',
      expiresAt: now,
      createdAt: now,
      updatedAt: now
    }
  ])

  await db.insert(adminAuditLog).values({
    id: 'audit-1',
    category: 'admin',
    actorUserId: 'user-1',
    targetUserId: 'user-2',
    action: 'test',
    createdAt: now
  })
}

function runRepository<A, E>(db: ReturnType<typeof drizzle>, effect: Effect.Effect<A, E, AccountDeletionRepository | DbService>) {
  const database = db as unknown as DbServiceInterface['db']
  return Effect.runPromise(effect.pipe(
    Effect.provide(AccountDeletionRepositoryLive),
    Effect.provide(Layer.succeed(DbService, {
      db: database,
      executeAtomic: buildStatements => database.transaction(async (tx) => {
        const results: unknown[] = []
        for (const statement of buildStatements(tx as unknown as DbServiceInterface['db'])) {
          results.push(await statement)
        }
        return results
      })
    }))
  ))
}

function runRepositoryWithService<A, E>(dbService: DbServiceInterface, effect: Effect.Effect<A, E, AccountDeletionRepository | DbService>) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(AccountDeletionRepositoryLive),
    Effect.provide(Layer.succeed(DbService, dbService))
  ))
}

async function selectIds(db: ReturnType<typeof drizzle>, table: { id: never }) {
  const rows = await db
    .select({ id: table.id })
    .from(table as never)
    .orderBy(table.id)
  return rows.map(row => row.id)
}
