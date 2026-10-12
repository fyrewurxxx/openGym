// Program Blocks — a calendar-driven program (Base Building, Operator) that runs as a bounded
// unit and supersedes the week/rotation while it is active. Spec: docs/dev/PROGRAM_BLOCKS.md.
//
//   S.programBlocks = [{ id, name, daysPerWeek, weeks, days: { [weekday]: routineId }, table, nextBlockId }]
//   S.activeBlock   = null | { blockId, startsOn, tm: { [exerciseId]: number } }
//
// The week number is never stored: it is derived from the date and `startsOn` every time.

import { snapWeight, weightIncrement } from './progression.js'
import { blockWeekOf, blockOf, activeBlockDef, blockRoutineIdsOn } from './block-calendar.js'

export { blockWeekOf, blockOf, activeBlockDef, blockRoutineIdsOn }

/**
 * The prescription for one block-owned exercise on `iso`, in the shape nextPrescription returns
 * (policy, kind, weight, reps, sets, why) so the entry builder can use either. Null when the
 * exercise is not block-owned that day.
 */
export function blockPrescriptionFor(S, cfg, iso) {
  const block = activeBlockDef(S)
  if (!block) return null
  const week = blockWeekOf(block, S.activeBlock, iso)
  if (week == null) return null
  const entry = block.table?.[cfg.id]?.[week]
  if (!entry) return null
  // A week can name a different exercise for the slot; its Training Max is its own, never the slot's.
  const exerciseId = entry.exerciseId ?? cfg.id
  const tm = S.activeBlock.tm?.[exerciseId]
  if (!(tm > 0)) return null   // never captured: normal progression, never a weight of 0
  const unit = S.unit || 'kg'
  const weight = snapWeight(tm * entry.pct / 100, weightIncrement(cfg, unit))
  return {
    policy: 'block', kind: 'block', weight, reps: entry.reps, sets: entry.sets,
    exerciseId, week, blockId: block.id,
    why: ['{0} · Week {1} of {2}: {3}% of {4} {5} Training Max.', block.name, week, block.weeks, entry.pct, tm, unit],
  }
}

/**
 * The block a saved session was built under, for the label History and the workout detail show:
 * { name, week, weeks }, or null when no entry carries the stamp or the definition is gone (the
 * logged sets are unaffected either way). The week is the stamped one, frozen at build time;
 * only the name and length are read from the definition as it is now.
 */
export function blockLabelOf(S, workout) {
  const stamped = (workout?.entries || []).find(e => e?.blockId && e.blockWeek > 0)
  const block = stamped ? blockOf(S, stamped.blockId) : null
  return block ? { name: block.name, week: stamped.blockWeek, weeks: block.weeks } : null
}

// A 1RM entered at Start is stored as the Training Max: a fixed 90% of it, to a tenth.
export const TM_FRACTION = 0.9
export const trainingMaxFrom1RM = oneRM => Math.round(oneRM * TM_FRACTION * 10) / 10

/**
 * Every exercise a block can ever need a Training Max for: each table slot and each week's
 * override exercise, first occurrence order. The Start sheet asks for all of them upfront, so an
 * exercise reached only in week 12 is not a surprise prompt in week 12.
 */
export function blockExerciseIds(block) {
  const ids = []
  const add = id => { if (id && !ids.includes(id)) ids.push(id) }
  for (const [slot, weeks] of Object.entries(block?.table || {})) {
    add(slot)
    for (const entry of Object.values(weeks || {})) add(entry?.exerciseId)
  }
  return ids
}

/**
 * The `tm` map for a running block from the Start sheet's rows ({ id, mode: '1rm' | 'tm', value }).
 * A blank or non-positive row is left out: that lift keeps its normal progression, never a
 * weight of 0 (blockPrescriptionFor).
 */
export function trainingMaxesFrom(rows) {
  const tm = {}
  for (const { id, mode, value } of rows) {
    const n = Number(value)
    if (!(n > 0)) continue
    tm[id] = mode === '1rm' ? trainingMaxFrom1RM(n) : n
  }
  return tm
}

/** Starts a block on `startsOn` with its captured Training Maxes. Week and rotation stay untouched. */
export function startBlock(s, blockId, tm, startsOn) {
  s.activeBlock = { blockId, startsOn, tm }
}

/**
 * Stops the running block now. Always leaves the Block Chain (nextBlockId is never consulted) and
 * reverts to the week/rotation exactly as they were; sessions already logged keep their stamp.
 */
export function stopBlock(s) {
  s.activeBlock = null
}
