import { Context, Data, Effect, Layer } from 'effect'
import { and, desc, eq, exists, isNotNull, isNull, not, or, sql } from 'drizzle-orm'
import { authors, bookAuthors, books, loans, user, userBooks } from 'hub:db:schema'
import { DbService } from '../services/db.service'
import { BookNotFoundError, BookNotOwnedError, DatabaseError } from './book.repository'
import type { LibraryState } from '../../shared/types/book'

export class LoanNotFoundError extends Data.TaggedError('LoanNotFoundError')<{
  loanId?: string
}> { }

export class ActiveLoanExistsError extends Data.TaggedError('ActiveLoanExistsError')<{
  userBookId: string
}> { }

export class InvalidInviteError extends Data.TaggedError('InvalidInviteError')<{
  message: string
}> { }

export class LoanUnavailableError extends Data.TaggedError('LoanUnavailableError')<{
  message: string
}> { }

export interface LoanCreateInput {
  userBookId: string
  ownerUserId: string
  borrowerDisplayName: string
  borrowerEmail: string | null
  note: string | null
  dueAt: Date | null
  acceptTokenHash: string
  inviteEmailStatus: 'pending' | 'sent' | 'failed' | null
}

export interface OwnerActiveLoanInvite {
  id: string
  acceptTokenHash: string | null
  borrowerEmail: string | null
  borrowerDisplayName: string
  dueAt: Date | null
  snapshotBookTitle: string
  snapshotBookAuthor: string
  snapshotOwnerName: string
}

export interface LoanCreateResult {
  loan: OwnerLoan
  acceptTokenHash: string
}

interface LoanSnapshotSource {
  title: string
  author: string
  coverPath: string | null
  ownerName: string
}

export interface LendingRepositoryInterface {
  createLoan: (input: LoanCreateInput) => Effect.Effect<OwnerLoan, BookNotFoundError | BookNotOwnedError | ActiveLoanExistsError | DatabaseError, DbService>
  getActiveLoanInviteForOwner: (loanId: string, ownerUserId: string) => Effect.Effect<OwnerActiveLoanInvite, LoanNotFoundError | DatabaseError, DbService>
  updateInviteEmailDelivery: (loanId: string, ownerUserId: string, status: 'pending' | 'sent' | 'failed' | null, lastAttemptAt: Date | null) => Effect.Effect<OwnerLoan, LoanNotFoundError | DatabaseError, DbService>
  updateLoanNote: (loanId: string, ownerUserId: string, note: string | null) => Effect.Effect<OwnerLoan, LoanNotFoundError | DatabaseError, DbService>
  getActiveLoanForBook: (userBookId: string, ownerUserId: string) => Effect.Effect<OwnerLoan | null, DatabaseError, DbService>
  returnLoan: (loanId: string, ownerUserId: string) => Effect.Effect<OwnerLoan, LoanNotFoundError | DatabaseError, DbService>
  cancelLoan: (loanId: string, ownerUserId: string) => Effect.Effect<OwnerLoan, LoanNotFoundError | DatabaseError, DbService>
  listOwnerLoans: (ownerUserId: string) => Effect.Effect<OwnerLoan[], DatabaseError, DbService>
  listBorrowedBooks: (borrowerUserId: string) => Effect.Effect<BorrowedBook[], DatabaseError, DbService>
  userHasLoanCoverAccess: (userId: string, pathname: string) => Effect.Effect<boolean, DatabaseError, DbService>
  getInvitePreviewByHash: (tokenHash: string, viewerUserId?: string | null) => Effect.Effect<InvitePreview, InvalidInviteError | DatabaseError, DbService>
  acceptInviteByHash: (tokenHash: string, borrowerUserId: string) => Effect.Effect<BorrowedBook, InvalidInviteError | LoanUnavailableError | DatabaseError, DbService>
}

export class LendingRepository extends Context.Tag('LendingRepository')<LendingRepository, LendingRepositoryInterface>() { }

function generateId(): string {
  return crypto.randomUUID()
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('SQLITE_CONSTRAINT')
    || message.includes('UNIQUE constraint failed')
    || message.includes('loans_active_user_book_unique')
    || message.includes('loans_accept_token_hash_unique')
}

export const LendingRepositoryLive = Layer.effect(
  LendingRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    const snapshotForBook = (userBookId: string, ownerUserId: string) =>
      Effect.gen(function* () {
        const rows = yield* Effect.tryPromise({
          try: () => dbService.db
            .select({
              title: books.title,
              author: authors.name,
              coverPath: books.coverPath,
              ownerName: user.name,
              libraryState: userBooks.libraryState
            })
            .from(userBooks)
            .innerJoin(books, eq(userBooks.bookId, books.id))
            .leftJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
            .leftJoin(authors, eq(bookAuthors.authorId, authors.id))
            .innerJoin(user, eq(userBooks.userId, user.id))
            .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, ownerUserId), isNull(userBooks.removedAt)))
            .orderBy(bookAuthors.sortOrder)
            .limit(1),
          catch: error => new DatabaseError({
            message: `Failed to load book snapshot: ${error}`,
            operation: 'snapshotForBook'
          })
        })

        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
        }

        if (row.libraryState !== 'owned') {
          return yield* Effect.fail(new BookNotOwnedError({
            userBookId,
            libraryState: row.libraryState as LibraryState
          }))
        }

        return {
          title: row.title,
          author: row.author ?? 'Unknown Author',
          coverPath: row.coverPath,
          ownerName: row.ownerName
        } satisfies LoanSnapshotSource
      })

    const toOwnerLoan = (row: typeof loans.$inferSelect & { acceptedByName?: string | null }): OwnerLoan => ({
      id: row.id,
      userBookId: row.userBookId,
      ownerDisplayName: row.snapshotOwnerName,
      borrowerDisplayName: row.borrowerDisplayName,
      acceptedByName: row.acceptedByName ?? null,
      status: row.status,
      loanedAt: row.loanedAt,
      dueAt: row.dueAt ?? null,
      returnedAt: row.returnedAt ?? null,
      canceledAt: row.canceledAt ?? null,
      acceptedAt: row.acceptedAt ?? null,
      note: row.note ?? null,
      deliveryStatus: row.inviteEmailStatus === 'sent' ? 'sent' : row.inviteEmailStatus === 'failed' ? 'failed' : row.inviteEmailStatus === 'pending' ? 'unavailable' : 'not_requested',
      book: {
        title: row.snapshotBookTitle,
        author: row.snapshotBookAuthor,
        coverPath: row.snapshotCoverPath
      },
      inviteUrl: null
    })

    const toBorrowedBook = (row: Pick<typeof loans.$inferSelect, 'id' | 'status' | 'snapshotBookTitle' | 'snapshotBookAuthor' | 'snapshotCoverPath' | 'snapshotOwnerName' | 'loanedAt' | 'dueAt' | 'returnedAt' | 'acceptedAt'> & { ownerRemoved: Date | null }): BorrowedBook => ({
      id: row.id,
      status: row.status,
      title: row.snapshotBookTitle,
      author: row.snapshotBookAuthor,
      coverPath: row.snapshotCoverPath,
      ownerName: row.snapshotOwnerName,
      loanedAt: row.loanedAt,
      dueAt: row.dueAt ?? null,
      returnedAt: row.returnedAt ?? null,
      acceptedAt: row.acceptedAt!,
      ownerRemoved: Boolean(row.ownerRemoved)
    })

    return {
      createLoan: input =>
        Effect.gen(function* () {
          const snapshot = yield* snapshotForBook(input.userBookId, input.ownerUserId)
          const existing = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({ id: loans.id })
              .from(loans)
              .where(and(eq(loans.userBookId, input.userBookId), eq(loans.ownerUserId, input.ownerUserId), eq(loans.status, 'active')))
              .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to check active loan: ${error}`,
              operation: 'createLoan.checkActive'
            })
          })

          if (existing[0]) {
            return yield* Effect.fail(new ActiveLoanExistsError({ userBookId: input.userBookId }))
          }

          const now = new Date()
          const loan: typeof loans.$inferInsert = {
            id: generateId(),
            ownerUserId: input.ownerUserId,
            userBookId: input.userBookId,
            borrowerUserId: null,
            borrowerDisplayName: input.borrowerDisplayName,
            borrowerEmail: input.borrowerEmail,
            note: input.note,
            inviteEmailStatus: input.inviteEmailStatus,
            inviteEmailLastAttemptAt: null,
            status: 'active',
            loanedAt: now,
            dueAt: input.dueAt,
            returnedAt: null,
            canceledAt: null,
            snapshotBookTitle: snapshot.title,
            snapshotBookAuthor: snapshot.author,
            snapshotCoverPath: snapshot.coverPath,
            snapshotOwnerName: snapshot.ownerName,
            acceptTokenHash: input.acceptTokenHash,
            acceptedAt: null,
            createdAt: now,
            updatedAt: now
          }

          const inserted = yield* Effect.tryPromise({
            try: () => dbService.db.insert(loans).values(loan).returning(),
            catch: error => isUniqueConstraintError(error)
              ? new ActiveLoanExistsError({ userBookId: input.userBookId })
              : new DatabaseError({
                  message: `Failed to create loan: ${error}`,
                  operation: 'createLoan.insert'
                })
          })

          return toOwnerLoan(inserted[0]!)
        }),

      getActiveLoanInviteForOwner: (loanId, ownerUserId) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db.select({
              id: loans.id,
              acceptTokenHash: loans.acceptTokenHash,
              borrowerEmail: loans.borrowerEmail,
              borrowerDisplayName: loans.borrowerDisplayName,
              dueAt: loans.dueAt,
              snapshotBookTitle: loans.snapshotBookTitle,
              snapshotBookAuthor: loans.snapshotBookAuthor,
              snapshotOwnerName: loans.snapshotOwnerName
            }).from(loans).where(and(eq(loans.id, loanId), eq(loans.ownerUserId, ownerUserId), eq(loans.status, 'active'))).limit(1),
            catch: error => new DatabaseError({ message: `Failed to load loan invite: ${error}`, operation: 'getActiveLoanInviteForOwner' })
          })
          if (!rows[0]) return yield* Effect.fail(new LoanNotFoundError({ loanId }))
          return rows[0]
        }),

      updateInviteEmailDelivery: (loanId, ownerUserId, status, lastAttemptAt) =>
        Effect.gen(function* () {
          const now = new Date()
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db.update(loans).set({
              inviteEmailStatus: status,
              inviteEmailLastAttemptAt: lastAttemptAt,
              updatedAt: now
            }).where(and(eq(loans.id, loanId), eq(loans.ownerUserId, ownerUserId), eq(loans.status, 'active'))).returning(),
            catch: error => new DatabaseError({ message: `Failed to update loan invite delivery: ${error}`, operation: 'updateInviteEmailDelivery' })
          })
          if (!rows[0]) return yield* Effect.fail(new LoanNotFoundError({ loanId }))
          return toOwnerLoan(rows[0])
        }),

      updateLoanNote: (loanId, ownerUserId, note) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db.update(loans).set({ note, updatedAt: new Date() })
              .where(and(eq(loans.id, loanId), eq(loans.ownerUserId, ownerUserId), eq(loans.status, 'active'))).returning(),
            catch: error => new DatabaseError({ message: `Failed to update loan note: ${error}`, operation: 'updateLoanNote' })
          })
          if (!rows[0]) return yield* Effect.fail(new LoanNotFoundError({ loanId }))
          return toOwnerLoan(rows[0])
        }),

      getActiveLoanForBook: (userBookId, ownerUserId) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select()
              .from(loans)
              .where(and(eq(loans.userBookId, userBookId), eq(loans.ownerUserId, ownerUserId), eq(loans.status, 'active')))
              .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to load active loan: ${error}`,
              operation: 'getActiveLoanForBook'
            })
          })

          return rows[0] ? toOwnerLoan(rows[0]) : null
        }),

      returnLoan: (loanId, ownerUserId) =>
        Effect.gen(function* () {
          const now = new Date()
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .update(loans)
              .set({
                status: 'returned',
                returnedAt: now,
                acceptTokenHash: null,
                updatedAt: now
              })
              .where(and(eq(loans.id, loanId), eq(loans.ownerUserId, ownerUserId), eq(loans.status, 'active')))
              .returning(),
            catch: error => new DatabaseError({
              message: `Failed to return loan: ${error}`,
              operation: 'returnLoan'
            })
          })

          if (!rows[0]) {
            return yield* Effect.fail(new LoanNotFoundError({ loanId }))
          }

          return toOwnerLoan(rows[0])
        }),

      cancelLoan: (loanId, ownerUserId) =>
        Effect.gen(function* () {
          const now = new Date()
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .update(loans)
              .set({
                status: 'canceled',
                canceledAt: now,
                acceptTokenHash: null,
                updatedAt: now
              })
              .where(and(eq(loans.id, loanId), eq(loans.ownerUserId, ownerUserId), eq(loans.status, 'active'), isNull(loans.acceptedAt)))
              .returning(),
            catch: error => new DatabaseError({
              message: `Failed to cancel loan: ${error}`,
              operation: 'cancelLoan'
            })
          })

          if (!rows[0]) {
            return yield* Effect.fail(new LoanNotFoundError({ loanId }))
          }

          return toOwnerLoan(rows[0])
        }),

      listOwnerLoans: ownerUserId =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({
                id: loans.id,
                ownerUserId: loans.ownerUserId,
                userBookId: loans.userBookId,
                borrowerUserId: loans.borrowerUserId,
                borrowerDisplayName: loans.borrowerDisplayName,
                borrowerEmail: loans.borrowerEmail,
                note: loans.note,
                inviteEmailStatus: loans.inviteEmailStatus,
                inviteEmailLastAttemptAt: loans.inviteEmailLastAttemptAt,
                status: loans.status,
                loanedAt: loans.loanedAt,
                dueAt: loans.dueAt,
                returnedAt: loans.returnedAt,
                canceledAt: loans.canceledAt,
                snapshotBookTitle: loans.snapshotBookTitle,
                snapshotBookAuthor: loans.snapshotBookAuthor,
                snapshotCoverPath: loans.snapshotCoverPath,
                snapshotOwnerName: loans.snapshotOwnerName,
                acceptTokenHash: loans.acceptTokenHash,
                acceptedAt: loans.acceptedAt,
                createdAt: loans.createdAt,
                updatedAt: loans.updatedAt,
                acceptedByName: user.name
              })
              .from(loans)
              .leftJoin(user, eq(loans.borrowerUserId, user.id))
              .where(eq(loans.ownerUserId, ownerUserId))
              .orderBy(desc(loans.loanedAt)),
            catch: error => new DatabaseError({
              message: `Failed to list owner loans: ${error}`,
              operation: 'listOwnerLoans'
            })
          })

          return rows.map(toOwnerLoan)
        }),

      listBorrowedBooks: borrowerUserId =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({
                id: loans.id,
                status: loans.status,
                snapshotBookTitle: loans.snapshotBookTitle,
                snapshotBookAuthor: loans.snapshotBookAuthor,
                snapshotCoverPath: loans.snapshotCoverPath,
                snapshotOwnerName: loans.snapshotOwnerName,
                loanedAt: loans.loanedAt,
                dueAt: loans.dueAt,
                returnedAt: loans.returnedAt,
                acceptedAt: loans.acceptedAt,
                ownerRemoved: userBooks.removedAt
              })
              .from(loans)
              .leftJoin(userBooks, eq(loans.userBookId, userBooks.id))
              .where(and(eq(loans.borrowerUserId, borrowerUserId), isNotNull(loans.acceptedAt)))
              .orderBy(desc(loans.loanedAt)),
            catch: error => new DatabaseError({
              message: `Failed to list borrowed books: ${error}`,
              operation: 'listBorrowedBooks'
            })
          })

          return rows.map(row => ({
            id: row.id,
            status: row.status,
            title: row.snapshotBookTitle,
            author: row.snapshotBookAuthor,
            coverPath: row.snapshotCoverPath,
            ownerName: row.snapshotOwnerName,
            loanedAt: row.loanedAt,
            dueAt: row.dueAt ?? null,
            returnedAt: row.returnedAt ?? null,
            acceptedAt: row.acceptedAt!,
            ownerRemoved: Boolean(row.ownerRemoved)
          }))
        }),

      userHasLoanCoverAccess: (userId, pathname) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({ id: loans.id })
              .from(loans)
              .where(and(
                eq(loans.snapshotCoverPath, pathname),
                or(
                  eq(loans.ownerUserId, userId),
                  and(
                    eq(loans.borrowerUserId, userId),
                    not(eq(loans.status, 'canceled')),
                    isNotNull(loans.acceptedAt)
                  )
                )
              ))
              .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to validate loan cover access: ${error}`,
              operation: 'userHasLoanCoverAccess'
            })
          })

          return Boolean(rows[0])
        }),

      getInvitePreviewByHash: (tokenHash, viewerUserId = null) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({
                ownerUserId: loans.ownerUserId,
                status: loans.status,
                borrowerUserId: loans.borrowerUserId,
                acceptedAt: loans.acceptedAt,
                snapshotBookTitle: loans.snapshotBookTitle,
                snapshotBookAuthor: loans.snapshotBookAuthor,
                snapshotCoverPath: loans.snapshotCoverPath,
                snapshotOwnerName: loans.snapshotOwnerName,
                dueAt: loans.dueAt,
                ownerRemovedAt: userBooks.removedAt
              })
              .from(loans)
              .innerJoin(userBooks, and(eq(loans.userBookId, userBooks.id), eq(loans.ownerUserId, userBooks.userId)))
              .where(eq(loans.acceptTokenHash, tokenHash))
              .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to load invite: ${error}`,
              operation: 'getInvitePreviewByHash'
            })
          })

          const row = rows[0]
          if (!row || row.ownerRemovedAt) {
            return yield* Effect.fail(new InvalidInviteError({ message: 'This invitation is no longer available.' }))
          }

          const isOwnInvite = Boolean(viewerUserId && viewerUserId === row.ownerUserId)
          const canAccept = row.status === 'active' && !row.borrowerUserId && !row.acceptedAt && !isOwnInvite
          return {
            title: row.snapshotBookTitle,
            author: row.snapshotBookAuthor,
            coverPath: row.snapshotCoverPath,
            ownerName: row.snapshotOwnerName,
            dueAt: row.dueAt ?? null,
            canAccept,
            isOwnInvite,
            status: canAccept ? 'available' : row.acceptedAt ? 'already_accepted' : 'unavailable'
          }
        }),

      acceptInviteByHash: (tokenHash, borrowerUserId) =>
        Effect.gen(function* () {
          const now = new Date()
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .update(loans)
              .set({
                borrowerUserId,
                acceptedAt: now,
                acceptTokenHash: null,
                updatedAt: now
              })
              .where(and(
                eq(loans.acceptTokenHash, tokenHash),
                eq(loans.status, 'active'),
                isNull(loans.borrowerUserId),
                isNull(loans.acceptedAt),
                not(eq(loans.ownerUserId, borrowerUserId)),
                exists(
                  dbService.db
                    .select({ value: sql`1` })
                    .from(userBooks)
                    .where(and(
                      eq(userBooks.id, loans.userBookId),
                      eq(userBooks.userId, loans.ownerUserId),
                      isNull(userBooks.removedAt)
                    ))
                )
              ))
              .returning({
                id: loans.id,
                status: loans.status,
                snapshotBookTitle: loans.snapshotBookTitle,
                snapshotBookAuthor: loans.snapshotBookAuthor,
                snapshotCoverPath: loans.snapshotCoverPath,
                snapshotOwnerName: loans.snapshotOwnerName,
                loanedAt: loans.loanedAt,
                dueAt: loans.dueAt,
                returnedAt: loans.returnedAt,
                acceptedAt: loans.acceptedAt
              }),
            catch: error => new DatabaseError({
              message: `Failed to accept invite: ${error}`,
              operation: 'acceptInviteByHash'
            })
          })

          const accepted = rows[0]
          if (!accepted) {
            return yield* Effect.fail(new InvalidInviteError({ message: 'This invitation is no longer available.' }))
          }

          return toBorrowedBook({ ...accepted, ownerRemoved: null })
        })
    }
  })
)

export const createLoan = (input: LoanCreateInput) =>
  Effect.flatMap(LendingRepository, repo => repo.createLoan(input))

export const returnLoan = (loanId: string, ownerUserId: string) =>
  Effect.flatMap(LendingRepository, repo => repo.returnLoan(loanId, ownerUserId))

export const cancelLoan = (loanId: string, ownerUserId: string) =>
  Effect.flatMap(LendingRepository, repo => repo.cancelLoan(loanId, ownerUserId))

export const getActiveLoanInviteForOwner = (loanId: string, ownerUserId: string) =>
  Effect.flatMap(LendingRepository, repo => repo.getActiveLoanInviteForOwner(loanId, ownerUserId))

export const updateInviteEmailDelivery = (loanId: string, ownerUserId: string, status: 'pending' | 'sent' | 'failed' | null, lastAttemptAt: Date | null) =>
  Effect.flatMap(LendingRepository, repo => repo.updateInviteEmailDelivery(loanId, ownerUserId, status, lastAttemptAt))

export const listOwnerLoans = (ownerUserId: string) =>
  Effect.flatMap(LendingRepository, repo => repo.listOwnerLoans(ownerUserId))

export const listBorrowedBooks = (borrowerUserId: string) =>
  Effect.flatMap(LendingRepository, repo => repo.listBorrowedBooks(borrowerUserId))

export const userHasLoanCoverAccess = (userId: string, pathname: string) =>
  Effect.flatMap(LendingRepository, repo => repo.userHasLoanCoverAccess(userId, pathname))

export const getInvitePreviewByHash = (tokenHash: string) =>
  Effect.flatMap(LendingRepository, repo => repo.getInvitePreviewByHash(tokenHash))

export const acceptInviteByHash = (tokenHash: string, borrowerUserId: string) =>
  Effect.flatMap(LendingRepository, repo => repo.acceptInviteByHash(tokenHash, borrowerUserId))
