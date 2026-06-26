import { Cause, Effect, Exit, Layer, pipe } from 'effect'
import type * as HttpClient from '@effect/platform/HttpClient'
import { RuntimeInfrastructureLive } from '../runtime/active'
import type { EmailService } from '../runtime/email.core'
import { StructuredLoggerLive } from './logger'

// Base services layer (no dependencies)
const BaseServicesLive = Layer.mergeAll(
  AuthServiceLive,
  RuntimeInfrastructureLive
)

// Repository layer (depends on base services)
const RepositoriesLive = Layer.provideMerge(
  Layer.mergeAll(
    BookRepositoryLive,
    OpenLibraryRepositoryLive,
    LendingRepositoryLive,
    AdminRepositoryLive,
    AuditRepositoryLive,
    LocationRepositoryLive,
    LibraryTransferRepositoryLive,
    AuthRepositoryLive,
    AccountDeletionRepositoryLive,
    SignupInviteRepositoryLive,
    HealthRepositoryLive,
    LegalRepositoryLive
  ),
  BaseServicesLive
)

// Service layer (depends on repositories)
const ServicesLive = Layer.provideMerge(
  Layer.mergeAll(BookServiceLive, LendingServiceLive, AdminServiceLive, AuditServiceLive, LocationServiceLive, LibraryTransferServiceLive, AccountDeletionServiceLive, SignupInviteServiceLive, EmailCapabilityServiceLive, HealthServiceLive, LegalServiceLive),
  RepositoriesLive
)

// Combined live layer for all services
export const MainLive = Layer.provideMerge(
  ServicesLive,
  StructuredLoggerLive
)

// Type for all available services
export type MainServices
  = DbService
    | StorageService
    | AuthService
    | BookRepository
    | OpenLibraryRepository
    | LendingRepository
    | AdminRepository
    | AuditRepository
    | LocationRepository
    | LibraryTransferRepository
    | AuthRepository
    | AccountDeletionRepository
    | SignupInviteRepository
    | HealthRepository
    | LegalRepository
    | BookService
    | LendingService
    | AdminService
    | AuditService
    | LocationService
    | LibraryTransferService
    | AccountDeletionService
    | SignupInviteService
    | EmailService
    | EmailCapabilityService
    | HealthService
    | LegalService
    | HttpClient.HttpClient

// Helper to safely get property from unknown object
function getProp<T>(obj: unknown, key: string): T | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    return (obj as Record<string, unknown>)[key] as T
  }
  return undefined
}

// Error mappings for converting tagged errors to HTTP status codes
const errorStatusCodes: Record<string, number> = {
  UnauthorizedError: 401,
  EmailDeliveryError: 503,
  VerificationEmailDeliveryError: 503,
  EmailCapabilityDisabledError: 403,
  InvalidPendingEmailError: 400,
  PendingEmailConflictError: 409,
  InvalidEmailVerificationTokenError: 401,
  ExpiredEmailVerificationTokenError: 401,
  BookNotFoundError: 404,
  OpenLibraryBookNotFoundError: 404,
  BookAlreadyOwnedError: 409,
  ActiveLoanRemovalError: 409,
  OpenLibraryApiError: 502,
  BookCreateError: 500,
  InvalidTagError: 400,
  InvalidReadingProgressError: 400,
  InvalidManualCoverError: 400,
  InvalidLibraryCsvError: 400,
  InvalidLocationError: 400,
  InvalidLocationMoveError: 400,
  LocationNotFoundError: 404,
  LocationCreateError: 500,
  LocationUpdateError: 500,
  LocationDeleteError: 500,
  LocationHasBooksError: 409,
  ActiveLoanExistsError: 409,
  LoanNotFoundError: 404,
  InvalidInviteError: 400,
  LoanUnavailableError: 409,
  AdminForbiddenError: 403,
  InvalidAdminRequestError: 400,
  SignupInviteForbiddenError: 403,
  InvalidSignupInviteError: 400,
  SignupInviteDeliveryError: 503,
  DatabaseError: 500,
  StorageError: 500,
  HealthCheckError: 503,
  LegalDocumentFetchError: 502,
  InvalidLegalDocumentSourceError: 500,
  InvalidAccountDeletionConfirmationError: 400,
  LastAdminAccountDeletionError: 409
}

// Custom error message formatters
const errorMessageFormatters: Record<string, (error: unknown) => string> = {
  BookNotFoundError: (error) => {
    const isbn = getProp<string>(error, 'isbn')
    return isbn ? `Book with ISBN ${isbn} not found` : 'Book not found'
  },
  BookAlreadyOwnedError: (error) => {
    const isbn = getProp<string>(error, 'isbn')
    return `You already have this book (ISBN: ${isbn || 'unknown'}) in your library`
  },
  ActiveLoanRemovalError: (error) => {
    const borrower = getProp<string>(error, 'borrowerDisplayName')
    return borrower
      ? `This book is currently lent to ${borrower}. Confirm removal to remove it from your library while keeping lending history.`
      : 'This book is currently lent out. Confirm removal to remove it from your library while keeping lending history.'
  },
  ActiveLoanExistsError: () => {
    return 'This book is already lent out.'
  },
  LocationUpdateError: () => 'The location could not be updated. Please try again.',
  LocationDeleteError: () => 'The location could not be deleted. Please try again.'
}

/**
 * Converts any error to an H3Error and throws it as a defect.
 *
 * This uses Effect.die() to immediately terminate the Effect with the H3Error
 * as an unrecoverable defect. The runEffect function will catch this defect
 * and throw the H3Error to the HTTP layer.
 */
export function handleError(error: unknown): Effect.Effect<never> {
  return Effect.gen(function* () {
    // Check if it's already an H3 error - throw it directly
    if (isError(error)) {
      return yield* Effect.die(error)
    }

    // Check if it's a tagged error with _tag
    const tag = getProp<string>(error, '_tag')
    if (tag) {
      const statusCode = errorStatusCodes[tag] ?? 500
      const formatter = errorMessageFormatters[tag]
      const underlyingMessage = getProp<string>(error, 'message') ?? tag
      const message = formatter
        ? formatter(error)
        : underlyingMessage
      const operation = getProp<string>(error, 'operation')
      const cause = getProp<unknown>(error, 'cause')
      const causeMessage = cause instanceof Error ? cause.message : cause ? String(cause) : undefined
      const diagnosticMessage = causeMessage
        ? `${underlyingMessage}; cause: ${causeMessage}`
        : underlyingMessage

      yield* Effect.logError(`[${tag}${operation ? `:${operation}` : ''}] ${diagnosticMessage}`).pipe(
        Effect.annotateLogs({
          tag,
          operation: operation ?? 'unknown',
          cause: causeMessage ?? 'none',
          severity: 'error'
        }),
        Effect.provide(StructuredLoggerLive)
      )
      return yield* Effect.die(createError({ statusCode, message }))
    }

    // Unknown error - log and throw as internal server error
    const message = error instanceof Error ? error.message : String(error)
    yield* Effect.logError(`Unexpected error: ${message}`).pipe(
      Effect.annotateLogs({
        tag: 'UnknownError',
        operation: 'handleError',
        severity: 'error'
      }),
      Effect.provide(StructuredLoggerLive)
    )
    return yield* Effect.die(createError({ statusCode: 500, message: 'Internal Server Error' }))
  })
}

/**
 * Runs an Effect in a Nitro event handler, converting tagged errors to H3Errors
 * and throwing them to the HTTP layer.
 *
 * Error handling flow:
 * 1. Effect.catchAll intercepts all expected errors (E channel)
 * 2. handleError converts them to H3Errors and uses Effect.die() to throw as defects
 * 3. runPromiseExit captures the Exit (success or failure with Cause)
 * 4. On failure, we extract the H3Error defect and throw it
 * 5. On success, we return the value directly (no isError check needed)
 */
export async function runEffect<A, E>(
  effect: Effect.Effect<A, E, MainServices>
): Promise<A> {
  const exit = await pipe(
    effect,
    Effect.provide(MainLive),
    Effect.catchAll(handleError),
    Effect.runPromiseExit
  )

  return Exit.match(exit, {
    onFailure: (cause) => {
      // handleError uses Effect.die() to throw H3Errors as defects.
      // Extract the first defect (which should be our H3Error) and throw it.
      const defects = [...Cause.defects(cause)]
      if (defects.length > 0 && isError(defects[0])) {
        throw defects[0]
      }
      // Fallback for unexpected causes
      throw createError({ statusCode: 500, message: 'Unexpected internal error' })
    },
    onSuccess: value => value
  })
}

// Re-export common Effect utilities
export { Effect, Layer, Context, Data } from 'effect'
