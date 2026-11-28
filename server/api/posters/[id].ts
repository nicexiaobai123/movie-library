import { setHeader } from 'h3'
import { endpoint, routeId } from '../../http/handlers.ts'
import { sendPoster } from '../../http/streams.ts'

export default endpoint(async (event, runtime) => {
  setHeader(event, 'Cache-Control', 'no-cache')
  await sendPoster(event, runtime, routeId(event))
})
