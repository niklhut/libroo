import { Context, Data, Effect, Layer } from 'effect'
import type { SignupInvite, SignupInviteCreateResult, SignupInvitePreview, SignupInviteStatus } from '~~/shared/types/signup-invite'
import { SignupInviteRepository } from '../repositories/signup-invite.repository'
import type { SignupInviteRecord } from '../repositories/signup-invite.repository'
import { AuditRepository } from '../repositories/audit.repository'
import type { EmailService } from './email.service'
import { sendEmail } from './email.service'
import { getAuthUrl } from '../utils/auth'
import { requireAdmin } from '../utils/admin-access'
import type { DatabaseError } from '../repositories/book.repository'
import type { DbService } from './db.service'
import { booleanConfigValue } from '~~/shared/utils/runtime-config'
import { getEmailCapabilities } from '../utils/email-capabilities'

const DEFAULT_INVITE_TTL_DAYS = 7
const MAX_INVITE_TTL_DAYS = 90
const DEFAULT_INVITE_PAGE_SIZE = 25
const MAX_INVITE_PAGE_SIZE = 100
const INVITE_RESERVATION_TTL_MS = 10 * 60 * 1000

export class InvalidSignupInviteError extends Data.TaggedError('InvalidSignupInviteError')<{
  message: string
}> { }

export class SignupInviteForbiddenError extends Data.TaggedError('SignupInviteForbiddenError')<{
  message: string
}> { }

export class SignupInviteDeliveryError extends Data.TaggedError('SignupInviteDeliveryError')<{
  message: string
}> { }

export interface CreateSignupInviteInput {
  email?: unknown
  expiresInDays?: unknown
}

export interface SignupAttemptInput {
  token?: unknown
  email?: unknown
}

export interface SignupInviteActor {
  id: string
  role?: string | null
}

export interface ListSignupInvitesInput {
  page?: unknown
  pageSize?: unknown
}

export interface SignupInviteServiceInterface {
  createInvite: (actor: SignupInviteActor, input: CreateSignupInviteInput) => Effect.Effect<SignupInviteCreateResult, SignupInviteForbiddenError | InvalidSignupInviteError | SignupInviteDeliveryError | DatabaseError, DbService | EmailService>
  listInvites: (actor: SignupInviteActor, input?: ListSignupInvitesInput) => Effect.Effect<{ invites: SignupInvite[], total: number, page: number, pageSize: number }, SignupInviteForbiddenError | InvalidSignupInviteError | DatabaseError, DbService>
  revokeInvite: (actor: SignupInviteActor, inviteId: string) => Effect.Effect<SignupInvite, SignupInviteForbiddenError | InvalidSignupInviteError | DatabaseError, DbService>
  getInvitePreview: (token: string) => Effect.Effect<SignupInvitePreview, InvalidSignupInviteError | DatabaseError, DbService>
  validateSignupAttempt: (input: SignupAttemptInput) => Effect.Effect<{ inviteId: string | null }, InvalidSignupInviteError | DatabaseError, DbService>
  reserveSignupAttempt: (input: SignupAttemptInput) => Effect.Effect<{ reservationToken: string | null }, InvalidSignupInviteError | DatabaseError, DbService>
  acceptInvite: (reservationToken: string, userId: string) => Effect.Effect<SignupInvite, InvalidSignupInviteError | DatabaseError, DbService>
  releaseInviteReservation: (reservationToken: string) => Effect.Effect<void, DatabaseError, DbService>
  deleteCompensatingSignupAccount: (userId: string) => Effect.Effect<boolean, DatabaseError, DbService>
}

export class SignupInviteService extends Context.Tag('SignupInviteService')<SignupInviteService, SignupInviteServiceInterface>() { }

export const SignupInviteServiceLive = Layer.effect(
  SignupInviteService,
  Effect.gen(function* () {
    const repository = yield* SignupInviteRepository
    const auditRepository = yield* AuditRepository

    return {
      createInvite: (actor, input) =>
        Effect.gen(function* () {
          yield* requireAdmin(actor, () => new SignupInviteForbiddenError({ message: 'Admin access required' }))
          yield* requireInviteOnlyMode()

          const normalized = yield* parseInviteInput(input)
          if (normalized.email && !getEmailCapabilities().inviteEmailEnabled) {
            return yield* Effect.fail(new InvalidSignupInviteError({
              message: 'Invite email is not available because email sending is not configured. Create an invite link instead.'
            }))
          }
          const expiresAt = new Date(Date.now() + normalized.expiresInDays * 24 * 60 * 60 * 1000)
          const { invite, token } = yield* repository.create({
            email: normalized.email,
            createdByUserId: actor.id,
            expiresAt
          })
          const inviteUrl = buildSignupInviteUrl(token)

          if (normalized.email) {
            yield* sendInviteEmail(normalized.email, inviteUrl, expiresAt)
          }

          yield* auditRepository.create({
            category: 'admin',
            actorUserId: actor.id,
            targetUserId: null,
            action: 'signup_invite.created',
            metadata: {
              inviteId: invite.id,
              email: invite.email,
              expiresAt: invite.expiresAt
            }
          })

          return {
            invite: toSignupInvite(invite, inviteUrl),
            token,
            inviteUrl
          }
        }),

      listInvites: (actor, input = {}) =>
        Effect.gen(function* () {
          yield* requireAdmin(actor, () => new SignupInviteForbiddenError({ message: 'Admin access required' }))
          yield* requireInviteOnlyMode()
          const page = parsePositiveInteger(input.page, 1)
          const pageSize = Math.min(MAX_INVITE_PAGE_SIZE, parsePositiveInteger(input.pageSize, DEFAULT_INVITE_PAGE_SIZE))
          const { invites, total } = yield* repository.list({
            limit: pageSize,
            offset: (page - 1) * pageSize
          })
          const now = new Date()

          return {
            invites: invites.map(invite => toSignupInvite({
              ...invite,
              status: effectiveSignupInviteStatus(invite, now)
            })),
            total,
            page,
            pageSize
          }
        }),

      revokeInvite: (actor, inviteId) =>
        Effect.gen(function* () {
          yield* requireAdmin(actor, () => new SignupInviteForbiddenError({ message: 'Admin access required' }))
          yield* requireInviteOnlyMode()

          if (!inviteId) {
            return yield* Effect.fail(new InvalidSignupInviteError({ message: 'Invite id is required' }))
          }

          const invite = yield* repository.revoke(inviteId, new Date())
          if (!invite) {
            return yield* Effect.fail(new InvalidSignupInviteError({ message: 'Invite not found' }))
          }

          yield* auditRepository.create({
            category: 'admin',
            actorUserId: actor.id,
            targetUserId: invite.acceptedByUserId,
            action: 'signup_invite.revoked',
            metadata: {
              inviteId: invite.id,
              email: invite.email,
              previousStatus: 'pending',
              newStatus: invite.status
            }
          })

          return toSignupInvite(invite)
        }),

      getInvitePreview: token =>
        Effect.gen(function* () {
          if (!token) {
            return yield* Effect.fail(new InvalidSignupInviteError({ message: 'Invite token is required' }))
          }

          const invite = yield* repository.findByToken(token)
          if (!invite) {
            return { email: null, status: null }
          }

          const status = effectiveSignupInviteStatus(invite, new Date())
          return {
            email: status === 'pending' ? invite.email : null,
            status
          }
        }),

      validateSignupAttempt: input =>
        Effect.gen(function* () {
          const { email, token } = yield* parseSignupAttempt(input)

          if (publicRegistrationEnabled()) {
            return { inviteId: null }
          }

          if (!token) {
            return yield* Effect.fail(new InvalidSignupInviteError({ message: 'An invite is required to create an account' }))
          }

          if (!email) {
            return yield* Effect.fail(new InvalidSignupInviteError({ message: 'A valid email address is required' }))
          }

          const invite = yield* repository.findByToken(token)
          const now = new Date()
          const validation = validateSignupInvite(invite, email, now)

          if (!validation.valid) {
            if (invite && validation.status === 'expired' && invite.status === 'pending') {
              yield* repository.markExpired(invite.id, now)
            }
            return yield* Effect.fail(new InvalidSignupInviteError({ message: validation.message }))
          }

          if (yield* repository.emailExists(email)) {
            return yield* Effect.fail(new InvalidSignupInviteError({ message: 'An account already exists for this email address' }))
          }

          return { inviteId: validation.invite.id }
        }),

      reserveSignupAttempt: input =>
        Effect.gen(function* () {
          const { email, token } = yield* parseSignupAttempt(input)

          if (publicRegistrationEnabled()) {
            return { reservationToken: null }
          }

          if (!token) {
            return yield* Effect.fail(new InvalidSignupInviteError({ message: 'An invite is required to create an account' }))
          }

          if (!email) {
            return yield* Effect.fail(new InvalidSignupInviteError({ message: 'A valid email address is required' }))
          }

          const now = new Date()
          const reservation = yield* repository.reserveByToken(
            token,
            email,
            now,
            new Date(now.getTime() + INVITE_RESERVATION_TTL_MS)
          )

          if (!reservation) {
            const invite = yield* repository.findByToken(token)
            const validation = validateSignupInvite(invite, email, now)

            if (!validation.valid) {
              if (invite && validation.status === 'expired' && invite.status === 'pending') {
                yield* repository.markExpired(invite.id, now)
              }
              return yield* Effect.fail(new InvalidSignupInviteError({ message: validation.message }))
            }

            return yield* Effect.fail(new InvalidSignupInviteError({ message: 'This invite is already being used' }))
          }

          if (yield* repository.emailExists(email)) {
            yield* repository.releaseReservation(reservation.reservationToken, now)
            return yield* Effect.fail(new InvalidSignupInviteError({ message: 'An account already exists for this email address' }))
          }

          return { reservationToken: reservation.reservationToken }
        }),

      acceptInvite: (reservationToken, userId) =>
        Effect.gen(function* () {
          if (!reservationToken || !userId) {
            return yield* Effect.fail(new InvalidSignupInviteError({ message: 'Invite and user are required' }))
          }

          const invite = yield* repository.markAcceptedReservation(reservationToken, userId, new Date())
          if (!invite) {
            return yield* Effect.fail(new InvalidSignupInviteError({ message: 'Invite is no longer available' }))
          }

          return toSignupInvite(invite)
        }),

      releaseInviteReservation: reservationToken =>
        Effect.gen(function* () {
          if (!reservationToken) return
          yield* repository.releaseReservation(reservationToken, new Date())
        }),

      deleteCompensatingSignupAccount: userId =>
        repository.deleteCompensatingAccount(userId)
    }
  })
)

export const createSignupInvite = (actor: SignupInviteActor, input: CreateSignupInviteInput) =>
  Effect.flatMap(SignupInviteService, service => service.createInvite(actor, input))

export const listSignupInvites = (actor: SignupInviteActor, input?: ListSignupInvitesInput) =>
  Effect.flatMap(SignupInviteService, service => service.listInvites(actor, input))

export const revokeSignupInvite = (actor: SignupInviteActor, inviteId: string) =>
  Effect.flatMap(SignupInviteService, service => service.revokeInvite(actor, inviteId))

export const getSignupInvitePreview = (token: string) =>
  Effect.flatMap(SignupInviteService, service => service.getInvitePreview(token))

export const validateSignupAttempt = (input: SignupAttemptInput) =>
  Effect.flatMap(SignupInviteService, service => service.validateSignupAttempt(input))

export const reserveSignupAttempt = (input: SignupAttemptInput) =>
  Effect.flatMap(SignupInviteService, service => service.reserveSignupAttempt(input))

export const acceptSignupInvite = (reservationToken: string, userId: string) =>
  Effect.flatMap(SignupInviteService, service => service.acceptInvite(reservationToken, userId))

export const releaseSignupInviteReservation = (reservationToken: string) =>
  Effect.flatMap(SignupInviteService, service => service.releaseInviteReservation(reservationToken))

export const deleteCompensatingSignupAccount = (userId: string) =>
  Effect.flatMap(SignupInviteService, service => service.deleteCompensatingSignupAccount(userId))

export function normalizeCreateSignupInviteInput(input: CreateSignupInviteInput) {
  const email = normalizeEmail(input.email)
  const expiresInDays = normalizeInviteTtl(input.expiresInDays)
  return { email, expiresInDays }
}

export function effectiveSignupInviteStatus(invite: Pick<SignupInviteRecord, 'status' | 'expiresAt'>, now: Date): SignupInviteStatus {
  if (invite.status === 'pending' && invite.expiresAt.getTime() <= now.getTime()) {
    return 'expired'
  }

  return invite.status
}

export function validateSignupInvite(invite: SignupInviteRecord | null, email: string, now: Date) {
  if (!invite) {
    return { valid: false as const, status: null, message: 'Invite not found' }
  }

  const status = effectiveSignupInviteStatus(invite, now)
  if (status !== 'pending') {
    return { valid: false as const, status, message: inviteStatusMessage(status) }
  }

  if (invite.email && invite.email !== email) {
    return { valid: false as const, status, message: 'This invite was sent to a different email address' }
  }

  return { valid: true as const, status, invite }
}

export function publicRegistrationEnabled() {
  try {
    if (typeof useRuntimeConfig === 'function') {
      const config = useRuntimeConfig()
      return booleanConfigValue(config.public?.registrationEnabled, true)
    }
  } catch {
    // Runtime config is unavailable in some CLI and test contexts.
  }

  return booleanConfigValue(process.env.NUXT_PUBLIC_REGISTRATION_ENABLED, true)
}

function sendInviteEmail(email: string, inviteUrl: string, expiresAt: Date) {
  const expiresOn = expiresAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

  return sendEmail({
    to: email,
    subject: 'Your Libroo invite',
    text: [
      'You have been invited to join Libroo.',
      '',
      `Create your account with this link: ${inviteUrl}`,
      '',
      `This invite expires on ${expiresOn}.`
    ].join('\n'),
    html: [
      '<p>You have been invited to join Libroo.</p>',
      `<p><a href="${escapeHtml(inviteUrl)}">Create your account</a></p>`,
      `<p>This invite expires on ${escapeHtml(expiresOn)}.</p>`
    ].join('')
  }).pipe(
    Effect.mapError(error => new SignupInviteDeliveryError({ message: error.message }))
  )
}

function toSignupInvite(invite: SignupInviteRecord, inviteUrl?: string): SignupInvite {
  return {
    id: invite.id,
    email: invite.email,
    status: invite.status,
    createdByUserId: invite.createdByUserId,
    acceptedByUserId: invite.acceptedByUserId,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt,
    revokedAt: invite.revokedAt,
    createdAt: invite.createdAt,
    updatedAt: invite.updatedAt,
    inviteUrl
  }
}

function requireInviteOnlyMode() {
  if (publicRegistrationEnabled()) {
    return Effect.fail(new InvalidSignupInviteError({
      message: 'Invite management is only available when public registration is disabled'
    }))
  }

  return Effect.void
}

function normalizeInviteTtl(value: unknown) {
  const parsed = Number(value ?? DEFAULT_INVITE_TTL_DAYS)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_INVITE_TTL_DAYS) {
    throw new InvalidSignupInviteError({ message: `Invite expiration must be between 1 and ${MAX_INVITE_TTL_DAYS} days` })
  }
  return parsed
}

function parsePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value ?? fallback)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeEmail(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new InvalidSignupInviteError({ message: 'Enter a valid email address' })
  }
  return trimmed
}

function parseInviteInput(input: CreateSignupInviteInput) {
  return Effect.try({
    try: () => normalizeCreateSignupInviteInput(input),
    catch: error => error instanceof InvalidSignupInviteError
      ? error
      : new InvalidSignupInviteError({ message: 'Invalid invite request' })
  })
}

function parseSignupAttempt(input: SignupAttemptInput) {
  return Effect.try({
    try: () => ({
      email: normalizeEmail(input.email),
      token: normalizeToken(input.token)
    }),
    catch: error => error instanceof InvalidSignupInviteError
      ? error
      : new InvalidSignupInviteError({ message: 'Invalid signup request' })
  })
}

function normalizeToken(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function inviteStatusMessage(status: SignupInviteStatus) {
  if (status === 'expired') return 'This invite has expired'
  if (status === 'revoked') return 'This invite has been revoked'
  if (status === 'accepted') return 'This invite has already been accepted'
  return 'This invite cannot be used'
}

function buildSignupInviteUrl(token: string) {
  const url = new URL('/register', getAuthUrl())
  url.searchParams.set('invite', token)
  return url.toString()
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}
