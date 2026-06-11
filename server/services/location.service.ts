import { Context, Effect, Layer, Data } from 'effect'
import { normalizeBookLocationName } from '../../shared/utils/book-location'
import type { LocationDeleteSchema, LocationMoveSchema, LocationRenameSchema } from '../../shared/utils/schemas'

export class InvalidLocationError extends Data.TaggedError('InvalidLocationError')<{
  message: string
}> { }

export class InvalidLocationMoveError extends Data.TaggedError('InvalidLocationMoveError')<{
  message: string
}> { }

export class LocationHasBooksError extends Data.TaggedError('LocationHasBooksError')<{
  message: string
  directBookCount: number
  descendantBookCount: number
}> { }

export interface LocationServiceInterface {
  listLocations: (userId: string) => Effect.Effect<BookLocationWithCount[], DatabaseError, DbService>
  createLocation: (
    userId: string,
    input: LocationCreateSchema
  ) => Effect.Effect<BookLocation, InvalidLocationError | LocationNotFoundError | LocationCreateError | DatabaseError, DbService>
  getLocation: (
    userId: string,
    locationId: string
  ) => Effect.Effect<BookLocation, LocationNotFoundError | DatabaseError, DbService>
  renameLocation: (
    userId: string,
    locationId: string,
    input: LocationRenameSchema
  ) => Effect.Effect<BookLocation, InvalidLocationError | LocationNotFoundError | LocationUpdateError | DatabaseError, DbService>
  moveLocation: (
    userId: string,
    locationId: string,
    input: LocationMoveSchema
  ) => Effect.Effect<BookLocation, InvalidLocationMoveError | LocationNotFoundError | LocationUpdateError | DatabaseError, DbService>
  deleteLocation: (
    userId: string,
    locationId: string,
    input: LocationDeleteSchema
  ) => Effect.Effect<void, InvalidLocationMoveError | LocationHasBooksError | LocationNotFoundError | LocationDeleteError | DatabaseError, DbService>
}

export class LocationService extends Context.Tag('LocationService')<LocationService, LocationServiceInterface>() { }

export const LocationServiceLive = Layer.effect(
  LocationService,
  Effect.gen(function* () {
    const locationRepo = yield* LocationRepository

    return {
      listLocations: userId =>
        locationRepo.listLocations(userId),

      getLocation: (userId, locationId) =>
        locationRepo.getLocationById(userId, locationId),

      createLocation: (userId, input) =>
        Effect.gen(function* () {
          const name = normalizeBookLocationName(input.name)
          if (!name) {
            return yield* Effect.fail(new InvalidLocationError({ message: 'Location name is required' }))
          }

          const parent = input.parentLocationId !== null
            ? yield* locationRepo.getLocationById(userId, input.parentLocationId)
            : null

          return yield* locationRepo.createLocation(userId, { name, parent })
        }),

      renameLocation: (userId, locationId, input) =>
        Effect.gen(function* () {
          const name = normalizeBookLocationName(input.name)
          if (!name) {
            return yield* Effect.fail(new InvalidLocationError({ message: 'Location name is required' }))
          }

          const location = yield* locationRepo.getLocationById(userId, locationId)
          return yield* locationRepo.renameLocation(userId, location, name)
        }),

      moveLocation: (userId, locationId, input) =>
        Effect.gen(function* () {
          const location = yield* locationRepo.getLocationById(userId, locationId)
          const parent = input.parentLocationId
            ? yield* locationRepo.getLocationById(userId, input.parentLocationId)
            : null

          if (parent?.id === location.id) {
            return yield* Effect.fail(new InvalidLocationMoveError({ message: 'A location cannot be moved under itself' }))
          }

          if (parent && parent.path.startsWith(`${location.path} - `)) {
            return yield* Effect.fail(new InvalidLocationMoveError({ message: 'A location cannot be moved under one of its descendants' }))
          }

          return yield* locationRepo.moveLocation(userId, location, parent)
        }),

      deleteLocation: (userId, locationId, input) =>
        Effect.gen(function* () {
          const location = yield* locationRepo.getLocationById(userId, locationId)
          const counts = yield* locationRepo.getBookCounts(userId, location)
          const affectedBooks = counts.directBookCount + counts.descendantBookCount

          if (input.mode === 'block' && affectedBooks > 0) {
            return yield* Effect.fail(new LocationHasBooksError({
              message: 'Location has books and requires explicit handling',
              directBookCount: counts.directBookCount,
              descendantBookCount: counts.descendantBookCount
            }))
          }

          if (input.mode === 'move') {
            const targetLocation = yield* locationRepo.getLocationById(userId, input.targetLocationId)
            if (targetLocation.id === location.id || targetLocation.path.startsWith(`${location.path} - `)) {
              return yield* Effect.fail(new InvalidLocationMoveError({ message: 'Books cannot be moved into the location being deleted' }))
            }

            yield* locationRepo.deleteLocation(userId, location, 'move', targetLocation)
            return
          }

          yield* locationRepo.deleteLocation(userId, location, 'clear', null)
        })
    }
  })
)

export const listLocations = (userId: string) =>
  Effect.flatMap(LocationService, service => service.listLocations(userId))

export const createLocation = (userId: string, input: LocationCreateSchema) =>
  Effect.flatMap(LocationService, service => service.createLocation(userId, input))

export const getLocation = (userId: string, locationId: string) =>
  Effect.flatMap(LocationService, service => service.getLocation(userId, locationId))

export const renameLocation = (userId: string, locationId: string, input: LocationRenameSchema) =>
  Effect.flatMap(LocationService, service => service.renameLocation(userId, locationId, input))

export const moveLocation = (userId: string, locationId: string, input: LocationMoveSchema) =>
  Effect.flatMap(LocationService, service => service.moveLocation(userId, locationId, input))

export const deleteLocation = (userId: string, locationId: string, input: LocationDeleteSchema) =>
  Effect.flatMap(LocationService, service => service.deleteLocation(userId, locationId, input))
