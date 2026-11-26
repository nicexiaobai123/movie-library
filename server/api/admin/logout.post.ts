import { adminEndpoint } from '../../http/handlers.ts'
import { clearSession, sessionToken } from '../../http/access.ts'

export default adminEndpoint((event, runtime) => {
  runtime.auth.end(sessionToken(event))
  clearSession(event, runtime)
  return { ok: true }
}, { write: true })
