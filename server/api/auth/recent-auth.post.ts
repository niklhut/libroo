import { Effect } from 'effect'
import * as z from 'zod'
import { RecentAuthService, RecentAuthServiceLive } from '../../services/recent-auth.service'
import { effectHandler } from '../../utils/effectHandler'

const bodySchema = z.object({ password: z.string().min(1) })

export default effectHandler(event =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, bodySchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Password is required' })
    })
    const service = yield* RecentAuthService
    return yield* service.confirmPassword(event, body.password)
  }).pipe(Effect.provide(RecentAuthServiceLive)), { auth: 'session' })
