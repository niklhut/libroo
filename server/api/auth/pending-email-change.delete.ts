import { Effect } from 'effect'
import { clearPendingEmailChange } from '../../services/auth.service'
import { runEffect } from '../../utils/effect'

export default defineEventHandler(event =>
  runEffect(Effect.gen(function* () {
    return yield* clearPendingEmailChange(event)
  }))
)
