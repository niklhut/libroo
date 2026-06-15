import { Effect } from 'effect'
import { getEmailCapabilityFlags } from '../../services/email-capability.service'

export default effectHandler(() =>
  Effect.gen(function* () {
    return yield* getEmailCapabilityFlags()
  }),
{ auth: false })
