# Validation Gate + IRL — resolution log, 04/08

Two founder threads landed the same day and are recorded together because they
touch the same surface.

1. **IRL spec** — Luca answered the four open questions on the 1-9 ladder and
   added the Score × IRL quadrant framing.
2. **Validation Gate** — testing, he found the gate was missing steps he had
   put in the linee guida.

**Status: everything he asked for is built and in production.** Shipped across
PRs #358 → #361, deploys `6a720e60` → `6a721d19`. Two open items are product
decisions, flagged at the bottom.

Legend: ✅ shipped · 💬 answered (no code) · ⏸ needs a founder call.

---

## Block 1 — IRL, the four answers

| # | His answer | Status |
|---|---|---|
| 1 | "Solo GO dà diritto al punto, oppure CAUTION con le problematiche risolte" | ✅ already true, two ways out of three |
| 2 | "L'IRL non regredisce; scende solo su pivot pesante" | ⏸ **contradicted in prod** — decided, not built |
| 3 | "IRL 7-9 non sono supportati oggi" | 💬 correct |
| 4 | "Ogni modulo è un punto, ordine non vincolante" | ✅ PR #321 (30/07) |

**#1 — the ladder was already most of the way there, by accident of design.**
It gates on *evidence* (WTP ≥ 30%, LTV/CAC ≥ 3×), never on the verdict label, so
`closedOutcome()` already splits the three ways a loop closes: **dismissed**
(override) earns nothing ✅, **resolved** (the signal recovered) earns the point
✅ — which is exactly "CAUTION con le problematiche risolte". The one gap is
stricter than he asked: a `GO` at the escalation cap while the evidence still
fails earns nothing.

> ⚠️ Vocabulary trap: loops emit `GO | PIVOT | STOP`. `CAUTION` belongs to the
> separate 0-10 stage-readiness rubric (`scoring.ts`), not to verdicts. Don't
> implement "CAUTION" on loops literally.

**#2 — the live divergence.** There is no stored IRL anywhere; every
`GET /irl` recomputes from scratch, so a project slides 4 → 2 on any evidence
dip with no pivot involved. Agreed fix (04/08): persist a **high-water floor**,
broken only when a `PIVOT` verdict's `scope` overlaps an earned level's gates.
Tracked in **#296** — whose body currently describes the opposite default and
should be rewritten before anyone picks it up.

**#4 was a real bug, not a preference.** `computeIRL` walked all nine rungs
contiguously, so completing Fundraising *and* Operations — two paid modules —
left IRL at 6. Now 1-6 stay contiguous (the phases genuinely are sequential)
and 7-9 are independent, +1 each in any order.

### Also from that thread

- **Score × IRL quadrants** — the accelerator/VC reading (*alto/alto = da tenere
  d'occhio*, *alto/basso = promettente ma acerbo*, …). Shipped as demo copy;
  **not yet in the product**, and not filed.
- **Score decay** ("asset di qualità, feedback, velocità di esecuzione") — the
  score is a one-shot skill output today. Not built, not filed.

---

## Block 2 — the Validation Gate steps

> "lo stage validation gate non ha ancora i tasks che avevo inserito nelle linee
> guida… è un problema legato a logiche di flusso?"

No. **#251 had been open since 15/07 waiting for exactly that list**, held on one
stated trade-off: *lengthening the gate re-locks projects mid-validation*.

**That trade-off was measured against prod before building.** 92 projects; 9 are
past the 1A+1B bar into 1C — all nine are June e2e/sim leftovers, none touched
since 13/07, none scored. Only **2** projects have recent activity and real
facts. The cohort the hold protected was essentially empty, so the checks
shipped.

| His item | Status |
|---|---|
| "market size" prima dei competitors | ✅ reordered — size the space before listing who is in it |
| "GTM chances & challenges" | ✅ `gtm_opportunities` (1A) |
| "potential partners detected" | ✅ `partners_identified` (1A) |
| "regulatory landscape" | ✅ existed as `regulatory_check` but sat in **1B Tecnica** — moved to 1A and relabelled |
| "watcher attivati" | ✅ `monitors_set` re-added; deadlock broken |
| "verdict go/no go" | ✅ shipped as **GO / PIVOT / STOP** |

Gate is now **1A: 9 · 1B: 3 · 1C: 4** (16), total spine **40 checks**.

### The watcher deadlock — fixed in the proposer, not the check

`monitors_set` was deleted in 2026-07 for a real reason: the gate required an
active watcher, and watchers were only proposed *once the gate completed*.
Re-adding the check naively re-creates the deadlock.

`shouldProposePhase1Watchers` now fires on `validationEvidenceDoneExceptWatchers`
— all 1A+1B except the watcher — so proposals arrive exactly when
`monitors_set` becomes the last open check.

> ⚠️ **Do not widen that trigger back to gate-done without deleting
> `monitors_set` again.** A regression test asserts gate-open +
> watcher-is-the-only-gap + proposer-fires.

### The verdict — why not a binary

"NO-GO" hides two different decisions — *this piece needs rework* and *this idea
is dead* — and a system that cannot tell them apart cannot respond correctly to
either. So the gate ends in the loop verdicts' own vocabulary:

| | |
|---|---|
| **GO** | stamps `research.gate_verdict`; the gate completes |
| **PIVOT** | motivation **+ the weak track**. `1C` opens Loop 1; `1A`/`1B` are recorded (no loop engine exists — #126/#127) |
| **STOP** | parks the idea with a reason |

`DELETE /gate-verdict` clears any verdict, so a pivoted or stopped project can
resume — a decision you cannot undo is a trap.

> ⚠️ **"NO-GO opens Loop 1" is impossible on the auto path.**
> `shouldTriggerLoop1` requires the gate to be **done** (`loop1-psf.ts:88`), and
> any non-GO verdict keeps it open. The endpoint uses `triggerLoop1Manual`,
> which skips that guard. This was proposed and rejected once — don't retry it.

**Guards are asymmetric on purpose.** GO requires complete evidence (you cannot
approve past evidence you never gathered). PIVOT/STOP are allowed at any time
with a motivation: a founder who has already decided the idea is dead must not
be made to tick six more boxes before the product lets them say so. §4 cuts both
ways.

### Write paths, not just checks

Every new check carries its full chain — keyword family → chat-sweep family →
item kind → source mapping → **executor Apply prefix**. A check reading a column
nothing fills is permanently red; that is the bug class #251 warns about. A test
asserts every Apply prefix is matched by its own keyword family in EN and IT, so
editing one out of step fails the build.

---

## Bugs found and fixed in-flight

- **The demo contradicted itself.** The spine showed phase 4 *MVP Release &
  Launch* as `attivo` while the IRL badge claimed **6** — which by his own
  mapping requires that phase complete. Fixed, plus three **locked** IRL 7-9
  add-on rows so the 6/9 explains itself, and the quadrant caption.
- **The go/no-go card bricked the gate (self-inflicted, #359).**
  `maybeProposeGateVerdict` copied `phase1-watchers`' permanent-marker
  idempotency, so declining wrote no verdict, blocked re-asking, and left
  `gate_verdict` red forever. A watcher is a *suggestion* — "no" can be final. A
  verdict is a *required step* — "no" can only mean "not now". Guard is now
  state, not history.
- **PIVOT was a label, not a machine (#361).** The endpoint accepted a scope and
  routed `1C` to Loop 1, but the card sent none, so every PIVOT opened nothing.
  Now split per track at click time.
- **`project-auto-add` failed on every PR.** A permanently-red check trains
  people to ignore CI, which is how the real gate gets waved through. The step
  now skips cleanly when `PROJECT_TOKEN` is absent.

---

## Migration 037

`research.gate_verdict JSONB` — `{verdict, decided_at, motivation, scope}`.

- **Prod:** applied via `db/migrate.ts` and recorded in `_migrations`. Only 037
  was pending, so nothing rode along.
- **Staging:** applied **directly, not via the runner**. Staging has 63 public
  tables and **no `_migrations` table** — its schema came from `schema.sql`, so
  the runner would have replayed 001-036 (including the 036 scores heal) against
  a populated database.

> ⚠️ **Staging has no migration ledger at all.** Not fixed here: baselining it
> would assert 001-036 were applied, which is unverifiable, and a ledger that
> lies is worse than none. Needs a decision.

Without the column the check reads undefined → red forever → no project can
complete the gate. Additive, nullable, `IF NOT EXISTS`; `SELECT *` tolerates its
absence.

---

## Open — product decisions, not bugs

- **#296** — IRL monotonicity. Decided (high-water floor, broken by a
  scope-overlapping PIVOT), not built. A gate PIVOT is now the strongest
  *pivot pesante* signal the product can capture; worth wiring as its trigger.
- **Score × IRL quadrants** in the product, and **score decay**. Neither filed.
- **Early-exit STOP** — permitted by the endpoint, not yet surfaced before the
  evidence is complete.
- **#302** — he has partly answered the "può l'AI decidere da sola?" question;
  the human-audit sigillo threshold for IRL 6+ is still his call.
- **#301** — per-archetype ladder, now explicitly confirmed by him
  ("AI native, tech intensive, deeptech… modularità massima indispensabile") and
  still sitting at P3.
