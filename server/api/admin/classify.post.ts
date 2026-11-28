import { adminEndpoint, smallJson } from '../../http/handlers.ts'
import { parseClassify } from '../../http/validation.ts'

// Batch re-classification: the escape hatch for files whose names produced the
// wrong kind, without editing them one at a time.
export default adminEndpoint(async (event, { catalog }) => {
  return catalog.classifyMany(parseClassify(await smallJson(event)))
}, { write: true })
