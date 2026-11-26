import { getQuery, setResponseStatus } from 'h3'
import { adminEndpoint, uploadInput } from '../../http/handlers.ts'

export default adminEndpoint(async (event, { catalog }) => {
  const path = await catalog.uploadPoster(uploadInput(event, getQuery(event).name))
  setResponseStatus(event, 201)
  return { path }
}, { write: true })
