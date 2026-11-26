import { getQuery } from 'h3'
import { endpoint } from '../../http/handlers.ts'
import { parseCatalogQuery } from '../../http/validation.ts'

export default endpoint((event, { catalog }) => {
  const { q, kind } = parseCatalogQuery(getQuery(event))
  return { items: catalog.cards(q, kind) }
})
