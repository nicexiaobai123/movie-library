import { setResponseStatus } from 'h3'
import { adminEndpoint } from '../../http/handlers.ts'

export default adminEndpoint((event, { catalog }) => {
  setResponseStatus(event, 202)
  return catalog.scanner.start()
}, { write: true })
