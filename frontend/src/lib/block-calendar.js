// The calendar half of Program Blocks (lib/program-block.js): which block is running, which week
// of it a date falls in, which routine it assigns to a weekday. Imports nothing, so history.js
// (the schedule resolver) and rotation.js (scheduleModeOf) can use it without a cycle through
// progression.js, which program-block.js needs for prescriptions.

const DAY_MS = 86400000

/** Which week (1-based) of the block `iso` falls in, or null when the date is outside its run. */
export function blockWeekOf(block, activeBlock, iso) {
  if (!block || !activeBlock) return null
  const days = Math.floor((Date.parse(iso) - Date.parse(activeBlock.startsOn)) / DAY_MS)
  const week = Math.floor(days / 7) + 1
  return week >= 1 && week <= block.weeks ? week : null
}

export const blockOf = (S, id) => (S?.programBlocks || []).find(b => b.id === id) ?? null
export const activeBlockDef = S => (S?.activeBlock ? blockOf(S, S.activeBlock.blockId) : null)

/**
 * The routines a running block trains on `iso`: its own routine for that weekday, or none (rest)
 * when the weekday is unassigned, the routine was deleted, the definition is gone or the run is
 * over. The block's `days` map is read here and nowhere else; S.week is never consulted.
 */
export function blockRoutineIdsOn(S, iso) {
  const block = activeBlockDef(S)
  if (!block || blockWeekOf(block, S.activeBlock, iso) == null) return []
  const id = block.days?.[new Date(iso + 'T12:00:00').getDay()]
  return id && (S.routines || []).some(r => r.id === id) ? [id] : []
}
