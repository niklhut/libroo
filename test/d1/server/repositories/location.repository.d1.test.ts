/// <reference types="@cloudflare/vitest-pool-workers" />

import { env } from 'cloudflare:workers'
import { Effect, Layer } from 'effect'
import { drizzle } from 'drizzle-orm/d1'
import { asc, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { books, locations, user, userBooks } from '../../../../server/db/schema'
import {
  LocationRepository,
  LocationRepositoryLive,
  type LocationRecord
} from '../../../../server/repositories/location.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'
import initialMigration from '../../../../server/db/migrations/sqlite/0000_initial_beta.sql?raw'
import termsMigration from '../../../../server/db/migrations/sqlite/0001_add_terms_acceptance.sql?raw'

type D1Db = ReturnType<typeof drizzle>

let db: D1Db

describe('LocationRepository.deleteLocation on D1', () => {
  beforeAll(async () => {
    db = drizzle(env.DB)
    await applyMigrations(env.DB)
  })

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM user_books').run()
    await env.DB.prepare('DELETE FROM locations').run()
    await env.DB.prepare('DELETE FROM books').run()
    await env.DB.prepare('DELETE FROM user').run()
    await seedUser(db)
  })

  it('clears assigned books and deletes the hierarchy', async () => {
    await seedLocations(db)
    await seedBook(db, 'grandchild')

    const root = await getLocation(db, 'root')
    await expectCompletes(runRepository(db, Effect.flatMap(LocationRepository, repository =>
      repository.deleteLocation('user-1', root, 'clear', null)
    )))

    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'other-root', path: 'Archive', depth: 0 }
    ])
    await expect(bookLocation(db)).resolves.toBeNull()
  })

  it('reassigns books before deleting the hierarchy atomically', async () => {
    await seedLocations(db)
    await seedBook(db, 'grandchild')

    const root = await getLocation(db, 'root')
    const target = await getLocation(db, 'other-root')
    await expectCompletes(runRepository(db, Effect.flatMap(LocationRepository, repository =>
      repository.deleteLocation('user-1', root, 'move', target)
    )))

    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'other-root', path: 'Archive', depth: 0 }
    ])
    await expect(bookLocation(db)).resolves.toBe('other-root')
  })

  it('deletes an empty location hierarchy', async () => {
    await seedLocations(db)

    const child = await getLocation(db, 'child')
    await expectCompletes(runRepository(db, Effect.flatMap(LocationRepository, repository =>
      repository.deleteLocation('user-1', child, 'clear', null)
    )))

    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'other-root', path: 'Archive', depth: 0 },
      { id: 'root', path: 'Shelf', depth: 0 }
    ])
  })

  it('deletes a single top-level location', async () => {
    const now = new Date('2026-06-24T10:00:00.000Z')
    await db.insert(locations).values(
      locationValue('solo-root', 'Solo Shelf', null, 'Solo Shelf', 0, now)
    )

    const location = await getLocation(db, 'solo-root')
    await expectCompletes(runRepository(db, Effect.flatMap(LocationRepository, repository =>
      repository.deleteLocation('user-1', location, 'clear', null)
    )))

    await expect(locationPaths(db)).resolves.toEqual([])
  })
})

async function expectCompletes(promise: Promise<unknown>) {
  await expect(Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('deleteLocation did not complete')), 2_000))
  ])).resolves.toBeUndefined()
}

async function applyMigrations(database: D1Database) {
  for (const migration of [initialMigration, termsMigration]) {
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
  effect: Effect.Effect<A, E, LocationRepository | DbService>
) {
  const typedDatabase = database as unknown as DbServiceInterface['db']
  return Effect.runPromise(effect.pipe(
    Effect.provide(LocationRepositoryLive),
    Effect.provide(Layer.succeed(DbService, {
      db: typedDatabase,
      supportsReliableBatch: false,
      executeAtomic: buildStatements => typedDatabase.batch(buildStatements(typedDatabase))
    }))
  ))
}

async function seedUser(database: D1Db) {
  const now = new Date('2026-06-24T10:00:00.000Z')
  await database.insert(user).values({
    id: 'user-1',
    name: 'Reader',
    email: 'reader@example.com',
    emailVerified: true,
    role: 'user',
    banned: false,
    createdAt: now,
    updatedAt: now
  })
}

async function seedLocations(database: D1Db) {
  const now = new Date('2026-06-24T10:00:00.000Z')
  await database.insert(locations).values([
    locationValue('root', 'Shelf', null, 'Shelf', 0, now),
    locationValue('child', 'Row', 'root', 'Shelf - Row', 1, now),
    locationValue('grandchild', 'Bin', 'child', 'Shelf - Row - Bin', 2, now),
    locationValue('other-root', 'Archive', null, 'Archive', 0, now)
  ])
}

function locationValue(
  id: string,
  name: string,
  parentLocationId: string | null,
  path: string,
  depth: number,
  now: Date
) {
  return {
    id,
    userId: 'user-1',
    parentLocationId,
    name,
    normalizedName: name.toLocaleLowerCase(),
    path,
    depth,
    createdAt: now,
    updatedAt: now
  }
}

async function seedBook(database: D1Db, locationId: string) {
  const now = new Date('2026-06-24T10:00:00.000Z')
  await database.insert(books).values({
    id: 'book-1',
    title: 'Atomic Shelves',
    source: 'manual',
    createdByUserId: 'user-1',
    createdAt: now
  })
  await database.insert(userBooks).values({
    id: 'user-book-1',
    userId: 'user-1',
    bookId: 'book-1',
    locationId,
    addedAt: now
  })
}

async function getLocation(database: D1Db, id: string): Promise<LocationRecord> {
  const rows = await database.select().from(locations).where(eq(locations.id, id)).limit(1)
  const location = rows[0]
  if (!location) throw new Error(`Missing location ${id}`)
  return {
    id: location.id,
    name: location.name,
    parentLocationId: location.parentLocationId,
    path: location.path,
    depth: location.depth
  }
}

async function locationPaths(database: D1Db) {
  return database
    .select({ id: locations.id, path: locations.path, depth: locations.depth })
    .from(locations)
    .orderBy(asc(locations.id))
}

async function bookLocation(database: D1Db) {
  const rows = await database
    .select({ locationId: userBooks.locationId })
    .from(userBooks)
    .where(eq(userBooks.id, 'user-book-1'))
  return rows[0]?.locationId ?? null
}
