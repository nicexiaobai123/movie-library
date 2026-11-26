import { setHeader } from 'h3'
import { endpoint, smallJson } from '../../http/handlers.ts'
import { userToken, writeUserSession } from '../../http/access.ts'
import { parseUserRegister } from '../../http/validation.ts'

export default endpoint(async (event, runtime) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const input = parseUserRegister(await smallJson(event))
  const session = await runtime.userAuth.register(input.username, input.password, event.node.req.socket.remoteAddress ?? 'local', userToken(event))
  writeUserSession(event, runtime, session.token, session.maxAge)
  return { username: session.username }
})
