// @vitest-environment happy-dom
// Plan → Schedule, third way to train (docs/dev/PROGRAM_BLOCKS.md §7.1, §7.2, §6.1): pick a
// Program Block, set a Training Max for every lift upfront (1RM x 0.9, or the number as typed),
// and stop it again with an Undo that never starts the chained block.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, nav: null }
  state.snapshot = () => ({
    S: state.S,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
    config: {}, user: null, coachLocal: { mode: 'off' },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), menuSheet: vi.fn(), confirmSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false }))
vi.mock('../lib/demo.js', () => ({ DEMO: false }))
vi.mock('../lib/coach.js', () => ({ coachAvailable: () => false }))

import Plan from './Plan.jsx'
import { menuSheet } from '../sheets.jsx'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'

const routines = [{ id: 'a', name: 'A', emoji: null, ex: [{ id: '0025' }] }]
// One slot ('0025') that swaps to '0032' in week 3: '0032' is reachable only through the override.
const block = (over = {}) => ({
  id: 'b1', name: 'Operator', daysPerWeek: 3, weeks: 6, days: { 1: 'a' },
  table: { '0025': { 1: { pct: 70, sets: 3, reps: 5 }, 3: { pct: 80, sets: 3, reps: 5, exerciseId: '0032' } } },
  nextBlockId: null, ...over,
})
const baseS = over => ({
  unit: 'kg', routines, week: { 1: ['a'] }, dayPlan: {}, workouts: [], queue: null, rotation: null,
  scheduleMode: null, programBlocks: [block()], activeBlock: null, ...over,
})
// A logged single of 100 gives '0025' an estimated 1RM of 100.
const lifted = { d: '2026-01-01', start: 1, entries: [{ id: '0025', sets: [{ w: 100, r: 1, done: true }] }] }

let host, root, sheetHost, sheetRoot
beforeEach(() => {
  localStorage.removeItem('gym_plan_view')
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  sheetHost = document.createElement('div'); document.body.appendChild(sheetHost); sheetRoot = createRoot(sheetHost)
  menuSheet.mockClear(); mocks.nav = vi.fn()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
})
afterEach(() => {
  act(() => { root.unmount(); sheetRoot.unmount() }); host.remove(); sheetHost.remove()
})

const mount = over => { mocks.S = baseS(over); act(() => root.render(<Plan />)) }
const click = el => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const modeButtons = () => [...host.querySelectorAll('.plan-mode .seg button')]
const buttonIn = (el, label) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const typeInto = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const rows = () => [...sheetHost.querySelectorAll('[data-ex]')]
const rowOf = id => rows().find(r => r.getAttribute('data-ex') === id)

// Picks the block and renders the Start sheet the pick opened.
const openStartSheet = () => {
  click(modeButtons().find(b => b.textContent === 'Program Block'))
  menuSheet.mock.calls.at(-1)[0].items[0].onClick()
  const [sheet] = useUI.getState().sheets
  act(() => sheetRoot.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
}

describe('Plan — Program Block', () => {
  it('the third option opens a picker of the existing blocks', () => {
    mount()
    click(modeButtons().find(b => b.textContent === 'Program Block'))
    const picker = menuSheet.mock.calls.at(-1)[0]
    expect(picker.items.map(i => i.label)).toEqual(['Operator'])
  })

  it('with no blocks saved it says so instead of opening an empty picker', () => {
    mount({ programBlocks: [] })
    click(modeButtons().find(b => b.textContent === 'Program Block'))
    expect(menuSheet).not.toHaveBeenCalled()
    expect(useUI.getState().toastMsg).toBe('No program blocks yet.')
  })

  it('the Start sheet has a row for every lift, an override-only one included', () => {
    mount({ workouts: [lifted] })
    openStartSheet()
    expect(rows().map(r => r.getAttribute('data-ex'))).toEqual(['0025', '0032'])
  })

  it('1RM mode prefills the estimate and stores 90% of it', () => {
    mount({ workouts: [lifted] })
    openStartSheet()
    expect(rowOf('0025').querySelector('input').value).toBe('100')
    click(buttonIn(sheetHost, 'Start block'))
    expect(mocks.S.activeBlock).toEqual({ blockId: 'b1', startsOn: todayISO(), tm: { '0025': 90 } })
  })

  it('1RM mode stores 90% of an edited number', () => {
    mount({ workouts: [lifted] })
    openStartSheet()
    typeInto(rowOf('0025').querySelector('input'), '120')
    click(buttonIn(sheetHost, 'Start block'))
    expect(mocks.S.activeBlock.tm['0025']).toBe(108)
  })

  it('Training Max mode starts blank and stores the entered number as it is', () => {
    mount()
    openStartSheet()
    const input = rowOf('0032').querySelector('input')
    expect(input.value).toBe('')
    typeInto(input, '87.5')
    click(buttonIn(sheetHost, 'Start block'))
    expect(mocks.S.activeBlock.tm).toEqual({ '0032': 87.5 })
  })

  it('switching a row to Training Max clears the 1RM prefill', () => {
    mount({ workouts: [lifted] })
    openStartSheet()
    click(buttonIn(rowOf('0025'), 'Training Max'))
    expect(rowOf('0025').querySelector('input').value).toBe('')
  })
})

describe('Plan — a running block', () => {
  const running = (over = {}) => ({
    programBlocks: [block(over)], activeBlock: { blockId: 'b1', startsOn: todayISO(), tm: { '0025': 90 } },
  })

  it('shows its name and week in place of the weekday grid, and locks the mode control', () => {
    mount(running())
    const card = host.querySelector('.plan-block')
    expect(card.textContent).toContain('Operator')
    expect(card.textContent).toContain('Week 1 of 6')
    expect(modeButtons()).toEqual([])
    expect(host.querySelector('.plan-week')).toBeNull()
  })

  it('hints the chain target when there is one', () => {
    mount({ ...running({ nextBlockId: 'b2' }), programBlocks: [block({ nextBlockId: 'b2' }), block({ id: 'b2', name: 'Base Building' })] })
    expect(host.querySelector('.plan-block').textContent).toContain('then \u2192 Base Building')
  })

  it('Stop block clears it at once, never offers the chain, and Undo brings it back', () => {
    mount({ ...running(), programBlocks: [block({ nextBlockId: 'b2' }), block({ id: 'b2', name: 'Base Building' })] })
    const before = structuredClone(mocks.S.activeBlock)
    click(buttonIn(host, 'Stop block'))
    expect(mocks.S.activeBlock).toBe(null)
    expect(useUI.getState().sheets).toEqual([])
    expect(menuSheet).not.toHaveBeenCalled()
    expect(useUI.getState().toastMsg).toBe('Block stopped.')
    act(() => useUI.getState().runToastAction())
    expect(mocks.S.activeBlock).toEqual(before)
  })
})
