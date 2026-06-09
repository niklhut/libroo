import { Context, Effect, Layer, Data } from 'effect'
import { normalizeBookLocationName } from '../../shared/utils/book-location'

export class InvalidLocationError extends Data.TaggedError('InvalidLocationError')<{
  message: string
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

          const parent = input.parentLocationId
            ? yield* locationRepo.getLocationById(userId, input.parentLocationId)
            : null

          return yield* locationRepo.createLocation(userId, { name, parent })
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
