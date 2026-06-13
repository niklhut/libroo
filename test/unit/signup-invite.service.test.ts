import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'
import { EmailService } from '../../server/services/email.service'
import { SignupInviteRepository } from '../../server/repositories/signup-invite.repository'
import type { SignupInviteRecord, SignupInviteRepositoryInterface } from '../../server/repositories/signup-invite.repository'
import { SignupInviteServiceLive, acceptSignupInvite, createSignupInvite, listSignupInvites, validateSignupAttempt } from '../../server/services/signup-invite.service'

const originalPublicRegistration = process.env.LIBROO_PUBLIC_REGISTRATION_ENABLED
const admin = { id: 'admin-1', role: 'admin' }

describe('SignupInviteService', () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_URL = 'https://libroo.example.com'
    process.env.LIBROO_PUBLIC_REGISTRATION_ENABLED = 'false'
  })

  afterEach(() => {
    process.env.LIBROO_PUBLIC_REGISTRATION_ENABLED = originalPublicRegistration
  })

  it('creates pending invite links for admins', async () => {
    const state = createFakeState()
    const result = await runWithFakes(
      createSignupInvite(admin, { expiresInDays: 3 }),
      state
    )

    expect(result.token).toBe('token-1')
    expect(result.inviteUrl).toBe('https://libroo.example.com/register?invite=token-1')
    expect(result.invite.status).toBe('pending')
    expect(result.invite.email).toBeNull()
    expect(state.invites).toHaveLength(1)
  })

  it('creates invite emails through the email service', async () => {
    const state = createFakeState()
    const result = await runWithFakes(
      createSignupInvite(admin, { email: 'Ada@Example.com', expiresInDays: 7 }),
      state
    )

    expect(result.invite.email).toBe('ada@example.com')
    expect(state.sentEmails).toEqual([{
      to: 'ada@example.com',
      subject: 'Your Libroo invite'
    }])
  })

  it('accepts a pending invite for Better Auth user ids', async () => {
    const state = createFakeState()
    state.invites.push(makeInvite({ id: 'invite-1' }))

    const result = await runWithFakes(
      acceptSignupInvite('invite-1', 'user-1'),
      state
    )

    expect(result.status).toBe('accepted')
    expect(result.acceptedByUserId).toBe('user-1')
  })

  it('expires pending invites that are past their expiration date', async () => {
    const state = createFakeState()
    state.invites.push(makeInvite({
      id: 'invite-1',
      token: 'expired-token',
      expiresAt: new Date(Date.now() - 1000)
    }))

    await expect(runWithFakes(
      validateSignupAttempt({ token: 'expired-token', email: 'ada@example.com' }),
      state
    )).rejects.toThrow('This invite has expired')
    expect(state.invites[0]?.status).toBe('expired')
  })

  it('rejects revoked invites', async () => {
    const state = createFakeState()
    state.invites.push(makeInvite({
      token: 'revoked-token',
      status: 'revoked',
      revokedAt: new Date()
    }))

    await expect(runWithFakes(
      validateSignupAttempt({ token: 'revoked-token', email: 'ada@example.com' }),
      state
    )).rejects.toThrow('This invite has been revoked')
  })

  it('rejects disabled public signup without an invite', async () => {
    process.env.LIBROO_PUBLIC_REGISTRATION_ENABLED = 'false'
    const state = createFakeState()

    await expect(runWithFakes(
      validateSignupAttempt({ email: 'ada@example.com' }),
      state
    )).rejects.toThrow('An invite is required to create an account')
  })

  it('allows public signup without invites when enabled', async () => {
    process.env.LIBROO_PUBLIC_REGISTRATION_ENABLED = 'true'
    const state = createFakeState()

    await expect(runWithFakes(
      validateSignupAttempt({ email: 'ada@example.com' }),
      state
    )).resolves.toEqual({ inviteId: null })
  })

  it('ignores stale invite tokens when public signup is enabled', async () => {
    process.env.LIBROO_PUBLIC_REGISTRATION_ENABLED = 'true'
    const state = createFakeState()
    state.invites.push(makeInvite({
      token: 'expired-token',
      expiresAt: new Date(Date.now() - 1000)
    }))

    await expect(runWithFakes(
      validateSignupAttempt({ token: 'expired-token', email: 'ada@example.com' }),
      state
    )).resolves.toEqual({ inviteId: null })
    expect(state.invites[0]?.status).toBe('pending')
  })

  it('rejects invite management when public registration is enabled', async () => {
    process.env.LIBROO_PUBLIC_REGISTRATION_ENABLED = 'true'
    const state = createFakeState()

    await expect(runWithFakes(
      createSignupInvite(admin, { expiresInDays: 3 }),
      state
    )).rejects.toThrow('Invite management is only available when public registration is disabled')
  })

  it('lists expired invites with derived expired status', async () => {
    const state = createFakeState()
    state.invites.push(makeInvite({
      id: 'invite-1',
      expiresAt: new Date(Date.now() - 1000)
    }))

    const result = await runWithFakes(listSignupInvites(admin), state)

    expect(result.invites[0]?.status).toBe('expired')
    expect(result.total).toBe(1)
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(25)
  })

  it('paginates invite lists', async () => {
    const state = createFakeState()
    state.invites.push(
      makeInvite({ id: 'invite-1' }),
      makeInvite({ id: 'invite-2' }),
      makeInvite({ id: 'invite-3' })
    )

    const result = await runWithFakes(listSignupInvites(admin, { page: 2, pageSize: 2 }), state)

    expect(result.invites.map(invite => invite.id)).toEqual(['invite-3'])
    expect(result.total).toBe(3)
    expect(result.page).toBe(2)
    expect(result.pageSize).toBe(2)
  })
})

interface FakeState {
  invites: SignupInviteRecord[]
  sentEmails: Array<{ to: string, subject: string }>
  existingEmails: Set<string>
  nextToken: number
}

function createFakeState(): FakeState {
  return {
    invites: [],
    sentEmails: [],
    existingEmails: new Set(),
    nextToken: 1
  }
}

function runWithFakes<A, E>(effect: Effect.Effect<A, E, SignupInviteService | SignupInviteRepository | EmailService>, state: FakeState) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(SignupInviteServiceLive),
    Effect.provide(Layer.succeed(SignupInviteRepository, createFakeRepository(state))),
    Effect.provide(Layer.succeed(EmailService, {
      sendEmail: message =>
        Effect.sync(() => {
          state.sentEmails.push({
            to: message.to,
            subject: message.subject
          })
        })
    }))
  ))
}

function createFakeRepository(state: FakeState): SignupInviteRepositoryInterface {
  return {
    create: input =>
      Effect.sync(() => {
        const token = `token-${state.nextToken++}`
        const invite = makeInvite({
          id: `invite-${state.nextToken}`,
          token,
          email: input.email,
          createdByUserId: input.createdByUserId,
          expiresAt: input.expiresAt
        })
        state.invites.push(invite)
        return { invite, token }
      }),

    findByToken: token =>
      Effect.sync(() => state.invites.find(invite => invite.tokenHash === token) ?? null),

    list: pagination =>
      Effect.sync(() => ({
        invites: state.invites.slice(pagination.offset, pagination.offset + pagination.limit),
        total: state.invites.length
      })),

    markExpired: (inviteId, now) =>
      Effect.sync(() => updateInvite(state, inviteId, {
        status: 'expired',
        updatedAt: now
      })),

    markAccepted: (inviteId, userId, now) =>
      Effect.sync(() => updateInvite(state, inviteId, {
        status: 'accepted',
        acceptedByUserId: userId,
        acceptedAt: now,
        updatedAt: now
      })),

    revoke: (inviteId, now) =>
      Effect.sync(() => updateInvite(state, inviteId, {
        status: 'revoked',
        revokedAt: now,
        updatedAt: now
      })),

    emailExists: email =>
      Effect.sync(() => state.existingEmails.has(email))
  }
}

function makeInvite(overrides: Partial<SignupInviteRecord> & { token?: string } = {}): SignupInviteRecord {
  const now = new Date()

  return {
    id: 'invite-1',
    tokenHash: overrides.token ?? 'token-1',
    email: null,
    status: 'pending',
    createdByUserId: 'admin-1',
    acceptedByUserId: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    acceptedAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

function updateInvite(state: FakeState, inviteId: string, values: Partial<SignupInviteRecord>) {
  const index = state.invites.findIndex(invite => invite.id === inviteId)
  if (index === -1) return null

  state.invites[index] = {
    ...state.invites[index],
    ...values
  } as SignupInviteRecord
  return state.invites[index]
}
