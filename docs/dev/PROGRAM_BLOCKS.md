# Program Blocks — implementable spec

Run a Tactical-Barbell-style calendar-driven program (Base Building, Operator) as a bounded,
schedule-overriding unit, distinct from the app's existing session-history-driven progression.

Design provenance: `docs/dev/PROGRAM_BLOCKS_BRIEF.md` (product brief + analysis) and its
`/grill-with-docs` session, resolved into `CONTEXT.md` (**Program Block**, **Training Max**,
**Progression Table**, **Block Chain**) and `docs/adr/0001-program-block-chaining-not-phases.md`.
This document is the assembled hand-off; it describes what to build, not a change already made.

---

## 1. Model

**No new scheduling primitive beyond what `CONTEXT.md` already named.** A Program Block is a
reusable *definition* (like a Routine); an active block is one running *instance* of it (like
`S.rotation` vs. `S.queue`, `lib/rotation.js`).

### 1.1 `S.programBlocks` — definitions

```js
S.programBlocks = [{
  id, name,                      // "Base Building", "Operator"
  daysPerWeek,                   // fixed for the block's own duration (CONTEXT.md decision 1)
  weeks,                         // duration
  days: { [weekday]: routineId }, // which Routine (S.routines) trains on which weekday, this block's own mapping — never S.week
  table: {                       // Progression Table (CONTEXT.md) — per base exercise slot
    [exerciseId]: {
      [week]: { pct, sets, reps, exerciseId }  // exerciseId optional: override which exercise fills the slot that week
    }
  },
  nextBlockId: null,              // Block Chain target (ADR-0001) — another S.programBlocks id, or null
}]
```

- `days` is this block's own weekday → routine mapping, structurally identical to `S.week`
  but never read from or written to it (Decision 5 — full supersession, not reuse).
- `table` keys are **slots** — the base exercise id as it appears in the assigned Routine's
  `ex` list. A week's entry with no `exerciseId` progresses that slot's own exercise; a week's
  entry **with** `exerciseId` (e.g. Operator's deadlift-for-pull-ups week) builds that exercise
  instead, at that week's `pct`/`sets`/`reps`, and the TM looked up is the **override
  exercise's own** Training Max (§1.2), never the slot exercise's — deadlift and weighted
  pull-ups are unrelated lifts with unrelated maxes.
- An exercise absent from `table` entirely is not block-owned: it builds on its own `cfg.prog`
  policy untouched, exactly as today (CONTEXT.md decision 8). This is also how a "both in the
  routine, only one in the table" accessory lift opts out — implicitly, no flag.
- Exactly one of `pct` or (for an exercise `modeOf` reads as `'time'`) a seconds-equivalent
  field applies — Tactical Barbell's lifts are all loaded, so v1's `table` entries carry `pct`
  only; a timed exercise is simply never placed in a block's `table` (validated at block-editor
  save, not at read time).

### 1.2 `S.activeBlock` — the running instance

```js
S.activeBlock = {
  blockId,                        // S.programBlocks id
  startsOn,                       // iso date — week 1 day 1
  tm: { [exerciseId]: number },   // Training Max, captured at start (CONTEXT.md decision 2)
}
```

- `null` when no block is running. `S.scheduleMode` (`store/useStore.js:105`) gains a third
  value, `'block'`, alongside today's `null`/`'rotation'`; `scheduleModeOf` (`lib/rotation.js:31`)
  becomes `S.activeBlock ? 'block' : (queueOf(S) || S.scheduleMode === 'rotation') ? 'rotation' : 'week'`.
- `tm` holds exactly the exercise ids that appear as a `table` key *or* as some week's override
  `exerciseId` for the active block — i.e., every exercise the block will ever need a Training
  Max for, captured once at start (decision 2: a snapshot of the app's estimated 1RM ×0.9 fixed,
  or a direct Training Max entry, editable; `lib/onerm.js` `best1RM` is the snapshot source).
- Week number is **never stored** — it's a pure function of `today` and `startsOn`, matching
  the app's existing preference for derived-not-stored state (`progression.js`'s header
  comment: "nothing writes back... the next prescription is derived from it every time").

```js
// lib/program-block.js
export function blockWeekOf(block, activeBlock, iso = todayISO()) {
  const days = Math.floor((new Date(iso) - new Date(activeBlock.startsOn)) / 86400000)
  const week = Math.floor(days / 7) + 1
  return week >= 1 && week <= block.weeks ? week : null  // null = block's run is over
}
```

---

## 2. `lib/program-block.js` (new)

Mirrors `lib/rotation.js`'s split: pure helpers here, store writes (`update(s => ...)`) at the
call sites in `views/` and the app shell. Imports `progression.js` (for `snapWeight`/`weightIncrement`) and
`onerm.js` (for the TM-capture default); nothing imports this file but `session-start.js`,
`history.js`'s resolver, `App.jsx`, and `views/Plan.jsx`/`Home.jsx` — no cycle.

```js
export const blockOf = (S, id) => (S.programBlocks || []).find(b => b.id === id) ?? null
export const activeBlockDef = S => S.activeBlock ? blockOf(S, S.activeBlock.blockId) : null

// This block's routine for a weekday — the block's own `days` map, never S.week.
export function blockRoutineIdFor(block, weekday) {
  return block?.days?.[weekday] ?? null
}

// The slot's table entry for the active week, or null when this exercise isn't block-owned
// this week (not in `table`, or in `table` but with no entry for this week — e.g. a slot the
// block only progresses starting week 3).
export function blockTableEntry(block, week, exerciseId) {
  return block?.table?.[exerciseId]?.[week] ?? null
}

// The prescription for one block-owned exercise this week — same return shape as
// progression.js's nextPrescription ({ policy, kind, weight, reps, sets, why }), so
// buildPlannedEntry (session-start.js) can use either interchangeably.
export function blockPrescriptionFor(S, cfg, routine, iso = todayISO()) {
  const block = activeBlockDef(S)
  if (!block || !S.activeBlock) return null
  const week = blockWeekOf(block, S.activeBlock, iso)
  if (week == null) return null
  const entry = blockTableEntry(block, week, cfg.id)
  if (!entry) return null
  const realId = entry.exerciseId ?? cfg.id
  const tm = S.activeBlock.tm[realId]
  if (!(tm > 0)) return null  // TM never captured for this exercise — falls through to nextPrescription
  const step = weightIncrement(cfg, S.unit || 'kg')
  const weight = snapWeight(tm * entry.pct / 100, step)
  return {
    policy: 'block', kind: 'block', weight, reps: entry.reps, sets: entry.sets,
    // `realId`/`week` ride along so buildSessionEntries (§2.1) can swap the exercise and stamp history.
    exerciseId: realId, week, blockId: block.id,
    why: ['{0} · Week {1} of {2}: {3}% of {4} {5} Training Max.', block.name, week, block.weeks, entry.pct, tm, S.unit || 'kg'],
  }
}
```

### 2.1 Building a block day's entries — no new builder

A block day builds through the existing path, unchanged in shape: `effectiveRoutineIds` (§4)
already returns `[routineId]` in block mode, so `buildCombinedEntries` → `buildSessionEntries` →
`buildPlannedEntry` runs as for any other day, and `entry.rid` / `{ entries, routineIds,
routines }` keep working. There is no `buildBlockEntries` and no separate slot builder.

The one thing a block adds that `buildSessionEntries` (`lib/session-start.js:118`) did not do is
the week's exercise override (`entry.exerciseId`). When the plan for a `cfg` carries an
`exerciseId` different from `cfg.id`, `buildSessionEntries` builds `{ ...cfg, id: plan.exerciseId }`
instead — the rest of `cfg` (`sg`, equipment/warm-up defaults, intensifiers) rides along, so the
swapped exercise is built exactly like a freshly swapped-in one. The override exercise need not
be in the routine's `ex` list; its `cfg` is the slot's, re-pointed.

```js
// session-start.js — buildSessionEntries, the only change
return (r ? r.ex : []).map(slot => {
  const plan = noProg ? null : blockPrescriptionFor(st, slot, r, date)
  const cfg = plan && plan.exerciseId !== slot.id ? { ...slot, id: plan.exerciseId } : slot
  const built = buildPlannedEntry(st, cfg, r, { noProg, blockPlan: plan })
  return { id: cfg.id, sg: cfg.sg, ...built, ...(noProg ? { noProg: true } : {}) }
})
```

`date` is `sessionDateOf(st)` (`lib/backfill.js`): the builders already receive the history
view a session is built from, and `historyAsOf` stamps that view with `asOf` (the day it was cut
at), so a backfilled or edited session resolves *its* week and a live one resolves today's (§3).

---

## 3. `session-start.js` integration

`buildPlannedEntry` (`lib/session-start.js:30`) accepts the block plan resolved by
`buildSessionEntries` (§2.1) and uses it in the position the `noProg` branch already occupies:

```js
export function buildPlannedEntry(stored, cfg, routine, { noProg = false, blockPlan = null } = {}) {
  ...
  const plan = noProg ? { policy: 'off', kind: 'off' } : blockPlan ?? nextPrescription(st, cfg, routine)
  ...
```

Everything downstream of `plan` (`applyPrescription`, warm-up re-ramp, backoff, intensifiers)
already only reads `plan.weight`/`.reps`/`.sec`/`.sets` — it does not care whether `plan` came
from a policy or a block, so no other line in this function changes.

**Date threading.** No new parameter: every builder call site already hands over the state it
builds from, and the past-session ones (backfill, edit a saved workout, in-session rebuilds —
all through `historyAsOf` / `sessionHistory`) hand over a view cut at the session's day.
`historyAsOf` stamps that view with `asOf`; `sessionDateOf(st)` reads it (today when absent) and
`blockPrescriptionFor` / `blockWeekOf` use it. Shipped by ticket 01.

`routine.excludeFromProgression` wins: a `noProg` build gets no block plan (a rehab routine in
a block stays at its own numbers, as everywhere else).

---

## 4. Resolver integration — full supersession (CONTEXT.md decision 5)

`effectiveRoutineIds` (`lib/history.js:477`) gains a block branch **before** every existing
check — `S.dayPlan` override, the queue/pin logic, `S.week` — all of it is old-schedule
machinery a block supersedes:

```js
export function effectiveRoutineIds(S, iso, today = todayISO()) {
  if (scheduleModeOf(S) === 'block') {
    const block = activeBlockDef(S)
    const week = block ? blockWeekOf(block, S.activeBlock, iso) : null
    if (week == null) return []   // block's run is over, or definition missing — rest until the chain/cleanup below resolves it
    const weekday = new Date(iso + 'T12:00:00').getDay()
    const id = blockRoutineIdFor(block, weekday)
    return id && S.routines.some(r => r.id === id) ? [id] : []  // unassigned day within the block's week = rest, no fallback
  }
  // ...existing dayPlan / queue / S.week logic, unchanged
}
```

**Resolved (CONTEXT.md decision 10)**: `S.dayPlan[iso]` is suppressed while a block is active,
with no override escape hatch for v1 — a one-off deviation means ending the block early (§6.1)
rather than "blipping" a single day, so there's no second rule for what a dayPlan-overridden
day does to the calendar or the Progression Table.

No change to workout building: callers already pass `effectiveRoutineIds` to
`buildCombinedEntries`, so block days arrive through the same door (§2.1).

---

## 5. History/Stats stamping (CONTEXT.md decision 9)

Frozen at build time, the same way `rid`/`planned`/`noProg` already are (`COMBINE_ROUTINES.md`
§1, §8) — never recomputed from a later-edited block definition:

- `buildSessionEntries` stamps `entry.blockId` + `entry.blockWeek` from `plan.blockId`/`plan.week`
  (§2.1) onto every block-owned entry; an entry built from `nextPrescription` (not block-owned
  that week, or no block active) carries neither key, exactly like `noProg` today.
- `lib/finish-workout.js`'s per-entry field whitelist (the same one `COMBINE_ROUTINES.md` §6
  had to extend for `rid`/`noProg`) gains `blockId`/`blockWeek` — otherwise both are silently
  dropped at Finish, the same bug that spec called out for `rid`.
- `views/History` / `WorkoutDetail` renders "{block.name} · Week {blockWeek} of {block.weeks}"
  under the session header when `entry.blockId` is present and still resolves to a
  `S.programBlocks` entry (a deleted block definition degrades to showing nothing extra — the
  logged sets and weights are unaffected either way).

---

## 6. Lifecycle & Block Chain (CONTEXT.md decisions 4, 6)

Unlike `lib/rotation.js`'s `refillAfter` (which refills on a **completed, logged** pass), a
Program Block's clock is calendar-fixed (decision 6b) — completion is a date fact, not a
logging fact, so it can be checked on read rather than needing a workout-finish trigger.

```js
// Called from Home's mount / a day-boundary check, like queueRecovery's read-time check.
export function blockNeedsAdvance(S, today = todayISO()) {
  const block = activeBlockDef(S)
  return !!(block && S.activeBlock && blockWeekOf(block, S.activeBlock, today) == null)
}

// Ends the current block. With a Block Chain target, hands back the next block's id and start date so the
// caller can run it through the same TM-capture flow a manual start uses (decision 4 — no
// numbers carry over, including for an exercise the two blocks share).
export function advanceBlock(s, today = todayISO()) {
  const block = activeBlockDef(s)
  const next = block?.nextBlockId ? blockOf(s, block.nextBlockId) : null
  const startsOn = block && s.activeBlock ? addDaysISO(s.activeBlock.startsOn, block.weeks * 7) : null  // prev block's end date (§6.0.1)
  s.activeBlock = null              // reverts to whatever S.week/S.rotation already held (decision 6a) — untouched throughout
  // Chain target already over by the time anyone opens the app → drop it, old schedule resumes.
  if (!next || blockWeekOf(next, { startsOn }, today) == null) return null
  return { nextBlockId: next.id, startsOn }
}
```

### 6.0 Where the end-of-block check runs

Not in `views/Home.jsx`: a PWA can cold-start on `/workout` or `/plan` (notification, deep
link), and until the check runs `effectiveRoutineIds` returns `[]`. The check runs at the app
shell (`App.jsx`, on mount and on day rollover, next to `queueRecovery`'s read-time check):
`blockNeedsAdvance` → `advanceBlock`. A truthy return sets a "chain prompt pending" flag in
`store/useUI.js`; `views/Home.jsx` only *reads* it to open the **Start block** TM-capture sheet
(§7.2) pre-selected to the chained block, rather than returning to the plain Schedule view.

### 6.0.1 Chained block start date

A chained block's clock starts on the **previous block's end date** (`prev.startsOn +
prev.weeks * 7`), not on the day the user confirms the TM sheet — the calendar stays contiguous
(decision 6b applies across the chain too). The TM sheet appears whenever the app is first
opened after the end date; confirming it writes `startsOn: prevEnd`. If `blockWeekOf` would
already be `null` for the chained block (its whole duration has passed), the chain is dropped
without a prompt and the old schedule resumes. `advanceBlock` therefore returns
`{ nextBlockId, startsOn }` or `null`, not a bare id.

### 6.1 Stop block (manual, CONTEXT.md decision 11)

The only way out of a block before its calendar end date — there is no other escape hatch
(§4's resolved `dayPlan` note). Mirrors `rotation.js`'s `stopPass`: immediate, no confirm beyond
the tap (Plan already uses a toast-Undo pattern for comparable reversible actions — see
`deleteRoutineWithUndo`, `views/Plan.jsx:39` — stop could reuse it, since reverting is itself
free: nothing is deleted, just `S.activeBlock` cleared).

```js
// Always exits the Block Chain — `nextBlockId` is never consulted here. Reverts to whatever
// S.week/S.rotation already held, exactly like advanceBlock's ordinary end-of-duration path.
export function stopBlock(s) {
  s.activeBlock = null
}
```

Sessions already logged under the stopped block keep their `blockId`/`blockWeek` stamp (§5) —
stopping is forward-only, it does not retroactively touch History.

---

## 7. Entry-point flows (UI)

### 7.1 Plan → Schedule

`views/Plan.jsx`'s "How you train" `Segmented` (Week / Rotation, around `scheduleModeOf`'s call
sites at `:224`) gains a third option, **Program Block**. Selecting it with no block running
opens a single-pick list of `S.programBlocks` → **Start block** sheet. While a block is
running, this tab instead shows its name, "Week {n} of {weeks}", and two actions: **Stop
block** (§6.1 — immediate, toast-Undo) and, only once a `nextBlockId` exists, a muted "then →
{next block's name}" hint (informational; the chain still fires on its own, §6).

### 7.2 Start block (Training Max capture)

New sheet, one row per exercise appearing in the chosen block's `table` (base slots and any
week's override `exerciseId`, deduplicated) — **all of them, upfront, in this one sheet**
(CONTEXT.md decision 12): an exercise only reached via a week-12 `exerciseId` override still
gets a row here, at block start, not a prompt deferred to week 12. Each row: exercise name, a
toggle **1RM / Training Max**, and a prefilled number —
- **1RM** mode prefills `best1RM(S, exId)` (`lib/onerm.js:182`) when one exists, editable; on
  save, stores `Math.round(value * 0.9 * 10) / 10` into `tm[exId]` (fixed 90%, decision 2).
- **Training Max** mode prefills nothing (blank — a declared number, not a derived one),
  stores the entered value as-is.

Confirming writes `S.activeBlock = { blockId, startsOn, tm }` — `startsOn` is today for a
manual start, or the previous block's end date for a chained one (§6.0.1) — and `S.scheduleMode =
null` (the third value is derived from `S.activeBlock`'s presence, §1.2 — nothing to set).

### 7.3 Block editor

New screen/sheet (Plan → Program Block → ⋯ → Edit, or New), building `S.programBlocks` entries:
day-count, duration, weekday→Routine assignment (reusing the existing day-assignment picker
UI `dayAssignSheet`, `sheets.jsx`, scoped to the block instead of `S.week`), and the
Progression Table — a per-exercise grid, one row per week, `{pct, sets, reps}` plus an optional
"different exercise this week" picker that writes `exerciseId`. Out of scope for a first pass:
a template importer (typing in Tactical Barbell's actual week-by-week numbers by hand is
acceptable for a personal-use v1 with two known templates).

### 7.4 Home

While `scheduleModeOf(S) === 'block'`, the Today card and week-strip (`views/Home.jsx`, the
same sites `COMBINE_ROUTINES.md` §9 touched for combined-day display) read through
`effectiveRoutineIds` exactly as any other mode — no special-casing needed there, since §4
already makes the resolver block-aware. The Today card additionally shows "{block.name} · Week
{week} of {weeks}" as a subtitle.

---

## 8. Data-model invariants

- **`S.activeBlock.tm` is captured once, upfront, for every exercise the block's `table` can
  ever reach** (decision 12) — `blockPrescriptionFor`'s missing-TM fallback to
  `nextPrescription` (§2) exists only for the edge case below (editing the definition
  mid-run), never as an expected path for a block started normally through §7.2's sheet.
- **An exercise added to the block's `table` *after* the block started** (editing the
  definition mid-run) has no TM captured — `blockPrescriptionFor` returns `null` and the
  exercise falls through to `nextPrescription` until the block ends. Never a silent
  `weight: 0`; this is the one place the fallback is reached in practice.
- **A block's `days`/`table` are read, never mutated, by the running instance.** Editing a
  block definition while it's active changes next week's prescription, not past entries
  (consistent with `planChanged`/`noProg`'s freeze-at-build precedent elsewhere in the app).
- **A session's block week is a function of the session's date**, never of when it was built or
  logged: backfilled sessions resolve and stamp their own week (§3).
- **One active block at a time.** `S.activeBlock` is a scalar, not a list — matches `S.queue`.
- **`blockWeekOf` returning `null` is the sole "this block's run is over" signal** — no
  separate `active: false` flag to drift out of sync with the date math.
- **Deleting a `S.programBlocks` definition while it's the active block's `blockId`** leaves
  `S.activeBlock` pointing at nothing; `activeBlockDef` returns `null`, `effectiveRoutineIds`'s
  block branch returns `[]` (rest) rather than throwing. Treated as the same "stale reference"
  class the app already tolerates (a deleted routine inside `S.week`, `COMBINE_ROUTINES.md` §4).

---

## 9. Sync / merge (`lib/sync-merge.js`)

- **`S.programBlocks`**: union by id, like `routines` (same file's existing rule for named,
  user-edited lists) — of an id both copies have, the version edited last by its own
  timestamp.
- **`S.activeBlock`**: scalar, like `S.queue`/`S.rotation` — whichever copy changed it last
  wins wholesale; no partial merge of `tm` (a TM capture is one atomic action, not a
  field-by-field edit stream).

---

## 10. Out of scope

- **AI Coach / reminders** (CONTEXT.md decision 7) — `api/coach/core/*` and `lib/queue.js`
  reminders are not touched; both go stale while a block is active. Accepted, documented gap.
- **`lib/plan-share.js`** — Program Block export/import. Not asked for in the brief; add only
  if block-sharing is wanted later, following `COMBINE_ROUTINES.md` §5's per-field remap
  pattern as the template.
- **Per-exercise explicit opt-out toggle** (decision 8) — opt-out is implicit (absence from
  `table`); no UI/flag needed.
- **Timed/cardio exercises in a block's table** — Tactical Barbell's schemes are all loaded
  lifts; a block's `table` entries are `pct`-only (§1.1). Supporting a timed hold's percentage
  progression is a later, separate effort if ever needed.
- **A template importer / library of built-in Tactical Barbell blocks** — v1 is the manual
  block editor (§7.3); Base Building and Operator are entered by hand once.
- **A "blip one day" override while a block is active** — resolved against, not deferred
  (§4, CONTEXT.md decision 10): there is deliberately no escape hatch short of Stop block
  (§6.1).

---

## 11. Test checklist

Per `CONTRIBUTING.md`: anything deciding what you lift, or reading a session back, is a pure
`lib/` helper with a unit test beside it.

### `lib/program-block.test.js` (new)

1. `blockWeekOf`: day 0–6 of the block → week 1; day 7–13 → week 2; a date before `startsOn` or
   past `weeks * 7` days → `null`.
2. `blockPrescriptionFor`: no active block → `null`; exercise not in `table` → `null`; in
   `table` but no entry for the current week → `null`; entry present, no TM captured yet →
   `null` (falls through, never `weight: 0`); entry + TM → `{weight, reps, sets}` with `weight`
   snapped to the exercise's increment.
3. `blockPrescriptionFor` with a week's `exerciseId` override: TM looked up under the
   **override** exercise's id, not the slot's.
4. `buildSessionEntries`/`buildCombinedEntries` on a block day: a weekday with no block-assigned
   routine → no entries; an overridden week builds the override exercise (not the slot's) with
   the slot's `sg`/config carried over, and no entry for the slot exercise that day; `rid` and
   `routineIds` are still stamped/returned.
4b. Date threading: building for a backfilled date in week 2 while "today" is week 4 yields the
    week-2 percentage and `blockWeek: 2`.
5. `advanceBlock`: no `nextBlockId` → `S.activeBlock = null`, `S.week`/`S.rotation` read
   exactly as they did before the block started (untouched, not reset). With `nextBlockId` →
   returns `{ nextBlockId, startsOn }` with `startsOn` = the previous block's end date (not
   `today`); `S.activeBlock` cleared (caller starts the new one via the normal TM-capture flow,
   not this function). Chain target already over at `today` → returns `null`.
6. `stopBlock`: clears `S.activeBlock` regardless of `nextBlockId` — called on a block with a
   chain target, the chain never fires (distinct from `advanceBlock`, which hands the id back).
   Sessions already logged keep their `blockId`/`blockWeek` stamp after stopping.

### `lib/history.test.js`

7. `effectiveRoutineIds` under `scheduleModeOf(S) === 'block'`: block's own `days` resolve,
   `S.week`/`S.rotation`/`S.dayPlan` on the same date are never consulted (set contradicting
   values in the fixture and assert they're ignored); an unassigned weekday within the block →
   `[]`; a week number of `null` (block over) → `[]`.

### `lib/session-start.test.js`

8. `buildPlannedEntry` for a block-owned exercise this week: `plan.kind === 'block'`,
   `entry.blockId`/`entry.blockWeek` stamped; warm-up ramp and backoff still apply on top
   (reuses the existing post-`plan` pipeline, §3).
9. Same exercise in a week the block's `table` has no entry for: falls through to
   `nextPrescription`'s ordinary policy output, no block stamp.

### `lib/finish-workout.test.js`

10. `blockId`/`blockWeek` survive the per-entry whitelist onto the saved workout (currently
    would be dropped, same class of bug `COMBINE_ROUTINES.md` §6 fixed for `rid`).

### `lib/sync-merge.test.js`

11. `S.programBlocks`: union by id, newer edit per-id wins on an id both copies have.
12. `S.activeBlock`: wholesale newer-`_ts` wins; no partial `tm` merge.

### Component

13. `views/Plan.block.test.jsx` — Schedule segmented control's third option starts the block picker;
    Start-block sheet's 1RM/Training Max toggle computes the stored `tm` value correctly for
    both modes (1RM × 0.9 vs. direct entry); a week-12-only override exercise still gets a row
    in the same upfront sheet (decision 12); Stop block clears `S.activeBlock` and never offers
    the chained block.
14. `views/Home.block.test.jsx` — Today card shows "{block.name} · Week N of M" while a block is
    active; with the chain-prompt-pending flag set, Home opens the chained block's TM-capture
    sheet instead of silently reverting.
15. `App.block.test.jsx` — cold-start on `/workout` after a block's end date runs
    `blockNeedsAdvance` → `advanceBlock` before any view reads the schedule, and sets the
    chain-prompt flag when a chained block remains.
