import { getQuery, setHeader } from 'h3'
import { endpoint, routeId } from '../../http/handlers.ts'
import { sendPoster } from '../../http/streams.ts'

// The same endpoint serves the 2:3 poster and the 16:9 backdrop.
export default endpoint(async (event, runtime) => {
  const variant = getQuery(event).variant === 'backdrop' ? 'backdrop' : 'poster'
  setHeader(event, 'Cache-Control', 'no-cache')
  await sendPoster(event, runtime, routeId(event), variant)
})
