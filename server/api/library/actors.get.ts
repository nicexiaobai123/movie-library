import { endpoint } from '../../http/handlers.ts'

// The actor index is derived from every published title's cast list.
export default endpoint((_event, { catalog }) => catalog.actors())
