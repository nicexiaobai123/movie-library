import { optionalUserEndpoint } from '../../http/handlers.ts'
import type { FavoriteList } from '../../../shared/types/library.ts'

// An anonymous visitor gets an empty list rather than a 401, so the favourites
// page can render a signed-out state without special handling.
export default optionalUserEndpoint((_event, runtime, user) => {
  if (!user) return { items: [] } satisfies FavoriteList
  return runtime.favorites.list(user)
})
