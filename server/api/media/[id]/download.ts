import { endpoint } from '../../../http/handlers.ts'
import { sendVideo } from '../../../http/streams.ts'

export default endpoint((event, runtime) => sendVideo(event, runtime, true))
