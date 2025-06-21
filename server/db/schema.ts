import {
  pgTable,
  text,
  uuid,
  timestamp,
  primaryKey,
  pgEnum,
  index,
  integer,
  boolean,
  unique
} from 'drizzle-orm/pg-core'
import { user } from './auth-schema'

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}

export const book = pgTable('book', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  author: text('author'),
  isbn: text('isbn'),
  coverImageUrl: text('cover_image_url'),
  publisher: text('publisher'),
  publishDate: timestamp('publish_date', { withTimezone: true }),
  pageCount: integer('page_count'),
  subjects: text('subjects').array(),
  language: text('language'),
  openLibraryWorkId: text('open_library_work_id'),
  openLibraryEditionId: text('open_library_edition_id'),
  notes: text('notes'),
  ...timestamps
}, table => [
  index('book_title_idx').on(table.title),
  index('book_author_idx').on(table.author),
  index('book_isbn_idx').on(table.isbn),
  index('book_open_library_work_id_idx').on(table.openLibraryWorkId),
  index('book_open_library_edition_id_idx').on(table.openLibraryEditionId)
])

export const collection = pgTable('collection', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  ...timestamps
}, table => [
  unique('collection_user_name_unique_idx').on(table.userId, table.name)
])

export const bookCollection = pgTable('book_collection', {
  bookId: uuid('book_id').notNull().references(() => book.id, { onDelete: 'cascade' }),
  collectionId: uuid('collection_id').notNull().references(() => collection.id, { onDelete: 'cascade' }),
  ...timestamps
}, table => [
  primaryKey({ columns: [table.bookId, table.collectionId] })
])

export const borrower = pgTable('borrower', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdByUserId: text('created_by_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  email: text('email'),
  isLinkedToUser: boolean('is_linked_to_user').default(false).notNull(),
  ...timestamps
}, table => [
  unique('borrower_user_name_unique_idx').on(table.userId, table.name)
])

export const lending = pgTable('lending', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id').notNull().references(() => book.id, { onDelete: 'cascade' }),
  lenderId: text('lender_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  borrowerId: uuid('borrower_id').notNull().references(() => borrower.id, { onDelete: 'cascade' }),
  borrowedAt: timestamp('borrowed_at', { withTimezone: true }).notNull().defaultNow(),
  returnedAt: timestamp('returned_at', { withTimezone: true }),
  isCurrentlyBorrowed: boolean('is_currently_borrowed').default(true).notNull(),
  notes: text('notes'),
  ...timestamps
}, table => [
  index('lending_book_id_idx').on(table.bookId),
  index('lending_borrower_id_idx').on(table.borrowerId),
  index('lending_lender_id_idx').on(table.lenderId)
])

export const readStatusEnum = pgEnum('read_status', ['not_started', 'reading', 'finished'])

export const readStatus = pgTable('read_status', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id').notNull().references(() => book.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  status: readStatusEnum('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  rating: integer('rating'),
  review: text('review'),
  ...timestamps
}, table => [
  unique('read_status_user_book_unique_idx').on(table.userId, table.bookId)
])
