import { smallJson, userEndpoint } from '../../http/handlers.ts'
import { parsePasswordChange } from '../../http/validation.ts'
import { clearUserSession } from '../../http/access.ts'

// Changing the password revokes every session, so the caller is signed out too.
export default userEndpoint(async (event, runtime, user) => {
  const input = parsePasswordChange(await smallJson(event))
  await runtime.userAuth.changePassword(user, input.currentPassword, input.newPassword, event.node.req.socket.remoteAddress ?? 'local')
  clearUserSession(event, runtime)
  return { changed: true }
}, { write: true })
