import { adminEndpoint } from '../../http/handlers.ts'
import { requireAdmin } from '../../http/access.ts'

export default adminEndpoint(requireAdmin)
