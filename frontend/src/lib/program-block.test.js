import { describe, it, expect } from 'vitest'
import { blockWeekOf, blockPrescriptionFor } from './program-block.js'

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
