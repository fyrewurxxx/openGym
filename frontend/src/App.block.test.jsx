// @vitest-environment happy-dom
// A Program Block's end is a date, so it is settled at the app shell (docs/dev/PROGRAM_BLOCKS.md
// §6.0): a PWA cold-started on /workout after the end date must have it ended before any view
// reads the schedule, with a chained block still to start waiting for Home to offer it.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { todayISO } from './lib/format.js'
import { addDaysISO } from './lib/program-block.js'

vi.mock('./lib/sound.js', () => ({ setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn() }))
vi.mock('./lib/api.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, api: vi.fn(() => Promise.resolve({})), beacon: vi.fn() }
})
// What the workout route saw of the running block the first time it rendered.
const seen = vi.hoisted(() => ({ activeBlock: undefined, renders: 0 }))
vi.mock('./views/Workout.jsx', async () => {
  const { useStore } = await import('./store/useStore.js')
  return { default: () => {
    const S = useStore(s => s.S)
    if (!seen.renders++) seen.activeBlock = S.activeBlock
    return <div id="workout-view" />
  } }
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const block = (id, over = {}) => ({ id, name: id, daysPerWeek: 1, weeks: 4, days: { 1: 'a' }, table: {}, nextBlockId: null, ...over })
let host, root, original
beforeEach(() => {
  original = { S: useStore.getState().S, boot: useStore.getState().boot, ready: useStore.getState().ready }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  window.scrollTo = vi.fn()
  localStorage.setItem('gym_guest', '1')
  window.location.hash = '#/workout'
  seen.activeBlock = undefined; seen.renders = 0
  useUI.setState({ blockChain: null, sheets: [] })
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  localStorage.removeItem('gym_guest')
  useStore.setState({ S: original.S, boot: original.boot, ready: original.ready })
})

const coldStart = async S => {
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), routines: [{ id: 'a', name: 'A', ex: [] }], ...S }, boot: () => {}, ready: true, user: null })
  await act(async () => { root.render(<App />) })
}

describe('a Program Block past its end date', () => {
  it('has ended before the workout route first reads the schedule', async () => {
    await coldStart({
      programBlocks: [block('b1')],
      activeBlock: { blockId: 'b1', startsOn: addDaysISO(todayISO(), -35), tm: {} },
    })
    expect(host.querySelector('#workout-view')).not.toBeNull()
    expect(seen.activeBlock).toBe(null)
    expect(useStore.getState().S.activeBlock).toBe(null)
    expect(useUI.getState().blockChain).toBe(null)   // no chain target: no prompt
  })

  it('leaves a block with days remaining running, and holds no prompt', async () => {
    const active = { blockId: 'b1', startsOn: addDaysISO(todayISO(), -7), tm: {} }
    await coldStart({ programBlocks: [block('b1')], activeBlock: active })
    expect(seen.activeBlock).toEqual(active)
    expect(useUI.getState().blockChain).toBe(null)
  })

  it('sets the chain prompt for a chained block that still has days to run, starting on the end date', async () => {
    const startsOn = addDaysISO(todayISO(), -30)   // a 4 week block ends 2 days ago
    await coldStart({
      programBlocks: [block('b1', { nextBlockId: 'b2' }), block('b2', { weeks: 6 })],
      activeBlock: { blockId: 'b1', startsOn, tm: { '0025': 100 } },
    })
    expect(useStore.getState().S.activeBlock).toBe(null)
    expect(useUI.getState().blockChain).toEqual({ nextBlockId: 'b2', startsOn: addDaysISO(startsOn, 28) })
  })

  it('drops a chained block whose whole run has already passed', async () => {
    await coldStart({
      programBlocks: [block('b1', { nextBlockId: 'b2' }), block('b2', { weeks: 2 })],
      activeBlock: { blockId: 'b1', startsOn: addDaysISO(todayISO(), -60), tm: {} },
    })
    expect(useStore.getState().S.activeBlock).toBe(null)
    expect(useUI.getState().blockChain).toBe(null)
  })
})
