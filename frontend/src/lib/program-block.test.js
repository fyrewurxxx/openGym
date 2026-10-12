import { describe, it, expect } from 'vitest'
import {
  blockWeekOf, blockRoutineIdsOn, blockPrescriptionFor, blockLabelOf, trainingMaxFrom1RM, trainingMaxesFrom,
  blockExerciseIds, startBlock, stopBlock, addDaysISO, blockNeedsAdvance, advanceBlock,
  newBlockDraft, blockSlotCandidates, normalizeBlock, blockProblem, saveBlock, deleteBlock, DEFAULT_WEEK,
} from './program-block.js'

// A 3-week block starting Mon 2026-03-02, one slot (exercise '0025') with a different percentage each week.
const blockState = (over = {}) => ({
  unit: 'kg',
  programBlocks: [{
    id: 'b', name: 'Base Building', weeks: 3, days: {},
    table: {
      '0025': {
        1: { pct: 70, sets: 3, reps: 5 },
        2: { pct: 80, sets: 4, reps: 4 },
      },
    },
  }],
  activeBlock: { blockId: 'b', startsOn: '2026-03-02', tm: { '0025': 102 } },
  ...over,
})

describe('blockWeekOf', () => {
  const block = { id: 'b', weeks: 3 }
  const active = { blockId: 'b', startsOn: '2026-03-02' }

  it('counts days 0-6 as week 1 and days 7-13 as week 2', () => {
    expect(blockWeekOf(block, active, '2026-03-02')).toBe(1)
    expect(blockWeekOf(block, active, '2026-03-08')).toBe(1)
    expect(blockWeekOf(block, active, '2026-03-09')).toBe(2)
    expect(blockWeekOf(block, active, '2026-03-15')).toBe(2)
  })

  it('is null before the start date and after the last week', () => {
    expect(blockWeekOf(block, active, '2026-03-01')).toBe(null)
    expect(blockWeekOf(block, active, '2026-03-22')).toBe(3)
    expect(blockWeekOf(block, active, '2026-03-23')).toBe(null)
  })
})

describe('blockPrescriptionFor', () => {
  it('is the week\'s percentage of the Training Max, snapped to the exercise\'s increment', () => {
    // 102 × 80% = 81.6 → nearest 2.5 is 82.5
    const plan = blockPrescriptionFor(blockState(), { id: '0025', inc: 2.5 }, '2026-03-10')
    expect(plan).toMatchObject({ kind: 'block', weight: 82.5, sets: 4, reps: 4 })
  })

  describe('falls through (null) so normal progression applies', () => {
    const cfg = { id: '0025', inc: 2.5 }
    const wk2 = '2026-03-10'

    it('with no block running', () => {
      expect(blockPrescriptionFor(blockState({ activeBlock: null }), cfg, wk2)).toBe(null)
    })
    it('for an exercise the block table does not list', () => {
      expect(blockPrescriptionFor(blockState(), { id: 'other', inc: 2.5 }, wk2)).toBe(null)
    })
    it('in a week the table has no entry for', () => {
      expect(blockPrescriptionFor(blockState(), cfg, '2026-03-17')).toBe(null)   // week 3
    })
    it('when no Training Max was captured for the exercise, never a weight of 0', () => {
      const S = blockState({ activeBlock: { blockId: 'b', startsOn: '2026-03-02', tm: {} } })
      expect(blockPrescriptionFor(S, cfg, wk2)).toBe(null)
    })
    it('when the Training Max is 0', () => {
      const S = blockState({ activeBlock: { blockId: 'b', startsOn: '2026-03-02', tm: { '0025': 0 } } })
      expect(blockPrescriptionFor(S, cfg, wk2)).toBe(null)
    })
    it('after the last week of the block', () => {
      expect(blockPrescriptionFor(blockState(), cfg, '2026-03-30')).toBe(null)
    })
    it('when the block definition was deleted', () => {
      expect(blockPrescriptionFor(blockState({ programBlocks: [] }), cfg, wk2)).toBe(null)
    })
  })

  it('builds a week override exercise against the override exercise own Training Max', () => {
    const S = blockState()
    S.programBlocks[0].table['0025'][3] = { pct: 50, sets: 5, reps: 3, exerciseId: '0099' }
    S.activeBlock.tm = { '0025': 200, '0099': 60 }
    const plan = blockPrescriptionFor(S, { id: '0025', inc: 2.5 }, '2026-03-17')   // week 3
    expect(plan).toMatchObject({ exerciseId: '0099', weight: 30, sets: 5, reps: 3 })   // 50% of 60, not of 200
  })

  it('falls through when only the slot exercise has a Training Max, not the override', () => {
    const S = blockState()
    S.programBlocks[0].table['0025'][3] = { pct: 50, sets: 5, reps: 3, exerciseId: '0099' }
    expect(blockPrescriptionFor(S, { id: '0025', inc: 2.5 }, '2026-03-17')).toBe(null)
  })
})

describe('blockLabelOf', () => {
  const workout = { entries: [{ id: '0001' }, { id: '0025', blockId: 'b', blockWeek: 2 }] }

  it('names the block and the stamped week of a session built under it', () => {
    expect(blockLabelOf(blockState(), workout)).toEqual({ name: 'Base Building', week: 2, weeks: 3 })
  })

  it('reads the stamped week even once the block is no longer the active one', () => {
    expect(blockLabelOf(blockState({ activeBlock: null }), workout)).toMatchObject({ week: 2 })
  })

  it('says nothing for a session with no stamp, or whose block definition was deleted', () => {
    expect(blockLabelOf(blockState(), { entries: [{ id: '0025' }] })).toBeNull()
    expect(blockLabelOf(blockState({ programBlocks: [] }), workout)).toBeNull()
  })
})

describe('Training Max capture', () => {
  it('stores 90% of a 1RM to a tenth, and a Training Max as entered', () => {
    expect(trainingMaxFrom1RM(100)).toBe(90)
    expect(trainingMaxFrom1RM(142.5)).toBe(128.3)
    expect(trainingMaxesFrom([
      { id: 'a', mode: '1rm', value: 100 },
      { id: 'b', mode: 'tm', value: 87.5 },
    ])).toEqual({ a: 90, b: 87.5 })
  })

  it('leaves out a blank or non-positive row', () => {
    expect(trainingMaxesFrom([
      { id: 'a', mode: 'tm', value: '' },
      { id: 'b', mode: '1rm', value: 0 },
      { id: 'c', mode: 'tm', value: 60 },
    ])).toEqual({ c: 60 })
  })

  it('lists table slots and override exercises once each, override-only ones included', () => {
    const block = { table: {
      '0025': { 1: { pct: 70 }, 5: { pct: 80, exerciseId: 'dl' } },
      '0032': { 1: { pct: 70 }, 6: { pct: 80, exerciseId: 'dl' } },
    } }
    expect(blockExerciseIds(block)).toEqual(['0025', 'dl', '0032'])
    expect(blockExerciseIds(null)).toEqual([])
  })
})

describe('startBlock / stopBlock', () => {
  it('stop clears the running block whatever its chain target, keeping the week and rotation', () => {
    const s = { ...blockState(), week: { 1: ['r'] }, rotation: { id: 'x' } }
    s.programBlocks[0].nextBlockId = 'b2'
    stopBlock(s)
    expect(s.activeBlock).toBe(null)
    expect(s.week).toEqual({ 1: ['r'] })
    expect(s.rotation).toEqual({ id: 'x' })
  })

  it('start writes the block, its start date and the captured maxes', () => {
    const s = { programBlocks: [], activeBlock: null }
    startBlock(s, 'b', { a: 90 }, '2026-03-02')
    expect(s.activeBlock).toEqual({ blockId: 'b', startsOn: '2026-03-02', tm: { a: 90 } })
  })
})

describe('block definitions', () => {
  const S = () => ({
    unit: 'kg',
    routines: [
      { id: 'a', name: 'A', ex: [{ id: '0025' }, { id: '0032' }, { id: 'plank', mode: 'time' }] },
      { id: 'b', name: 'B', ex: [{ id: '0032' }, { id: '0041' }] },
      { id: 'c', name: 'C', ex: [{ id: '0099' }] },
    ],
    programBlocks: [], activeBlock: null,
  })
  const draft = (over = {}) => ({
    ...newBlockDraft('b1'), name: 'Operator', daysPerWeek: 2, weeks: 3, days: { 1: 'a', 4: 'b' },
    table: { '0025': { 1: { pct: 80, sets: 3, reps: 5 } } }, ...over,
  })

  it('offers each exercise of the assigned routines once, flags timed ones, ignores unassigned routines', () => {
    expect(blockSlotCandidates(S(), draft())).toEqual([
      { id: '0025', timed: false }, { id: '0032', timed: false }, { id: 'plank', timed: true }, { id: '0041', timed: false },
    ])
  })

  it('keeps a table slot whose routine was unassigned so it can still be taken out', () => {
    const c = blockSlotCandidates(S(), draft({ days: { 1: 'b' }, table: { '0025': {} } }))
    expect(c.map(x => x.id)).toEqual(['0032', '0041', '0025'])
  })

  it('normalizes: trims, fills untouched weeks with the default, drops weeks past the duration', () => {
    const b = normalizeBlock(draft({ name: '  Operator ', weeks: 2, table: { '0025': { 1: { pct: 85, sets: 2, reps: 3, exerciseId: '0041' }, 3: { pct: 99, sets: 1, reps: 1 } } } }))
    expect(b.name).toBe('Operator')
    expect(b.table['0025']).toEqual({
      1: { pct: 85, sets: 2, reps: 3, exerciseId: '0041' },
      2: { ...DEFAULT_WEEK },
    })
  })

  it('refuses a save that has no name, no weeks or the wrong number of days', () => {
    expect(blockProblem(S(), draft({ name: ' ' }))).toEqual({ code: 'name' })
    expect(blockProblem(S(), draft({ weeks: 0 }))).toEqual({ code: 'weeks' })
    expect(blockProblem(S(), draft({ weeks: 53 }))).toEqual({ code: 'weeks' })
    expect(blockProblem(S(), draft({ daysPerWeek: 3 }))).toEqual({ code: 'days' })
    expect(blockProblem(S(), draft())).toBe(null)
  })

  it('refuses a timed exercise in the table, as a slot or as a week override', () => {
    expect(blockProblem(S(), draft({ table: { plank: { 1: { pct: 70, sets: 3, reps: 5 } } } }))).toEqual({ code: 'timed', id: 'plank' })
    expect(blockProblem(S(), draft({ table: { '0025': { 2: { pct: 70, sets: 3, reps: 5, exerciseId: 'plank' } } } }))).toEqual({ code: 'timed', id: 'plank' })
  })

  it('refuses a chain that points at the block itself', () => {
    expect(blockProblem(S(), draft({ nextBlockId: 'b1' }))).toEqual({ code: 'chain' })
    expect(blockProblem(S(), draft({ nextBlockId: 'b2' }))).toBe(null)
  })

  it('saves new, then replaces by id; a refused save writes nothing', () => {
    const s = S()
    expect(saveBlock(s, draft())).toBe(null)
    expect(s.programBlocks).toHaveLength(1)
    expect(saveBlock(s, draft({ name: 'Renamed' }))).toBe(null)
    expect(s.programBlocks).toHaveLength(1)
    expect(s.programBlocks[0].name).toBe('Renamed')
    expect(saveBlock(s, draft({ name: '' }))).toEqual({ code: 'name' })
    expect(s.programBlocks[0].name).toBe('Renamed')
  })

  it('editing a running block keeps its start date and maxes, and a new slot has no max', () => {
    const s = S()
    saveBlock(s, draft())
    startBlock(s, 'b1', { '0025': 90 }, '2026-03-02')
    saveBlock(s, draft({ weeks: 5, table: { '0025': { 1: { pct: 80, sets: 3, reps: 5 } }, '0041': {} } }))
    expect(s.activeBlock).toEqual({ blockId: 'b1', startsOn: '2026-03-02', tm: { '0025': 90 } })
    expect(s.programBlocks[0].weeks).toBe(5)
    // '0041' is in the table but was never given a max: normal progression, never a weight of 0.
    expect(blockPrescriptionFor(s, { id: '0041' }, '2026-03-02')).toBe(null)
    expect(blockPrescriptionFor(s, { id: '0025' }, '2026-03-02').weight).toBe(72.5)
  })

  it('deleting clears chains into it and leaves a running instance reading as rest', () => {
    const s = S()
    saveBlock(s, draft({ id: 'b2', name: 'Next' }))
    saveBlock(s, draft({ nextBlockId: 'b2' }))
    startBlock(s, 'b1', {}, '2026-03-02')
    deleteBlock(s, 'b2')
    expect(s.programBlocks.find(b => b.id === 'b1').nextBlockId).toBe(null)
    deleteBlock(s, 'b1')
    expect(s.programBlocks).toEqual([])
    expect(s.activeBlock).not.toBe(null)
    expect(blockRoutineIdsOn(s, '2026-03-02')).toEqual([])
  })
})

// A 3-week block that began Mon 2026-03-02 ends on Mon 2026-03-23 (its last day is Sun 2026-03-22).
describe('blockNeedsAdvance', () => {
  it('is false while a day of the run remains, true from the end date on', () => {
    expect(blockNeedsAdvance(blockState(), '2026-03-22')).toBe(false)
    expect(blockNeedsAdvance(blockState(), '2026-03-23')).toBe(true)
    expect(blockNeedsAdvance(blockState(), '2026-06-01')).toBe(true)
  })

  it('is false with no block running, a missing definition, or a start still ahead', () => {
    expect(blockNeedsAdvance(blockState({ activeBlock: null }), '2026-06-01')).toBe(false)
    expect(blockNeedsAdvance(blockState({ programBlocks: [] }), '2026-06-01')).toBe(false)
    expect(blockNeedsAdvance(blockState(), '2026-02-20')).toBe(false)
  })
})

describe('advanceBlock', () => {
  const chained = () => {
    const S = blockState()
    S.programBlocks[0].nextBlockId = 'c'
    S.programBlocks.push({ id: 'c', name: 'Operator', weeks: 6, days: {}, table: {}, nextBlockId: null })
    return S
  }

  it('ends a block with no chain target and hands nothing back', () => {
    const S = blockState()
    expect(advanceBlock(S, '2026-03-23')).toBe(null)
    expect(S.activeBlock).toBe(null)
  })

  it('leaves the week, rotation and queue exactly as they were', () => {
    const S = blockState({ week: { 1: ['a'] }, rotation: { ids: ['a', 'b'] }, queue: null, scheduleMode: 'rotation' })
    const before = JSON.stringify({ week: S.week, rotation: S.rotation, queue: S.queue, scheduleMode: S.scheduleMode })
    advanceBlock(S, '2026-03-23')
    expect(JSON.stringify({ week: S.week, rotation: S.rotation, queue: S.queue, scheduleMode: S.scheduleMode })).toBe(before)
  })

  it('hands back the chained block, starting on the previous end date and not today', () => {
    const S = chained()
    expect(advanceBlock(S, '2026-03-26')).toEqual({ nextBlockId: 'c', startsOn: '2026-03-23' })
    expect(S.activeBlock).toBe(null)   // the caller starts it through the Start sheet, not this function
  })

  it('drops a chained block whose whole run has already passed', () => {
    const S = chained()
    expect(advanceBlock(S, '2026-05-04')).toBe(null)   // 2026-03-23 + 6 weeks = 2026-05-04
    expect(S.activeBlock).toBe(null)
  })

  it('drops a chain target whose definition is gone', () => {
    const S = chained()
    S.programBlocks = S.programBlocks.filter(b => b.id !== 'c')
    expect(advanceBlock(S, '2026-03-23')).toBe(null)
  })

  it('is never what Stop block runs: stopping a chained block ignores the chain', () => {
    const S = chained()
    stopBlock(S)
    expect(S.activeBlock).toBe(null)
  })
})

describe('addDaysISO', () => {
  it('counts calendar days across month ends and DST', () => {
    expect(addDaysISO('2026-03-02', 21)).toBe('2026-03-23')
    expect(addDaysISO('2026-01-30', 3)).toBe('2026-02-02')
    expect(addDaysISO('2026-03-28', 2)).toBe('2026-03-30')
  })
})
