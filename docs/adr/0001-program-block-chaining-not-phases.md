---
status: accepted
---

# Program Blocks: structural changes are a Block Chain, not internal phases

Context: Program Blocks (`docs/dev/PROGRAM_BLOCKS_BRIEF.md`) were designed with a fixed
day-count/structure for a block's whole duration. Base Building breaks that: it runs 2x/week
for 5 weeks, then switches to Operator's day-structure (including Operator's weekly
deadlift-for-pull-ups swap) for its remaining weeks — a real mid-program structural change.

Two genuine alternatives existed: (1) let a Program Block contain internal **phases**, each
with its own day-count/structure, or (2) keep a block's shape fixed for its own duration and
model the structural change as **two separate Program Blocks linked by a Block Chain**, the
second auto-starting when the first completes.

We chose (2). It keeps the Program Block shape itself simple (no nested-phase variant to
support everywhere a block is read), and it reuses machinery the model needs anyway for "what
happens at block end" (lifecycle) and Training Max capture (each chained block captures its own
Training Max fresh, through the same flow as a manually-started block, rather than inheriting
the prior block's numbers under a separate inheritance rule).

Consequence: anything that looks like one continuous program to the user (Base Building) may be
two Program Block records under the hood. A future reader adding a third TB-style program with
its own internal structural shift should reach for Block Chain, not add phase support to
Program Block — revisit this ADR first if that assumption stops holding.
