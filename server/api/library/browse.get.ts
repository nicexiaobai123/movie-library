import { getQuery } from 'h3'
import { endpoint } from '../../http/handlers.ts'
import { parseBrowseQuery } from '../../http/validation.ts'

export default endpoint((event, { catalog }) => catalog.browse(parseBrowseQuery(getQuery(event))))
