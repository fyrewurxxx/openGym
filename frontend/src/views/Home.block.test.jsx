// @vitest-environment happy-dom
// While a Program Block runs, the Today card names it under the routine: "{block} · Week N of M".
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { startBlockSheet } from '../components/StartBlockSheet.jsx'
import Home from './Home.jsx'

vi.mock('../components/StartBlockSheet.jsx', () => ({ startBlockSheet: vi.fn() }))

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

const routines = [{ id: 'a', name: 'Squat day', emoji: null, ex: [{ id: '0025' }] }]
const everyDay = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, 'a']))
const block = { id: 'b1', name: 'Operator', daysPerWeek: 7, weeks: 6, days: everyDay, table: {}, nextBlockId: null }

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const setS = over => useStore.setState(s => ({
  S: { ...s.S, routines, week: {}, dayPlan: {}, workouts: [], active: null, queue: null, rotation: null,
    scheduleMode: null, programBlocks: [block], activeBlock: null, ...over }, user: null,
}))
const mount = () => act(() => root.render(<Home />))
const todayRow = () => host.querySelector('.today-row')

describe('Home — Program Block', () => {
  it('names the block and its week under today’s routine', () => {
    setS({ activeBlock: { blockId: 'b1', startsOn: todayISO(), tm: {} } })
    mount()
    expect(todayRow().querySelector('.ttl').textContent).toBe('Squat day')
    expect(todayRow().querySelector('.ss').textContent).toBe('Operator · Week 1 of 6')
  })

  it('shows nothing extra when no block is running', () => {
    setS()
    mount()
    expect(todayRow().querySelector('.ss')).toBeNull()
  })

  it('shows nothing extra once the block’s run is over', () => {
    setS({ activeBlock: { blockId: 'b1', startsOn: '2020-01-06', tm: {} } })
    mount()
    expect(todayRow().textContent).not.toContain('Operator')
  })

  it('opens the Start sheet for the chained block once, clearing the pending state', () => {
    startBlockSheet.mockClear()
    setS()
    useUI.setState({ blockChain: { nextBlockId: 'b2', startsOn: '2026-03-23' } })
    mount()
    expect(startBlockSheet).toHaveBeenCalledTimes(1)
    expect(startBlockSheet).toHaveBeenCalledWith('b2', '2026-03-23', { chained: true })
    expect(useUI.getState().blockChain).toBe(null)
    act(() => root.render(<Home />))
    expect(startBlockSheet).toHaveBeenCalledTimes(1)
  })

  it('opens nothing when no chain is pending', () => {
    startBlockSheet.mockClear()
    setS()
    useUI.setState({ blockChain: null })
    mount()
    expect(startBlockSheet).not.toHaveBeenCalled()
  })
})
