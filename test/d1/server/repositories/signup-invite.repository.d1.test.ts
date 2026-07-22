/// <reference types="@cloudflare/vitest-pool-workers" />

import { env } from 'cloudflare:workers'
import { Effect, Layer } from 'effect'
import { drizzle } from 'drizzle-orm/d1'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import initialMigration from '../../../../server/db/migrations/sqlite/0000_initial_beta.sql?raw'
import termsMigration from '../../../../server/db/migrations/sqlite/0001_add_terms_acceptance.sql?raw'
import locationRestrictMigration from '../../../../server/db/migrations/sqlite/0002_prevent_location_delete_cascade.sql?raw'
import libraryStateMigration from '../../../../server/db/migrations/sqlite/0003_add_library_state.sql?raw'
import previouslyOwnedMigration from '../../../../server/db/migrations/sqlite/0006_huge_tiger_shark.sql?raw'
import inviteEmailMigration from '../../../../server/db/migrations/sqlite/0008_brave_saracen.sql?raw'
import loanNoteMigration from '../../../../server/db/migrations/sqlite/0010_owner_private_loan_note.sql?raw'
import borrowerSuggestionsMigration from '../../../../server/db/migrations/sqlite/0011_borrower_suggestions.sql?raw'
import { account, session, signupInvites, user } from '../../../../server/db/schema'
import { hashInviteToken, SignupInviteRepository, SignupInviteRepositoryLive } from '../../../../server/repositories/signup-invite.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'

type D1Db = ReturnType<typeof drizzle>

let db: D1Db

describe('SignupInviteRepository on D1', () => {
  beforeAll(async () => {
    db = drizzle(env.DB)
    await applyMigrations(env.DB)
  })

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM signup_invites').run()
    await env.DB.prepare('DELETE FROM user').run()
    await seedUser(db)
  })

  it('does not reserve an invite when expiresAt equals now', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z')
    await seedInvite(db, { token: 'expires-now', expiresAt: now })

    await expect(runRepository(db, Effect.flatMap(SignupInviteRepository, repository =>
      repository.reserveByToken('expires-now', 'ada@example.com', now, new Date(now.getTime() + 60_000))
    ))).resolves.toBeNull()
  })

  it('re-reserves a reservation whose TTL equals now', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z')
    await seedInvite(db, {
      token: 'reservation-now',
      reservationToken: 'old-reservation',
      reservedAt: new Date(now.getTime() - 60_000),
      reservationExpiresAt: now
    })

    const result = await runRepository(db, Effect.flatMap(SignupInviteRepository, repository =>
      repository.reserveByToken('reservation-now', 'ada@example.com', now, new Date(now.getTime() + 60_000))
    ))

    expect(result).toMatchObject({ invite: { id: 'invite-1' } })
    expect(result?.reservationToken).not.toBe('old-reservation')
  })

  it('accepts a matching reservation after its TTL lapses while the invite remains unexpired', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z')
    await seedInvite(db, {
      token: 'expired-reservation',
      reservationToken: 'reservation-1',
      reservedAt: new Date(now.getTime() - 120_000),
      reservationExpiresAt: new Date(now.getTime() - 60_000)
    })

    const result = await runRepository(db, Effect.flatMap(SignupInviteRepository, repository =>
      repository.markAcceptedReservation('reservation-1', 'user-accepted', now)
    ))

    expect(result).toMatchObject({ status: 'accepted', acceptedByUserId: 'user-accepted' })
  })

  it('does not accept an invite when its expiresAt equals now', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z')
    await seedInvite(db, { token: 'invite-expires-now', reservationToken: 'reservation-1', expiresAt: now })

    await expect(runRepository(db, Effect.flatMap(SignupInviteRepository, repository =>
      repository.markAcceptedReservation('reservation-1', 'user-accepted', now)
    ))).resolves.toBeNull()
  })

  it('rejects stale reservations and double redemption', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z')
    await seedInvite(db, { token: 'rereserved', reservationToken: 'replacement-token' })

    await expect(runRepository(db, Effect.flatMap(SignupInviteRepository, repository =>
      repository.markAcceptedReservation('stale-token', 'user-accepted', now)
    ))).resolves.toBeNull()

    const accepted = await runRepository(db, Effect.flatMap(SignupInviteRepository, repository =>
      repository.markAcceptedReservation('replacement-token', 'user-accepted', now)
    ))
    expect(accepted).toMatchObject({ status: 'accepted' })
    await expect(runRepository(db, Effect.flatMap(SignupInviteRepository, repository =>
      repository.markAcceptedReservation('replacement-token', 'user-second', now)
    ))).resolves.toBeNull()
  })

  it('atomically deletes a compensated user with their accounts and sessions', async () => {
    const now = new Date('2026-07-11T12:00:00.000Z')
    await db.insert(account).values({
      id: 'account-accepted', accountId: 'accepted@example.com', providerId: 'credential',
      userId: 'user-accepted', createdAt: now, updatedAt: now
    })
    await db.insert(session).values({
      id: 'session-accepted', token: 'session-token', userId: 'user-accepted',
      expiresAt: now, createdAt: now, updatedAt: now
    })

    await expect(runRepository(db, Effect.flatMap(SignupInviteRepository, repository =>
      repository.deleteCompensatingAccount('user-accepted')
    ))).resolves.toBe(true)
    await expect(db.select().from(user)).resolves.toEqual([expect.objectContaining({ id: 'admin-1' })])
    await expect(db.select().from(account)).resolves.toEqual([])
    await expect(db.select().from(session)).resolves.toEqual([])
  })
})

async function applyMigrations(database: D1Database) {
  for (const migration of [initialMigration, termsMigration, locationRestrictMigration, libraryStateMigration, previouslyOwnedMigration, inviteEmailMigration, loanNoteMigration, borrowerSuggestionsMigration]) {
    for (const statement of migration.split('--> statement-breakpoint')) {
      const migrationStatement = statement.trim()
      if (migrationStatement) await database.prepare(migrationStatement).run()
    }
  }
}

function runRepository<A, E>(database: D1Db, effect: Effect.Effect<A, E, SignupInviteRepository | DbService>) {
  const typedDatabase = database as unknown as DbServiceInterface['db']
  return Effect.runPromise(effect.pipe(
    Effect.provide(SignupInviteRepositoryLive),
    Effect.provide(Layer.succeed(DbService, {
      db: typedDatabase,
      executeAtomic: buildStatements => typedDatabase.batch(buildStatements(typedDatabase))
    }))
  ))
}

async function seedUser(database: D1Db) {
  const now = new Date('2026-07-11T10:00:00.000Z')
  await database.insert(user).values([
    { id: 'admin-1', name: 'Admin', email: 'admin@example.com', emailVerified: true, role: 'admin', banned: false, createdAt: now, updatedAt: now },
    { id: 'user-accepted', name: 'Accepted', email: 'accepted@example.com', emailVerified: true, role: 'user', banned: false, createdAt: now, updatedAt: now }
  ])
}

async function seedInvite(database: D1Db, overrides: Partial<typeof signupInvites.$inferInsert> & { token: string }) {
  const now = new Date('2026-07-11T10:00:00.000Z')
  const { token, ...values } = overrides
  await database.insert(signupInvites).values({
    id: 'invite-1',
    tokenHash: hashInviteToken(token),
    email: null,
    status: 'pending',
    createdByUserId: 'admin-1',
    acceptedByUserId: null,
    reservationToken: null,
    reservedAt: null,
    reservationExpiresAt: null,
    expiresAt: new Date('2026-07-12T10:00:00.000Z'),
    acceptedAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...values
  })
}
