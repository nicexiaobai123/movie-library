import { adminEndpoint } from '../../http/handlers.ts'

export default adminEndpoint((_event, { catalog }) => catalog.forAdmin())
