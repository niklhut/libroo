import { Context, Data, Effect, Layer } from 'effect'
import type { ActiveLoanExistsError, InvalidInviteError, LoanNotFoundError, OwnerActiveLoanInvite } from '../repositories/lending.repository'
import { LendingRepository, LoanUnavailableError } from '../repositories/lending.repository'
import type { BookNotFoundError, BookNotOwnedError } from '../repositories/book.repository'
import { DatabaseError } from '../repositories/book.repository'
import type { DbService } from './db.service'
import type { EmailService } from './email.service'
import { sendEmail } from './email.service'
import { getEmailCapabilities } from '../utils/email-capabilities'
import { escapeHtml } from '../utils/html-escape'
import type { LoanInviteUrlConfigError } from '../utils/loan-invite-url'
import { buildLoanInviteUrl } from '../utils/loan-invite-url'
import type { LoanInviteDeliveryStatus, OwnerLoan, BorrowerSuggestion } from '../../shared/types/book'
import {
  BORROWER_SUGGESTION_LIMIT,
  BORROWER_SUGGESTION_MIN_QUERY_LENGTH,
  normalizeBorrowerEmail,
  normalizeBorrowerName
} from '../../shared/utils/borrower'

interface CreateLoanInput {
  borrowerDisplayName: string
  borrowerEmail?: string | null
  dueAt?: Date | null
  note?: string | null
}

interface CreateLoanResult {
  loan: OwnerLoan
  inviteUrl: string
  deliveryStatus: LoanInviteDeliveryStatus
}

export class LoanInviteDeliveryError extends Data.TaggedError('LoanInviteDeliveryError')<{
  message: string
}> { }

export interface LendingServiceInterface {
  createLoan: (userBookId: string, ownerUserId: string, input: CreateLoanInput) => Effect.Effect<CreateLoanResult, BookNotFoundError | BookNotOwnedError | ActiveLoanExistsError | LoanNotFoundError | LoanUnavailableError | DatabaseError | LoanInviteUrlConfigError, DbService | EmailService>
  resendLoanInvite: (loanId: string, ownerUserId: string, token: string) => Effect.Effect<{ deliveryStatus: LoanInviteDeliveryStatus }, LoanNotFoundError | LoanUnavailableError | DatabaseError | LoanInviteUrlConfigError, DbService | EmailService>
  returnLoan: (loanId: string, ownerUserId: string) => Effect.Effect<OwnerLoan, LoanNotFoundError | DatabaseError, DbService>
  cancelLoan: (loanId: string, ownerUserId: string) => Effect.Effect<OwnerLoan, LoanNotFoundError | DatabaseError, DbService>
  deleteLoan: (loanId: string, ownerUserId: string) => Effect.Effect<OwnerLoan, LoanNotFoundError | LoanUnavailableError | DatabaseError, DbService>
  listBorrowerSuggestions: (ownerUserId: string, query: string) => Effect.Effect<BorrowerSuggestion[], DatabaseError, DbService>
  updateLoanNote: (loanId: string, ownerUserId: string, note: string | null) => Effect.Effect<OwnerLoan, LoanNotFoundError | DatabaseError, DbService>
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
    catch: error => new DatabaseError({ message: `Failed to hash invitation token: ${error}`, operation: 'hashToken' })
  })
}

function emailMessage(invite: OwnerActiveLoanInvite, email: string, inviteUrl: string) {
  const dueDate = invite.dueAt?.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return {
    to: email,
    subject: `Libroo invitation: ${invite.snapshotBookTitle}`,
    text: [
      `Hi ${invite.borrowerDisplayName},`,
      '',
      `${invite.snapshotOwnerName} has lent you “${invite.snapshotBookTitle}” by ${invite.snapshotBookAuthor}.`,
      dueDate ? `Due date: ${dueDate}` : null,
      '',
      `Accept this loan: ${inviteUrl}`
    ].filter((value): value is string => value !== null).join('\n'),
    html: [
      `<p>Hi ${escapeHtml(invite.borrowerDisplayName)},</p>`,
      `<p>${escapeHtml(invite.snapshotOwnerName)} has lent you <strong>${escapeHtml(invite.snapshotBookTitle)}</strong> by ${escapeHtml(invite.snapshotBookAuthor)}.</p>`,
      dueDate ? `<p>Due date: ${escapeHtml(dueDate)}.</p>` : '',
      `<p><a href="${escapeHtml(inviteUrl)}">Accept this loan</a></p>`
    ].join('')
  }
}

export const LendingServiceLive = Layer.effect(
  LendingService,
  Effect.gen(function* () {
    const lendingRepo = yield* LendingRepository

    const sendInvite = (loanId: string, ownerUserId: string, invite: OwnerActiveLoanInvite, token: string) =>
      Effect.gen(function* () {
        if (!invite.borrowerEmail) {
          return yield* Effect.fail(new LoanUnavailableError({ message: 'This loan has no invitation email.' }))
        }
        if (!getEmailCapabilities().inviteEmailEnabled) {
          yield* lendingRepo.updateInviteEmailDelivery(loanId, ownerUserId, 'pending', null).pipe(
            Effect.catchAll(statusError => Effect.logError(`Could not persist pending loan invitation delivery: ${statusError.message}`))
          )
          return 'unavailable' as const
        }
        const absoluteUrl = yield* buildLoanInviteUrl(token)
        const attemptedAt = new Date()
        const deliveryStatus = yield* sendEmail(emailMessage(invite, invite.borrowerEmail, absoluteUrl)).pipe(
          Effect.mapError(() => new LoanInviteDeliveryError({ message: 'Loan invitation email delivery failed' })),
          Effect.catchAll(error =>
            Effect.logWarning(`Loan invitation email delivery failed: ${error.message}`).pipe(
              Effect.zipRight(
                lendingRepo.updateInviteEmailDelivery(loanId, ownerUserId, 'failed', attemptedAt).pipe(
                  Effect.catchAll(statusError => Effect.logError(`Could not persist failed loan invitation delivery: ${statusError.message}`))
                )
              ),
              Effect.as('failed' as const)
            )
          )
        )
        if (deliveryStatus === 'failed') return deliveryStatus

        yield* lendingRepo.updateInviteEmailDelivery(loanId, ownerUserId, 'sent', attemptedAt).pipe(
          Effect.catchAll(statusError => Effect.logError(`Could not persist sent loan invitation delivery: ${statusError.message}`))
        )
        return 'sent' as const
      })

    return {
      createLoan: (userBookId, ownerUserId, input) =>
        Effect.gen(function* () {
          const token = createAcceptToken()
          const acceptTokenHash = yield* hashToken(token)
          const borrowerEmail = input.borrowerEmail ?? null
          const borrowerNameNormalized = normalizeBorrowerName(input.borrowerDisplayName)
          const borrowerEmailNormalized = normalizeBorrowerEmail(borrowerEmail)
          const emailEnabled = getEmailCapabilities().inviteEmailEnabled
          const loan = yield* lendingRepo.createLoan({
            userBookId, ownerUserId, borrowerDisplayName: input.borrowerDisplayName, borrowerNameNormalized, borrowerEmail, borrowerEmailNormalized,
            dueAt: input.dueAt ?? null, note: input.note ?? null, acceptTokenHash,
            inviteEmailStatus: borrowerEmail ? 'pending' : null
          })
          const inviteUrl = `/i/${token}`
          if (!borrowerEmail) return { loan: { ...loan, inviteUrl, deliveryStatus: 'not_requested' }, inviteUrl, deliveryStatus: 'not_requested' as const }
          if (!emailEnabled) return { loan: { ...loan, inviteUrl, deliveryStatus: 'unavailable' }, inviteUrl, deliveryStatus: 'unavailable' as const }
          const deliveryStatus = yield* sendInvite(loan.id, ownerUserId, {
            id: loan.id, acceptTokenHash, borrowerEmail, borrowerDisplayName: loan.borrowerDisplayName,
            dueAt: loan.dueAt instanceof Date ? loan.dueAt : null, snapshotBookTitle: loan.book.title,
            snapshotBookAuthor: loan.book.author, snapshotOwnerName: loan.ownerDisplayName
          }, token)
          return { loan: { ...loan, inviteUrl, deliveryStatus }, inviteUrl, deliveryStatus }
        }),

      resendLoanInvite: (loanId, ownerUserId, token) => Effect.gen(function* () {
        const invite = yield* lendingRepo.getActiveLoanInviteForOwner(loanId, ownerUserId)
        const tokenHash = yield* hashToken(token)
        if (!invite.acceptTokenHash || invite.acceptTokenHash !== tokenHash) {
          return yield* Effect.fail(new LoanUnavailableError({ message: 'This loan invitation is unavailable.' }))
        }
        return { deliveryStatus: yield* sendInvite(loanId, ownerUserId, invite, token) }
      }),

      returnLoan: (loanId, ownerUserId) => lendingRepo.returnLoan(loanId, ownerUserId),
      cancelLoan: (loanId, ownerUserId) => lendingRepo.cancelLoan(loanId, ownerUserId),
      deleteLoan: (loanId, ownerUserId) => lendingRepo.deleteLoan(loanId, ownerUserId),
      listBorrowerSuggestions: (ownerUserId, query) => {
        const normalizedPrefix = normalizeBorrowerName(query)
        return normalizedPrefix.length < BORROWER_SUGGESTION_MIN_QUERY_LENGTH
          ? Effect.succeed([])
          : lendingRepo.listBorrowerSuggestions(ownerUserId, normalizedPrefix, BORROWER_SUGGESTION_LIMIT)
      },
      updateLoanNote: (loanId, ownerUserId, note) => lendingRepo.updateLoanNote(loanId, ownerUserId, note),
      listOwnerLoans: ownerUserId => lendingRepo.listOwnerLoans(ownerUserId),
      listBorrowedBooks: borrowerUserId => lendingRepo.listBorrowedBooks(borrowerUserId),
      getInvitePreview: (token, viewerUserId = null) => Effect.gen(function* () { return yield* lendingRepo.getInvitePreviewByHash(yield* hashToken(token), viewerUserId) }),
      acceptInvite: (token, borrowerUserId) => Effect.gen(function* () { return yield* lendingRepo.acceptInviteByHash(yield* hashToken(token), borrowerUserId) })
    }
  })
)

export const createLoanForBook = (userBookId: string, ownerUserId: string, input: CreateLoanInput) => Effect.flatMap(LendingService, service => service.createLoan(userBookId, ownerUserId, input))
export const resendLoanInviteForOwner = (loanId: string, ownerUserId: string, token: string) => Effect.flatMap(LendingService, service => service.resendLoanInvite(loanId, ownerUserId, token))
export const returnLoanForOwner = (loanId: string, ownerUserId: string) => Effect.flatMap(LendingService, service => service.returnLoan(loanId, ownerUserId))
export const cancelLoanForOwner = (loanId: string, ownerUserId: string) => Effect.flatMap(LendingService, service => service.cancelLoan(loanId, ownerUserId))
export const deleteLoanForOwner = (loanId: string, ownerUserId: string) => Effect.flatMap(LendingService, service => service.deleteLoan(loanId, ownerUserId))
export const listBorrowerSuggestionsForOwner = (ownerUserId: string, query: string) => Effect.flatMap(LendingService, service => service.listBorrowerSuggestions(ownerUserId, query))
export const updateLoanNote = (loanId: string, ownerUserId: string, note: string | null) => Effect.flatMap(LendingService, service => service.updateLoanNote(loanId, ownerUserId, note))
export const listLoansForOwner = (ownerUserId: string) => Effect.flatMap(LendingService, service => service.listOwnerLoans(ownerUserId))
export const listBooksLentToUser = (borrowerUserId: string) => Effect.flatMap(LendingService, service => service.listBorrowedBooks(borrowerUserId))
export const getInvitePreview = (token: string, viewerUserId?: string | null) => Effect.flatMap(LendingService, service => service.getInvitePreview(token, viewerUserId))
export const acceptBookInvite = (token: string, borrowerUserId: string) => Effect.flatMap(LendingService, service => service.acceptInvite(token, borrowerUserId))
