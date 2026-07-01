import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, uniqueIndex, index, primaryKey, check } from 'drizzle-orm/sqlite-core'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { user } from './auth'

// Domain tables for Libroo

// Book metadata. Open Library rows are deduplicated by ISBN; manual rows are private candidates
// and may share an ISBN with other manual rows or the shared Open Library row.
export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  isbn: text('isbn'),
  title: text('title').notNull(),
  coverPath: text('cover_path'), // Local blob storage path
  openLibraryKey: text('open_library_key'), // OpenLibrary edition key
  workKey: text('work_key'), // OpenLibrary works key (for description)

  // Enhanced metadata from OpenLibrary
  description: text('description'),
  publishDate: text('publish_date'),
  publishers: text('publishers'),
  numberOfPages: integer('number_of_pages'),
  source: text('source', { enum: ['open_library', 'manual'] }).notNull().default('open_library'),
  createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),

  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
}, table => [
  index('books_isbn_idx').on(table.isbn),
  uniqueIndex('books_open_library_isbn_unique')
    .on(table.isbn)
    .where(sql`${table.source} = 'open_library' AND ${table.isbn} IS NOT NULL`)
])

// Global author dictionary. Books link to authors through book_authors.
export const authors = sqliteTable('authors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, table => [
  uniqueIndex('authors_normalized_name_unique').on(table.normalizedName),
  index('authors_name_idx').on(table.name)
])

// Ordered many-to-many relation between books and authors.
export const bookAuthors = sqliteTable('book_authors', {
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => authors.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
}, table => [
  primaryKey({ columns: [table.bookId, table.authorId] }),
  index('book_authors_book_id_idx').on(table.bookId),
  index('book_authors_author_id_idx').on(table.authorId)
])

// User-defined physical locations form a tree of arbitrary depth.
export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  parentLocationId: text('parent_location_id').references((): AnySQLiteColumn => locations.id, { onDelete: 'no action' }),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  path: text('path').notNull(),
  depth: integer('depth').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, table => [
  uniqueIndex('locations_user_parent_name_unique')
    .on(table.userId, table.parentLocationId, table.normalizedName)
    .where(sql`${table.parentLocationId} IS NOT NULL`),
  uniqueIndex('locations_user_root_name_unique')
    .on(table.userId, table.normalizedName)
    .where(sql`${table.parentLocationId} IS NULL`),
  index('locations_user_id_idx').on(table.userId),
  index('locations_parent_location_id_idx').on(table.parentLocationId),
  index('locations_path_idx').on(table.path)
])

// User's book ownership (junction table)
// Links users to books they own
export const userBooks = sqliteTable('user_books', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  locationId: text('location_id').references(() => locations.id, { onDelete: 'set null' }),
  rating: integer('rating'), // 1–5 star rating, null = unrated
  note: text('note'), // Private user note
  libraryState: text('library_state', { enum: ['owned', 'wishlisted'] }).notNull().default('owned'),
  readingStatus: text('reading_status', { enum: ['unread', 'reading', 'read'] }).notNull().default('unread'),
  currentPage: integer('current_page'),
  progressPercent: integer('progress_percent'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
  removedAt: integer('removed_at', { mode: 'timestamp' })
}, table => [
  check('user_books_rating_check', sql`${table.rating} IS NULL OR ${table.rating} BETWEEN 1 AND 5`),
  check('user_books_library_state_check', sql`${table.libraryState} IN ('owned', 'wishlisted')`),
  check('user_books_reading_status_check', sql`${table.readingStatus} IN ('unread', 'reading', 'read')`),
  check('user_books_current_page_check', sql`${table.currentPage} IS NULL OR ${table.currentPage} >= 0`),
  check('user_books_progress_percent_check', sql`${table.progressPercent} IS NULL OR ${table.progressPercent} BETWEEN 0 AND 100`)
])

// Global tag dictionary with case-insensitive uniqueness enforced in migration
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(), // Normalized key for case-insensitive lookup (unique constraint)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, table => [
  uniqueIndex('tags_name_unique').on(table.name),
  uniqueIndex('tags_normalized_name_unique').on(table.normalizedName)
])

// Shared metadata tags attached to canonical books.
export const bookSystemTags = sqliteTable('book_system_tags', {
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, table => [
  primaryKey({ columns: [table.bookId, table.tagId] }),
  index('book_system_tags_book_id_idx').on(table.bookId),
  index('book_system_tags_tag_id_idx').on(table.tagId)
])

// User-curated tags attached to user-owned book records.
export const userBookTags = sqliteTable('user_book_tags', {
  id: text('id').primaryKey(),
  userBookId: text('user_book_id').notNull().references(() => userBooks.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, table => [
  uniqueIndex('user_book_tags_user_book_id_tag_id_unique').on(table.userBookId, table.tagId),
  index('user_book_tags_user_book_id_idx').on(table.userBookId),
  index('user_book_tags_tag_id_idx').on(table.tagId)
])

// Loans track when a user's book is lent out
export const loans = sqliteTable('loans', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  userBookId: text('user_book_id').notNull().references(() => userBooks.id, { onDelete: 'cascade' }),
  borrowerUserId: text('borrower_user_id').references(() => user.id, { onDelete: 'set null' }),
  borrowerDisplayName: text('borrower_display_name').notNull(),
  borrowerEmail: text('borrower_email'),
  status: text('status', { enum: ['active', 'returned', 'canceled'] }).notNull().default('active'),
  loanedAt: integer('loaned_at', { mode: 'timestamp' }).notNull(),
  dueAt: integer('due_at', { mode: 'timestamp' }),
  returnedAt: integer('returned_at', { mode: 'timestamp' }),
  canceledAt: integer('canceled_at', { mode: 'timestamp' }),
  snapshotBookTitle: text('snapshot_book_title').notNull(),
  snapshotBookAuthor: text('snapshot_book_author').notNull(),
  snapshotCoverPath: text('snapshot_cover_path'),
  snapshotOwnerName: text('snapshot_owner_name').notNull(),
  acceptTokenHash: text('accept_token_hash'),
  acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
}, table => [
  check('loans_status_check', sql`${table.status} IN ('active', 'returned', 'canceled')`),
  index('loans_owner_user_id_idx').on(table.ownerUserId),
  index('loans_user_book_id_idx').on(table.userBookId),
  index('loans_borrower_user_id_idx').on(table.borrowerUserId),
  uniqueIndex('loans_active_user_book_unique').on(table.userBookId).where(sql`${table.status} = 'active'`),
  uniqueIndex('loans_accept_token_hash_unique').on(table.acceptTokenHash).where(sql`${table.acceptTokenHash} IS NOT NULL`)
])
