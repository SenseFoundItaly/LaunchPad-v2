# Launchpad Lite — kickoff spec, items 1–4

File-level spec for the three-question kickoff that fills five pillars. Written
against the repo as of `e35749e4`. Every anchor below was verified to exist.

**Scope:** the kickoff engine only. No meeting lifecycle (dropped — progress is
*derived*, see §2). No madlib, style picker, snapshots, tasks, or wallet.

---

## 0. The decision everything else depends on

LaunchPad's headline invariant, stated to the agent in `chat/route.ts:360`:

> "any evidence YOU produce that would satisfy a validation substep MUST be
> staged for approval — you can NEVER write it silently."

Audos writes its Notes live, with no approval. These collide — unless the two
things are different objects:

> **The North Star is a DRAFT DOCUMENT. Evidence is what greens a check.**
>
> The agent writes pillars freely, because **no gate check ever reads the pillar
> store.** Promoting a pillar into `idea_canvas` is a separate, explicit act —
> and that act is the consent moment.

This is what buys the live-filling feeling without touching the guarantee. It is
also what makes §4 the only non-trivial item on the list.

---

## 1. The three-question prompt

**Files**
- `src/lib/kickoff/prompt.ts` — new
- `src/app/api/chat/route.ts` — one line into `dynamicContext` (line ~732)

**Precedent to copy exactly:** `src/lib/journey/stage-prompt.ts` +
`stage-prompt.phase0.test.ts`. That test file's own words — *"Prompt guidance
has no type checker, so these assertions ARE the guard"* — is the pattern.

```ts
// src/lib/kickoff/prompt.ts
export function kickoffPrompt(step: string, answered: number): string {
  if (step !== KICKOFF_STEP) return '';        // inert everywhere else
  …
}
```

Wire it beside the existing blocks:

```ts
// chat/route.ts ~732 — dynamicContext
const dynamicContext = `${focusNodeContext}${directionContext}${kickoffContext}${stageContext}…`;
```

**The three questions** (ask in order; one per turn):

| # | Stage label | Asks for |
|---|---|---|
| 1 | Your fit | founder–problem fit, from **personal history** — not market data |
| 2 | Your take | the contrarian insight: what incumbents get **fundamentally wrong** |
| 3 | The problem | the visceral moment; ends by asking them to finish "It sucks that ___" |

**Three rules that produce the feeling** — these are the spec, not decoration:

1. **Reflect before you ask.** Open every question with a substantive *opinion*
   on what they just said, using their own words. Observed: *"Eight years, two
   cities, two choirs that folded — and you were the person holding the phone.
   That's not research, that's a scar."* Take a position; never flatter.
2. **Escalate specificity.** Abstract (why you) → analytical (what's broken) →
   visceral (the worst moment).
3. **Never ask two questions in one turn**, and never continue past Q3.

**Guard tests** (`src/lib/kickoff/prompt.test.ts`), mirroring the phase-0 file:
- each instruction present when `step === 'kickoff'`
- the whole block **absent** for every other step (it must not leak into the
  ordinary co-pilot)
- the block names all three stages in order

---

## 2. Progress, derived — no status column

**File:** `src/lib/kickoff/pillars.ts` — new

`step` already scopes threads (`idea_shaping`, `chat:2`, `node:<id>` are live in
prod), so the kickoff lives at `step='kickoff'` with **no schema change**.
Progress is a pure function of the pillar store:

```ts
export function kickoffProgress(ns: NorthStar | null) {
  const answered = ASKED_PILLARS.filter((p) => filled(ns?.[p])).length;
  return { answered, total: 3, complete: answered === 3 };
}
```

`complete` is also the **reveal gate** for the landing page (item 6, later). One
predicate, one source of truth — deliberately not a stored status, because this
repo has twice been bitten by a status field drifting from the thing it
describes (`projects.current_step` vs journey `activeStage`; the check-kind list
kept in four copies).

---

## 3. The five pillars

**File:** `src/lib/kickoff/pillars.ts`

Three pillars are **asked**; two are **inferred** by the agent. That is why
three questions fill five slots.

| # | Pillar | Source | Promotes to |
|---|---|---|---|
| 01 | Who we serve | Q1 | `idea_canvas.target_market` |
| 02 | The problem | **Q3, verbatim** | `idea_canvas.problem` |
| 03 | Our first move | *inferred* | `idea_canvas.solution` |
| 04 | Where it grows | *inferred* | `idea_canvas.channels` |
| 05 | Why it lasts | Q2 | `idea_canvas.competitive_advantage` |

All five targets are existing columns — verified against prod. **No canvas
migration.** Pillar 02 must store the founder's own sentence verbatim; seeing
your own words quoted back is the ownership hook.

**UI:** `src/components/canvas/NorthStarPanel.tsx` — new, rendered in the right
pane above `IdeaCanvasHeader` while `step='kickoff'`
(`Canvas.tsx:249-262` is where panels mount). Skeleton rows before the first
answer; fill in place as pillars arrive.

---

## 4. Live writes without approval — the crux

**Migration `042_north_star.sql`** — number taken from `_migrations` (highest
applied: `041_market_size_fact_kind`), **never from the file tree**, per the
rule added to CLAUDE.md today. Note `040` is already duplicated.

```sql
CREATE TABLE IF NOT EXISTS north_star (
  project_id   VARCHAR PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  pillars      JSONB NOT NULL DEFAULT '{}'::jsonb,
  promoted     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- pillar id → promoted_at
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

A **separate table**, not a column on `idea_canvas` and not `projects.settings`
— the separation is the safety property, and it should be visible in the schema.
Bind the JSONB **raw**; `JSON.stringify` double-encodes (CLAUDE.md).

**New agent tool** in `src/lib/project-tools.ts`, registered beside
`listProspectsTool`:

```ts
write_north_star({ pillar: '01'|'02'|'03'|'04'|'05', value: string })
```

Ungated by design, and the doc comment must say why: *it writes to a store no
gate check reads.* It must **not** call `recordFact`, `stageValidationProposal`,
or touch `idea_canvas`.

**Promotion — the consent moment.** A founder-clicked action per pillar (or one
"use this in my canvas") that POSTs to the existing
`/api/projects/[id]/idea-canvas` route — the already-authorised, already-tested
approved path — and stamps `promoted[pillar]`.

**The guard test that makes this safe** (`src/lib/kickoff/isolation.test.ts`):

- no file under `src/lib/journey/**` references `north_star`
- `write_north_star` appears in no gate keyword family, item kind, or source map
- `buildProjectSnapshot` does not select from `north_star`

If any of those ever fails, the draft store has become evidence and the
invariant is gone.

---

## Build order

| | item | size |
|---|---|---|
| 1 | `042_north_star.sql` + `write_north_star` tool + isolation tests | **M** |
| 2 | `pillars.ts` (projection + progress) | **S** |
| 3 | `kickoff/prompt.ts` + wiring + guard tests | **S** |
| 4 | `NorthStarPanel.tsx` + progress header | **S** |
| 5 | promotion action → existing `/idea-canvas` POST | **S** |

Start with 1: it is the only item carrying a schema change and the only one
where getting it wrong costs the product's headline guarantee.

## Not in this spec

Auto-naming, parallel landing-page generation with gated reveal, and the daily
return trigger. The last one is the item I would not ship lite without —
**116/116 prod projects are locked at 1C, zero gate verdicts have ever been
recorded, and the only external founder has not returned since 05/08.** Fast
time-to-artifact was never the failure; nobody coming back was.
