import { getAccountMethodStatus } from '../../services/auth.service'

export default effectHandler((_event, user) =>
  getAccountMethodStatus(user.id),
{ auth: 'session' })
