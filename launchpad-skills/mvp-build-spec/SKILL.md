---
name: mvp-build-spec
description: Turns validated project intelligence into a builder-ready MVP prompt (initial build or an iteration delta) for an AI app builder
---

# MVP Build Prompt

Your job is to turn the founder's accumulated, validated intelligence into a single
**builder-ready prompt** that an AI app builder (an autonomous coding agent, or a tool
like Lovable / v0) can execute to produce a working MVP. This is NOT an analytical
document, a MoSCoW table, or a plan for a human dev team — it is the actual instruction
you would paste into an app builder to make it build the product.

The project intelligence is provided to you in the message (a `[PROJECT INTELLIGENCE]`
block: idea canvas, personas, interviews, open assumptions, market sizing, signals).
Ground everything in it. Do not invent facts, competitors, or numbers that aren't there.

## Two modes — detect which one applies

1. **Initial build** — the input has NO `PRIOR SPEC` section. Produce a complete
   build prompt for the first version of the MVP.
2. **Iteration delta** — the input contains a `PRIOR SPEC` section and an
   `ACCUMULATED FEEDBACK` section. Do NOT restate the whole app. Produce a focused
   **delta**: the specific changes to apply to the existing build, derived from the
   feedback. Frame it as instructions to apply on top of what already exists.

## Output contract (strict)

- Output **only the build prompt**, as clean markdown prose. Nothing else.
- **No JSON**, no code fences around the whole thing, no `:::artifact:::` blocks, no
  citations/sources, no preamble like "Here is the prompt".
- Keep it **under ~45,000 characters** (hard ceiling is 50k downstream). Be concrete and
  economical — every sentence should help the builder make a decision.
- Write in the **imperative** ("Build…", "Add a…", "On the dashboard, show…").

## Initial build — structure

Use these sections (short, scannable):

**Product**
: One or two sentences: what the app is and the single core job it does for the user.

**Primary user**
: Who it's for (the beachhead persona) and the one workflow that, if it works, proves the thesis.

**Core screens & flows** (must-have only — cut everything that doesn't serve the core job)
: List each screen and what the user does there, in build order. Aim for 3–6 screens. Name the
  one "happy path" flow end to end (trigger → steps → the value the user receives).

**Data model**
: The key entities and their important fields + relationships. Keep it minimal.

**Auth & accounts**
: How users sign in (or whether the MVP is no-auth), and what's tied to an account.

**Tech direction**
: Prefer a modern, fast web stack (e.g. React/Next + a Postgres-style DB + email/password or
  magic-link auth). State any hard requirements from the intelligence (integrations, compliance).
  Leave room for the builder to choose specifics; don't over-specify.

**Design & brand**
: Aesthetic (minimal / bold / playful / professional), a small palette (2–3 colors), typography
  feel, and 3 voice adjectives. Make it look intentional, not default.

**Explicitly out of scope**
: Name the tempting features to NOT build in the MVP, so the builder doesn't sprawl.

**Definition of done**
: 3–5 concrete checks that mean "the first build is good enough to put in front of a user".

## Iteration delta — structure

- One line restating the product goal (for continuity).
- **Changes to make** — a prioritized bullet list. Each bullet is a concrete, buildable
  instruction (add / modify / remove), traceable to a piece of the accumulated feedback.
- Call out anything that must NOT change (to avoid regressions).
- Keep it tight — only what this iteration needs.

## Principles

- **Minimum viable, maximum learning.** Every feature must help answer a real question about
  the business. If it doesn't, cut it and say why in "out of scope".
- **Buildable, not aspirational.** Prefer things an app builder can actually produce now.
- **Respect the evidence.** Lean on the interviews, personas, and open assumptions — the MVP
  exists to de-risk the riskiest open assumptions first.
