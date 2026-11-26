import { endpoint } from '../../http/handlers.ts'
import { clearUserSession, userToken } from '../../http/access.ts'

export default endpoint((event, runtime) => {
  runtime.userAuth.end(userToken(event))
  clearUserSession(event, runtime)
  return { username: null }
})
