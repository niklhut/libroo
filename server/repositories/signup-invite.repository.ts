import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'
import { and, desc, eq, sql } from 'drizzle-orm'
import { signupInvites, user } from 'hub:db:schema'
import type { SignupInviteStatus } from '~~/shared/types/signup-invite'
import { DatabaseError } from './book.repository'
import { DbService } from '../services/db.service'
import type { DbServiceInterface } from '../services/db.service'

export interface SignupInviteRecord {
  id: string
  tokenHash: string
  email: string | null
  status: SignupInviteStatus
  createdByUserId: string
  acceptedByUserId: string | null
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateSignupInviteRecordInput {
  email: string | null
  createdByUserId: string
  expiresAt: Date
}

export interface SignupInviteRepositoryInterface {
  create: (input: CreateSignupInviteRecordInput) => Effect.Effect<{ invite: SignupInviteRecord, token: string }, DatabaseError, DbService>
  findByToken: (token: string) => Effect.Effect<SignupInviteRecord | null, DatabaseError, DbService>
  list: (pagination: { limit: number, offset: number }) => Effect.Effect<{ invites: SignupInviteRecord[], total: number }, DatabaseError, DbService>
  markExpired: (inviteId: string, now: Date) => Effect.Effect<SignupInviteRecord | null, DatabaseError, DbService>
  markAccepted: (inviteId: string, userId: string, now: Date) => Effect.Effect<SignupInviteRecord | null, DatabaseError, DbService>
  revoke: (inviteId: string, now: Date) => Effect.Effect<SignupInviteRecord | null, DatabaseError, DbService>
  emailExists: (email: string) => Effect.Effect<boolean, DatabaseError, DbService>
}

export class SignupInviteRepository extends Context.Tag('SignupInviteRepository')<SignupInviteRepository, SignupInviteRepositoryInterface>() { }

export const SignupInviteRepositoryLive = Layer.effect(
  SignupInviteRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    return {
      create: input =>
        Effect.tryPromise({
          try: async () => {
            const token = createInviteToken()
            const tokenHash = hashInviteToken(token)
            const now = new Date()
            const record = {
              id: randomUUID(),
              tokenHash,
              email: input.email,
              status: 'pending' as const,
              createdByUserId: input.createdByUserId,
              acceptedByUserId: null,
              expiresAt: input.expiresAt,
              acceptedAt: null,
              revokedAt: null,
              createdAt: now,
              updatedAt: now
            }

            await dbService.db.insert(signupInvites).values(record)
            return { invite: record, token }
          },
          catch: error => new DatabaseError({
            message: `Failed to create signup invite: ${error}`,
            operation: 'signupInvite.create'
          })
        }),

      findByToken: token =>
        Effect.tryPromise({
          try: async () => {
            const rows = await dbService.db
              .select()
              .from(signupInvites)
              .where(eq(signupInvites.tokenHash, hashInviteToken(token)))
              .limit(1)

            return rows[0] ?? null
          },
          catch: error => new DatabaseError({
            message: `Failed to load signup invite: ${error}`,
            operation: 'signupInvite.findByToken'
          })
        }),

      list: pagination =>
        Effect.tryPromise({
          try: async () => {
            const [rows, totals] = await Promise.all([
              dbService.db
                .select()
                .from(signupInvites)
                .orderBy(desc(signupInvites.createdAt))
                .limit(pagination.limit)
                .offset(pagination.offset),
              dbService.db
                .select({ count: sql<number>`count(*)` })
                .from(signupInvites)
            ])

            return {
              invites: rows,
              total: normalizeCount(totals[0]?.count)
            }
          },
          catch: error => new DatabaseError({
            message: `Failed to list signup invites: ${error}`,
            operation: 'signupInvite.list'
          })
        }),

      markExpired: (inviteId, now) =>
        updateInviteStatus(dbService.db, inviteId, 'expired', {
          updatedAt: now
        }, 'signupInvite.markExpired', true),

      markAccepted: (inviteId, userId, now) =>
        updateInviteStatus(dbService.db, inviteId, 'accepted', {
          acceptedByUserId: userId,
          acceptedAt: now,
          updatedAt: now
        }, 'signupInvite.markAccepted', true),

      revoke: (inviteId, now) =>
        updateInviteStatus(dbService.db, inviteId, 'revoked', {
          revokedAt: now,
          updatedAt: now
        }, 'signupInvite.revoke', true),

      emailExists: email =>
        Effect.tryPromise({
          try: async () => {
            const rows = await dbService.db
              .select({ id: user.id })
              .from(user)
              .where(eq(user.email, email))
              .limit(1)

            return rows.length > 0
          },
          catch: error => new DatabaseError({
            message: `Failed to check signup email: ${error}`,
            operation: 'signupInvite.emailExists'
          })
        })
    }
  })
)

function updateInviteStatus(
  db: DbServiceInterface['db'],
  inviteId: string,
  status: SignupInviteStatus,
  values: Partial<typeof signupInvites.$inferInsert>,
  operation: string,
  pendingOnly = false
) {
  return Effect.tryPromise({
    try: async () => {
      const rows = await db
        .update(signupInvites)
        .set({ ...values, status })
        .where(pendingOnly
          ? and(eq(signupInvites.id, inviteId), eq(signupInvites.status, 'pending'))
          : eq(signupInvites.id, inviteId))
        .returning()

      return rows[0] ?? null
    },
    catch: error => new DatabaseError({
      message: `Failed to update signup invite: ${error}`,
      operation
    })
  })
}

export function createInviteToken() {
  return randomBytes(32).toString('base64url')
}

export function hashInviteToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function normalizeCount(value: number | string | bigint | null | undefined) {
  if (typeof value === 'bigint') return Number(value)
  const count = Number(value ?? 0)
  return Number.isFinite(count) ? count : 0
}

export const createSignupInviteRecord = (input: CreateSignupInviteRecordInput) =>
  Effect.flatMap(SignupInviteRepository, repo => repo.create(input))

export const findSignupInviteByToken = (token: string) =>
  Effect.flatMap(SignupInviteRepository, repo => repo.findByToken(token))

export const listSignupInviteRecords = (pagination: { limit: number, offset: number }) =>
  Effect.flatMap(SignupInviteRepository, repo => repo.list(pagination))

export const markSignupInviteExpired = (inviteId: string, now: Date) =>
  Effect.flatMap(SignupInviteRepository, repo => repo.markExpired(inviteId, now))

export const markSignupInviteAccepted = (inviteId: string, userId: string, now: Date) =>
  Effect.flatMap(SignupInviteRepository, repo => repo.markAccepted(inviteId, userId, now))

export const revokeSignupInviteRecord = (inviteId: string, now: Date) =>
  Effect.flatMap(SignupInviteRepository, repo => repo.revoke(inviteId, now))

export const signupEmailExists = (email: string) =>
  Effect.flatMap(SignupInviteRepository, repo => repo.emailExists(email))
