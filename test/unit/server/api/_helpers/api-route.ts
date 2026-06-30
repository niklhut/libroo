import type { Cause, Effect } from 'effect'
import { expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  handler: vi.fn()
}))

vi.mock('../../../../../server/utils/auth', () => ({
  LIBROO_CLIENT_IP_HEADER: 'x-libroo-client-ip',
  auth: {
    api: {
      getSession: authMock.getSession
    },
    handler: authMock.handler
  }
}))

vi.mock('../../../../../server/utils/effect', async () => {
  const { Cause, Effect, Exit } = await import('effect')
  const { AuthServiceLive } = await import('../../../../../server/services/auth.service')

  return {
    runEffect: async <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => {
      const exit = await effect.pipe(
        Effect.provide(AuthServiceLive),
        Effect.catchAll((error: unknown) => {
          if (typeof error === 'object' && error && 'statusCode' in error) {
            return Effect.die(error)
          }

          const tag = typeof error === 'object' && error && '_tag' in error
            ? String(error._tag)
            : undefined
          const statusCode = tag === 'UnauthorizedError'
            ? 401
            : tag === 'AdminForbiddenError'
              ? 403
              : tag === 'InvalidAdminRequestError'
                ? 400
                : tag === 'AdminUserNotFoundError'
                  ? 404
                  : tag === 'BookAlreadyOwnedError'
                    ? 409
                    : tag === 'BookNotFoundError'
                      ? 404
                      : tag === 'LoanNotFoundError'
                        ? 404
                        : tag === 'ActiveLoanExistsError'
                          ? 409
                          : tag === 'LoanUnavailableError'
                            ? 409
                            : tag === 'ActiveLoanRemovalError'
                              ? 409
                              : tag === 'SelfAdminDemotionError' || tag === 'InvalidAdminRoleError'
                                ? 400
                                : tag === 'LastAdminDemotionError'
                                  ? 409
                                  : tag === 'InvalidInviteError'
                                    ? 400
                                    : 500
          const message = typeof error === 'object' && error && 'message' in error
            ? String(error.message)
            : 'Internal Server Error'

          const httpError = new Error(message) as Error & { statusCode: number }
          httpError.statusCode = statusCode
          return Effect.die(httpError)
        }),
        Effect.runPromiseExit
      )

      return Exit.match(exit, {
        onFailure: (cause: Cause.Cause<unknown>) => {
          const defects = [...Cause.defects(cause)]
          throw defects[0] ?? new Error('Unexpected internal error')
        },
        onSuccess: value => value
      })
    }
  }
})

vi.mock('../../../../../server/services/auth-request.service', () => ({
  handleAuthRequest: (...args: unknown[]) => serviceMocks.handleAuthRequest(...args)
}))

export interface TestEvent {
  headers: Headers
  params?: Record<string, string | undefined>
  query?: Record<string, string | undefined>
  context?: Record<string, unknown>
  body?: unknown
  responseHeaders: Record<string, string>
}

type HttpErrorFactory = (input: {
  statusCode: number
  message?: string
  statusMessage?: string
  data?: unknown
}) => Error & {
  statusCode: number
  statusMessage?: string
  data?: unknown
}

interface ApiRouteTestGlobals {
  defineEventHandler: (handler: unknown) => unknown
  createError: HttpErrorFactory
  auth: { handler: ReturnType<typeof vi.fn> }
  toWebRequest: (event: TestEvent) => { webRequestFor: TestEvent }
  getRouterParam: (event: TestEvent, key: string) => string | undefined
  getQuery: (event: TestEvent) => Record<string, string | undefined>
  readValidatedBody: (event: TestEvent, parse: (body: unknown) => unknown) => Promise<unknown>
  setHeader: (event: TestEvent, key: string, value: string) => void
  effectHandler: unknown
  addBookToLibrary: (...args: unknown[]) => unknown
  bulkAddBooks: (...args: unknown[]) => unknown
  createManualBook: (...args: unknown[]) => unknown
  getUserLibrary: (...args: unknown[]) => unknown
  getAuthorLibrary: (...args: unknown[]) => unknown
  lookupBook: (...args: unknown[]) => unknown
  batchRemoveFromLibrary: (...args: unknown[]) => unknown
  removeBookFromLibrary: (...args: unknown[]) => unknown
  getBookDetails: (...args: unknown[]) => unknown
  updateNote: (...args: unknown[]) => unknown
  updateLocation: (...args: unknown[]) => unknown
  updateRating: (...args: unknown[]) => unknown
  updateReadingProgress: (...args: unknown[]) => unknown
  listLocations: (...args: unknown[]) => unknown
  createLocation: (...args: unknown[]) => unknown
  renameLocation: (...args: unknown[]) => unknown
  moveLocation: (...args: unknown[]) => unknown
  deleteLocation: (...args: unknown[]) => unknown
  addUserTag: (...args: unknown[]) => unknown
  batchUpdateTags: (...args: unknown[]) => unknown
  deleteTag: (...args: unknown[]) => unknown
  promoteSuggestedTag: (...args: unknown[]) => unknown
  createLoanForBook: (...args: unknown[]) => unknown
  returnLoanForOwner: (...args: unknown[]) => unknown
  cancelLoanForOwner: (...args: unknown[]) => unknown
  listLoansForOwner: (...args: unknown[]) => unknown
  listBooksLentToUser: (...args: unknown[]) => unknown
  getOptionalCurrentUserId: (...args: unknown[]) => unknown
  handleAuthRequest: (...args: unknown[]) => unknown
  getInvitePreview: (...args: unknown[]) => unknown
  acceptBookInvite: (...args: unknown[]) => unknown
  getBlob: (...args: unknown[]) => unknown
  getAuthorizedCover: (...args: unknown[]) => unknown
  exportLibraryCsv: (...args: unknown[]) => unknown
  importLibraryCsv: (...args: unknown[]) => unknown
  bookIsbnSchema: unknown
  bookBatchDeleteSchema: unknown
  bookTagAddSchema: unknown
  createLoanSchema: unknown
  manualBookCreateSchema: unknown
  locationCreateSchema: unknown
  locationRenameSchema: unknown
  locationMoveSchema: unknown
  locationDeleteSchema: unknown
  libraryImportSchema: unknown
}

const testGlobal = globalThis as typeof globalThis & Partial<ApiRouteTestGlobals>

export const testUser = {
  id: 'user-1',
  name: 'Ada',
  email: 'ada@example.com'
}

export const serviceMocks = {
  addBookToLibrary: vi.fn(),
  bulkAddBooks: vi.fn(),
  createManualBook: vi.fn(),
  getUserLibrary: vi.fn(),
  getAuthorLibrary: vi.fn(),
  lookupBook: vi.fn(),
  batchRemoveFromLibrary: vi.fn(),
  removeBookFromLibrary: vi.fn(),
  getBookDetails: vi.fn(),
  updateNote: vi.fn(),
  updateLocation: vi.fn(),
  updateRating: vi.fn(),
  updateReadingProgress: vi.fn(),
  listLocations: vi.fn(),
  createLocation: vi.fn(),
  renameLocation: vi.fn(),
  moveLocation: vi.fn(),
  deleteLocation: vi.fn(),
  addUserTag: vi.fn(),
  batchUpdateTags: vi.fn(),
  deleteTag: vi.fn(),
  promoteSuggestedTag: vi.fn(),
  createLoanForBook: vi.fn(),
  returnLoanForOwner: vi.fn(),
  cancelLoanForOwner: vi.fn(),
  listLoansForOwner: vi.fn(),
  listBooksLentToUser: vi.fn(),
  getOptionalCurrentUserId: vi.fn(),
  handleAuthRequest: vi.fn(),
  getInvitePreview: vi.fn(),
  acceptBookInvite: vi.fn(),
  getBlob: vi.fn(),
  getAuthorizedCover: vi.fn(),
  exportLibraryCsv: vi.fn(),
  importLibraryCsv: vi.fn()
}

export function getAuthHandlerMock() {
  return authMock.handler
}

const originalGlobals = {
  defineEventHandler: testGlobal.defineEventHandler,
  createError: testGlobal.createError,
  auth: testGlobal.auth,
  toWebRequest: testGlobal.toWebRequest,
  getRouterParam: testGlobal.getRouterParam,
  getQuery: testGlobal.getQuery,
  readValidatedBody: testGlobal.readValidatedBody,
  setHeader: testGlobal.setHeader,
  effectHandler: testGlobal.effectHandler,
  addBookToLibrary: testGlobal.addBookToLibrary,
  bulkAddBooks: testGlobal.bulkAddBooks,
  createManualBook: testGlobal.createManualBook,
  getUserLibrary: testGlobal.getUserLibrary,
  getAuthorLibrary: testGlobal.getAuthorLibrary,
  lookupBook: testGlobal.lookupBook,
  batchRemoveFromLibrary: testGlobal.batchRemoveFromLibrary,
  removeBookFromLibrary: testGlobal.removeBookFromLibrary,
  getBookDetails: testGlobal.getBookDetails,
  updateNote: testGlobal.updateNote,
  updateLocation: testGlobal.updateLocation,
  updateRating: testGlobal.updateRating,
  updateReadingProgress: testGlobal.updateReadingProgress,
  listLocations: testGlobal.listLocations,
  createLocation: testGlobal.createLocation,
  renameLocation: testGlobal.renameLocation,
  moveLocation: testGlobal.moveLocation,
  deleteLocation: testGlobal.deleteLocation,
  addUserTag: testGlobal.addUserTag,
  batchUpdateTags: testGlobal.batchUpdateTags,
  deleteTag: testGlobal.deleteTag,
  promoteSuggestedTag: testGlobal.promoteSuggestedTag,
  createLoanForBook: testGlobal.createLoanForBook,
  returnLoanForOwner: testGlobal.returnLoanForOwner,
  cancelLoanForOwner: testGlobal.cancelLoanForOwner,
  listLoansForOwner: testGlobal.listLoansForOwner,
  listBooksLentToUser: testGlobal.listBooksLentToUser,
  getOptionalCurrentUserId: testGlobal.getOptionalCurrentUserId,
  handleAuthRequest: testGlobal.handleAuthRequest,
  getInvitePreview: testGlobal.getInvitePreview,
  acceptBookInvite: testGlobal.acceptBookInvite,
  getBlob: testGlobal.getBlob,
  getAuthorizedCover: testGlobal.getAuthorizedCover,
  exportLibraryCsv: testGlobal.exportLibraryCsv,
  importLibraryCsv: testGlobal.importLibraryCsv,
  bookIsbnSchema: testGlobal.bookIsbnSchema,
  bookBatchDeleteSchema: testGlobal.bookBatchDeleteSchema,
  bookTagAddSchema: testGlobal.bookTagAddSchema,
  createLoanSchema: testGlobal.createLoanSchema,
  manualBookCreateSchema: testGlobal.manualBookCreateSchema,
  locationCreateSchema: testGlobal.locationCreateSchema,
  locationRenameSchema: testGlobal.locationRenameSchema,
  locationMoveSchema: testGlobal.locationMoveSchema,
  locationDeleteSchema: testGlobal.locationDeleteSchema,
  libraryImportSchema: testGlobal.libraryImportSchema
}

const createHttpError: HttpErrorFactory = (input) => {
  const error = new Error(input.message ?? input.statusMessage ?? 'Error') as ReturnType<HttpErrorFactory>
  error.statusCode = input.statusCode
  error.statusMessage = input.statusMessage ?? input.message
  error.data = input.data
  return error
}

export function routePath(pathname: string) {
  return `../../../../../server/api/${pathname}`
}

export function makeEvent(overrides: Partial<TestEvent> = {}): TestEvent {
  return {
    headers: new Headers(),
    params: {},
    query: {},
    responseHeaders: {},
    ...overrides
  }
}

export async function importRoute(path: string) {
  const module = await import(path)
  return module.default as (event: TestEvent) => Promise<unknown>
}

export function mockLoggedInUser(user = testUser) {
  authMock.getSession.mockResolvedValue({ user, session: { id: 'session-1' } })
}

export async function setupApiRouteTest() {
  vi.resetModules()
  vi.clearAllMocks()

  testGlobal.defineEventHandler = (handler: unknown) => handler
  testGlobal.createError = createHttpError
  testGlobal.auth = { handler: authMock.handler }
  testGlobal.toWebRequest = (event: TestEvent) => ({ webRequestFor: event })
  testGlobal.getRouterParam = (event: TestEvent, key: string) => event.params?.[key]
  testGlobal.getQuery = (event: TestEvent) => event.query ?? {}
  testGlobal.readValidatedBody = async (event: TestEvent, parse: (body: unknown) => unknown) => parse(event.body)
  testGlobal.setHeader = (event: TestEvent, key: string, value: string) => {
    event.responseHeaders[key] = value
  }

  const { effectHandler } = await import('../../../../../server/utils/effectHandler')
  testGlobal.effectHandler = effectHandler

  testGlobal.addBookToLibrary = (...args: unknown[]) => serviceMocks.addBookToLibrary(...args)
  testGlobal.bulkAddBooks = (...args: unknown[]) => serviceMocks.bulkAddBooks(...args)
  testGlobal.createManualBook = (...args: unknown[]) => serviceMocks.createManualBook(...args)
  testGlobal.getUserLibrary = (...args: unknown[]) => serviceMocks.getUserLibrary(...args)
  testGlobal.getAuthorLibrary = (...args: unknown[]) => serviceMocks.getAuthorLibrary(...args)
  testGlobal.lookupBook = (...args: unknown[]) => serviceMocks.lookupBook(...args)
  testGlobal.batchRemoveFromLibrary = (...args: unknown[]) => serviceMocks.batchRemoveFromLibrary(...args)
  testGlobal.removeBookFromLibrary = (...args: unknown[]) => serviceMocks.removeBookFromLibrary(...args)
  testGlobal.getBookDetails = (...args: unknown[]) => serviceMocks.getBookDetails(...args)
  testGlobal.updateNote = (...args: unknown[]) => serviceMocks.updateNote(...args)
  testGlobal.updateLocation = (...args: unknown[]) => serviceMocks.updateLocation(...args)
  testGlobal.updateRating = (...args: unknown[]) => serviceMocks.updateRating(...args)
  testGlobal.updateReadingProgress = (...args: unknown[]) => serviceMocks.updateReadingProgress(...args)
  testGlobal.listLocations = (...args: unknown[]) => serviceMocks.listLocations(...args)
  testGlobal.createLocation = (...args: unknown[]) => serviceMocks.createLocation(...args)
  testGlobal.renameLocation = (...args: unknown[]) => serviceMocks.renameLocation(...args)
  testGlobal.moveLocation = (...args: unknown[]) => serviceMocks.moveLocation(...args)
  testGlobal.deleteLocation = (...args: unknown[]) => serviceMocks.deleteLocation(...args)
  testGlobal.addUserTag = (...args: unknown[]) => serviceMocks.addUserTag(...args)
  testGlobal.batchUpdateTags = (...args: unknown[]) => serviceMocks.batchUpdateTags(...args)
  testGlobal.deleteTag = (...args: unknown[]) => serviceMocks.deleteTag(...args)
  testGlobal.promoteSuggestedTag = (...args: unknown[]) => serviceMocks.promoteSuggestedTag(...args)
  testGlobal.createLoanForBook = (...args: unknown[]) => serviceMocks.createLoanForBook(...args)
  testGlobal.returnLoanForOwner = (...args: unknown[]) => serviceMocks.returnLoanForOwner(...args)
  testGlobal.cancelLoanForOwner = (...args: unknown[]) => serviceMocks.cancelLoanForOwner(...args)
  testGlobal.listLoansForOwner = (...args: unknown[]) => serviceMocks.listLoansForOwner(...args)
  testGlobal.listBooksLentToUser = (...args: unknown[]) => serviceMocks.listBooksLentToUser(...args)
  testGlobal.getOptionalCurrentUserId = (...args: unknown[]) => serviceMocks.getOptionalCurrentUserId(...args)
  testGlobal.handleAuthRequest = (...args: unknown[]) => serviceMocks.handleAuthRequest(...args)
  testGlobal.getInvitePreview = (...args: unknown[]) => serviceMocks.getInvitePreview(...args)
  testGlobal.acceptBookInvite = (...args: unknown[]) => serviceMocks.acceptBookInvite(...args)
  testGlobal.getBlob = (...args: unknown[]) => serviceMocks.getBlob(...args)
  testGlobal.getAuthorizedCover = (...args: unknown[]) => serviceMocks.getAuthorizedCover(...args)
  testGlobal.exportLibraryCsv = (...args: unknown[]) => serviceMocks.exportLibraryCsv(...args)
  testGlobal.importLibraryCsv = (...args: unknown[]) => serviceMocks.importLibraryCsv(...args)

  const schemas = await import('../../../../../shared/utils/schemas')
  testGlobal.bookIsbnSchema = schemas.bookIsbnSchema
  testGlobal.bookBatchDeleteSchema = schemas.bookBatchDeleteSchema
  testGlobal.bookTagAddSchema = schemas.bookTagAddSchema
  testGlobal.createLoanSchema = schemas.createLoanSchema
  testGlobal.manualBookCreateSchema = schemas.manualBookCreateSchema
  testGlobal.locationCreateSchema = schemas.locationCreateSchema
  testGlobal.locationRenameSchema = schemas.locationRenameSchema
  testGlobal.locationMoveSchema = schemas.locationMoveSchema
  testGlobal.locationDeleteSchema = schemas.locationDeleteSchema
  testGlobal.libraryImportSchema = schemas.libraryImportSchema

  for (const mock of Object.values(serviceMocks)) {
    mock.mockReset()
  }
}

export function cleanupApiRouteTest() {
  Object.assign(testGlobal, originalGlobals)
}

export function expectNoServiceCalls() {
  expect(Object.values(serviceMocks).every(mock => mock.mock.calls.length === 0)).toBe(true)
}

export function itRequiresAuth(path: string, event: Partial<TestEvent> = {}) {
  it('requires an active session', async () => {
    authMock.getSession.mockResolvedValueOnce(null)
    const handler = await importRoute(path)

    await expect(handler(makeEvent(event))).rejects.toMatchObject({
      statusCode: 401,
      message: 'No active session'
    })
    expectNoServiceCalls()
  })
}

export function itRejectsBannedUsers(path: string, event: Partial<TestEvent> = {}) {
  it('rejects active banned sessions', async () => {
    authMock.getSession.mockResolvedValueOnce({
      user: {
        ...testUser,
        banned: true,
        banExpires: null
      },
      session: { id: 'session-1' }
    })
    const handler = await importRoute(path)

    await expect(handler(makeEvent(event))).rejects.toMatchObject({
      statusCode: 401,
      message: 'Account is banned'
    })
    expectNoServiceCalls()
  })
}
