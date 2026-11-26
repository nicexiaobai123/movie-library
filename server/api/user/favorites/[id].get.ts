import { optionalUserEndpoint, routeId } from '../../../http/handlers.ts'

export default optionalUserEndpoint((event, runtime, user) => {
  const id = routeId(event)
  if (!user) return { favorited: false }
  return runtime.favorites.state(user, id)
})
