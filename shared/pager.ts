// Page numbers for a pager.
//
// The strip always shows at most five page buttons and slides as the reader moves,
// which is the shape the catalogue uses. Nothing changes size between pages: a list
// with five or more pages always draws exactly five numbers, and a shorter one draws
// all of its pages.
//
// For a list of 19 pages:
//   page 1:   [1] 2 3 4 5
//   page 3:   1 2 [3] 4 5
//   page 9:   7 8 [9] 10 11
//   page 19:  15 16 17 18 [19]
export const pagerWindow = 5

export function pageSlots(current: number, total: number, window = pagerWindow): number[] {
  if (total <= 0) return []
  // A short list shows every page it has; there is nothing to slide.
  if (total <= window) return Array.from({ length: total }, (_, index) => index + 1)

  const page = Math.min(Math.max(1, current), total)
  // Centre the window on the current page, then push it back inside the ends so the
  // strip stays full at the first and last pages instead of shrinking there.
  let start = page - Math.floor(window / 2)
  start = Math.max(1, Math.min(start, total - window + 1))
  return Array.from({ length: window }, (_, index) => start + index)
}
