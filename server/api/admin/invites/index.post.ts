import { Effect } from 'effect'
import { z } from 'zod'

const inviteBodySchema = z.object({
  email: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value
      const email = value.trim().toLowerCase()
      return email === '' ? undefined : email
    },
    z.email().optional()
  ),
  expiresInDays: z.coerce.number().int().min(1).max(90).optional()
}).strict()

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, input => inviteBodySchema.parse(input ?? {})),
      catch: () => new InvalidSignupInviteError({ message: 'Invalid invite request body' })
    })

    return yield* createSignupInvite(user, body)
  })
)
