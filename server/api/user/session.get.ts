import { optionalUserEndpoint } from '../../http/handlers.ts'

// Anonymous callers get { username: null } so the header can render either state.
export default optionalUserEndpoint((_event, _runtime, user) => ({ username: user?.username ?? null }))
