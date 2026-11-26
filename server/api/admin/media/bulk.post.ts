import { setResponseStatus } from 'h3'
import { adminEndpoint, smallJson } from '../../../http/handlers.ts'
import { parseBulkEdit } from '../../../http/validation.ts'

export default adminEndpoint(async (event, { catalog }) => {
  const result = await catalog.publishMany(parseBulkEdit(await smallJson(event)))
  setResponseStatus(event, result.skipped.length && !result.published.length ? 409 : 200)
  return result
}, { write: true })
