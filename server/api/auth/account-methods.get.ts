import { getAccountMethodStatus } from '../../services/auth.service'

export default effectHandler((event, user) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return getAccountMethodStatus(user.id)
},
{ auth: 'session' })
