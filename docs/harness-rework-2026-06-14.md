# Harness Rework & Audit — 2026-06-14

Branch: `feat/harness-rework` (worktree, based on `feat/persistent-chrome` HEAD + WIP).

## Founder feedback (verbatim, IT)
> Prime impressioni: sicuramente molto meglio rispetto a prima... Però ancora non ci siamo con il workflow. Ho completato lo stage idea canvas con un progetto nuovo ma quando ho iniziato a fare un po' di challenging e dare input per value proposition, il co pilot si è perso. Forzandolo un pò ha chiuso lo stage ma con spreco di tempo e crediti, il risultato ci sta ma non ho avuto modo di affinarlo. Poi ho runnato due volte market analysis ma non ha dato risultati. Quindi a questo punto sono con 30 crediti e non ho ancora attivato watchers perché non ce ne sono più di preimpostati. Anche il graph non si è attivato.

## Four complaints → mapped failure modes
1. **Copilot "got lost" on value-prop challenging; wasted time/credits; no way to refine.**
2. **Ran Market Analysis ×2, no results.**
3. **No watchers (presets exhausted, none proposed).**
4. **Graph didn't activate.**

---

## ROOT CAUSE SYNTHESIS (all verified in code)

### Fault line A — Two parallel "stage truth" systems give contradictory direction
- `@/lib/journey` `STAGES` = binary **text-presence** checks → drives the spine, `[JOURNEY STAGE]`, `[DIRECTION ENGINE]`.
  - Stage 1 `value_prop` passes when `idea_canvas.value_proposition` non-empty; `value_prop_sharp` at ≥30 chars (`src/lib/journey/stage-1-idea-validation.ts:47,81`). No skill required.
- `@/lib/stages` `STAGES` (`src/lib/stages.ts:71-80`) = **skill-completion scores** → drives `get_project_summary` readiness + `next_recommended_skill` (`src/lib/stage-readiness.ts`).
  - Stage 1 readiness requires `idea-shaping` + `startup-scoring` skills to have run, scored ≥6 (`stages.ts:76-79`, `stage-readiness.ts:201`).
- **Divergence:** founder fills value prop via chat → **spine green (journey)** but **readiness still says "run idea-shaping," `next_recommended_skill=idea-shaping`**. Agent receives both. TIER 0.25 says "match the journey block"; TIER 3 says "surface next_recommended_skill." They conflict on exactly the value-prop case → agent oscillates = "lost direction."
- (The OLD `projects.current_step` two-pointer bug from memory is FIXED; this is a *different*, live divergence.)

### Fault line B — "Propose, never apply" limbo; successful work is invisible
- Every chat/skill capture is born `pending` (graph_nodes: `artifact-persistence.ts:124,242,661`) or as an unapproved `validation_proposal` (`artifact-persistence.ts:181-187`).
- Read filters disagree across surfaces:
  - `/api/graph/[projectId]` includes `applied`+`pending` (FIXED, `route.ts:25`).
  - Canvas/Intelligence beside chat: `applied`-ONLY (`intelligence/route.ts:203`) → **populated graph reads empty**.
  - `/knowledge/unified`: `applied`-ONLY (`unified.ts:339`).
- Nothing in the journey nudges the founder to Apply. Loop never closes → "graph didn't activate," market captures invisible.

### Fault line C — Skill output never re-enters the chat surface (primary "no results" cause)
- `skill:run` success handler (`chat/page.tsx:849-855`) only flips the card to "done" + broadcasts refetch events. It never `setMessages`.
- `canvasArtifacts` is derived **only from `messages`** (`chat/page.tsx:586-613`). Skill runs in a separate request; its text/artifacts never enter `messages`.
- Route returns only a 300-char `summary_preview` (`skills/route.ts:74`).
- Net: founder clicks Run → sees a tiny "done" note → chat + Canvas unchanged. Twice = nothing twice.

### Contributing factors
- **Credits charged regardless of visible output:** `recordUsage` debits BEFORE the quality gate / artifact persistence decide whether the run counts (`skill-executor.ts:226` precedes `:241-261`). "Wasted credits."
- **Tool-budget burn:** chat caps at 8 tool calls; force-synthesis at exhaustion strips ALL tools (`pi-agent.ts:484-501`), so a research-heavy refine turn can end without ever staging the refined value prop.
- **Parser rejects empty-`sources[]` artifacts** (`artifact-parser.ts:121-128`); in the skill path the error card isn't even shown → doubly silent drop.
- **Auto-stage dedup swallows refinements:** only one open auto-staged `validation_proposal` per project (`auto-stage-validation.ts:96-101`); rapid value-prop iterations return `{staged:false}`.
- **Watchers:** agent watcher protocol is purely *reactive* (`chat/route.ts:321`), prompt prefers ZERO watchers (`:327`); `monitors_set` gap never surfaced in `formatReadinessForPrompt`; `propose_monitor` gated out of toolset on advisory turns (`includeWriteTools`, `route.ts:513`); preset seeder `seedEcosystemMonitorsForProject()` is dead code (`projects/route.ts:83-87`) → new projects get 0 watchers; empty-state copy points at co-pilot which won't propose.

---

## DECOMPOSED FIX PLAN (workstreams)

### WS-0 — Diagnostic confirmation (optional, careful: DB may be PROD; read-only)
Pull the founder's actual project rows to disambiguate conditional causes (pending-vs-empty graph; clarification-downgrade vs sources-rejection on market analysis).

### WS-1 — Unify stage truth → fixes "loses direction" (Fault line A)
- `stage-readiness.ts`: when the journey stage is `done`, stop recommending that stage's skill; blend journey passed/total into `next_recommended_skill`.
- ARTIFACT_INSTRUCTIONS (`chat/route.ts`): add a **canvas-refine branch** — when a canvas field is populated and the founder is challenging/refining, call `update_idea_canvas` directly; do NOT propose a skill.
- `content-mapping.ts:66-70`: don't fire the `idea-shaping` trigger when the canvas already has that field.

### WS-2 — Make skill output visible → fixes "market analysis no results" (Fault line C + parser)
- `skill:run` success (`chat/page.tsx:849`): append the skill summary/artifacts into `messages` so the Canvas renders them; widen the route response (`skills/route.ts:68-77`) beyond `summary_preview`.
- Surface parser rejections (`artifact-error`) in the skill path instead of silent drop (`skill-executor.ts:243-248`).
- Surface `status:'incomplete'` to the UI; don't silently report `completed` (`skills/route.ts:71`).

### WS-3 — Close the proposal→apply loop → fixes "graph didn't activate" (Fault line B)
- Unify read filter: Canvas/Intelligence (`intelligence/route.ts:203`) + `unified.ts:339` include `pending` (or surface "N proposed entities awaiting apply").
- In-journey nudge to Apply pending captures after market analysis.
- Soften `EntityGridFallback.tsx:35` copy.
- Fix `auto-stage-validation.ts:96-101` dedup so refinements update the open proposal instead of being dropped.

### WS-4 — Watchers → fixes "no watchers" (watcher factors)
- Agent proactively proposes a watcher when Stage 2 `monitors_set` is unmet and 0 active watchers (`chat/route.ts:298-327`).
- Surface the `monitors_set` gap in `formatReadinessForPrompt` (`stage-readiness.ts:226-277`).
- Ensure `propose_monitor` is in the toolset when the agent should offer it (`route.ts:513`).
- (Optional) re-seed presets at project create as `inactive` suggestions (`ecosystem-monitors.ts:559` + `projects/route.ts:83`); fix empty-state copy.

### WS-5 — Credits/budget hygiene → fixes "wasted credits"
- Exempt gated write tools (`update_idea_canvas`, `propose_validation`) from the force-synthesis strip OR reserve budget (`pi-agent.ts:484-501`).
- Don't debit for dropped/incomplete runs, or surface the spend honestly (`skill-executor.ts:226-261`).

### WS-6 — Verify end-to-end
Replay the founder scenario (new project → Idea Canvas → value-prop challenge → market analysis → watchers → graph) via gstack browse/qa; confirm each complaint resolved.

---

## CONFIRMED — WS-0 forensics on Luca's real project (2026-06-15, read-only prod)

Project: **EasyContract** `proj_4b9b4cf3-1cb` (Luca `3e8ce3d3…`, lucaboscariol24@gmail.com), created 2026-06-14 17:05. The forensics **corrected the priority order** — the dominant bug was NOT in my original 6 workstreams.

### 🔴 CONFIRMED ROOT CAUSE #1 (NEW, highest impact): Skills run CONTEXT-BLIND
`src/lib/skill-executor.ts:195-199` — `runAgent(userMsg, { systemPrompt: loaded.body, ... })`. The skill agent gets **only the raw SKILL.md** as system prompt and a generic kickoff as the user message. **No idea_canvas, no project summary, no memory facts are injected.**
- DB proof: `market-research` skill_completions.summary = *"I'd be happy to run a comprehensive market analysis! ... 1. What does your product/service do? ... What's your startup?"* — it asked clarifying questions because it had **zero** knowledge of EasyContract, **despite** idea_canvas being fully populated (problem 236c, value_prop 282c, competitive_advantage 386c).
- Consequence chain: market-research produced no analysis → `research` table EMPTY → `graph_nodes` has only the `your_startup` root (0 entities) → **explains BOTH "market analysis no results" AND "graph didn't activate" at a single source.**
- It ran **twice** (`llm_usage_logs`: 2 market-research calls), both debited, both useless.
- **Fix:** inject project context (idea_canvas + get_project_summary digest + memory) into the skill agent in `runSkill`. This is the #1 fix.

### 🔴 CONFIRMED ROOT CAUSE #2: Clarification gate has a list-shaped hole
`src/lib/skill-output.ts:39` `STRUCTURE_RE` matches numbered/bulleted lists `(?:^|\n)\s*\d+[.)]\s`. The market-research clarifying questions were a **numbered list**, so `STRUCTURE_RE.test()` → true → `isClarificationOnly()` → false → persisted as **`status='completed'`** with NULL section_scores (DB-confirmed). The gate's own docstring example is this exact case, but list-formatting defeats it.
- **Fix:** treat a "structured" block that is mostly questions / clarification phrases as clarification-only; and don't charge for incomplete runs.

### 🔴 CONFIRMED ROOT CAUSE #3: Chat agent forgets + asks instead of writing → 31-turn oscillation
DB proof: **31 user / 31 assistant** messages on EasyContract; chat cost **$3.29** of the project's $3.35 total (skills were ~$0.05). Luca's own turns are the evidence:
- *"Non stavamo parlando di unfair advantage?"* (weren't we talking about unfair advantage?)
- *"unfair advantage te l'avevo già detto prima"* (I already told you that before)
- *"Ma il canvas non è stato scritto, stavamo ragionando sulla value proposition"* (but the canvas wasn't written)
- *"Abbiamo definito prima sia value proposition che competitive edge. Prendili"* (we already defined both — just take them)
- Many *"I choose: …"* turns = the agent kept emitting option-set chips instead of acting.

Verified mechanisms:
- `src/app/api/chat/route.ts:429` — the always-on `projectContext` is **only** `[PROJECT: "name" — description]`. The **live idea_canvas content is NOT injected** every turn; the agent only sees it if it calls `get_project_summary`.
- `src/lib/pi-agent.ts:281` — history window = **last 12 messages**; in a 31-turn refine the agreed value prop falls out of context → agent re-asks.
- `src/app/api/chat/route.ts:314` — `update_idea_canvas` "now PROPOSES a card, it does not write directly" → nothing accrues unless approved each turn → "il canvas non è stato scritto".
- `route.ts:333` — option-sets are the default interaction → defer instead of write.
- **Fix:** inject a `[CURRENT IDEA CANVAS]` block (actual field values) every turn; add a refine-in-place branch (write, don't card/ask) for already-populated fields; reconsider the 12-msg window for refine.

### ✅ CONFIRMED: No watchers
`monitors` count = **0**; `pending_actions` has **zero** `configure_monitor` rows → agent never called `propose_monitor`, and new project got no presets. (WS-4 unchanged.)

### ⚠️ CORRECTED: Graph applied-vs-pending filter did NOT affect Luca
`graph_nodes` had only the root node — **genuinely empty, not populated-but-pending**. The filter mismatch (WS-3) is a real latent bug but was NOT Luca's problem; his graph was empty because Root Cause #1 never produced entities. WS-3 demoted; the in-journey "apply captures" nudge still valuable once entities exist.

### REVISED FIX PRIORITY (by confirmed impact)
1. **Inject project context into skill execution** (`skill-executor.ts:195`) → fixes market analysis + graph at source. *[was unscoped — now P0]*
2. **Inject live idea_canvas into chat context + refine-in-place + memory window** (`chat/route.ts:429`, `pi-agent.ts:281`) → fixes "got lost" + "wasted credits" (the $3.29 sink).
3. **Tighten clarification gate + don't charge empty runs** (`skill-output.ts:39`, `skill-executor.ts:259`).
4. **Watchers: propose proactively + reseed presets** (WS-4).
5. **Render skill output back into chat** (WS-2) — needed generally; prerequisite is #1 so there IS output to render.
6. **Graph pending-visibility + apply nudge** (WS-3) — latent, lower priority.

---

## IMPLEMENTED (branch feat/harness-rework, 2026-06-15)

All changes type-clean: `npx tsc --noEmit` 126 → 85 errors; **0 errors in any touched file**; the 85 remaining are entirely the unrelated knowledge-upload WIP (`AddDocumentsDialog`/`DataRoomPanel`/`AllKnowledgePanel`) + 1 pre-existing `monitor-dedup` (byte-identical pre/post).

**Fix #1 — skills no longer run blind** (`src/lib/skill-context.ts` NEW, `skill-executor.ts:195`): `buildSkillProjectContext` injects an authoritative `=== PROJECT CONTEXT ===` block (idea_canvas + research + competitors + memory) into the skill agent's system prompt, with an explicit "use this; do NOT ask; state assumptions and proceed" override. → market analysis + graph at source.

**Fix #2 — copilot stops losing direction** (`chat/route.ts`, `stage-readiness.ts`, `pi-agent` opt): (a) `[CURRENT IDEA CANVAS]` block injected every turn so the agent never forgets defined fields; (b) refine-in-place guidance (iterate text, don't re-ask, don't propose a skill for a text edit); (c) `getStageReadiness` no longer recommends a stage's skill once the spine marks it done (kills the journey-vs-readiness contradiction); (d) chat history window 12→16 for refine continuity.

**Fix #3 — clarification gate + don't charge empty runs** (`skill-output.ts:39`, `skill-executor.ts`, `cost-meter.ts`): a numbered/bulleted question list no longer counts as deliverable structure (only JSON/headers/tables do); `recordUsage` gained `skip_credit_debit` — incomplete runs are logged but never debit credits.

**Fix #4 — watchers** (`chat/route.ts`, `ecosystem-monitors.ts`, `projects/route.ts`, i18n): `[WATCHER GAP]` nudge + `propose_monitor` tool forced available when Stage 2 has 0 active watchers; new projects seed 3 inactive presets (Competitors/Trends/Customer Sentiment); empty-state copy points at both the button and the co-pilot.

**Fix #5 — render skill output to chat** (`skills/route.ts`, `chat/page.tsx`): the run response returns full `summary` + real `status`; the chat handler appends it as an assistant message so the Canvas renders the artifacts (and an honest "no usable result" message on incomplete).

**Fix #6 — graph visibility** (`intelligence/route.ts`, `unified.ts`, `Canvas.tsx`, `EntityGridFallback.tsx`): pending captures surface as "proposed" with a one-click review→apply link (gate preserved — nothing greens without approval).

**Also:** completed the `canvas.*` i18n set (en+it, ~30 keys) the in-flight WIP left as raw keys on the spine/idea-canvas surface.

**Deferred (noted):** pi-agent force-synthesis write-tool exemption — risky core-loop change, low marginal value now that steering + canvas-injection cut the oscillation that was the real $3.29 sink.

## VERIFIED (read-only, on Luca's real prod rows)
- **Gate fix on real data:** Luca's actual market-research output → OLD `isClarificationOnly`=false (the bug: counted completed) → NEW=true (correctly incomplete, not charged). A real deliverable carrying a JSON artifact + a follow-up question → NEW=false (correctly kept). No false positives.
- **Context fix on real data:** reconstructed the `buildSkillProjectContext` block for EasyContract — now carries the full canvas (problem/solution/target/value-prop/competitive-advantage), so market-research cannot run blind.

## REMAINING — WS-6 live behavioral e2e (not auto-run)
Static (tsc) + unit (gate) + read-only (context block) verification done. A full new-project → idea-canvas → value-prop-challenge → market-analysis → watcher → graph run needs the app live; `.env.local` points at PROD (would create test data / spend credits) and the dev server has a known worktree-collision risk. Recommend running against a local/staging DB, or hand off.

---

## LIVE VERIFICATION on PRODUCTION (2026-06-15, user-authorized)

Drove the real `/api/chat` + skills API on a local dev server (worktree code, `E2E_AUTH_ENABLED=1`) against the prod DB, using throwaway test projects seeded with Luca's exact canvas, all auto-deleted after. Results:

- **Steering / "got lost" (Fix #2) — ✅ FIXED.** Seeded Luca's mid-chat state, sent his EXACT turn 53 (*"Ecco value proposition e competitive edge… Inseriscili nel Canvas"*) — the turn where the OLD agent replied *"Eseguo idea-shaping ora"*. The fixed agent: called `update_idea_canvas`, did NOT loop to a skill, did NOT re-ask, and staged ONE `validation_proposal` containing BOTH value-prop + competitive edge — in a single turn.
- **Market analysis "no results" (Fix #1) — ✅ FIXED.** Real EasyContract analysis produced (no "what's your startup?"), `status=completed`, rendered back into chat (Fix #5).
- **Graph "didn't activate" — ⚠️→✅ required a SECOND fix (Fix #7 below).** First live run: real analysis but `research`=NONE, `graph_nodes`=0 entities.

### Fix #7 (discovered live) — market-research output → graph persistence
The market-research `SKILL.md` emits a fenced ```json {market_research}``` block, but skill-executor only persisted `:::artifact{…}` segments → zero rows. Worse, the JSON routinely exceeds the 8192-token output cap and truncates mid-`trends`.
- `src/lib/skill-research-persist.ts` (NEW): tolerant extractor — full-parse first, then per-key **balanced-bracket scan** that recovers `market_sizing` + `competitors` even when the JSON is truncated (the completed parts survive). Writes the `research` row + one PENDING `graph_node` per competitor + a PENDING market node. Pending = gate-respecting (WS-3 surfaces as "proposed").
- `skill-executor.ts`: appends a strict OUTPUT CONTRACT forcing the JSON block (model was emitting prose markdown), keeps it compact, and calls the persister after the artifact loop.
- **Verified live:** market-research run → `research` row POPULATED + **6 competitor nodes + 1 market node, all `pending`** (was 0). Offline-tested the extractor on the real truncated 24KB output → recovered all 6 competitors.

### Fix #4 preset half — re-applied (subagent edits were lost) + verified live
The proactive-proposal half landed, but the preset-seeding subagent's edits to `ecosystem-monitors.ts`/`projects/route.ts`/i18n never persisted. Re-applied: `DEFAULT_SEED_MONITOR_TYPES` (Competitors/Trends/Customer Sentiment), idempotent subset seeder, wired non-fatally at project creation, empty-state copy updated. **Verified live:** new project → 3 INACTIVE presets (was 0); cron skips inactive so zero cost until activated.

## FINAL STATUS
All 5 founder complaints fixed and verified on real data:
1. Copilot got lost → ✅ (live: clean single-turn canvas write, no loop)
2. Market analysis no results → ✅ (live: real analysis, rendered in chat)
3. Graph didn't activate → ✅ (live: 6 competitor + 1 market pending node from one run)
4. No watchers → ✅ (live: 3 presets seeded + agent proposes at Stage 2)
5. Wasted credits → ✅ (no-charge on empty runs + steering no longer oscillates)

Type-clean: 85 tsc errors, all pre-existing knowledge-upload WIP, 0 in any rework file.
Minor follow-up (cosmetic, non-blocking): `research.competitors`/`trends` columns may be double-encoded jsonb (the spine reads `graph_nodes`, not these, so no founder impact).
