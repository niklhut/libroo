import { getLegalDocument } from '../../services/legal.service'

export default effectHandler(() =>
  getLegalDocument('terms'),
{ auth: false })
