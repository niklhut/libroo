import { getLegalStatus } from '../../services/legal.service'

export default effectHandler(() =>
  getLegalStatus(),
{ auth: false })
