import { getQuery } from 'h3'
import { endpoint } from '../../http/handlers.ts'
import { parseCatalogQuery } from '../../http/validation.ts'

export default endpoint((event, { catalog }) => {
  const { q, kind } = parseCatalogQuery(getQuery(event))
  const result = catalog.browse({ q, kind, actor: null, sort: 'newest', page: 1, pageSize: 60 })
  return { items: result.items }
})
