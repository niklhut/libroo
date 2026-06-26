import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Effect, Layer } from 'effect'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { asc, eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { books, locations, user, userBooks } from '../../../../server/db/schema'
import {
  affectedRows,
  buildDeleteLocationStatements,
  LocationDeleteError,
  LocationRepository,
  LocationRepositoryLive,
  LocationUpdateError,
  type LocationRecord
} from '../../../../server/repositories/location.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'

type Database = ReturnType<typeof drizzle>
type AtomicMode = 'd1-batch' | 'selfhost-transaction'

describe('LocationRepository D1 delete helpers', () => {
  it('reads affected rows from D1 meta.changes results', () => {
    expect(affectedRows({ meta: { changes: 3 } })).toBe(3)
    expect(affectedRows({ meta: { changes: '3' } })).toBe(0)
  })

  it('builds deleteLocation batch statements without nested selects or exists clauses', () => {
    const client = createClient({ url: ':memory:' })
    const database = drizzle(client)
    const target: LocationRecord = {
      id: 'target',
      name: 'Archive',
      parentLocationId: null,
      path: 'Archive',
      depth: 0
    }

    const statements = buildDeleteLocationStatements(
      database as unknown as DbServiceInterface['db'],
      'user-1',
      [
        { id: 'root', name: 'Shelf', parentLocationId: null, path: 'Shelf', depth: 0 },
        { id: 'child', name: 'Row', parentLocationId: 'root', path: 'Shelf - Row', depth: 1 }
      ],
      'move',
      target
    )
    const sqlText = statements.map(statement => statement.toSQL().sql).join('\n').toLowerCase()

    expect(sqlText).not.toMatch(/\bselect\b/)
    expect(sqlText).not.toMatch(/\bexists\b/)
    expect(sqlText).toContain('in (?, ?)')
    expect(statements.slice(1).map(statement => statement.toSQL().params.at(-1))).toEqual([
      'child',
      'root'
    ])
    client.close()
  })
})

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

  it('does not overwrite a hierarchy that changed before a rename batch starts', async () => {
    await seedLocations(db)
    const root = await getLocation(db, 'root')

    const result = await Effect.runPromise(Effect.either(repositoryEffect(
      db,
      mode,
      Effect.flatMap(LocationRepository, repository =>
        repository.renameLocation('user-1', root, 'Requested Name')
      ),
      async () => {
        await db.update(locations)
          .set({ name: 'Concurrent Name', normalizedName: 'concurrent name', path: 'Concurrent Name' })
          .where(eq(locations.id, 'root'))
        await db.update(locations)
          .set({ path: sql`'Concurrent Name' || substr(${locations.path}, ${'Shelf'.length + 1})` })
          .where(sql`${locations.path} like 'Shelf - %'`)
      }
    )))

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(LocationUpdateError)
      expect(result.left.message).toContain('hierarchy changed')
    }
    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'child', path: 'Concurrent Name - Row', depth: 1 },
      { id: 'grandchild', path: 'Concurrent Name - Row - Bin', depth: 2 },
      { id: 'other-root', path: 'Archive', depth: 0 },
      { id: 'root', path: 'Concurrent Name', depth: 0 }
    ])
  })

  it('repaths descendants that enter the hierarchy before a rename batch starts', async () => {
    await seedLocations(db)
    const root = await getLocation(db, 'root')

    await runRepository(
      db,
      mode,
      Effect.flatMap(LocationRepository, repository =>
        repository.renameLocation('user-1', root, 'Library')
      ),
      async () => {
        const now = new Date('2026-06-24T10:01:00.000Z')
        await db.insert(locations).values(
          locationValue('late-child', 'Late', 'root', 'Shelf - Late', 1, now)
        )
      }
    )

    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'child', path: 'Library - Row', depth: 1 },
      { id: 'grandchild', path: 'Library - Row - Bin', depth: 2 },
      { id: 'late-child', path: 'Library - Late', depth: 1 },
      { id: 'other-root', path: 'Archive', depth: 0 },
      { id: 'root', path: 'Library', depth: 0 }
    ])
  })

  it('does not move under a parent that changed before the atomic write starts', async () => {
    await seedLocations(db)
    const child = await getLocation(db, 'child')
    const otherRoot = await getLocation(db, 'other-root')

    const result = await Effect.runPromise(Effect.either(repositoryEffect(
      db,
      mode,
      Effect.flatMap(LocationRepository, repository =>
        repository.moveLocation('user-1', child, otherRoot)
      ),
      async () => {
        await db.update(locations)
          .set({ name: 'Concurrent Archive', normalizedName: 'concurrent archive', path: 'Concurrent Archive' })
          .where(eq(locations.id, 'other-root'))
      }
    )))

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(LocationUpdateError)
      expect(result.left.message).toContain('hierarchy changed')
    }
    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'child', path: 'Shelf - Row', depth: 1 },
      { id: 'grandchild', path: 'Shelf - Row - Bin', depth: 2 },
      { id: 'other-root', path: 'Concurrent Archive', depth: 0 },
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

  it('does not delete when the book destination changed after the caller loaded it', async () => {
    await seedLocations(db)
    await seedBook(db, 'grandchild')
    const root = await getLocation(db, 'root')
    const target = await getLocation(db, 'other-root')

    await db.update(locations)
      .set({
        name: 'Concurrent Archive',
        normalizedName: 'concurrent archive',
        path: 'Concurrent Archive'
      })
      .where(eq(locations.id, 'other-root'))

    const result = await Effect.runPromise(Effect.either(repositoryEffect(
      db,
      mode,
      Effect.flatMap(LocationRepository, repository =>
        repository.deleteLocation('user-1', root, 'move', target)
      )
    )))

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left).toBeInstanceOf(LocationDeleteError)
      expect(result.left.message).toContain('hierarchy changed')
    }
    await expect(bookLocation(db)).resolves.toBe('grandchild')
    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'child', path: 'Shelf - Row', depth: 1 },
      { id: 'grandchild', path: 'Shelf - Row - Bin', depth: 2 },
      { id: 'other-root', path: 'Concurrent Archive', depth: 0 },
      { id: 'root', path: 'Shelf', depth: 0 }
    ])
  })

  it('includes locations that entered the hierarchy after the caller loaded the root', async () => {
    await seedLocations(db)
    await seedBook(db, 'grandchild')
    const root = await getLocation(db, 'root')
    const now = new Date('2026-06-24T10:01:00.000Z')
    await db.insert(locations).values(
      locationValue('late-child', 'Late', 'root', 'Shelf - Late', 1, now)
    )
    await db.insert(books).values({
      id: 'late-book',
      title: 'Late Arrival',
      source: 'manual',
      createdByUserId: 'user-1',
      createdAt: now
    })
    await db.insert(userBooks).values({
      id: 'late-user-book',
      userId: 'user-1',
      bookId: 'late-book',
      locationId: 'late-child',
      addedAt: now
    })

    await runRepository(db, mode, Effect.flatMap(LocationRepository, repository =>
      repository.deleteLocation('user-1', root, 'clear', null)
    ))

    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'other-root', path: 'Archive', depth: 0 }
    ])
    const assignedBooks = await db
      .select({ id: userBooks.id, locationId: userBooks.locationId })
      .from(userBooks)
      .orderBy(asc(userBooks.id))
    expect(assignedBooks).toEqual([
      { id: 'late-user-book', locationId: null },
      { id: 'user-book-1', locationId: null }
    ])
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
      expect(result.left.message).toBe('The location could not be deleted. Please try again.')
    }
    await expect(bookLocation(db)).resolves.toBe('grandchild')
    await expect(locationPaths(db)).resolves.toEqual([
      { id: 'child', path: 'Shelf - Row', depth: 1 },
      { id: 'grandchild', path: 'Shelf - Row - Bin', depth: 2 },
      { id: 'other-root', path: 'Archive', depth: 0 },
      { id: 'root', path: 'Shelf', depth: 0 }
    ])
  })
})

function repositoryEffect<A, E>(
  db: Database,
  mode: AtomicMode,
  effect: Effect.Effect<A, E, LocationRepository | DbService>,
  beforeAtomic?: () => Promise<void>
) {
  const database = db as unknown as DbServiceInterface['db']
  const executeAtomic: DbServiceInterface['executeAtomic'] = mode === 'd1-batch'
    ? async (buildStatements) => {
      await beforeAtomic?.()
      return database.batch(buildStatements(database))
    }
    : async (buildStatements) => {
      await beforeAtomic?.()
      return database.transaction(async (tx) => {
        const results: unknown[] = []
        for (const statement of buildStatements(tx as unknown as DbServiceInterface['db'])) {
          results.push(await statement)
        }
        return results
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
  effect: Effect.Effect<A, E, LocationRepository | DbService>,
  beforeAtomic?: () => Promise<void>
) {
  return Effect.runPromise(repositoryEffect(db, mode, effect, beforeAtomic))
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
