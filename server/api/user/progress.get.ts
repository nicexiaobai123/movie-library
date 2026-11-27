import { smallJson, optionalUserEndpoint } from '../../http/handlers.ts'
import type { ContinueWatching } from '../../../shared/types/library.ts'

// Signed-out visitors get an empty list so the home page can render one shape.
export default optionalUserEndpoint(async (event, runtime, user) => {
  if (!user) return { items: [] } satisfies ContinueWatching
  return runtime.progress.list(user)
})
