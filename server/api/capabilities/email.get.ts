import { getEmailCapabilityFlags } from '../../services/email-capability.service'

export default effectHandler(() =>
  getEmailCapabilityFlags(),
{ auth: false })
