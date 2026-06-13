import { Effect } from 'effect'
import * as z from 'zod'
import { setPendingEmailChange } from '../../services/auth.service'
import { runEffect } from '../../utils/effect'

const pendingEmailSchema = z.object({
  pendingEmail: z.email(),
  currentPassword: z.string().min(1)
})

export default defineEventHandler(async event =>
  runEffect(Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, pendingEmailSchema.parse),
      catch: error => createError({ statusCode: 400, message: 'Invalid pending email', data: error })
    })
    return yield* setPendingEmailChange(event, body.pendingEmail, body.currentPassword)
  }))
)
