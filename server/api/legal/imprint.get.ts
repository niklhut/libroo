import { getLegalDocument } from '../../services/legal.service'

export default effectHandler(() =>
  getLegalDocument('imprint'),
{ auth: false })
