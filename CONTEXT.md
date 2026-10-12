# openGym

A self-hosted gym & body-weight tracker PWA. This file captures the domain vocabulary — the
concepts users and code should agree on — distinct from `CLAUDE.md` (architecture/conventions)
and `docs/dev/*.md` (per-feature implementable specs).

## Language

**Program Block**:
A fixed-N-days/week, fixed-M-week unit of training (e.g. Tactical Barbell's Base Building or
Operator) that wraps existing Routines and overrides their schedule and progression for its
duration. Day-count per week is constant across the block; week-to-week variation (deload,
wave loading) lives in the block's progression table, not in how many days it trains.
_Avoid_: Program, Plan, Cycle (all already mean something else or nothing specific in this app).

**Training Max (TM)**:
The per-exercise load a Program Block's progression table percentages are calculated against.
Captured once at block start, per exercise: either entered directly as a Training Max, or
entered as a 1RM (manual or snapshotted from the app's existing estimated 1RM, `onerm.js`) and
converted to a Training Max at a fixed 90%. Distinct from the app's existing estimated 1RM,
which is a rolling, session-derived number never declared by the user.
_Avoid_: 1RM (for the block's working number), max, true max.

**Progression Table**:
A per-exercise, week-indexed map of `{ pct, sets, reps, exerciseId? }` for the duration of a
Program Block — `pct` relative to that exercise's Training Max. Sets and reps can vary week
to week, not just load, and a week may override which exercise fills the slot (e.g. Operator's
deadlift-for-pull-ups week); `exerciseId` absent means the block's base exercise for that slot.
_Avoid_: schedule, plan (both already mean something else in this app).

**Block Chain**:
A Program Block may declare a next block that starts the day its own duration ends (e.g.
Base Building's 5-week phase handing off into an Operator-shaped block) — on that calendar
date, even if the user only opens the app later. The next block runs
through the same Training Max capture flow as a manually-started block — a fresh snapshot of
estimated 1RM per exercise, editable — rather than inheriting the prior block's numbers.
_Avoid_: phase (a block's day-count/structure is fixed for its own duration — see **Program
Block** — a structural change is always a new chained block, never a phase within one).

## Relationships

- A **Program Block** wraps one or more existing **Routines** (`S.routines`) as its workout
  content — it does not duplicate exercise/sets/reps data.
- A **Program Block** declares one **Training Max** per exercise it progresses, and one
  **Progression Table** per exercise it progresses; the table's `pct` is always relative to
  that exercise's **Training Max**, never the app's estimated 1RM directly.
- A **Program Block** may link to a next **Program Block** via a **Block Chain**; the linked
  block captures its own **Training Max** independently when it starts.
- An active **Program Block** fully supersedes `S.week`/`S.rotation` (no coexistence); days
  within the block's week it doesn't assign a workout to are rest, not a fallback to the old
  schedule.
- A **Program Block**'s week-count is strictly calendar-fixed — missed sessions never pause
  or extend it, preserving the calendar-driven (not performance-driven) prescription that
  distinguishes it from the app's existing session-history-driven progression policies.
- A **Program Block** with no **Block Chain** target reverts to the previous `S.week`/
  `S.rotation` schedule on completion — no auto-prompt, no repeating its last week.
- A **Program Block** owns only the exercises named in its **Progression Table**; any other
  exercise in a wrapped **Routine** keeps its own existing `cfg.prog` policy untouched — opt-out
  is implicit (absence from the table), not a separate flag.
- Every session logged under an active **Program Block** is stamped with the block id and week
  number at build time (frozen, like `rid`/`planned` on an entry — never recomputed), so
  History/Stats can show "Base Building, Week 3 of 6" context that survives a later edit to
  the block's own definition.
- `S.dayPlan`'s per-date override has no effect while a **Program Block** is active — a block
  leaves no manual "blip one day" escape hatch; a real deviation means ending the block.

## Flagged ambiguities

- "1RM" is used ambiguously in the brief: the app's existing *estimated* 1RM (derived,
  rolling) vs. the block's *declared* **Training Max** (one-time, user-entered or confirmed,
  fixed for the block's duration). Resolved: these are distinct concepts — see **Training
  Max** above.
- "Base Building" and "Operator" initially read as two unrelated, same-shaped programs
  (different numbers over one mechanism). Resolved: they are structurally different — Base
  Building is two **Block Chain**-linked blocks, the second of which reuses Operator's own
  day-structure (including its exercise-swap week). See **Block Chain**.

## Decisions pending (see `docs/dev/PROGRAM_BLOCKS_BRIEF.md` §3 for the open-question list)

1. ✅ Block shape — fixed N days/week for the whole block; per-week variation is expressed in
   the progression table (pending: table shape, see question 3), not in day-count. A
   structural change mid-program (Base Building → Operator shape) is a **Block Chain** to a
   new block, not an exception to this rule (see decision 4).
2. ✅ Training Max capture — per-exercise (not per-lift-category); entered either as a 1RM
   (manual, or a snapshot of the app's estimated 1RM, editable) converted at a fixed 90%, or
   entered directly as a Training Max. The 90% factor is a fixed constant for now, not a
   per-profile setting.
3. ✅ Progression Table shape — `week → {pct, sets, reps}` per exercise, not just `week → pct`;
   sets/reps can vary week to week alongside load.
4. ✅ Base Building vs. Operator — structurally different, not just different numbers over one
   mechanism. Base Building is modeled as two **Block Chain**-linked **Program Blocks**: its
   own 5-week/2x-week block, auto-followed by a block reusing Operator's day-structure
   (including the weekly deadlift-for-pull-ups swap, via the Progression Table's optional
   `exerciseId`). The chained block captures its own Training Max fresh rather than inheriting
   the prior block's numbers.
5. ✅ Block vs. Routines/Rotation — full supersession while a block is active (a third
   `scheduleModeOf` value, `'block'`, alongside `'week'`/`'rotation'`); unassigned days within
   the block's week are rest, with no fallback to the old weekly schedule.
6. ✅ Lifecycle — a block with no chained next block reverts to the previous schedule on
   completion (no prompt, no repeat); week-count is strictly calendar-fixed, never paused or
   extended by missed sessions.
7. ✅ Scope boundary — AI Coach visibility and reminders-while-in-a-block both deferred for v1;
   `api/coach/core/*` and `lib/queue.js`-driven reminders are not touched, and will read stale
   `S.week`/`S.routines` while a block is active. Accepted gap, not a correctness bug.
8. ✅ Exercise-level progression interaction — implicit opt-out: a block owns only the
   exercises in its Progression Table; anything else in a wrapped Routine keeps its existing
   `cfg.prog` policy untouched, no separate toggle needed.
9. ✅ History/Stats surface — sessions logged under a block are stamped (block id + week
   number, frozen at build time) so History/Stats can show block/week context.

All nine open questions from `docs/dev/PROGRAM_BLOCKS_BRIEF.md` §3 are resolved as of this
session.

## Decisions pending, round 2 (surfaced while drafting `docs/dev/PROGRAM_BLOCKS.md`)

10. ✅ `S.dayPlan` during an active block — suppressed entirely, no override escape hatch for
    v1; a one-off deviation means ending the block (see decision 11), not blipping a day.
11. ✅ Manual "Stop block" — an explicit stop action exists (mirrors `rotation.js`'s
    `stopPass`); stopping always exits the **Block Chain** entirely and reverts to the
    previous `S.week`/`S.rotation` — it never auto-starts the chained next block early. Moving
    on to that block afterward is a normal manual start.
12. ✅ Training Max capture timing — all upfront, at block start, for every exercise the block
    will ever need (every **Progression Table** slot and every week's `exerciseId` override),
    not lazily prompted mid-block the first week each is needed.

## Decisions pending, round 3 (surfaced while reviewing `docs/dev/PROGRAM_BLOCKS.md` against the code)

13. ✅ Chained block start date — a chained block's week 1 begins on the previous block's end
    date, not the day the user confirms its Training Max sheet; if the chained block's whole
    duration has already passed by then, the chain is dropped and the previous schedule resumes.
    Extends decision 6b's calendar-fixed rule across the chain.
14. ✅ A session's block week follows the session's own date — a backfilled session is
    prescribed and stamped with the week its date falls in, not today's week.
