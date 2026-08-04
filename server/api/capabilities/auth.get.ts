import { getAuthCapabilityFlags } from '../../services/auth-capability.service'

export default effectHandler(() =>
  getAuthCapabilityFlags(),
{ auth: false })
