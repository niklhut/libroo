import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { user } from './auth'

// Domain tables for Libroo

export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  author: text('author').notNull(),
  isbn: text('isbn'),
  coverPath: text('cover_path'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
})

export const loans = sqliteTable('loans', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  borrowerName: text('borrower_name').notNull(),
  dateLoaned: integer('date_loaned', { mode: 'timestamp' }).notNull(),
  dateReturned: integer('date_returned', { mode: 'timestamp' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
})
