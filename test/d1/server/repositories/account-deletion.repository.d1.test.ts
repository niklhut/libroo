/// <reference types="@cloudflare/vitest-pool-workers" />

import { env } from 'cloudflare:workers'
import { Effect, Either, Layer } from 'effect'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import initialMigration from '../../../../server/db/migrations/sqlite/0000_initial_beta.sql?raw'
import termsMigration from '../../../../server/db/migrations/sqlite/0001_add_terms_acceptance.sql?raw'
import locationRestrictMigration from '../../../../server/db/migrations/sqlite/0002_prevent_location_delete_cascade.sql?raw'
import { account, books, locations, loans, session, signupInvites, tags, user, userBookTags, userBooks, verification } from '../../../../server/db/schema'
import { AccountDeletionRepository, AccountDeletionRepositoryLive, LastAdminAccountDeletionError } from '../../../../server/repositories/account-deletion.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'

type D1Db = ReturnType<typeof drizzle>

let db: D1Db

describe('AccountDeletionRepository on D1', () => {
  beforeAll(async () => {
    db = drizzle(env.DB)
    await applyMigrations(env.DB)
  })

  beforeEach(async () => {
    for (const table of [
      'signup_invites',
      'verification',
      'session',
      'account',
      'loans',
      'user_book_tags',
      'tags',
      'user_books',
      'locations',
      'books',
      'user'
    ]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
  })

  it('cascades account data and returns blob paths from D1 batch results', async () => {
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
    expect(result.blobPaths.sort()).toEqual([
      'covers/manual/user-1/private.webp',
      'profiles/user-1.webp'
    ])
    await expect(selectIds(db, user)).resolves.toEqual(['user-2'])
    await expect(selectIds(db, account)).resolves.toEqual(['account-2'])
    await expect(selectIds(db, session)).resolves.toEqual(['session-2'])
    await expect(selectIds(db, userBooks)).resolves.toEqual(['ub-other', 'ub-shared-other'])
    await expect(selectIds(db, locations)).resolves.toEqual(['loc-other'])
    await expect(selectIds(db, userBookTags)).resolves.toEqual(['ubt-other'])
    await expect(selectIds(db, signupInvites)).resolves.toEqual(['invite-accepted-by-user-1'])
    await expect(selectIds(db, verification)).resolves.toEqual(['verify-other'])
    await expect(selectIds(db, books)).resolves.toEqual(['manual-shared', 'open-book'])
  })

  it('rejects deleting the last active admin without mutating rows', async () => {
    const now = new Date('2026-06-26T10:00:00.000Z')
    await db.insert(user).values({
      id: 'admin-1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      role: 'admin',
      banned: false,
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

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(LastAdminAccountDeletionError)
    }
    await expect(selectIds(db, user)).resolves.toEqual(['admin-1'])
    await expect(selectIds(db, account)).resolves.toEqual(['account-admin-1'])
  })

  it('rejects when a concurrent delete makes the target the last active admin before the batch', async () => {
    const now = new Date('2026-06-26T10:00:00.000Z')
    await db.insert(user).values([
      { id: 'admin-1', name: 'Ada', email: 'ada@example.com', emailVerified: true, role: 'admin', banned: false, createdAt: now, updatedAt: now },
      { id: 'admin-2', name: 'Grace', email: 'grace@example.com', emailVerified: true, role: 'admin', banned: false, createdAt: now, updatedAt: now }
    ])
    await db.insert(account).values({
      id: 'account-admin-1',
      accountId: 'ada@example.com',
      providerId: 'credential',
      userId: 'admin-1',
      createdAt: now,
      updatedAt: now
    })
    await db.insert(session).values({
      id: 'session-admin-1',
      token: 'token-admin-1',
      userId: 'admin-1',
      expiresAt: now,
      createdAt: now,
      updatedAt: now
    })

    await db.delete(user).where(eq(user.id, 'admin-2'))

    const result = await runRepository(db, Effect.either(Effect.flatMap(AccountDeletionRepository, repository =>
      repository.deleteAccountData('admin-1')
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(LastAdminAccountDeletionError)
    }
    await expect(selectIds(db, user)).resolves.toEqual(['admin-1'])
    await expect(selectIds(db, account)).resolves.toEqual(['account-admin-1'])
    await expect(selectIds(db, session)).resolves.toEqual(['session-admin-1'])
  })

  it('anonymizes borrowed loans when deleting a borrower', async () => {
    await seedDeletionScenario(db)

    await runRepository(db, Effect.flatMap(AccountDeletionRepository, repository =>
      repository.deleteAccountData('user-1')
    ))

    const borrowedLoans = await db
      .select({ id: loans.id, borrowerUserId: loans.borrowerUserId, acceptedAt: loans.acceptedAt })
      .from(loans)
      .where(eq(loans.id, 'loan-borrowed-by-user-1'))
    expect(borrowedLoans).toEqual([
      { id: 'loan-borrowed-by-user-1', borrowerUserId: null, acceptedAt: null }
    ])
  })
})

async function applyMigrations(database: D1Database) {
  for (const migration of [initialMigration, termsMigration, locationRestrictMigration]) {
    for (const statement of migration.split('--> statement-breakpoint')) {
      const migrationStatement = statement.trim()
      if (migrationStatement) {
        await database.prepare(migrationStatement).run()
      }
    }
  }
}

function runRepository<A, E>(
  database: D1Db,
  effect: Effect.Effect<A, E, AccountDeletionRepository | DbService>
) {
  const typedDatabase = database as unknown as DbServiceInterface['db']
  return Effect.runPromise(effect.pipe(
    Effect.provide(AccountDeletionRepositoryLive),
    Effect.provide(Layer.succeed(DbService, {
      db: typedDatabase,
      executeAtomic: buildStatements => typedDatabase.batch(buildStatements(typedDatabase))
    }))
  ))
}

async function seedDeletionScenario(database: D1Db) {
  const now = new Date('2026-06-26T10:00:00.000Z')
  await database.insert(user).values([
    { id: 'user-1', name: 'Ada', email: 'ada@example.com', emailVerified: true, pendingEmail: 'ada.new@example.com', image: 'profiles/user-1.webp', role: 'user', banned: false, createdAt: now, updatedAt: now },
    { id: 'user-2', name: 'Grace', email: 'grace@example.com', emailVerified: true, role: 'user', banned: false, createdAt: now, updatedAt: now }
  ])
  await database.insert(account).values([
    { id: 'account-1', accountId: 'ada@example.com', providerId: 'credential', userId: 'user-1', createdAt: now, updatedAt: now },
    { id: 'account-2', accountId: 'grace@example.com', providerId: 'credential', userId: 'user-2', createdAt: now, updatedAt: now }
  ])
  await database.insert(session).values([
    { id: 'session-1', token: 'token-1', userId: 'user-1', expiresAt: now, createdAt: now, updatedAt: now },
    { id: 'session-2', token: 'token-2', userId: 'user-2', expiresAt: now, createdAt: now, updatedAt: now }
  ])
  await database.insert(verification).values([
    { id: 'verify-user', identifier: 'ada@example.com', value: 'token', expiresAt: now, createdAt: now, updatedAt: now },
    { id: 'verify-pending', identifier: 'ada.new@example.com', value: 'token', expiresAt: now, createdAt: now, updatedAt: now },
    { id: 'verify-other', identifier: 'grace@example.com', value: 'token', expiresAt: now, createdAt: now, updatedAt: now }
  ])
  await database.insert(books).values([
    { id: 'open-book', isbn: '9780000000001', title: 'Shared Catalog Book', source: 'open_library', createdAt: now },
    { id: 'manual-private', title: 'Private Manual Book', coverPath: 'covers/manual/user-1/private.webp', source: 'manual', createdByUserId: 'user-1', createdAt: now },
    { id: 'manual-shared', title: 'Referenced Manual Book', coverPath: 'covers/manual/user-1/shared.webp', source: 'manual', createdByUserId: 'user-1', createdAt: now }
  ])
  await database.insert(locations).values([
    { id: 'loc-user', userId: 'user-1', name: 'Shelf', normalizedName: 'shelf', path: 'Shelf', depth: 0, createdAt: now, updatedAt: now },
    { id: 'loc-other', userId: 'user-2', name: 'Desk', normalizedName: 'desk', path: 'Desk', depth: 0, createdAt: now, updatedAt: now }
  ])
  await database.insert(userBooks).values([
    { id: 'ub-open-user', userId: 'user-1', bookId: 'open-book', locationId: 'loc-user', addedAt: now },
    { id: 'ub-manual-user', userId: 'user-1', bookId: 'manual-private', addedAt: now },
    { id: 'ub-other', userId: 'user-2', bookId: 'open-book', locationId: 'loc-other', addedAt: now },
    { id: 'ub-shared-other', userId: 'user-2', bookId: 'manual-shared', addedAt: now }
  ])
  await database.insert(tags).values({ id: 'tag-1', name: 'Favorite', normalizedName: 'favorite', createdAt: now, updatedAt: now })
  await database.insert(userBookTags).values([
    { id: 'ubt-user', userBookId: 'ub-open-user', tagId: 'tag-1', createdAt: now, updatedAt: now },
    { id: 'ubt-other', userBookId: 'ub-other', tagId: 'tag-1', createdAt: now, updatedAt: now }
  ])
  await database.insert(loans).values([
    { id: 'loan-owned-by-user-1', ownerUserId: 'user-1', userBookId: 'ub-open-user', borrowerUserId: 'user-2', borrowerDisplayName: 'Grace', status: 'active', loanedAt: now, snapshotBookTitle: 'Shared Catalog Book', snapshotBookAuthor: 'Author', snapshotOwnerName: 'Ada', acceptedAt: now, createdAt: now, updatedAt: now },
    { id: 'loan-borrowed-by-user-1', ownerUserId: 'user-2', userBookId: 'ub-other', borrowerUserId: 'user-1', borrowerDisplayName: 'Ada', status: 'active', loanedAt: now, snapshotBookTitle: 'Shared Catalog Book', snapshotBookAuthor: 'Author', snapshotOwnerName: 'Grace', acceptedAt: now, createdAt: now, updatedAt: now }
  ])
  await database.insert(signupInvites).values([
    { id: 'invite-created-by-user-1', tokenHash: 'token-hash-1', status: 'pending', createdByUserId: 'user-1', expiresAt: now, createdAt: now, updatedAt: now },
    { id: 'invite-accepted-by-user-1', tokenHash: 'token-hash-2', status: 'accepted', createdByUserId: 'user-2', acceptedByUserId: 'user-1', expiresAt: now, createdAt: now, updatedAt: now }
  ])
}

async function selectIds(database: D1Db, table: { id: never }) {
  const rows = await database
    .select({ id: table.id })
    .from(table as never)
    .orderBy(table.id)
  return rows.map(row => row.id)
}
