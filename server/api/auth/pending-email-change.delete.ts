import { Effect } from 'effect'
import { clearPendingEmailChange } from '../../services/auth.service'

export default effectHandler(event =>
  Effect.gen(function* () {
    return yield* clearPendingEmailChange(event)
  }),
{ auth: 'session' })
