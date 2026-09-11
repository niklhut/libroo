import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupApiRouteTest,
  importRoute,
  itRejectsBannedUsers,
  itRequiresAuth,
  makeEvent,
  mockLoggedInUser,
  routePath,
  setupApiRouteTest
} from '../../_helpers/api-route'

const runOwnedEnrichmentBatch = vi.hoisted(() => vi.fn())

vi.mock('../../../../../../server/services/book-enrichment.service', () => ({
  runOwnedEnrichmentBatch
}))

const route = routePath('books/enrichment/batch.post')

describe('server/api/books/enrichment/batch.post', () => {
  beforeEach(async () => {
    await setupApiRouteTest()
    runOwnedEnrichmentBatch.mockReset()
    const { runLibraryEnrichmentBatchSchema } = await import('../../../../../../shared/utils/schemas')
    ;(globalThis as typeof globalThis & { runLibraryEnrichmentBatchSchema?: unknown }).runLibraryEnrichmentBatchSchema = runLibraryEnrichmentBatchSchema
  })
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { body: { batchId: 'batch-1' } })
  itRejectsBannedUsers(route, { body: { batchId: 'batch-1' } })

  it('runs a requested batch for the authenticated owner with the configured worker bound', async () => {
    mockLoggedInUser({ id: 'owner-1', name: 'Ada', email: 'ada@example.com' })
    const result = { claimed: 2, enriched: 1, noCover: 1, notFound: 0, retried: 0, failed: 0, cancelled: 0 }
    runOwnedEnrichmentBatch.mockReturnValueOnce(Effect.succeed(result))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { batchId: 'batch-1' } }))).resolves.toEqual(result)
    expect(runOwnedEnrichmentBatch).toHaveBeenCalledWith('owner-1', 'batch-1', expect.any(Number))
  })

  it.each([
    {},
    { batchId: '' },
    { batchId: 'x'.repeat(129) },
    { batchId: 42 }
  ])('rejects an invalid batch request: %j', async (body) => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Validation Error'
    })
    expect(runOwnedEnrichmentBatch).not.toHaveBeenCalled()
  })
})
