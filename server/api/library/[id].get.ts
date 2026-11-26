import { LibraryError } from '../../domain/errors.ts'
import { endpoint, routeId } from '../../http/handlers.ts'

export default endpoint((event, { catalog }) => {
  const detail = catalog.detail(routeId(event))
  if (!detail) throw new LibraryError(404, '未找到这部影片。')
  return detail
})
