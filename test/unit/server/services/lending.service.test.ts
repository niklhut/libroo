import { Effect, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailService } from '../../../../server/services/email.service'
import { EmailDeliveryError } from '../../../../server/runtime/email.core'
import { LendingService, LendingServiceLive } from '../../../../server/services/lending.service'
import { LendingRepository, type LendingRepositoryInterface } from '../../../../server/repositories/lending.repository'

const capabilities = vi.hoisted(() => ({ getEmailCapabilities: vi.fn() }))
vi.mock('../../../../server/utils/email-capabilities', () => capabilities)

describe('LendingService invitation delivery', () => {
  const state = { creates: 0, sends: 0, updates: [] as string[] }
  const repository = {
    createLoan: (input: { inviteEmailStatus: 'pending' | 'sent' | 'failed' | null }) => Effect.sync(() => {
      state.creates++
      return { id: 'loan-1', userBookId: 'book-1', ownerDisplayName: 'Ada', borrowerDisplayName: 'Grace', acceptedByName: null, status: 'active' as const, loanedAt: new Date(), dueAt: null, returnedAt: null, canceledAt: null, acceptedAt: null, book: { title: 'Book', author: 'Author', coverPath: null }, inviteUrl: null, deliveryStatus: input.inviteEmailStatus ? 'unavailable' as const : 'not_requested' as const }
    }),
    updateInviteEmailDelivery: (_id: string, _owner: string, status: string) => Effect.sync(() => {
      state.updates.push(status)
      return {}
    }),
    getActiveLoanInviteForOwner: () => Effect.succeed({ id: 'loan-1', acceptTokenHash: null, borrowerEmail: null, borrowerDisplayName: 'Grace', dueAt: null, snapshotBookTitle: 'Book', snapshotBookAuthor: 'Author', snapshotOwnerName: 'Ada' })
  } as unknown as LendingRepositoryInterface

  beforeEach(() => {
    state.creates = 0
    state.sends = 0
    state.updates = []
    capabilities.getEmailCapabilities.mockReturnValue({ inviteEmailEnabled: true })
  })

  function run(email: string | null, fails = false) {
    return Effect.runPromise(Effect.flatMap(LendingService, service => service.createLoan('book-1', 'owner-1', { borrowerDisplayName: 'Grace', borrowerEmail: email })).pipe(
      Effect.provide(LendingServiceLive),
      Effect.provide(Layer.succeed(LendingRepository, repository)),
      Effect.provide(Layer.succeed(EmailService, { sendEmail: () => Effect.gen(function* () {
        state.sends++
        if (fails) return yield* Effect.fail(new EmailDeliveryError({ message: 'provider failure' }))
      }) }))
    ))
  }

  it('sends once and records sent delivery', async () => {
    await expect(run('grace@example.com')).resolves.toMatchObject({ deliveryStatus: 'sent' })
    expect(state).toMatchObject({ creates: 1, sends: 1, updates: ['sent'] })
  })

  it('does not send without a borrower email', async () => {
    await expect(run(null)).resolves.toMatchObject({ deliveryStatus: 'not_requested' })
    expect(state.sends).toBe(0)
  })

  it('keeps the loan when delivery is unavailable', async () => {
    capabilities.getEmailCapabilities.mockReturnValue({ inviteEmailEnabled: false })
    await expect(run('grace@example.com')).resolves.toMatchObject({ deliveryStatus: 'unavailable' })
    expect(state).toMatchObject({ creates: 1, sends: 0 })
  })

  it('records failed delivery when the email provider fails', async () => {
    await expect(run('grace@example.com', true)).resolves.toMatchObject({ deliveryStatus: 'failed' })
    expect(state).toMatchObject({ creates: 1, sends: 1, updates: ['failed'] })
  })
})
