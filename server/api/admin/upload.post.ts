import { getQuery, setResponseStatus } from 'h3'
import { adminEndpoint, uploadInput } from '../../http/handlers.ts'

export default adminEndpoint(async (event, { catalog }) => {
  const item = await catalog.uploadVideo(uploadInput(event, getQuery(event).name))
  setResponseStatus(event, 201)
  return { item }
}, { write: true })
