/// <reference types="@cloudflare/vitest-pool-workers" />

import { env } from 'cloudflare:workers'
import { Effect, Layer } from 'effect'
import { drizzle } from 'drizzle-orm/d1'
import { asc, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import initialMigration from '../../../../server/db/migrations/sqlite/0000_initial_beta.sql?raw'
import termsMigration from '../../../../server/db/migrations/sqlite/0001_add_terms_acceptance.sql?raw'
import locationRestrictMigration from '../../../../server/db/migrations/sqlite/0002_prevent_location_delete_cascade.sql?raw'
import libraryStateMigration from '../../../../server/db/migrations/sqlite/0003_add_library_state.sql?raw'
import previouslyOwnedMigration from '../../../../server/db/migrations/sqlite/0006_huge_tiger_shark.sql?raw'
import inviteEmailMigration from '../../../../server/db/migrations/sqlite/0008_brave_saracen.sql?raw'
import loanNoteMigration from '../../../../server/db/migrations/sqlite/0010_owner_private_loan_note.sql?raw'
import borrowerSuggestionsMigration from '../../../../server/db/migrations/sqlite/0011_borrower_suggestions.sql?raw'
import enrichmentMigration from '../../../../server/db/migrations/sqlite/0012_imported_book_enrichment.sql?raw'
import authFactorsMigration from '../../../../server/db/migrations/sqlite/0013_auth-two-factor-passkeys.sql?raw'
import recentAuthMigration from '../../../../server/db/migrations/sqlite/0014_recent-auth.sql?raw'
import canonicalEnrichmentMigration from '../../../../server/db/migrations/sqlite/0016_canonical_book_enrichment.sql?raw'
import durableOpenLibraryPayloadMigration from '../../../../server/db/migrations/sqlite/0019_durable_open_library_payload.sql?raw'
import { authors, bookAuthors, bookEnrichmentJobs, books, canonicalBookEnrichmentJobs, user, userBooks, tags, userBookTags, bookSystemTags } from '../../../../server/db/schema'
import {
  BookEnrichmentRepository,
  BookEnrichmentRepositoryLive
} from '../../../../server/repositories/book-enrichment.repository'
import {
  CanonicalBookEnrichmentRepository,
  CanonicalBookEnrichmentRepositoryLive
} from '../../../../server/repositories/canonical-book-enrichment.repository'
import {
  BookRepository,
  BookRepositoryLive
} from '../../../../server/repositories/book.repository'
import type { OpenLibraryBookData } from '../../../../shared/types/open-library'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'

type D1Db = ReturnType<typeof drizzle>

let db: D1Db

describe('BookEnrichmentRepository on D1', () => {
  beforeAll(async () => {
    db = drizzle(env.DB)
    await applyMigrations(env.DB)
  })

  beforeEach(async () => {
    for (const table of [
      'book_enrichment_jobs',
      'canonical_book_enrichment_jobs',
      'book_enrichment_locks',
      'book_authors',
      'authors',
      'user_books',
      'books',
      'user'
    ]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    await seedPendingJob(db)
  })

  it('lets only one concurrent worker claim a job', async () => {
    const now = new Date('2026-07-26T10:00:00.000Z')
    const leaseExpiresAt = new Date(now.getTime() + 60_000)
    const claim = () => runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.claimJobs({ limit: 10, now, leaseExpiresAt })
    ))

    const [first, second] = await Promise.all([claim(), claim()])
    expect([...first, ...second]).toHaveLength(1)
    expect([...first, ...second][0]).toMatchObject({
      bookId: 'book-1',
      isbn: '9780441172719',
      attempts: 1
    })
  })

  it('scopes foreground batch claims to the authenticated owner', async () => {
    const now = new Date('2026-07-26T10:00:00.000Z')
    await db.insert(user).values({
      id: 'user-2',
      name: 'Grace',
      email: 'grace@example.com',
      emailVerified: true,
      role: 'user',
      banned: false,
      createdAt: now,
      updatedAt: now
    })
    await db.insert(books).values({
      id: 'book-2',
      isbn: '9780141439518',
      title: 'Pride and Prejudice',
      source: 'manual',
      entrySource: 'csv_import',
      createdByUserId: 'user-2',
      createdAt: now
    })
    await db.insert(userBooks).values({
      id: 'ub-2',
      userId: 'user-2',
      bookId: 'book-2',
      libraryState: 'owned',
      addedAt: now
    })
    await db.insert(bookEnrichmentJobs).values({
      id: 'job-2',
      batchId: 'batch-1',
      userId: 'user-2',
      bookId: 'book-2',
      isbn: '9780141439518',
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
      createdAt: now,
      updatedAt: now
    })

    const claimed = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.claimJobs({
        batchId: 'batch-1',
        userId: 'user-1',
        limit: 10,
        now,
        leaseExpiresAt: new Date(now.getTime() + 60_000)
      })
    ))

    expect(claimed.map(job => job.userId)).toEqual(['user-1'])
    await expect(db.select({ status: bookEnrichmentJobs.status }).from(bookEnrichmentJobs)
      .where(eq(bookEnrichmentJobs.id, 'job-2')))
      .resolves.toEqual([{ status: 'pending' }])
  })

  it('aggregates pending work and the earliest retry time for an owned batch', async () => {
    const _now = new Date('2026-07-26T10:00:00.000Z')
    const nextAttemptAt = new Date('2026-07-26T10:05:00.000Z')
    await db.update(bookEnrichmentJobs).set({ status: 'retrying', nextAttemptAt }).where(eq(bookEnrichmentJobs.id, 'job-1'))

    const progress = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.getBatchProgress('user-1', 'batch-1')
    ))
    expect(progress).toMatchObject({ exists: true, pending: 1, nextAttemptAt, createdAt: new Date('2026-07-26T09:00:00.000Z') })

    const foreign = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.getBatchProgress('other-user', 'batch-1')
    ))
    expect(foreign).toEqual({ exists: false, pending: 0, nextAttemptAt: null, createdAt: null })
  })

  it('uses a live processing lease as the next poll time', async () => {
    const leaseExpiresAt = new Date('2026-07-26T10:10:00.000Z')
    await db.update(bookEnrichmentJobs).set({
      status: 'processing',
      nextAttemptAt: null,
      leaseExpiresAt
    }).where(eq(bookEnrichmentJobs.id, 'job-1'))

    await expect(runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.getBatchProgress('user-1', 'batch-1')
    ))).resolves.toMatchObject({ exists: true, pending: 1, nextAttemptAt: leaseExpiresAt, createdAt: expect.any(Date) })
  })

  it('prevents workers from holding the same ISBN lock until its lease expires', async () => {
    const now = new Date('2026-07-26T10:00:00.000Z')
    const firstLease = new Date(now.getTime() + 60_000)
    const first = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.acquireIsbnLocks(['9780441172719'], 'claim-a', firstLease, now)
    ))
    const second = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.acquireIsbnLocks(['9780441172719'], 'claim-b', firstLease, now)
    ))
    const afterExpiry = new Date(firstLease.getTime() + 1)
    const third = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.acquireIsbnLocks(
        ['9780441172719'],
        'claim-c',
        new Date(afterExpiry.getTime() + 60_000),
        afterExpiry
      )
    ))

    expect([...first]).toEqual(['9780441172719'])
    expect([...second]).toEqual([])
    expect([...third]).toEqual(['9780441172719'])
  })

  it('does not apply stale results after the imported ISBN changes', async () => {
    const now = new Date('2026-07-26T10:00:00.000Z')
    const [job] = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.claimJobs({
        limit: 1,
        now,
        leaseExpiresAt: new Date(now.getTime() + 60_000)
      })
    ))
    await db.update(books).set({ isbn: '9780141439518' }).where(eq(books.id, 'book-1'))

    const applied = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.applyMetadata(job!, {
        coverPath: 'covers/9780441172719.webp',
        description: 'Stale description',
        openLibraryKey: '/books/OL1M',
        workKey: '/works/OL1W'
      })
    ))

    expect(applied).toBe(false)
    await expect(db.select({
      coverPath: books.coverPath,
      description: books.description,
      metadataProviderIsbn: books.metadataProviderIsbn
    }).from(books).where(eq(books.id, 'book-1'))).resolves.toEqual([{
      coverPath: null,
      description: null,
      metadataProviderIsbn: null
    }])
  })

  it('cancels work when the user no longer actively owns the imported book', async () => {
    await db.update(userBooks)
      .set({ removedAt: new Date('2026-07-26T09:00:00.000Z') })
      .where(eq(userBooks.id, 'ub-1'))

    const cancelled = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.cancelIneligibleJobs(new Date('2026-07-26T10:00:00.000Z'))
    ))

    expect(cancelled).toBe(1)
    await expect(db.select({ status: bookEnrichmentJobs.status }).from(bookEnrichmentJobs))
      .resolves.toEqual([{ status: 'cancelled' }])
  })

  it('returns only the requested user-owned card updates', async () => {
    const updates = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.getUpdatesForUserBooks('user-1', ['ub-1', 'another-users-book'])
    ))

    expect(updates).toEqual([{
      userBookId: 'ub-1',
      bookId: 'book-1',
      author: 'Unknown Author',
      authors: '[]',
      isbn: '9780441172719',
      subjects: '[]',
      coverUrl: null,
      coverPath: null,
      description: null,
      publishDate: null,
      publishers: null,
      numberOfPages: null,
      openLibraryKey: null,
      workKey: null,
      tags: '[]',
      suggestedTags: '[]',
      status: 'pending'
    }])
  })

  it('hydrates manual and suggested tags as JSON without comma corruption', async () => {
    const now = new Date('2026-07-26T10:00:00.000Z')
    await db.insert(tags).values([
      { id: 'tag-manual', name: 'Manual, comma', normalizedName: 'manual-comma', createdAt: now, updatedAt: now },
      { id: 'tag-overlap', name: 'Shared', normalizedName: 'shared', createdAt: now, updatedAt: now },
      { id: 'tag-system', name: 'System suggestion', normalizedName: 'system-suggestion', createdAt: now, updatedAt: now }
    ])
    await db.insert(userBookTags).values([
      { id: 'ubt-manual', userBookId: 'ub-1', tagId: 'tag-manual', createdAt: now, updatedAt: now },
      { id: 'ubt-overlap', userBookId: 'ub-1', tagId: 'tag-overlap', createdAt: now, updatedAt: now }
    ])
    await db.insert(bookSystemTags).values([
      { bookId: 'book-1', tagId: 'tag-overlap', createdAt: now, updatedAt: now },
      { bookId: 'book-1', tagId: 'tag-system', createdAt: now, updatedAt: now }
    ])
    const [update] = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.getUpdatesForUserBooks('user-1', ['ub-1'])
    ))
    expect(JSON.parse(update!.tags)).toEqual(['Manual, comma', 'Shared'])
    expect(JSON.parse(update!.suggestedTags)).toEqual(['System suggestion'])
  })

  it('returns active owned user-book ids with a hard foreground bound', async () => {
    await db.update(userBooks).set({ removedAt: new Date('2026-07-26T09:00:00.000Z') }).where(eq(userBooks.id, 'ub-1'))
    const ids = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.getUserBookIdsForBooks('user-1', ['book-1'], 100)
    ))
    expect(ids).toEqual([])

    await db.update(userBooks).set({ removedAt: null }).where(eq(userBooks.id, 'ub-1'))
    const active = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.getUserBookIdsForBooks('user-1', ['book-1'], 100)
    ))
    expect(active).toEqual(['ub-1'])
  })

  it('returns canonical enrichment updates for a user-owned book', async () => {
    const now = new Date('2026-07-26T10:00:00.000Z')
    await db.delete(bookEnrichmentJobs)
    await db.update(books)
      .set({ coverPath: 'covers/9780441172719.webp', source: 'open_library' })
      .where(eq(books.id, 'book-1'))
    await db.insert(canonicalBookEnrichmentJobs).values({
      bookId: 'book-1',
      isbn: '9780441172719',
      status: 'processing',
      attempts: 1,
      maxAttempts: 5,
      claimToken: 'claim-1',
      leaseExpiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now
    })

    const updates = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.getUpdatesForUserBooks('user-1', ['ub-1'])
    ))

    expect(updates).toEqual([{
      userBookId: 'ub-1',
      bookId: 'book-1',
      author: 'Unknown Author',
      authors: '[]',
      isbn: '9780441172719',
      subjects: '[]',
      coverUrl: null,
      coverPath: 'covers/9780441172719.webp',
      description: null,
      publishDate: null,
      publishers: null,
      numberOfPages: null,
      openLibraryKey: null,
      workKey: null,
      tags: '[]',
      suggestedTags: '[]',
      status: 'processing'
    }])
  })

  it('persists one canonical pending job and atomically grants a single claim', async () => {
    await db.update(books).set({ source: 'open_library' }).where(eq(books.id, 'book-1'))
    const ensure = () => runCanonicalRepository(Effect.flatMap(CanonicalBookEnrichmentRepository, repository =>
      repository.ensurePending('book-1', '9780441172719')
    ))
    await Promise.all([ensure(), ensure()])
    await expect(db.select().from(canonicalBookEnrichmentJobs)).resolves.toHaveLength(1)

    const now = new Date('2026-07-26T10:00:00.000Z')
    const claim = () => runCanonicalRepository(Effect.flatMap(CanonicalBookEnrichmentRepository, repository =>
      repository.claim('book-1', now, new Date(now.getTime() + 60_000))
    ))
    const claims = await Promise.all([claim(), claim()])
    expect(claims.filter(Boolean)).toHaveLength(1)

    const reclaimed = await runCanonicalRepository(Effect.flatMap(CanonicalBookEnrichmentRepository, repository =>
      repository.claim('book-1', new Date(now.getTime() + 60_001), new Date(now.getTime() + 120_000))
    ))
    expect(reclaimed?.attempts).toBe(2)
  })

  it('returns the inserted canonical job without a follow-up read, and preserves the winner on conflict', async () => {
    const first = await runCanonicalRepository(Effect.flatMap(CanonicalBookEnrichmentRepository, repository =>
      repository.ensurePending('book-1', '9780441172719')
    ))
    expect(first).toMatchObject({
      bookId: 'book-1',
      isbn: '9780441172719',
      status: 'pending',
      attempts: 0
    })

    await db.update(canonicalBookEnrichmentJobs)
      .set({ status: 'retrying', attempts: 2, lastError: 'keep this row' })
      .where(eq(canonicalBookEnrichmentJobs.bookId, 'book-1'))

    const existing = await runCanonicalRepository(Effect.flatMap(CanonicalBookEnrichmentRepository, repository =>
      repository.ensurePending('book-1', 'different-isbn')
    ))
    expect(existing).toMatchObject({
      bookId: 'book-1',
      isbn: '9780441172719',
      status: 'retrying',
      attempts: 2,
      lastError: 'keep this row'
    })
    await expect(db.select().from(canonicalBookEnrichmentJobs)).resolves.toHaveLength(1)
  })

  it('marks a canonical job failed after its final allowed attempt', async () => {
    await runCanonicalRepository(Effect.flatMap(CanonicalBookEnrichmentRepository, repository =>
      repository.ensurePending('book-1', '9780441172719')
    ))
    await db.update(canonicalBookEnrichmentJobs)
      .set({ maxAttempts: 1 })
      .where(eq(canonicalBookEnrichmentJobs.bookId, 'book-1'))

    const now = new Date('2026-07-26T10:00:00.000Z')
    const claimed = await runCanonicalRepository(Effect.flatMap(CanonicalBookEnrichmentRepository, repository =>
      repository.claim('book-1', now, new Date(now.getTime() + 60_000))
    ))
    expect(claimed?.attempts).toBe(1)

    await runCanonicalRepository(Effect.flatMap(CanonicalBookEnrichmentRepository, repository =>
      repository.retry('book-1', claimed!.claimToken!, new Date(now.getTime() + 5_000), 'Temporary failure', now)
    ))
    const job = await runCanonicalRepository(Effect.flatMap(CanonicalBookEnrichmentRepository, repository => repository.get('book-1')))
    expect(job).toMatchObject({ status: 'failed', nextAttemptAt: null })

    const retryClaim = await runCanonicalRepository(Effect.flatMap(CanonicalBookEnrichmentRepository, repository =>
      repository.claim('book-1', new Date(now.getTime() + 60_001), new Date(now.getTime() + 120_000))
    ))
    expect(retryClaim).toBeNull()
  })

  it('prioritizes due retries and expired leases over pending canonical jobs during recovery', async () => {
    const now = new Date('2026-07-26T10:00:00.000Z')
    const jobs = [
      { bookId: 'book-retry-old', isbn: '9780000000001', status: 'retrying' as const, nextAttemptAt: new Date('2026-07-26T09:40:00.000Z') },
      { bookId: 'book-retry-new', isbn: '9780000000002', status: 'retrying' as const, nextAttemptAt: new Date('2026-07-26T09:50:00.000Z') },
      { bookId: 'book-expired-processing', isbn: '9780000000003', status: 'processing' as const, leaseExpiresAt: new Date('2026-07-26T09:55:00.000Z') },
      { bookId: 'book-pending-a', isbn: '9780000000004', status: 'pending' as const },
      { bookId: 'book-pending-b', isbn: '9780000000005', status: 'pending' as const },
      { bookId: 'book-pending-c', isbn: '9780000000006', status: 'pending' as const },
      { bookId: 'book-pending-d', isbn: '9780000000007', status: 'pending' as const }
    ]

    await db.insert(books).values(jobs.map(job => ({
      id: job.bookId,
      isbn: job.isbn,
      title: job.bookId,
      source: 'open_library' as const,
      entrySource: 'isbn_lookup' as const,
      createdAt: now
    })))
    await db.insert(canonicalBookEnrichmentJobs).values(jobs.map(job => ({
      ...job,
      attempts: 0,
      maxAttempts: 5,
      createdAt: now,
      updatedAt: now
    })))

    const recoverable = await runCanonicalRepository(Effect.flatMap(CanonicalBookEnrichmentRepository, repository =>
      repository.listRecoverable(now, 3)
    ))

    expect(recoverable.map(job => job.bookId)).toEqual([
      'book-retry-old',
      'book-retry-new',
      'book-expired-processing'
    ])
  })

  it('hydrates authors when a competing core lookup already persisted the canonical book', async () => {
    await db.update(books)
      .set({ source: 'open_library' })
      .where(eq(books.id, 'book-1'))

    const data: OpenLibraryBookData = {
      isbn: '9780441172719',
      title: 'Dune',
      authors: ['Frank Herbert'],
      openLibraryKey: '/books/OL1M',
      workKey: '/works/OL1W',
      coverUrl: null
    }
    const book = await runBookRepository(Effect.flatMap(BookRepository, repository =>
      repository.createCoreOpenLibraryBook(data.isbn, data)
    ))

    expect(book.authors.map(author => author.name)).toEqual(['Frank Herbert'])
  })

  it('persists core books and author links atomically for competing lookups', async () => {
    const data: OpenLibraryBookData = {
      isbn: '9780306406157',
      title: 'Nuclear Physics',
      authors: [' George  Green ', 'George Green'],
      openLibraryKey: '/books/OL2M',
      workKey: '/works/OL2W',
      coverUrl: null
    }
    const create = () => runBookRepository(Effect.flatMap(BookRepository, repository =>
      repository.createCoreOpenLibraryBook(data.isbn, data)
    ))

    const [first, second] = await Promise.all([create(), create()])
    const persistedAuthors = await db.select({ name: authors.name, createdAt: bookAuthors.createdAt })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, first.id))

    expect(first.id).toBe(second.id)
    expect(first.authors.map(author => author.name)).toEqual(['George Green'])
    expect(second.authors.map(author => author.name)).toEqual(['George Green'])
    expect(persistedAuthors).toHaveLength(1)
    expect(persistedAuthors[0]?.name).toBe('George Green')
    expect(persistedAuthors[0]?.createdAt).toBeInstanceOf(Date)
  })

  it('resolves and links multiple normalized authors exactly once during competing inserts', async () => {
    const data: OpenLibraryBookData = {
      isbn: '9780306406157',
      title: 'Nuclear Physics',
      authors: [' George  Green ', 'Marie Curie', 'George Green', ' Marie   Curie '],
      openLibraryKey: '/books/OL2M',
      workKey: '/works/OL2W',
      coverUrl: null
    }
    const create = () => runBookRepository(Effect.flatMap(BookRepository, repository =>
      repository.createCoreOpenLibraryBook(data.isbn, data)
    ))

    const [first, second] = await Promise.all([create(), create()])
    expect(first.id).toBe(second.id)
    expect(first.authors.map(author => author.name)).toEqual(['George Green', 'Marie Curie'])
    expect(second.authors.map(author => author.name)).toEqual(['George Green', 'Marie Curie'])

    const persistedAuthors = await db.select({ name: authors.name, sortOrder: bookAuthors.sortOrder })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, first.id))
      .orderBy(asc(bookAuthors.sortOrder))
    expect(persistedAuthors).toEqual([
      { name: 'George Green', sortOrder: 0 },
      { name: 'Marie Curie', sortOrder: 1 }
    ])
  })

  it('replaces an Unknown Author placeholder when enrichment returns an author', async () => {
    await db.update(books)
      .set({ source: 'open_library' })
      .where(eq(books.id, 'book-1'))

    const coreData: OpenLibraryBookData = {
      isbn: '9780441172719',
      title: 'Dune',
      authors: ['Unknown Author'],
      openLibraryKey: '/books/OL1M',
      workKey: '/works/OL1W',
      coverUrl: null
    }
    await runBookRepository(Effect.flatMap(BookRepository, repository =>
      repository.createCoreOpenLibraryBook(coreData.isbn, coreData)
    ))

    const enriched = await runBookRepository(Effect.flatMap(BookRepository, repository =>
      repository.applyOpenLibraryEnrichment('book-1', {
        ...coreData,
        authors: ['Frank Herbert']
      }, null)
    ))

    expect(enriched.author).toBe('Frank Herbert')
    expect(enriched.authors.map(author => author.name)).toEqual(['Frank Herbert'])
  })

  it('preserves a resolved author during enrichment', async () => {
    await db.update(books)
      .set({ source: 'open_library' })
      .where(eq(books.id, 'book-1'))

    const coreData: OpenLibraryBookData = {
      isbn: '9780441172719',
      title: 'Dune',
      authors: ['Frank Herbert'],
      openLibraryKey: '/books/OL1M',
      workKey: '/works/OL1W',
      coverUrl: null
    }
    await runBookRepository(Effect.flatMap(BookRepository, repository =>
      repository.createCoreOpenLibraryBook(coreData.isbn, coreData)
    ))

    const enriched = await runBookRepository(Effect.flatMap(BookRepository, repository =>
      repository.applyOpenLibraryEnrichment('book-1', {
        ...coreData,
        authors: ['Different Provider Author']
      }, null)
    ))

    expect(enriched.authors.map(author => author.name)).toEqual(['Frank Herbert'])
  })
})

async function applyMigrations(database: D1Database) {
  for (const migration of [
    initialMigration,
    termsMigration,
    locationRestrictMigration,
    libraryStateMigration,
    previouslyOwnedMigration,
    inviteEmailMigration,
    loanNoteMigration,
    borrowerSuggestionsMigration,
    enrichmentMigration,
    authFactorsMigration,
    recentAuthMigration,
    canonicalEnrichmentMigration,
    durableOpenLibraryPayloadMigration
  ]) {
    for (const statement of migration.split('--> statement-breakpoint')) {
      const migrationStatement = statement.trim()
      if (migrationStatement) await database.prepare(migrationStatement).run()
    }
  }
}

async function seedPendingJob(database: D1Db) {
  const now = new Date('2026-07-26T09:00:00.000Z')
  await database.insert(user).values({
    id: 'user-1',
    name: 'Reader',
    email: 'reader@example.com',
    emailVerified: true,
    role: 'user',
    banned: false,
    createdAt: now,
    updatedAt: now
  })
  await database.insert(books).values({
    id: 'book-1',
    isbn: '9780441172719',
    title: 'Dune',
    source: 'manual',
    entrySource: 'csv_import',
    createdByUserId: 'user-1',
    createdAt: now
  })
  await database.insert(userBooks).values({
    id: 'ub-1',
    userId: 'user-1',
    bookId: 'book-1',
    libraryState: 'owned',
    addedAt: now
  })
  await database.insert(bookEnrichmentJobs).values({
    id: 'job-1',
    batchId: 'batch-1',
    userId: 'user-1',
    bookId: 'book-1',
    isbn: '9780441172719',
    status: 'pending',
    attempts: 0,
    maxAttempts: 5,
    createdAt: now,
    updatedAt: now
  })
}

function runRepository<A, E>(
  effect: Effect.Effect<A, E, BookEnrichmentRepository | DbService>
) {
  const typedDatabase = db as unknown as DbServiceInterface['db']
  return Effect.runPromise(effect.pipe(
    Effect.provide(BookEnrichmentRepositoryLive),
    Effect.provide(Layer.succeed(DbService, {
      db: typedDatabase,
      executeAtomic: buildStatements => typedDatabase.batch(buildStatements(typedDatabase))
    }))
  ))
}

function runCanonicalRepository<A, E>(
  effect: Effect.Effect<A, E, CanonicalBookEnrichmentRepository | DbService>
) {
  const typedDatabase = db as unknown as DbServiceInterface['db']
  return Effect.runPromise(effect.pipe(
    Effect.provide(CanonicalBookEnrichmentRepositoryLive),
    Effect.provide(Layer.succeed(DbService, {
      db: typedDatabase,
      executeAtomic: buildStatements => typedDatabase.batch(buildStatements(typedDatabase))
    }))
  ))
}

function runBookRepository<A, E>(
  effect: Effect.Effect<A, E, BookRepository | DbService>
) {
  const typedDatabase = db as unknown as DbServiceInterface['db']
  return Effect.runPromise(effect.pipe(
    Effect.provide(BookRepositoryLive),
    Effect.provide(Layer.succeed(DbService, {
      db: typedDatabase,
      executeAtomic: buildStatements => typedDatabase.batch(buildStatements(typedDatabase))
    }))
  ))
}
