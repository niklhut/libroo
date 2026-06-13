import { Effect } from 'effect'
import * as z from 'zod'
import { resendVerificationEmail } from '../../services/auth.service'
import { runEffect } from '../../utils/effect'

const resendVerificationSchema = z.object({
  currentPassword: z.string().optional()
}).optional()

export default defineEventHandler(event =>
  runEffect(Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, body => resendVerificationSchema.parse(body || undefined)),
      catch: error => createError({ statusCode: 400, message: 'Invalid resend request', data: error })
    })
    return yield* resendVerificationEmail(event, body?.currentPassword)
  }))
)
