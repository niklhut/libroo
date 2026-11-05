import { Context, Effect, Layer } from 'effect'
import { and, eq, exists, isNull, not, sql } from 'drizzle-orm'
import { authors, bookAuthors, books, bookSystemTags, loans, userBooks } from '../db/schema'
import { DbService, type AtomicDbStatement, type AtomicDbStatements } from '../services/db.service'
import { DatabaseError } from './book.repository'
import type { BookEditSchema } from '../../shared/utils/schemas'

export class BookEditRepository extends Context.Service<BookEditRepository, {
  isCoverReferenced: (path: string) => Effect.Effect<boolean, DatabaseError>
  replace: (userId: string, userBookId: string, input: BookEditSchema, coverPath: string | null) => Effect.Effect<boolean, DatabaseError>
}>()('BookEditRepository') {}

export const BookEditRepositoryLive = Layer.effect(BookEditRepository, Effect.gen(function* () {
  const database = yield* DbService
  return {
    isCoverReferenced: path => Effect.tryPromise({
      try: async () => {
        const rows = await database.db.select({ id: books.id }).from(books).where(eq(books.coverPath, path))
          .unionAll(database.db.select({ id: loans.id }).from(loans).where(eq(loans.snapshotCoverPath, path)))
          .limit(1)
        return rows.length > 0
      },
      catch: error => new DatabaseError({ message: `Could not check cover references: ${error}`, operation: 'book.edit.coverReferences' })
    }),
    replace: (userId, userBookId, input, coverPath) => Effect.tryPromise({
      try: async () => {
        const bookId = crypto.randomUUID()
        const now = new Date()
        // Creating a private replacement preserves shared canonical metadata and
        // isolates this entry from any enrichment already running on the old row.
        const predicate = and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), eq(userBooks.bookId, input.expectedBookId), isNull(userBooks.removedAt))
        const rows = await database.executeAtomic((db) => {
          const statements: AtomicDbStatement[] = [db.insert(books).select(db.select({
            id: sql<string>`${bookId}`.as('id'), isbn: sql<string | null>`${input.isbn}`.as('isbn'), title: sql<string>`${input.title}`.as('title'),
            coverPath: sql<string | null>`${coverPath}`.as('cover_path'), openLibraryKey: sql<string | null>`null`.as('open_library_key'), workKey: sql<string | null>`null`.as('work_key'),
            openLibraryMetadata: sql<null>`null`.as('open_library_metadata'), description: sql<string | null>`${input.description}`.as('description'),
            publishDate: sql<string | null>`${input.publishDate}`.as('publish_date'), publishers: sql<string | null>`${input.publisher}`.as('publishers'),
            numberOfPages: sql<number | null>`${input.numberOfPages}`.as('number_of_pages'), source: sql<'manual'>`'manual'`.as('source'),
            entrySource: sql<'manual_entry'>`'manual_entry'`.as('entry_source'), metadataProviderIsbn: sql<null>`null`.as('metadata_provider_isbn'),
            createdByUserId: sql<string>`${userId}`.as('created_by_user_id'), createdAt: sql<number>`${Math.floor(now.getTime() / 1000)}`.as('created_at')
          }).from(userBooks).where(predicate))]
          for (const [index, name] of input.authors.entries()) {
            const normalized = name.toLowerCase()
            statements.push(db.insert(authors).values({ id: crypto.randomUUID(), name, normalizedName: normalized, createdAt: now, updatedAt: now }).onConflictDoNothing())
            statements.push(db.insert(bookAuthors).select(db.select({
              bookId: books.id,
              authorId: authors.id,
              sortOrder: sql<number>`${index}`.as('sort_order'),
              createdAt: sql<number>`${Math.floor(now.getTime() / 1000)}`.as('created_at')
            }).from(books).innerJoin(authors, eq(authors.normalizedName, normalized)).where(eq(books.id, bookId))))
          }
          statements.push(db.insert(bookSystemTags).select(db.select({
            bookId: sql<string>`${bookId}`.as('book_id'), tagId: bookSystemTags.tagId,
            createdAt: bookSystemTags.createdAt, updatedAt: bookSystemTags.updatedAt
          }).from(bookSystemTags).innerJoin(books, eq(books.id, bookId)).where(eq(bookSystemTags.bookId, input.expectedBookId))))
          statements.push(db.update(userBooks).set({ bookId }).where(predicate).returning({ id: userBooks.id }))
          statements.push(db.delete(books).where(and(
            eq(books.id, input.expectedBookId), eq(books.source, 'manual'), eq(books.createdByUserId, userId),
            not(exists(db.select({ id: userBooks.id }).from(userBooks).where(eq(userBooks.bookId, input.expectedBookId))))
          )))
          return [statements[0]!, ...statements.slice(1)] as AtomicDbStatements
        })
        return (rows.at(-2) as Array<{ id: string }>).length === 1
      },
      catch: error => new DatabaseError({ message: `Could not save book changes: ${error}`, operation: 'book.edit' })
    })
  }
}))
