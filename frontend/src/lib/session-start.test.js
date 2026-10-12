import { describe, it, expect } from 'vitest'
import { buildSessionEntries, plannedConfigOf, builtOutOfProgression } from './session-start.js'
import { buildCombinedEntries } from './session-merge.js'
import { readSession } from './progression.js'
import { isWarmupRow } from './workout-model.js'

// The session builder used by the live start and by "log a past workout".
describe('buildSessionEntries', () => {
  const st = { unit: 'kg', workouts: [], exWeights: {}, routines: [] }

  it('ramps the warm-ups on the exercise’s own increment, not the unit default', () => {
    const r = { id: 'r', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, inc: 1.25, warmupSets: 2 }] }
    const entries = buildSessionEntries(st, r)
    const warm = entries[0].sets.filter(isWarmupRow).map(s => s.w)
    expect(warm).toHaveLength(2)
    for (const w of warm) expect(Math.round(w / 1.25 * 1000) / 1000 % 1).toBe(0)   // a multiple of 1.25
    expect(entries[0].sets.filter(s => !isWarmupRow(s)).every(s => s.w === 60)).toBe(true)
  })

  it('keeps the unit default for timed exercises, whose inc is seconds', () => {
    const r = { id: 'r', prog: 'off', ex: [{ id: '0025', mode: 'time', sets: 2, sec: 30, inc: 10, weight: 0 }] }
    const entries = buildSessionEntries(st, r)
    expect(entries[0].sets.every(s => s.sec === 30)).toBe(true)
  })

  it('persists the effective deload target so completing the opened rows reads as a hit', () => {
    const cfg = { id: '0025', sets: 3, reps: 8, weight: 60, prog: 'linear' }
    const st = {
      unit: 'kg', exWeights: {}, routines: [],
      workouts: [1, 2, 3].map((n) => ({
        d: `2026-01-0${n}`, routineIds: ['r'],
        entries: [{
          id: cfg.id,
          target: { sets: 3, reps: 8, weight: 60 },
          sets: [6, 6, 6].map(r => ({ w: 60, r, done: true }))
        }]
      }))
    }
    const r = { id: 'r', prog: 'linear', ex: [cfg] }
    const entries = buildSessionEntries(st, r)
    const entry = entries[0]
    const work = entry.sets.filter(s => !isWarmupRow(s))

    expect(entry.plan.kind).toBe('deload')
    expect(entry.target).toMatchObject({ reps: entry.plan.reps, weight: entry.plan.weight })
    expect(readSession({ ...entry, sets: entry.sets.map(s => ({ ...s, done: true })) }, cfg).ok).toBe(true)
    expect(work.every(s => s.r === entry.target.reps && s.w === entry.target.weight)).toBe(true)
  })

  // The same invariant for every other way a loaded rep policy opens a session: what the rows
  // say is the target the session is judged by, so doing exactly what is on the screen is a hit.
  // Linear and Greyskull used to open at last session's reps while the stamped target kept the
  // plan's, so a routine edited from 15 to 10 opened at 15 and read 15 ≥ 10 as a hit forever.
  const history = (reps, extra = {}) => ({
    unit: 'kg', exWeights: {}, routines: [],
    workouts: [{ d: '2026-01-01', routineIds: ['r'], entries: [{ id: '0025', target: { sets: 2, reps: 15, weight: 40 }, sets: reps.map(r => ({ w: 40, r, done: true })) }] }],
    ...extra,
  })
  // Greyskull has no hold: one failure resets it, so its miss case is a (non-Epley) deload.
  for (const [prog, kind, reps] of [['linear', 'up', [15, 15]], ['linear', 'hold', [15, 9]], ['greyskull', 'up', [15, 15]], ['greyskull', 'deload', [15, 9]]]) {
    it(`opens ${prog} ${kind} at the plan's reps, and completing the rows reads as a hit`, () => {
      const cfg = { id: '0025', sets: 2, reps: 10, weight: 40, prog }
      const [entry] = buildSessionEntries(history(reps), { id: 'r', prog, ex: [cfg] })
      const work = entry.sets.filter(s => !isWarmupRow(s))
      expect(entry.plan.kind).toBe(kind)
      expect(entry.target.reps).toBe(10)
      expect(work.map(s => s.r)).toEqual([10, 10])
      expect(work.every(s => s.r === entry.target.reps && s.w === entry.target.weight)).toBe(true)
      expect(readSession({ ...entry, sets: entry.sets.map(s => ({ ...s, done: true })) }, cfg).ok).toBe(true)
    })
  }

  it('carries last session\'s reps instead when the profile starts from the last session', () => {
    const cfg = { id: '0025', sets: 2, reps: 10, weight: 40, prog: 'linear' }
    const [entry] = buildSessionEntries(history([15, 15], { startFrom: 'last' }), { id: 'r', prog: 'linear', ex: [cfg] })
    expect(entry.sets.map(s => [s.w, s.r])).toEqual([[42.5, 15], [42.5, 15]])
    expect(entry.target.reps).toBe(10)
    // …and marks the entry, so the workout card can say where the 15 came from.
    expect(entry.carried).toBe(true)
    expect(buildSessionEntries(history([15, 15]), { id: 'r', prog: 'linear', ex: [cfg] })[0].carried).toBeUndefined()
    expect(buildSessionEntries(history([10, 10], { startFrom: 'last' }), { id: 'r', prog: 'linear', ex: [cfg] })[0].carried).toBeUndefined()
  })

  it('warms up at the plan\'s reps, not at last session\'s', () => {
    const cfg = { id: '0025', sets: 2, reps: 10, weight: 40, warmupSets: 1 }
    const [entry] = buildSessionEntries(history([15, 15]), { id: 'r', prog: 'linear', ex: [cfg] })
    expect(entry.sets.map(s => [isWarmupRow(s) ? 'warm' : 'work', s.r])).toEqual([['warm', 10], ['work', 10], ['work', 10]])
  })

  it('re-ramps a progressed barbell lift\'s warm-up from the bar, not from half the weight', () => {
    const lb = { unit: 'lb', exWeights: {}, routines: [], workouts: [{ d: '2026-01-01', routineIds: ['r'], entries: [{ id: '0025', target: { sets: 2, reps: 10, weight: 50 }, sets: [10, 10].map(r => ({ w: 50, r, done: true })) }] }] }
    const cfg = { id: '0025', sets: 2, reps: 10, weight: 50, prog: 'linear', warmupSets: 1 }
    const [entry] = buildSessionEntries(lb, { id: 'r', prog: 'linear', ex: [cfg] })
    expect(entry.plan.weight).toBe(55)
    expect(entry.sets.map(s => s.w)).toEqual([45, 55, 55])
    const [noBar] = buildSessionEntries({ ...lb, barWeights: { '0025': 0 } }, { id: 'r', prog: 'linear', ex: [cfg] })
    expect(noBar.sets.map(s => s.w)).toEqual([25, 55, 55])
  })

  it('splits the plan\'s reps evenly per side', () => {
    const cfg = { id: '0025', sets: 1, reps: 16, weight: 20, side: true, prog: 'linear' }
    const side = (w, r) => ({ w, r, done: true })
    const st = {
      unit: 'kg', exWeights: {}, routines: [],
      workouts: [{ d: '2026-01-01', routineIds: ['r'], entries: [{ id: '0025', target: { sets: 1, reps: 10, weight: 20, side: true }, sets: [
        { w: 22.5, r: 10, done: true, sides: { L: side(22.5, 5), R: side(20, 5) } },
      ] }] }],
    }
    const [entry] = buildSessionEntries(st, { id: 'r', ex: [cfg] })
    const row = entry.sets[0]
    expect(entry.plan.kind).toBe('up')
    expect([row.sides.L.r, row.sides.R.r]).toEqual([8, 8])
    expect(row.r).toBe(entry.target.reps)
  })

  it('stamps what the routine asked for on every entry, apart from the target it progressed', () => {
    const cfg = { id: '0025', sets: 2, reps: 10, weight: 40, prog: 'linear' }
    const [entry] = buildSessionEntries(history([15, 15]), { id: 'r', prog: 'linear', ex: [cfg] })
    expect(entry.planned).toEqual({ sets: 2, reps: 10, weight: 40 })
    expect(entry.target.weight).toBe(42.5)
  })

  it('opens an edited plan at its new numbers, and completing them reads as a hit', () => {
    const st = history([15, 15])
    st.workouts[0].entries[0].planned = { sets: 2, reps: 15, weight: 40 }
    const cfg = { id: '0025', sets: 3, reps: 10, weight: 40, prog: 'linear' }
    const [entry] = buildSessionEntries(st, { id: 'r', prog: 'linear', ex: [cfg] })
    const work = entry.sets.filter(s => !isWarmupRow(s))
    expect(entry.plan.kind).toBe('hold')
    expect(work.map(s => [s.w, s.r])).toEqual([[40, 10], [40, 10], [40, 10]])
    expect(entry.target).toMatchObject({ sets: 3, reps: 10, weight: 40 })
    expect(readSession({ ...entry, sets: entry.sets.map(s => ({ ...s, done: true })) }, cfg).ok).toBe(true)
  })

  // The history view a past session is built from carries the day it was cut at (asOf). Nothing
  // that decides a prescription reads it yet, so building from the view must not change a number.
  it('builds the same entries from a history view that carries its day as from one that does not', () => {
    const r = { id: 'r', prog: 'linear', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }
    const hist = { ...st, workouts: [{ id: 'w1', d: '2026-01-01', start: 1, entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] }] }] }
    expect(buildSessionEntries({ ...hist, asOf: '2026-01-05' }, r)).toEqual(buildSessionEntries(hist, r))
  })

  it('returns a bare array — no { entries, excluded } wrapper', () => {
    const r = { id: 'r', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }
    const out = buildSessionEntries(st, r)
    expect(Array.isArray(out)).toBe(true)
    expect(out).toHaveLength(1)
  })

  it('stamps noProg + plan.kind "off" on every entry of an excluded routine, and neither on a normal one', () => {
    const ex = [{ id: '0025', sets: 3, reps: 5, weight: 60 }, { id: '0031', sets: 3, reps: 8, weight: 40 }]
    const excluded = buildSessionEntries(st, { id: 'rehab', excludeFromProgression: true, ex })
    expect(excluded.every(e => e.noProg === true)).toBe(true)
    expect(excluded.every(e => e.plan.kind === 'off')).toBe(true)

    const normal = buildSessionEntries(st, { id: 'r', prog: 'off', ex })
    expect(normal.every(e => e.noProg === undefined)).toBe(true)
  })

  it('does not stamp rid — that is the merge helper’s job', () => {
    const r = { id: 'r', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }
    expect(buildSessionEntries(st, r)[0].rid).toBeUndefined()
  })
})

// The mid-session settings sheet edits the plan, so it opens at the plan's sets and reps and at
// today's weight — never at a prescription's aim, climb or added set (#275).
describe('plannedConfigOf', () => {
  it('puts the plan\'s sets, reps and range back in place of today\'s', () => {
    const entry = {
      target: { id: '0025', mode: 'reps', sets: 3, reps: 9, repsMin: 8, weight: 42.5, prog: 'double' },
      planned: { sets: 3, reps: 12, repsMin: 8, weight: 40 },
    }
    expect(plannedConfigOf(entry)).toEqual({ id: '0025', mode: 'reps', sets: 3, reps: 12, repsMin: 8, weight: 42.5, prog: 'double' })
  })

  it('drops a bottom the plan does not have, and takes a hold\'s seconds', () => {
    expect(plannedConfigOf({ target: { sets: 3, reps: 13, repsMin: 10, weight: 0 }, planned: { sets: 2, reps: 10, weight: 0 } }))
      .toEqual({ sets: 2, reps: 10, weight: 0 })
    expect(plannedConfigOf({ target: { mode: 'time', sets: 2, sec: 50, weight: 0 }, planned: { sets: 2, sec: 45, weight: 0 } }).sec).toBe(45)
  })

  it('opens an entry built before plans were stamped at its target', () => {
    const target = { sets: 2, reps: 8, weight: 60 }
    expect(plannedConfigOf({ target })).toEqual(target)
    expect(plannedConfigOf({ target })).not.toBe(target)
  })
})

// An exercise's ⋯ menu sets `noProg` by hand; a deload or rehab routine freezes it onto its
// exercises. Only the second is rebuilt without a prescription.
describe('builtOutOfProgression', () => {
  const deload = { id: 'd', excludeFromProgression: true }
  const main = { id: 'm' }

  it('is an exercise of a routine kept out of progression', () => {
    expect(builtOutOfProgression({ noProg: true, rid: 'd' }, deload)).toBe(true)
  })

  it('is not an exercise kept out by hand in a routine that counts', () => {
    expect(builtOutOfProgression({ noProg: true, rid: 'm' }, main)).toBe(false)
  })

  it('is not an exercise with no routine, nor one that was never kept out', () => {
    expect(builtOutOfProgression({ noProg: true }, null)).toBe(false)
    expect(builtOutOfProgression({ rid: 'd' }, deload)).toBe(false)
    expect(builtOutOfProgression(null, deload)).toBe(false)
  })
})

// A running Program Block decides the weight, sets and reps (lib/program-block.js).
describe('buildSessionEntries — program block', () => {
  // 3-week block from Mon 2026-03-02; squat (0025) at 70 / 80 / 90 % of a 102 kg Training Max.
  const blockSt = (over = {}) => ({
    unit: 'kg', workouts: [], exWeights: {}, routines: [], asOf: '2026-03-10',   // week 2
    programBlocks: [{
      id: 'b', name: 'Base', weeks: 3, days: {},
      table: { '0025': { 1: { pct: 70, sets: 3, reps: 5 }, 2: { pct: 80, sets: 4, reps: 4 }, 3: { pct: 90, sets: 2, reps: 3 } } },
    }],
    activeBlock: { blockId: 'b', startsOn: '2026-03-02', tm: { '0025': 102 } },
    ...over,
  })
  const squat = { id: '0025', sets: 3, reps: 8, weight: 60, inc: 2.5, prog: 'linear' }
  const routine = { id: 'r', prog: 'linear', ex: [squat] }

  it('opens at the week percentage of the Training Max, with the sets and reps of that week', () => {
    const [e] = buildSessionEntries(blockSt(), routine)
    const work = e.sets.filter(s => !isWarmupRow(s))
    expect(e.plan.kind).toBe('block')
    expect(work).toHaveLength(4)
    expect(work.every(s => s.w === 82.5 && s.r === 4)).toBe(true)   // 80% of 102 = 81.6 → 82.5
  })

  it('builds the override exercise in the slot, at its own Training Max, with the slot settings carried over', () => {
    const st = blockSt({ asOf: '2026-03-16' })   // week 3
    st.programBlocks[0].table['0025'][3] = { pct: 50, sets: 5, reps: 3, exerciseId: '0099' }
    st.activeBlock.tm = { '0025': 200, '0099': 60 }
    const r = { id: 'r', prog: 'linear', ex: [{ ...squat, sg: 'legs', warmupSets: 1 }] }
    const entries = buildSessionEntries(st, r)

    expect(entries.map(e => e.id)).toEqual(['0099'])   // no entry for the slot exercise that day
    const [e] = entries
    expect(e.sg).toBe('legs')
    expect(e.target.warmupSets).toBe(1)
    const work = e.sets.filter(s => !isWarmupRow(s))
    expect(work).toHaveLength(5)
    expect(work.every(s => s.w === 30 && s.r === 3)).toBe(true)   // 50% of 60, not of 200
    expect(e.sets.filter(isWarmupRow)).toHaveLength(1)
  })

  describe('falls through to normal progression', () => {
    // The same build with no block running is the reference: a fall-through must match it exactly.
    const plain = (st, r = routine) => buildSessionEntries({ ...st, activeBlock: null }, r)[0]
    const sameAsPlain = (st, r = routine) => {
      const [e] = buildSessionEntries(st, r)
      expect(e.plan.kind).not.toBe('block')
      expect(e.sets).toEqual(plain(st, r).sets)
      expect(e.target).toEqual(plain(st, r).target)
    }

    it('for an exercise the block table does not list', () => {
      sameAsPlain(blockSt(), { id: 'r', prog: 'linear', ex: [{ ...squat, id: '0001' }] })
    })
    it('in a week the table has no entry for', () => {
      const st = blockSt({ asOf: '2026-03-16' })   // week 3, the table only has weeks 1-2
      delete st.programBlocks[0].table['0025'][3]
      sameAsPlain(st)
    })
    it('when no Training Max was captured, never a weight of 0', () => {
      const st = blockSt()
      st.activeBlock.tm = {}
      sameAsPlain(st)
      expect(buildSessionEntries(st, routine)[0].target.weight).toBe(60)
    })
    it('for a routine excluded from progression', () => {
      const r = { ...routine, excludeFromProgression: true }
      const [e] = buildSessionEntries(blockSt(), r)
      expect(e.plan.kind).toBe('off')
      expect(e.target.weight).toBe(60)
    })
  })

  it('a backfilled day resolves its own week, not the current one', () => {
    // Built for Tue of week 1 (70% of 102 = 71.4 → 72.5), while the real clock is long past the block.
    const [e] = buildSessionEntries(blockSt({ asOf: '2026-03-03' }), routine)
    expect(e.plan).toMatchObject({ kind: 'block', week: 1, weight: 72.5, sets: 3, reps: 5 })
  })

  it('still stamps rid and returns the routine ids on a block day', () => {
    const st = blockSt({ routines: [routine] })
    const built = buildCombinedEntries(st, ['r'])
    expect(built.routineIds).toEqual(['r'])
    expect(built.entries.map(e => e.rid)).toEqual(['r'])
    expect(built.entries[0].plan.kind).toBe('block')
  })
})
