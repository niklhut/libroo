import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { user } from './auth'

// Domain tables for Libroo

// Shared book metadata (deduplicated by ISBN)
// Multiple users can reference the same book entry
export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  isbn: text('isbn').unique(), // Unique constraint for deduplication
  title: text('title').notNull(),
  author: text('author').notNull(),
  coverPath: text('cover_path'), // Local blob storage path
  openLibraryKey: text('open_library_key'), // OpenLibrary work/edition key
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
})

// User's book ownership (junction table)
// Links users to books they own
export const userBooks = sqliteTable('user_books', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull()
})

// Loans track when a user's book is lent out
export const loans = sqliteTable('loans', {
  id: text('id').primaryKey(),
  userBookId: text('user_book_id').notNull().references(() => userBooks.id, { onDelete: 'cascade' }),
  borrowerName: text('borrower_name').notNull(),
  dateLoaned: integer('date_loaned', { mode: 'timestamp' }).notNull(),
  dateReturned: integer('date_returned', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
})
