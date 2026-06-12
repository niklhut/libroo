import { Effect } from 'effect'
import { getEmailVerificationStatus } from '../../services/auth.service'
import { runEffect } from '../../utils/effect'

export default defineEventHandler(event =>
  runEffect(Effect.gen(function* () {
    return yield* getEmailVerificationStatus(event)
  }))
)
