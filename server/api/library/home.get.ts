import { endpoint } from '../../http/handlers.ts'

export default endpoint((_event, { catalog }) => catalog.home())
