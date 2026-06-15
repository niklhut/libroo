import { Effect } from 'effect'
import { getEmailVerificationStatus } from '../../services/auth.service'

export default effectHandler(event =>
  Effect.gen(function* () {
    return yield* getEmailVerificationStatus(event)
  }),
{ auth: 'session' })
