import { Effect } from 'effect'
import { z } from 'zod'

const inviteBodySchema = z.object({
  email: z.preprocess(
    value => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().toLowerCase().email().optional()
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
