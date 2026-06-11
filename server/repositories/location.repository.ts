import { Context, Effect, Layer, Data } from 'effect'
import { asc, count, eq, isNull, and, sql, or, inArray } from 'drizzle-orm'
import { locations, userBooks } from 'hub:db:schema'
import { normalizeBookLocationKey } from '../../shared/utils/book-location'
import {
  calculateLocationCounts,
  computeLocationRepath,
  locationChildPath,
  locationDescendantPathLike
} from '../../shared/utils/location-hierarchy'

export class LocationNotFoundError extends Data.TaggedError('LocationNotFoundError')<{
  locationId: string
}> { }

export class LocationCreateError extends Data.TaggedError('LocationCreateError')<{
  message: string
}> { }

export class LocationUpdateError extends Data.TaggedError('LocationUpdateError')<{
  message: string
}> { }

export class LocationDeleteError extends Data.TaggedError('LocationDeleteError')<{
  message: string
}> { }

export interface LocationBookCounts {
  directBookCount: number
  descendantBookCount: number
}

export interface LocationRecord {
  id: string
  name: string
  parentLocationId: string | null
  path: string
  depth: number
}

export interface LocationRepositoryInterface {
  listLocations: (userId: string) => Effect.Effect<BookLocationWithCount[], DatabaseError, DbService>
  getLocationById: (userId: string, locationId: string) => Effect.Effect<LocationRecord, LocationNotFoundError | DatabaseError, DbService>
  getDescendants: (userId: string, location: LocationRecord) => Effect.Effect<LocationRecord[], DatabaseError, DbService>
  getBookCounts: (userId: string, location: LocationRecord) => Effect.Effect<LocationBookCounts, DatabaseError, DbService>
  createLocation: (
    userId: string,
    input: { name: string, parent: LocationRecord | null }
  ) => Effect.Effect<LocationRecord, LocationCreateError | DatabaseError, DbService>
  renameLocation: (
    userId: string,
    location: LocationRecord,
    name: string
  ) => Effect.Effect<LocationRecord, LocationUpdateError | DatabaseError, DbService>
  moveLocation: (
    userId: string,
    location: LocationRecord,
    parent: LocationRecord | null
  ) => Effect.Effect<LocationRecord, LocationUpdateError | DatabaseError, DbService>
  deleteLocation: (
    userId: string,
    location: LocationRecord,
    mode: 'clear' | 'move',
    targetLocation: LocationRecord | null
  ) => Effect.Effect<void, LocationDeleteError | DatabaseError, DbService>
}

export class LocationRepository extends Context.Tag('LocationRepository')<LocationRepository, LocationRepositoryInterface>() { }

function generateId(): string {
  return crypto.randomUUID()
}

function toLocationRecord(location: typeof locations.$inferSelect): LocationRecord {
  return {
    id: location.id,
    name: location.name,
    parentLocationId: location.parentLocationId ?? null,
    path: location.path,
    depth: location.depth
  }
}

const descendantWhere = (location: LocationRecord) =>
  or(eq(locations.id, location.id), sql`${locations.path} like ${locationDescendantPathLike(location)} escape '\\'`)

export const LocationRepositoryLive = Layer.effect(
  LocationRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    return {
      listLocations: userId =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({
                id: locations.id,
                name: locations.name,
                parentLocationId: locations.parentLocationId,
                path: locations.path,
                depth: locations.depth,
                directBookCount: count(userBooks.id)
              })
              .from(locations)
              .leftJoin(userBooks, and(eq(userBooks.locationId, locations.id), isNull(userBooks.removedAt)))
              .where(eq(locations.userId, userId))
              .groupBy(locations.id)
              .orderBy(asc(sql`lower(${locations.path})`)),
            catch: error => new DatabaseError({
              message: `Failed to list locations: ${error}`,
              operation: 'listLocations'
            })
          })

          return calculateLocationCounts(rows.map(row => ({
            id: row.id,
            name: row.name,
            parentLocationId: row.parentLocationId ?? null,
            path: row.path,
            depth: row.depth,
            directBookCount: row.directBookCount
          })))
        }),

      getLocationById: (userId, locationId) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select()
              .from(locations)
              .where(and(eq(locations.id, locationId), eq(locations.userId, userId)))
              .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to load location: ${error}`,
              operation: 'getLocationById'
            })
          })

          const location = rows[0]
          if (!location) {
            return yield* Effect.fail(new LocationNotFoundError({ locationId }))
          }

          return toLocationRecord(location)
        }),

      getDescendants: (userId, location) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select()
              .from(locations)
              .where(and(eq(locations.userId, userId), sql`${locations.path} like ${locationDescendantPathLike(location)} escape '\\'`))
              .orderBy(asc(sql`lower(${locations.path})`)),
            catch: error => new DatabaseError({
              message: `Failed to load descendant locations: ${error}`,
              operation: 'getDescendants'
            })
          })

          return rows.map(toLocationRecord)
        }),

      getBookCounts: (userId, location) =>
        Effect.gen(function* () {
          const direct = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({ count: count() })
              .from(userBooks)
              .where(and(eq(userBooks.userId, userId), eq(userBooks.locationId, location.id), isNull(userBooks.removedAt))),
            catch: error => new DatabaseError({
              message: `Failed to count direct location books: ${error}`,
              operation: 'getBookCounts.direct'
            })
          })

          const descendantRows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({ count: count(userBooks.id) })
              .from(userBooks)
              .innerJoin(locations, eq(userBooks.locationId, locations.id))
              .where(and(
                eq(userBooks.userId, userId),
                isNull(userBooks.removedAt),
                sql`${locations.path} like ${locationDescendantPathLike(location)} escape '\\'`
              )),
            catch: error => new DatabaseError({
              message: `Failed to count descendant location books: ${error}`,
              operation: 'getBookCounts.descendant'
            })
          })

          return {
            directBookCount: direct[0]?.count ?? 0,
            descendantBookCount: descendantRows[0]?.count ?? 0
          }
        }),

      createLocation: (userId, input) =>
        Effect.gen(function* () {
          const now = new Date()
          const id = generateId()
          const parent = input.parent
          const path = locationChildPath(parent, input.name)
          const depth = parent ? parent.depth + 1 : 0

          yield* Effect.tryPromise({
            try: () => dbService.db
              .insert(locations)
              .values({
                id,
                userId,
                parentLocationId: parent?.id ?? null,
                name: input.name,
                normalizedName: normalizeBookLocationKey(input.name),
                path,
                depth,
                createdAt: now,
                updatedAt: now
              }),
            catch: error => new LocationCreateError({ message: `Failed to create location: ${error}` })
          })

          return { id, name: input.name, parentLocationId: parent?.id ?? null, path, depth }
        }),

      renameLocation: (userId, location, name) =>
        Effect.gen(function* () {
          const now = new Date()

          return yield* Effect.tryPromise({
            try: () => dbService.db.transaction(async (tx) => {
              const parent = location.parentLocationId
                ? await tx
                    .select()
                    .from(locations)
                    .where(and(eq(locations.id, location.parentLocationId), eq(locations.userId, userId)))
                    .limit(1)
                    .then(rows => rows[0] ? toLocationRecord(rows[0]) : null)
                : null
              const descendants = await tx
                .select()
                .from(locations)
                .where(and(eq(locations.userId, userId), sql`${locations.path} like ${locationDescendantPathLike(location)} escape '\\'`))
              const repath = computeLocationRepath(location, descendants.map(toLocationRecord), parent, name)

              await tx.update(locations)
                .set({
                  name,
                  normalizedName: normalizeBookLocationKey(name),
                  path: repath.location.path,
                  depth: repath.location.depth,
                  updatedAt: now
                })
                .where(and(eq(locations.id, location.id), eq(locations.userId, userId)))

              for (const descendant of repath.descendants) {
                await tx.update(locations)
                  .set({
                    path: descendant.path,
                    depth: descendant.depth,
                    updatedAt: now
                  })
                  .where(eq(locations.id, descendant.id))
              }
              return repath.location
            }),
            catch: error => new LocationUpdateError({ message: `Failed to rename location: ${error}` })
          })
        }),

      moveLocation: (userId, location, parent) =>
        Effect.gen(function* () {
          const now = new Date()

          yield* Effect.tryPromise({
            try: () => dbService.db.transaction(async (tx) => {
              const descendants = await tx
                .select()
                .from(locations)
                .where(and(eq(locations.userId, userId), sql`${locations.path} like ${locationDescendantPathLike(location)} escape '\\'`))
              const repath = computeLocationRepath(location, descendants.map(toLocationRecord), parent)

              await tx.update(locations)
                .set({
                  parentLocationId: parent?.id ?? null,
                  path: repath.location.path,
                  depth: repath.location.depth,
                  updatedAt: now
                })
                .where(and(eq(locations.id, location.id), eq(locations.userId, userId)))

              for (const descendant of repath.descendants) {
                await tx.update(locations)
                  .set({
                    path: descendant.path,
                    depth: descendant.depth,
                    updatedAt: now
                  })
                  .where(eq(locations.id, descendant.id))
              }
            }),
            catch: error => new LocationUpdateError({ message: `Failed to move location: ${error}` })
          })

          return computeLocationRepath(location, [], parent).location
        }),

      deleteLocation: (userId, location, mode, targetLocation) =>
        Effect.gen(function* () {
          const descendantLocations = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({ id: locations.id })
              .from(locations)
              .where(and(eq(locations.userId, userId), descendantWhere(location))),
            catch: error => new DatabaseError({
              message: `Failed to load locations for delete: ${error}`,
              operation: 'deleteLocation.loadScope'
            })
          })
          const locationIds = descendantLocations.map(row => row.id)
          if (locationIds.length === 0) return

          yield* Effect.tryPromise({
            try: () => dbService.db.transaction(async (tx) => {
              await tx.update(userBooks)
                .set({ locationId: mode === 'move' ? targetLocation?.id ?? null : null })
                .where(and(eq(userBooks.userId, userId), inArray(userBooks.locationId, locationIds), isNull(userBooks.removedAt)))

              await tx.delete(locations)
                .where(and(eq(locations.userId, userId), inArray(locations.id, locationIds)))
            }),
            catch: error => new LocationDeleteError({ message: `Failed to delete location: ${error}` })
          })
        })
    }
  })
)
