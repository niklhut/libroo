import { relations } from 'drizzle-orm'
import { book, collection, bookCollection, borrower, lending, readStatus } from './schema'
import { user } from './auth-schema'

// Book Relations
export const bookRelations = relations(book, ({ one, many }) => ({
  user: one(user, { fields: [book.userId], references: [user.id] }),
  collections: many(bookCollection),
  lendingRecords: many(lending),
  readStatuses: many(readStatus)
}))

// Collection Relations
export const collectionRelations = relations(collection, ({ one, many }) => ({
  user: one(user, { fields: [collection.userId], references: [user.id] }),
  books: many(bookCollection)
}))

// BookCollection Relations
export const bookCollectionRelations = relations(bookCollection, ({ one }) => ({
  book: one(book, { fields: [bookCollection.bookId], references: [book.id] }),
  collection: one(collection, { fields: [bookCollection.collectionId], references: [collection.id] })
}))

// Borrower Relations
export const borrowerRelations = relations(borrower, ({ one, many }) => ({
  user: one(user, { fields: [borrower.userId], references: [user.id] }),
  lendings: many(lending)
}))

// Lending Relations
export const lendingRelations = relations(lending, ({ one }) => ({
  book: one(book, { fields: [lending.bookId], references: [book.id] }),
  lender: one(user, { fields: [lending.lenderId], references: [user.id] }),
  borrower: one(borrower, { fields: [lending.borrowerId], references: [borrower.id] })
}))

// ReadStatus Relations
export const readStatusRelations = relations(readStatus, ({ one }) => ({
  book: one(book, { fields: [readStatus.bookId], references: [book.id] }),
  user: one(user, { fields: [readStatus.userId], references: [user.id] })
}))
