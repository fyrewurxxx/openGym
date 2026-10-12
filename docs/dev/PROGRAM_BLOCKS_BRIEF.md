# Program Blocks — product brief + high-level analysis

Status: brief captured, pre-grill. Next step is a `/grill-with-docs` session to turn the
open questions below into resolved decisions in `CONTEXT.md`/ADRs.

---

## 1. Product brief (as given, 2026-10-12)

> **Objective:** The ultimate end goal is to be able to run my Tactical Barbell programs in
> OpenGym. Specifically, Base Building and Operator.
>
> **Description:** I want the ability to run both the Base Building program and the Operator
> program (not at the same time, but as two program blocks). Whilst I can currently build the
> workout and set the days, it does not seem like OpenGym currently has a feature that allows
> me to set the Plan duration (e.g. 3x workouts per week for 6 weeks) and % of 1RM progression
> (e.g. I set my 1RM for each exercise at the start of the plan, Week 1 my workouts are 70% of
> 1RM, Week 2 my workouts are 80% of my 1RM and Week 3 my workouts are 90% of my 1RM etc.). This
> is what I want to build in.

---

## 2. High-level analysis

### 2.1 What's genuinely new vs. what already exists

`S.routines` (the workout) and `S.week`/`S.rotation` (day assignment)
already do real work here — building the workout and picking the days is already possible
today, as the brief itself says. **Two things are missing, and they're the entire ask:**

1. **A bounded block with a duration** — "3x/week for 6 weeks" has a start, an end, and a week
   count. Nothing in the codebase has this — `S.week` repeats forever,
   `S.rotation` loops forever. This is new state, not a parameter on existing state.
2. **Calendar-driven (not performance-driven) progression** — this is the sharper finding.
   `progression.js`'s five live policies (`linear`/`greyskull`/`double`/`triple`/`time`) all
   decide the next prescription from **session history** (did you hit your reps last time?
   stall count? deload trigger?). Tactical Barbell's %1RM scheme decides the prescription from
   **which week of the block it is** — a pure function of `(trainingMax, weekNumber)`, blind to
   whether last session's reps were hit. This isn't a sixth entry in `POLICIES` that slots into
   the existing `policyFor(cfg, routine, mode)` precedence — it needs a week number as an input
   the engine has never taken, because no caller has ever had one to give it (a progression rule today
   is never schedule-aware).

### 2.2 The 1RM gap

The brief says "I set my 1RM for each exercise at the start of the plan." I checked
`frontend/src/lib/onerm.js` directly: openGym only has **estimated** 1RM, derived continuously
from logged AMRAP/RIR sets (`estimate1RM`, `e1rmSeries`, `best1RM`). There is no field anywhere
for a user-entered training max. Tactical Barbell conventionally uses a *conservative,
user-declared* training max (often ~90% of true max), not a rolling estimate — so this brief
needs a genuinely new input, not a read of existing data. Whether the block's 1RM is a one-time
manual entry, a snapshot of the current estimated 1RM at block-start (editable), or both, is
open (see §3).

### 2.3 Where a Program Block sits relative to existing concepts

A Program Block most naturally **wraps existing Routines** rather than replacing them:
- It still needs `S.routines` as the workout content (exercise list, sets/reps shape) — no
  reason to duplicate that.
- It needs its own day-assignment, scoped to the block, not the global `S.week`/`S.rotation` —
  because the brief's "3x/week" is a property of *this block*, and the user explicitly wants to
  run a different block (Operator) later with potentially different days. Reusing global
  `S.week` would leak one block's schedule into the next.
- It needs a new progression type that is schedule-aware — a block-scoped percentage table
  (week → %1RM, and plausibly week → sets/reps too, since Tactical Barbell templates vary rep
  scheme by week in some variants, not just load) overriding the routine/exercise-level
  `prog` for the exercises it touches, for the block's duration only.

This implies three new pieces of state, roughly: a **block definition** (name, routines,
days/week mapping, duration in weeks, per-exercise %1RM-by-week table, source training maxes),
an **active block instance** (which block is live, its start date, so "week 3 of 6" can be
derived from today's date), and a **resolution path** that makes `effectiveRoutineIds`/
`nextPrescription` (or new equivalents) check "is an active block in play" before falling back
to the existing global schedule/progression. Getting that precedence right — block overrides
global while active, global resumes when the block ends — is the central design risk and a
good candidate for an ADR once decided (hard to reverse, several genuine alternatives).

### 2.4 Secondary systems that will need a decision, not necessarily a build

These aren't "new features" but places that currently assume the old
shape and will silently go stale if untouched:
- **AI Coach** (`api/coach/core/payload.js`, `plan-hash.js`) reads `S.week`/`S.routines`
  server-side. If a Program Block supersedes `S.week` while active, the Coach's view of "the
  plan" goes stale unless mirrored — same lockstep problem COMBINE_ROUTINES already solved once.
  Brief doesn't mention the Coach at all — worth confirming it's out of scope for v1.
- **Reminders/push** (`api/server.js:419-523`) derive "today's routine" server-side via
  `lib/queue.js`. Same staleness risk if a block's schedule isn't visible there.
- **Plan export/share bundle** (`lib/plan-share.js`) would silently drop block fields on
  export/import unless updated — only matters if block sharing is desired.

### 2.5 Tactical Barbell specifics I'm not assuming

I know Tactical Barbell (K. Black) as a system but the brief's 70/80/90% example reads as an
illustrative simplification, not a quoted protocol — real Base Building / Operator templates
vary by lift, by wave, and typically include set/rep scheme changes alongside load changes, not
load alone. I'm treating the exact week-by-week numbers, whether they repeat in waves vs.
climb once, and whether Base Building and Operator need different mechanics (not just different
numbers) as **open questions for the grill**, not something to infer from general knowledge of
the program.

---

## 3. Open questions for `/grill-with-docs`

Grouped roughly in the order they gate each other (duration/shape first, then progression
mechanics, then integration/lifecycle):

1. **Block shape**: Is a block strictly "N days/week for M weeks," or can days-per-week vary
   week to week within one block (Tactical Barbell sometimes flexes volume)?
2. **1RM capture**: Manual entry at block start, a snapshot of the current estimated 1RM
   (editable), or both? Per-exercise, or per-lift-category (e.g. one squat 1RM feeds every
   squat-pattern exercise in the block)?
3. **Progression table shape**: Is week→%1RM the only thing that changes per week, or do
   sets/reps also change per week (as real Tactical Barbell templates do)? If so the "table" is
   `week → {pct, sets, reps}` per exercise, not just `week → pct`.
4. **Base Building vs. Operator**: same mechanism with different numbers, or does Operator need
   different mechanics (e.g. wave loading, different exercise roles) that Base Building doesn't?
5. **Block vs. existing Routines/Rotation**: does activating a block fully supersede
   `S.week`/`S.rotation` for its duration, or coexist alongside routines not part of the block?
   What happens on the days *within* the block's week that aren't assigned a block workout?
6. **Lifecycle**: What happens at block end — does it just stop (revert to whatever
   Routines/Schedule existed before), auto-prompt to start the next block, or repeat its own
   last week indefinitely? Can a block be paused (missed days push the end date) or is it
   calendar-fixed regardless of missed sessions?
7. **Scope boundary**: Is AI Coach visibility / reminders-while-in-a-block in scope for v1, or
   explicitly deferred? (This determines whether `api/coach/core/*` needs
   touching at all in the first pass.)
8. **Exercise-level progression interaction**: within a block, can an individual exercise still
   opt out of block progression and keep its existing `cfg.prog` policy (e.g. an accessory lift
   that isn't part of Tactical Barbell's main-lift %1RM scheme), or does the block own every
   exercise in its routines unconditionally?
9. **History/stats surface**: should History/Stats show "Base Building, Week 3 of 6" context
   on logged sessions, or is the block purely a scheduling/prescription mechanism with no
   retroactive labeling?

---

## See also

- `docs/dev/COMBINE_ROUTINES.md` — precedent for a schema change that had to stay in lockstep
  between the frontend state shape and the API's Coach payload/hash logic.
