import { Context, Effect, Layer } from 'effect'
import type { ActiveLoanExistsError, InvalidInviteError, LoanNotFoundError, LoanUnavailableError } from '../repositories/lending.repository'
import { LendingRepository } from '../repositories/lending.repository'
import type { BookNotFoundError } from '../repositories/book.repository'
import { DatabaseError } from '../repositories/book.repository'

interface CreateLoanInput {
  borrowerDisplayName: string
  borrowerEmail?: string | null
  dueAt?: Date | null
  ownerNote?: string | null
}

interface CreateLoanResult {
  loan: OwnerLoan
  inviteUrl: string
}

export interface LendingServiceInterface {
  createLoan: (
    userBookId: string,
    ownerUserId: string,
    input: CreateLoanInput
  ) => Effect.Effect<CreateLoanResult, BookNotFoundError | ActiveLoanExistsError | DatabaseError, DbService>
  returnLoan: (loanId: string, ownerUserId: string) => Effect.Effect<OwnerLoan, LoanNotFoundError | DatabaseError, DbService>
  cancelLoan: (loanId: string, ownerUserId: string) => Effect.Effect<OwnerLoan, LoanNotFoundError | DatabaseError, DbService>
  listOwnerLoans: (ownerUserId: string) => Effect.Effect<OwnerLoan[], DatabaseError, DbService>
  listBorrowedBooks: (borrowerUserId: string) => Effect.Effect<BorrowedBook[], DatabaseError, DbService>
  getInvitePreview: (token: string, viewerUserId?: string | null) => Effect.Effect<InvitePreview, InvalidInviteError | DatabaseError, DbService>
  acceptInvite: (token: string, borrowerUserId: string) => Effect.Effect<BorrowedBook, InvalidInviteError | LoanUnavailableError | DatabaseError, DbService>
}

export class LendingService extends Context.Tag('LendingService')<LendingService, LendingServiceInterface>() { }

function createAcceptToken(): string {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
}

function hashToken(token: string): Effect.Effect<string, DatabaseError> {
  return Effect.tryPromise({
    try: async () => {
      const bytes = new TextEncoder().encode(token)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    },
    catch: error => new DatabaseError({
      message: `Failed to hash invitation token: ${error}`,
      operation: 'hashToken'
    })
  })
}

export const LendingServiceLive = Layer.effect(
  LendingService,
  Effect.gen(function* () {
    const lendingRepo = yield* LendingRepository

    return {
      createLoan: (userBookId, ownerUserId, input) =>
        Effect.gen(function* () {
          const token = createAcceptToken()
          const acceptTokenHash = yield* hashToken(token)
          const loan = yield* lendingRepo.createLoan({
            userBookId,
            ownerUserId,
            borrowerDisplayName: input.borrowerDisplayName,
            borrowerEmail: input.borrowerEmail ?? null,
            dueAt: input.dueAt ?? null,
            ownerNote: input.ownerNote ?? null,
            acceptTokenHash
          })

          const inviteUrl = `/i/${token}`
          return {
            loan: {
              ...loan,
              inviteUrl
            },
            inviteUrl
          }
        }),

      returnLoan: (loanId, ownerUserId) =>
        lendingRepo.returnLoan(loanId, ownerUserId),

      cancelLoan: (loanId, ownerUserId) =>
        lendingRepo.cancelLoan(loanId, ownerUserId),

      listOwnerLoans: ownerUserId =>
        lendingRepo.listOwnerLoans(ownerUserId),

      listBorrowedBooks: borrowerUserId =>
        lendingRepo.listBorrowedBooks(borrowerUserId),

      getInvitePreview: (token, viewerUserId = null) =>
        Effect.gen(function* () {
          const tokenHash = yield* hashToken(token)
          return yield* lendingRepo.getInvitePreviewByHash(tokenHash, viewerUserId)
        }),

      acceptInvite: (token, borrowerUserId) =>
        Effect.gen(function* () {
          const tokenHash = yield* hashToken(token)
          return yield* lendingRepo.acceptInviteByHash(tokenHash, borrowerUserId)
        })
    }
  })
)

export const createLoanForBook = (userBookId: string, ownerUserId: string, input: CreateLoanInput) =>
  Effect.flatMap(LendingService, service => service.createLoan(userBookId, ownerUserId, input))

export const returnLoanForOwner = (loanId: string, ownerUserId: string) =>
  Effect.flatMap(LendingService, service => service.returnLoan(loanId, ownerUserId))

export const cancelLoanForOwner = (loanId: string, ownerUserId: string) =>
  Effect.flatMap(LendingService, service => service.cancelLoan(loanId, ownerUserId))

export const listLoansForOwner = (ownerUserId: string) =>
  Effect.flatMap(LendingService, service => service.listOwnerLoans(ownerUserId))

export const listBooksLentToUser = (borrowerUserId: string) =>
  Effect.flatMap(LendingService, service => service.listBorrowedBooks(borrowerUserId))

export const getInvitePreview = (token: string, viewerUserId?: string | null) =>
  Effect.flatMap(LendingService, service => service.getInvitePreview(token, viewerUserId))

export const acceptBookInvite = (token: string, borrowerUserId: string) =>
  Effect.flatMap(LendingService, service => service.acceptInvite(token, borrowerUserId))
