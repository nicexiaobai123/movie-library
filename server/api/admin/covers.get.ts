import { adminEndpoint } from '../../http/handlers.ts'

export interface MissingCover {
  titleId: string
  mediaId: string
  title: string
}

// Covers are generated in the browser, so the admin page asks which titles still
// need one and then uploads the frames. This endpoint only reports the work.
export default adminEndpoint((_event, { catalog }) => {
  const library = catalog.forAdmin()
  const items: MissingCover[] = []
  for (const title of library.titles) {
    if (title.posterPath) continue
    const row = library.items.find(item => item.titleId === title.id)
    if (!row || !row.available) continue
    items.push({ titleId: title.id, mediaId: row.id, title: title.title })
  }
  return { items }
})

