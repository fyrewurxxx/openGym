// @vitest-environment happy-dom
// The Program Block editor (docs/dev/PROGRAM_BLOCKS.md §7.3): a draft that only reaches
// S.programBlocks on Save, with the weekday picker, the Progression Table and the chain target.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({
    S: state.S,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), exercisePicker: vi.fn(() => ({ close: vi.fn() })), menuSheet: vi.fn(), confirmSheet: vi.fn(),
}))

import { blockEditorSheet } from './BlockEditorSheet.jsx'
import { dayAssignSheet, exercisePicker, menuSheet, confirmSheet } from '../sheets.jsx'
import { useUI } from '../store/useUI.js'
import { blockRoutineIdsOn } from '../lib/program-block.js'

const routines = [
  { id: 'a', name: 'Upper', emoji: null, ex: [{ id: '0025' }, { id: 'plank', mode: 'time' }] },
  { id: 'b', name: 'Lower', emoji: null, ex: [{ id: '0032' }] },
]
const saved = (over = {}) => ({
  id: 'b1', name: 'Operator', daysPerWeek: 2, weeks: 3, days: { 1: 'a', 4: 'b' },
  table: { '0025': { 1: { pct: 70, sets: 3, reps: 5 }, 2: { pct: 80, sets: 3, reps: 5 }, 3: { pct: 90, sets: 1, reps: 3 } } },
  nextBlockId: null, ...over,
})
const baseS = over => ({ unit: 'kg', routines, week: {}, dayPlan: {}, workouts: [], programBlocks: [], activeBlock: null, ...over })

let host
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host)
  mocks.S = baseS()
  for (const m of [dayAssignSheet, exercisePicker, menuSheet, confirmSheet]) m.mockClear()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
})
afterEach(() => { host.remove() })

let root
const open = (id = null) => {
  act(() => { blockEditorSheet(id) })
  const [sheet] = useUI.getState().sheets
  root = createRoot(host)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return sheet
}
afterEach(() => { if (root) act(() => root.unmount()); root = null })

const click = el => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const typeInto = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const field = aria => host.querySelector(`input[aria-label="${aria}"]`)
const slot = id => host.querySelector(`[data-slot="${id}"]`)
const day = d => host.querySelector(`[data-day="${d}"]`)

describe('Block editor', () => {
  it('saves a new block once the name, days and a slot are in', () => {
    open()
    typeInto(host.querySelector('[data-field="name"]'), 'Base Building')
    typeInto(field('Days per week'), '2')
    typeInto(field('Weeks'), '2')
    click(day(1)); act(() => dayAssignSheet.mock.calls.at(-1)[1].onPick('a'))
    click(day(3)); act(() => dayAssignSheet.mock.calls.at(-1)[1].onPick('b'))
    const addButtons = [...host.querySelectorAll('[data-slot] button')].filter(b => /Put .* in the table/.test(b.getAttribute('aria-label')))
    expect(addButtons).toHaveLength(3)
    // 'plank' is timed: it cannot be put in the table.
    expect(addButtons[1].disabled).toBe(true)
    click(addButtons[0])
    click(button('Save'))
    const [b] = mocks.S.programBlocks
    expect(b).toMatchObject({ name: 'Base Building', daysPerWeek: 2, weeks: 2, days: { 1: 'a', 3: 'b' }, nextBlockId: null })
    expect(Object.keys(b.table)).toEqual(['0025'])
    expect(Object.keys(b.table['0025'])).toEqual(['1', '2'])
    expect(useUI.getState().sheets).toEqual([])
  })

  it('says why it will not save and leaves the list alone', () => {
    open()
    click(button('Save'))
    expect(host.querySelector('[role="alert"]').textContent).toBe('Give the block a name.')
    typeInto(host.querySelector('[data-field="name"]'), 'X')
    click(button('Save'))
    expect(host.querySelector('[role="alert"]').textContent).toContain('exactly 3 days')
    expect(mocks.S.programBlocks).toEqual([])
  })

  it('a week can name a different exercise, and go back to the same lift', () => {
    mocks.S = baseS({ programBlocks: [saved()] })
    open('b1')
    click(slot('0025').querySelector('.tt'))
    click(button('Week 2 · different exercise'))
    act(() => exercisePicker.mock.calls.at(-1)[0]({ id: '0032' }))
    expect(button('Back to the same lift')).toBeTruthy()
    click(button('Save'))
    expect(mocks.S.programBlocks[0].table['0025'][2].exerciseId).toBe('0032')
    expect(mocks.S.programBlocks[0].table['0025'][1].exerciseId).toBeUndefined()
  })

  it('edits only a draft: closing without Save changes nothing', () => {
    mocks.S = baseS({ programBlocks: [saved()] })
    open('b1')
    typeInto(host.querySelector('[data-field="name"]'), 'Renamed')
    expect(mocks.S.programBlocks[0].name).toBe('Operator')
  })

  it('the chain picker lists the other blocks and never the block itself', () => {
    mocks.S = baseS({ programBlocks: [saved(), saved({ id: 'b2', name: 'Base Building' })] })
    open('b1')
    click(host.querySelector('[data-field="chain"]'))
    const items = menuSheet.mock.calls.at(-1)[0].items
    expect(items.map(i => i.label)).toEqual(['Nothing', 'Base Building'])
    act(() => items[1].onClick())
    click(button('Save'))
    expect(mocks.S.programBlocks[0].nextBlockId).toBe('b2')
  })

  it('deleting a running block leaves the app in rest rather than erroring', () => {
    mocks.S = baseS({
      programBlocks: [saved()],
      activeBlock: { blockId: 'b1', startsOn: '2026-03-02', tm: { '0025': 90 } },
    })
    open('b1')
    click(button('Delete block'))
    act(() => confirmSheet.mock.calls.at(-1)[0].onConfirm())
    expect(mocks.S.programBlocks).toEqual([])
    expect(blockRoutineIdsOn(mocks.S, '2026-03-02')).toEqual([])
    expect(useUI.getState().sheets).toEqual([])
  })

  it('a running block is edited in place: the run and its maxes are kept', () => {
    mocks.S = baseS({
      programBlocks: [saved()],
      activeBlock: { blockId: 'b1', startsOn: '2026-03-02', tm: { '0025': 90 } },
    })
    open('b1')
    click(slot('0025').querySelector('.tt'))
    typeInto(field('Week 3 · % of Training Max'), '95')
    click(button('Save'))
    expect(mocks.S.activeBlock).toEqual({ blockId: 'b1', startsOn: '2026-03-02', tm: { '0025': 90 } })
    expect(mocks.S.programBlocks[0].table['0025'][3].pct).toBe(95)
  })
})
