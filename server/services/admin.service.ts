import { Context, Data, Effect, Layer } from 'effect'
import type { AdminUser, AdminUsersPage } from '~~/shared/types/admin'
import { AdminRepository } from '../repositories/admin.repository'
import { DatabaseError } from '../repositories/book.repository'
import { auth } from '../utils/auth'

const DEFAULT_ADMIN_PAGE_SIZE = 25
const MAX_ADMIN_PAGE_SIZE = 100

export class AdminForbiddenError extends Data.TaggedError('AdminForbiddenError')<{
  message: string
}> { }

export class InvalidAdminRequestError extends Data.TaggedError('InvalidAdminRequestError')<{
  message: string
}> { }

interface ListUsersInput {
  headers: Headers
  page?: unknown
  pageSize?: unknown
}

interface BetterAuthAdminUser {
  id: string
  name: string
  email: string
  createdAt: string | Date
  updatedAt: string | Date
  role?: string | null
  banned?: boolean | null
  banReason?: string | null
  banExpires?: string | Date | null
}

export interface AdminServiceInterface {
  listUsers: (
    input: ListUsersInput
  ) => Effect.Effect<AdminUsersPage, AdminForbiddenError | InvalidAdminRequestError | DatabaseError, DbService>
}

export class AdminService extends Context.Tag('AdminService')<AdminService, AdminServiceInterface>() { }

export const AdminServiceLive = Layer.effect(
  AdminService,
  Effect.gen(function* () {
    const adminRepository = yield* AdminRepository

    return {
      listUsers: input =>
        Effect.gen(function* () {
          const page = parsePositiveInteger(input.page, 1)
          const pageSize = Math.min(MAX_ADMIN_PAGE_SIZE, parsePositiveInteger(input.pageSize, DEFAULT_ADMIN_PAGE_SIZE))
          const offset = (page - 1) * pageSize

          const response = yield* Effect.tryPromise({
            try: () => auth.api.listUsers({
              headers: input.headers,
              query: {
                limit: pageSize,
                offset,
                sortBy: 'createdAt',
                sortDirection: 'desc'
              }
            }),
            catch: error => mapBetterAuthError(error)
          })

          const lastActiveByUserId = yield* adminRepository.listLastActiveByUserIds(response.users.map(user => user.id))

          return {
            users: response.users.map(user => toAdminUser(user, lastActiveByUserId[user.id] ?? null)),
            total: response.total,
            page,
            pageSize
          }
        })
    }
  })
)

export const listAdminUsers = (input: ListUsersInput) =>
  Effect.flatMap(AdminService, service => service.listUsers(input))

function roleIncludesAdmin(role: string | null | undefined) {
  return (role ?? 'user').split(',').map(part => part.trim()).includes('admin')
}

function parsePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function toAdminUser(user: BetterAuthAdminUser, lastActiveAt: Date | null): AdminUser {
  const isAdmin = roleIncludesAdmin(user.role)

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastActiveAt,
    role: isAdmin ? 'admin' : 'user',
    isAdmin,
    status: user.banned ? 'banned' : 'active',
    banReason: user.banReason ?? null,
    banExpires: user.banExpires ?? null
  }
}

function mapBetterAuthError(error: unknown) {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error
    ? Number(error.statusCode)
    : undefined

  if (statusCode === 401 || statusCode === 403) {
    return new AdminForbiddenError({ message: 'Admin access required' })
  }

  if (statusCode && statusCode >= 500) {
    return new DatabaseError({
      message: getBetterAuthErrorMessage(error),
      operation: 'admin.listUsers'
    })
  }

  return new InvalidAdminRequestError({
    message: getBetterAuthErrorMessage(error)
  })
}

function getBetterAuthErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message

  if (typeof error === 'object' && error && 'message' in error) {
    return String(error.message)
  }

  return 'Unable to list users'
}
