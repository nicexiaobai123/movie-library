import { userEndpoint, routeId } from '../../../http/handlers.ts'

export default userEndpoint((event, runtime, user) => {
  const id = routeId(event)
  return runtime.favorites.add(user, id)
}, { write: true })
