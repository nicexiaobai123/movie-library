import { adminEndpoint, smallJson } from '../../http/handlers.ts'
import { sessionToken, writeSession } from '../../http/access.ts'
import { parseCredentials } from '../../http/validation.ts'

export default adminEndpoint(async (event, runtime) => {
  const input = parseCredentials(await smallJson(event))
  const session = await runtime.auth.login(input.username, input.password, event.node.req.socket.remoteAddress ?? 'local', sessionToken(event))
  writeSession(event, runtime, session.token, session.maxAge)
  return { username: session.username }
}, { write: true, login: true })
