import { Data, Effect } from 'effect'
import { roleIncludesAdmin } from '~~/shared/utils/auth-roles'

export interface AdminRoleActor {
  role?: string | string[] | null
}

export class AdminAccessForbiddenError extends Data.TaggedError('AdminForbiddenError')<{
  message: string
}> { }

export function requireAdmin<E>(
  actor: AdminRoleActor,
  makeForbiddenError: () => E
) {
  if (!roleIncludesAdmin(actor.role)) {
    return Effect.fail(makeForbiddenError())
  }

  return Effect.void
}
