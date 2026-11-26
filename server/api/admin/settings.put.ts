import { adminEndpoint, smallJson } from '../../http/handlers.ts'
import { parseSettings } from '../../http/validation.ts'

export default adminEndpoint(async (event, { catalog }) => {
  return catalog.saveSettings(parseSettings(await smallJson(event)))
}, { write: true })
