// The pager always shows at most five page buttons and slides as the reader moves.
// A list never changes the strip's size while paging, so the bar keeps its width.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pageSlots, pagerWindow } from '../../shared/pager.ts'

const text = (slots) => slots.join(' ')

test('a long list always draws exactly five pages', () => {
  for (const total of [6, 8, 19, 40, 500]) {
    for (let page = 1; page <= total; page++) {
      const slots = pageSlots(page, total)
      assert.equal(slots.length, pagerWindow, `total=${total} page=${page}: ${text(slots)}`)
      assert.ok(slots.includes(page), `page ${page} must be in ${text(slots)}`)
    }
  }
})

test('the window sits at the start, slides, then stops at the end', () => {
  assert.equal(text(pageSlots(1, 19)), '1 2 3 4 5')
  assert.equal(text(pageSlots(2, 19)), '1 2 3 4 5')
  assert.equal(text(pageSlots(3, 19)), '1 2 3 4 5')
  assert.equal(text(pageSlots(4, 19)), '2 3 4 5 6')
  assert.equal(text(pageSlots(9, 19)), '7 8 9 10 11')
  assert.equal(text(pageSlots(19, 19)), '15 16 17 18 19')
})

test('a short list shows every page it has', () => {
  assert.equal(text(pageSlots(1, 1)), '1')
  assert.equal(text(pageSlots(2, 3)), '1 2 3')
  assert.equal(text(pageSlots(5, 5)), '1 2 3 4 5')
})

test('the strip is the same size whatever page is current', () => {
  for (const total of [6, 19, 40]) {
    const first = pageSlots(1, total).length
    for (let page = 1; page <= total; page++) {
      assert.equal(pageSlots(page, total).length, first, `total=${total} page=${page}`)
    }
  }
})

test('pages are consecutive, unique and inside the list', () => {
  for (const total of [6, 19, 40]) {
    for (let page = 1; page <= total; page++) {
      const slots = pageSlots(page, total)
      assert.equal(new Set(slots).size, slots.length, 'no repeats')
      assert.equal(slots[0], Math.min(...slots))
      for (let index = 1; index < slots.length; index++) {
        assert.equal(slots[index], slots[index - 1] + 1, 'consecutive pages')
      }
      assert.ok(slots[0] >= 1 && slots.at(-1) <= total, 'stays inside the list')
    }
  }
})

test('out-of-range pages are clamped and an empty list has none', () => {
  assert.equal(text(pageSlots(0, 19)), text(pageSlots(1, 19)))
  assert.equal(text(pageSlots(999, 19)), text(pageSlots(19, 19)))
  assert.deepEqual(pageSlots(1, 0), [])
})
