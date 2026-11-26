import { adminEndpoint, routeId, smallJson } from '../../../http/handlers.ts'
import { parseMediaEdit } from '../../../http/validation.ts'

export default adminEndpoint(async (event, { catalog }) => {
  const item = await catalog.edit(routeId(event), parseMediaEdit(await smallJson(event)))
  return { item }
}, { write: true })
