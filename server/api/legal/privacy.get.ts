import { getLegalDocument } from '../../services/legal.service'

export default effectHandler(() =>
  getLegalDocument('privacy'),
{ auth: false })
