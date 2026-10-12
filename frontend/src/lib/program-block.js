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
