import { smallJson, userEndpoint } from '../../http/handlers.ts'
import { parseProgress } from '../../http/validation.ts'

export default userEndpoint(async (event, runtime, user) => {
  const input = parseProgress(await smallJson(event))
  return runtime.progress.record(user, input)
}, { write: true })
