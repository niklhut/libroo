import { Context, Effect, Layer, Data } from 'effect'
import { asc, count, eq, isNull, and, sql } from 'drizzle-orm'
import { locations, userBooks } from 'hub:db:schema'
import { normalizeBookLocationKey } from '../../shared/utils/book-location'

export class LocationNotFoundError extends Data.TaggedError('LocationNotFoundError')<{
  locationId: string
}> { }

export class LocationCreateError extends Data.TaggedError('LocationCreateError')<{
  message: string
}> { }

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
  createLocation: (
    userId: string,
    input: { name: string, parent: LocationRecord | null }
  ) => Effect.Effect<LocationRecord, LocationCreateError | DatabaseError, DbService>
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
                bookCount: count(userBooks.id)
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

          return rows.map(row => ({
            id: row.id,
            name: row.name,
            parentLocationId: row.parentLocationId ?? null,
            path: row.path,
            depth: row.depth,
            bookCount: row.bookCount
          }))
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

      createLocation: (userId, input) =>
        Effect.gen(function* () {
          const now = new Date()
          const id = generateId()
          const parent = input.parent
          const path = parent ? `${parent.path} - ${input.name}` : input.name
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
        })
    }
  })
)
