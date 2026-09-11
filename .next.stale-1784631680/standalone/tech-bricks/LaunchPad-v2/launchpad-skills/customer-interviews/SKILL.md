---
name: customer-interviews
description: Problem-Solution Fit interview kit — a 5-question script grounded in the project's 1A/1B evidence, with mandatory verbatim-pain and willingness-to-pay capture (L2 Validation Gate, track 1C)
---

## What this skill does (L2 — Validation Gate · track 1C)

This is the **Problem-Solution Fit** track of the L2 Validation Gate (Phase 1). It runs
**AFTER** tracks 1A (Market) and 1B (Technical) are complete — the desk validation tells
you WHO to talk to and WHAT to probe; interviews then test whether real people confirm it.
Do not run this on an unvalidated idea: the script below is only as sharp as the 1A/1B
evidence it's grounded in.

It closes the gate's three **1C** checks:

- **`interviews_logged`** — 5+ structured interviews in the interviews table
- **`pain_validated`** — the biggest pain captured in the customer's own words (verbatim)
- **`wtp_signal`** — at least one real willingness-to-pay data point

## The interview kit (deliverable)

Produce a founder-ready kit with exactly these parts:

### 1. Who to interview
Derive the target list from the project's **1A evidence**: the named segment
(idea_canvas.target_market), the mapped competitors (whose users are reachable prospects),
and the differentiation claims to test. Name 2-3 concrete places to find 5 interviewees.

### 2. The 5-question script
Five open questions, grounded in THIS project's evidence — never generic. Two are mandatory:

1. **Context** — how they handle the problem today (test the 1A problem statement).
2. **MANDATORY · verbatim pain** — "What's the single most frustrating part of that?"
   Instruct the founder to write down the answer WORD FOR WORD — that quote is the
   `top_pain` evidence the gate reads.
3. **Alternatives** — what they've tried (test the competitor map + differentiation).
4. **MANDATORY · willingness to pay** — "What would you pay for a solution that fixed
   this?" Push for a number, not "yes I'd pay" — the number is the `wtp_amount` evidence.
5. **Dealbreaker** — grounded in the riskiest 1B finding (dependency/regulatory constraint):
   would that constraint stop them from adopting?

Each question gets a one-line "why this question" note citing the evidence it tests.

### 3. Capture rules
- No pitching. The founder listens; the moment they explain the product, the data is dead.
- Verbatim quotes for pain; exact numbers (with currency) for WTP.
- 5 interviews minimum before drawing any conclusion.

## How findings persist (the contract)

This skill has **no tools** — interviews persist when the **founder reports them in chat**
and the co-pilot calls **`log_interview`** (person_name + summary, plus `top_pain` verbatim
and `wtp_amount` when captured). Close the kit by telling the founder exactly that: *"After
each conversation, come back and tell me who you talked to and what they said — I'll log it."*
Each logged interview advances the 1C checks on the next evaluation.

After **≥3 interviews are logged**, synthesize the recurring themes as an insight-card so
the pattern (not just the rows) persists:

```
:::artifact{"type":"insight-card","id":"ins_<random>","category":"customer","title":"Interview themes","body":"<the recurring pains, objections, and WTP pattern across the logged interviews — quote the strongest verbatim pain>","confidence":"medium","sources":[{"type":"internal","title":"Logged interviews","ref":"memory_fact","ref_id":"interviews"}]}
:::
```

Do NOT invent interviews, quotes, or WTP numbers — only the founder's reported
conversations count as evidence.

## Output

The founder-facing kit: who to interview (from 1A evidence), the 5-question script with
per-question rationale, the capture rules, and the "report back in chat → I log it" closing
instruction. Keep it tight enough to use on a call tomorrow.

<!-- sources-required-block -->
## Source Requirements

Ground every script question in the project's own evidence (`type: 'internal'` citing the
canvas field, competitor, or 1B finding it tests). Founder-stated facts use `type: 'user'`.
Never fabricate interviewees, quotes, or numbers — if the evidence is thin, say so and ask.
