import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Effect, Layer } from 'effect'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { books, locations, user, userBooks } from '../../../../server/db/schema'
import {
  LocationDeleteError,
  LocationRepository,
  LocationRepositoryLive,
  type LocationRecord
} from '../../../../server/repositories/location.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'

type Database = ReturnType<typeof drizzle>
type AtomicMode = 'd1-batch' | 'selfhost-transaction'

describe.each<AtomicMode>(['d1-batch', 'selfhost-transaction'])('LocationRepository atomic mutations (%s)', (mode) => {
  let db: Database
  let dbDir: string
  let client: ReturnType<typeof createClient> | null = null

  beforeEach(async () => {
    dbDir = await mkdtemp(join(tmpdir(), 'libroo-location-repository-'))
    client = createClient({ url: `file:${join(dbDir, 'test.db')}` })
    db = drizzle(client)
    await client.execute('PRAGMA foreign_keys = ON')

    for (const migrationFile of ['0000_initial_beta.sql', '0001_add_terms_acceptance.sql']) {
      const migrationPath = fileURLToPath(
        new URL(`../../../../server/db/migrations/sqlite/${migrationFile}`, import.meta.url)
      )
      const migration = await readFile(migrationPath, 'utf8')
      for (const statement of migration.split('--> statement-breakpoint')) {
        const migrationStatement = statement.trim()
        if (migrationStatement) {
          await client.execute(migrationStatement)
        }
      }
    }

    const now = new Date('2026-06-24T10:00:00.000Z')
    await db.insert(user).values({
      id: 'user-1',
      name: 'Reader',
      email: 'reader@example.com',
      emailVerified: true,
      role: 'user',
      banned: false,
      createdAt: now,
      updatedAt: now
    })
  })

  afterEach(async () => {
    client?.close()
    client = null
    await rm(dbDir, { recursive: true, force: true })
  })

  it('renames root and nested locations while repathing descendants atomically', async () => {
    await seedLocations(db)
    const transactionSpy = vi.spyOn(db, 'transaction')

    const root = await getLocation(db, 'root')
    await runRepository(db, mode, Effect.flatMap(LocationRepository, repository =>
      repository.renameLocation('user-1', root, 'Library')
    ))

    const child = await getLocation(db, 'child')
    await runRepository(db, mode, Effect.flatMap(LocationRepository, repository =>
      repository.renameLocation('user-1', child, 'Section')
    ))

    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'child', path: 'Library - Section', depth: 1 },
      { id: 'grandchild', path: 'Library - Section - Bin', depth: 2 },
      { id: 'other-root', path: 'Archive', depth: 0 },
      { id: 'root', path: 'Library', depth: 0 }
    ])
    expect(transactionSpy).toHaveBeenCalledTimes(mode === 'selfhost-transaction' ? 2 : 0)
  })

  it('moves a hierarchy and repaths every descendant atomically', async () => {
    await seedLocations(db)

    const child = await getLocation(db, 'child')
    const otherRoot = await getLocation(db, 'other-root')
    const moved = await runRepository(db, mode, Effect.flatMap(LocationRepository, repository =>
      repository.moveLocation('user-1', child, otherRoot)
    ))

    expect(moved).toMatchObject({
      id: 'child',
      parentLocationId: 'other-root',
      path: 'Archive - Row',
      depth: 1
    })
    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'child', path: 'Archive - Row', depth: 1 },
      { id: 'grandchild', path: 'Archive - Row - Bin', depth: 2 },
      { id: 'other-root', path: 'Archive', depth: 0 },
      { id: 'root', path: 'Shelf', depth: 0 }
    ])
  })

  it('clears assigned books and deletes the full hierarchy atomically', async () => {
    await seedLocations(db)
    await seedBook(db, 'grandchild')

    const root = await getLocation(db, 'root')
    await runRepository(db, mode, Effect.flatMap(LocationRepository, repository =>
      repository.deleteLocation('user-1', root, 'clear', null)
    ))

    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'other-root', path: 'Archive', depth: 0 }
    ])
    await expect(bookLocation(db)).resolves.toBeNull()
  })

  it('moves assigned books before deleting the full hierarchy atomically', async () => {
    await seedLocations(db)
    await seedBook(db, 'grandchild')

    const root = await getLocation(db, 'root')
    const target = await getLocation(db, 'other-root')
    await runRepository(db, mode, Effect.flatMap(LocationRepository, repository =>
      repository.deleteLocation('user-1', root, 'move', target)
    ))

    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'other-root', path: 'Archive', depth: 0 }
    ])
    await expect(bookLocation(db)).resolves.toBe('other-root')
  })

  it('rolls back book reassignment when hierarchy deletion fails', async () => {
    await seedLocations(db)
    await seedBook(db, 'grandchild')
    await client!.execute(`
      CREATE TRIGGER prevent_location_delete
      BEFORE DELETE ON locations
      BEGIN
        SELECT RAISE(ABORT, 'location delete blocked');
      END
    `)

    const root = await getLocation(db, 'root')
    const target = await getLocation(db, 'other-root')
    const result = await Effect.runPromise(Effect.either(repositoryEffect(db, mode,
      Effect.flatMap(LocationRepository, repository =>
        repository.deleteLocation('user-1', root, 'move', target)
      )
    )))

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(LocationDeleteError)
      expect(result.left.message).toContain('Failed to delete location')
    }
    await expect(bookLocation(db)).resolves.toBe('grandchild')
    await expect(locationPaths(db)).resolves.toHaveLength(4)
  })
})

function repositoryEffect<A, E>(
  db: Database,
  mode: AtomicMode,
  effect: Effect.Effect<A, E, LocationRepository | DbService>
) {
  const database = db as unknown as DbServiceInterface['db']
  const executeAtomic: DbServiceInterface['executeAtomic'] = mode === 'd1-batch'
    ? async (buildStatements) => {
      await database.batch(buildStatements(database))
    }
    : async (buildStatements) => {
      await database.transaction(async (tx) => {
        for (const statement of buildStatements(tx as unknown as DbServiceInterface['db'])) {
          await statement
        }
      })
    }

  return effect.pipe(
    Effect.provide(LocationRepositoryLive),
    Effect.provide(Layer.succeed(DbService, { db: database, executeAtomic }))
  )
}

function runRepository<A, E>(
  db: Database,
  mode: AtomicMode,
  effect: Effect.Effect<A, E, LocationRepository | DbService>
) {
  return Effect.runPromise(repositoryEffect(db, mode, effect))
}

async function seedLocations(db: Database) {
  const now = new Date('2026-06-24T10:00:00.000Z')
  await db.insert(locations).values([
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

async function seedBook(db: Database, locationId: string) {
  const now = new Date('2026-06-24T10:00:00.000Z')
  await db.insert(books).values({
    id: 'book-1',
    title: 'Atomic Shelves',
    source: 'manual',
    createdByUserId: 'user-1',
    createdAt: now
  })
  await db.insert(userBooks).values({
    id: 'user-book-1',
    userId: 'user-1',
    bookId: 'book-1',
    locationId,
    addedAt: now
  })
}

async function getLocation(db: Database, id: string): Promise<LocationRecord> {
  const rows = await db.select().from(locations).where(eq(locations.id, id)).limit(1)
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

async function locationPaths(db: Database) {
  return db
    .select({ id: locations.id, path: locations.path, depth: locations.depth })
    .from(locations)
    .orderBy(asc(locations.id))
}

async function bookLocation(db: Database) {
  const rows = await db
    .select({ locationId: userBooks.locationId })
    .from(userBooks)
    .where(eq(userBooks.id, 'user-book-1'))
  return rows[0]?.locationId ?? null
}
