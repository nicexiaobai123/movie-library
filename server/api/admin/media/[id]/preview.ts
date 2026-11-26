import { setHeader } from 'h3'
import { sendVideo } from '../../../../http/streams.ts'
import { adminEndpoint } from '../../../../http/handlers.ts'

// Administrators may preview a pending file to extract its first frame.
// It reuses the streaming/Range handler but is guarded like every admin API.
export default adminEndpoint(async (event, runtime) => {
  setHeader(event, 'Cache-Control', 'no-store')
  await sendVideo(event, runtime, false, id => runtime.catalog.preview(id))
})
