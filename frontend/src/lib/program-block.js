// Program Blocks — a calendar-driven program (Base Building, Operator) that runs as a bounded
// unit and supersedes the week/rotation while it is active. Spec: docs/dev/PROGRAM_BLOCKS.md.
//
//   S.programBlocks = [{ id, name, daysPerWeek, weeks, days: { [weekday]: routineId }, table, nextBlockId }]
//   S.activeBlock   = null | { blockId, startsOn, tm: { [exerciseId]: number } }
//
// The week number is never stored: it is derived from the date and `startsOn` every time.

import { snapWeight, weightIncrement } from './progression.js'
import { modeOf } from './history.js'
import { blockWeekOf, blockOf, activeBlockDef, blockRoutineIdsOn } from './block-calendar.js'
import { isoOf, todayISO } from './format.js'

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

// ---- Lifecycle: a block ends on the calendar, and may hand off to the next one (§6) ----

/** `iso` plus `n` whole days, as an ISO date (calendar arithmetic at noon, so DST never shifts it). */
export function addDaysISO(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoOf(d)
}

/** The first date after the block's last day: the previous block's end, and a chained block's start. */
export const blockEndsOn = (block, activeBlock) => addDaysISO(activeBlock.startsOn, block.weeks * 7)

/**
 * Whether the running block's run is over at `today`. Read on its own, not through blockWeekOf, so
 * a start date still ahead of today is a block that has not begun, never one that has ended.
 */
export function blockNeedsAdvance(S, today = todayISO()) {
  const block = activeBlockDef(S)
  return !!(block && S.activeBlock && today >= blockEndsOn(block, S.activeBlock))
}

/**
 * Ends the finished block; the week or rotation underneath was never touched, so it simply reads
 * again. With a Block Chain target, hands back { nextBlockId, startsOn } for the caller to run
 * through the Start sheet (Training Maxes are captured afresh: nothing carries over). The chained
 * block's clock starts on the previous block's end date, not the day the sheet is confirmed. A
 * chained block whose whole run has already passed is dropped, and so is a missing definition.
 * Returns null when there is nothing to hand off.
 */
export function advanceBlock(s, today = todayISO()) {
  const block = activeBlockDef(s)
  const next = block?.nextBlockId ? blockOf(s, block.nextBlockId) : null
  const startsOn = block && s.activeBlock ? blockEndsOn(block, s.activeBlock) : null
  s.activeBlock = null
  if (!next || blockWeekOf(next, { startsOn }, today) == null) return null
  return { nextBlockId: next.id, startsOn }
}

// ---- Definitions: the block editor's pure half (docs/dev/PROGRAM_BLOCKS.md §1.1, §7.3, §8) ----

/** What a week of a freshly added slot starts at, and what a week the editor never touched saves as. */
export const DEFAULT_WEEK = { pct: 70, sets: 3, reps: 5 }
export const MAX_BLOCK_WEEKS = 52

export const newBlockDraft = id => ({
  id, name: '', daysPerWeek: 3, weeks: 4, days: {}, table: {}, nextBlockId: null,
})

/**
 * The exercises a block's table can be built over: those of the routines its days assign, once
 * each in routine order, plus any slot the table already holds whose routine has since changed (so
 * it can still be seen and taken out). `timed` marks the ones a table cannot take.
 */
export function blockSlotCandidates(S, block) {
  const routines = S?.routines || []
  const assigned = new Set(Object.values(block?.days || {}).filter(Boolean))
  const cfgs = new Map()
  for (const r of routines) {
    if (!assigned.has(r.id)) continue
    for (const e of r.ex || []) if (e?.id && !cfgs.has(e.id)) cfgs.set(e.id, e)
  }
  for (const id of Object.keys(block?.table || {})) {
    if (cfgs.has(id)) continue
    const cfg = routines.flatMap(r => r.ex || []).find(e => e?.id === id)
    cfgs.set(id, cfg || { id })
  }
  return [...cfgs.values()].map(cfg => ({ id: cfg.id, timed: modeOf(cfg) === 'time' }))
}

/**
 * A definition as it is stored: trimmed name, whole numbers, and every table slot holding exactly
 * weeks 1..weeks. A week the editor never touched is stored as DEFAULT_WEEK (what it showed), and
 * weeks past a shortened duration are dropped. Never mutates its argument.
 */
export function normalizeBlock(block) {
  const weeks = Math.round(Number(block.weeks)) || 0
  const table = {}
  for (const [slot, perWeek] of Object.entries(block.table || {})) {
    table[slot] = {}
    for (let w = 1; w <= weeks; w++) {
      const e = perWeek?.[w] || {}
      const entry = {
        pct: e.pct > 0 ? e.pct : DEFAULT_WEEK.pct,
        sets: e.sets > 0 ? Math.round(e.sets) : DEFAULT_WEEK.sets,
        reps: e.reps > 0 ? Math.round(e.reps) : DEFAULT_WEEK.reps,
      }
      if (e.exerciseId) entry.exerciseId = e.exerciseId
      table[slot][w] = entry
    }
  }
  return {
    id: block.id,
    name: String(block.name || '').trim(),
    daysPerWeek: Math.round(Number(block.daysPerWeek)) || 0,
    weeks,
    days: Object.fromEntries(Object.entries(block.days || {}).filter(([, id]) => id)),
    table,
    nextBlockId: block.nextBlockId || null,
  }
}

/**
 * Why a definition cannot be saved, as { code } (with `id` for 'timed'), or null when it can:
 *   name   — empty
 *   weeks  — not a whole number of weeks, 1..MAX_BLOCK_WEEKS
 *   days   — daysPerWeek is not 1..7, or the weekdays given a routine are not that many
 *   timed  — a timed exercise sits in the table (a slot, or a week's override): a block's
 *            percentages are of a Training Max, which a hold does not have (§1.1)
 *   chain  — the chain target is the block itself
 */
export function blockProblem(S, block) {
  const b = normalizeBlock(block)
  if (!b.name) return { code: 'name' }
  if (!(b.weeks >= 1 && b.weeks <= MAX_BLOCK_WEEKS)) return { code: 'weeks' }
  if (!(b.daysPerWeek >= 1 && b.daysPerWeek <= 7) || Object.keys(b.days).length !== b.daysPerWeek) return { code: 'days' }
  const cfgOf = id => (S?.routines || []).flatMap(r => r.ex || []).find(e => e?.id === id) || { id }
  for (const [slot, perWeek] of Object.entries(b.table)) {
    const timed = [slot, ...Object.values(perWeek).map(e => e.exerciseId)].find(id => id && modeOf(cfgOf(id)) === 'time')
    if (timed) return { code: 'timed', id: timed }
  }
  if (b.nextBlockId && b.nextBlockId === b.id) return { code: 'chain' }
  return null
}

/**
 * Saves a definition (new, or replacing the one with its id), normalized. Returns the problem and
 * writes nothing when it cannot be saved. S.activeBlock is never touched: a running block reads
 * the new definition from the next day on, past stamps are frozen (§8), and an exercise added to
 * the table mid-run has no captured Training Max, so it keeps its own progression until the block
 * ends (blockPrescriptionFor).
 */
export function saveBlock(s, block) {
  const problem = blockProblem(s, block)
  if (problem) return problem
  const next = normalizeBlock(block)
  if (!s.programBlocks) s.programBlocks = []
  const at = s.programBlocks.findIndex(b => b.id === next.id)
  if (at < 0) s.programBlocks.push(next); else s.programBlocks[at] = next
  return null
}

/**
 * Removes a definition. A chain that pointed at it is cleared (the block before it simply ends).
 * A running instance is left as it is: activeBlockDef reads null, the schedule reads rest, and
 * Stop block still works (§8).
 */
export function deleteBlock(s, id) {
  s.programBlocks = (s.programBlocks || []).filter(b => b.id !== id)
  for (const b of s.programBlocks) if (b.nextBlockId === id) b.nextBlockId = null
}
