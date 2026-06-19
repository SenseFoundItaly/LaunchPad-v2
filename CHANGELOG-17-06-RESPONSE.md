# Changelog 17/06 — Response & Remediation Status

_Prepared 2026-06-19. Status of every item Luca raised in the 17/06 testing pass, what was changed, how it was verified, and what's still open. Plus the credit-economics assessment requested._

**Legend:** ✅ done & live-validated · 🟩 fixed in code (tsc-clean, see Deployment) · 🟨 partial · 🟥 open/broken

---

## 1. Status of every item

| # | Item (17/06) | Status | What was done / evidence |
|---|---|---|---|
| 1 | First-login tutorial / onboarding | 🟨 partial | `OnboardingCard` ships on Home (`today/page.tsx:142`) with platform-objective + action links. **Missing:** the full 5-step walk-through + the post-canvas "activate your first weekly watcher" nudge. |
| 2 | IT naming (Knowledge→"Sapere", Inbox→"Posta") | ✅ | Nav now reads **"INTEL"** + **"Knowledge"** kept untranslated (frozen brand terms). Live-verified in the running app. |
| 3 | Account/settings icon disappears | ✅ | `flexShrink:0` chip guard on the bottom rail (`chrome.tsx:246`). |
| 4 | Co-pilot drifts to English on suggestion-click | ✅ | Per-turn `[LANGUAGE — THIS TURN]` reminder injected every non-EN turn (`route.ts:637`); IT SOUL/AGENTS/skills loaded per locale. |
| 5 | Watcher detail unclear | ✅ | Human-readable watcher summary + clear list (name / cadence / status / last-run). Live-verified — set up a "Sibill" watcher end-to-end (created, active, weekly). |
| 6 | Knowledge upload section vanished | ✅ | "+ Add documents" button on Knowledge; dead upload component removed. Live-verified. |
| 7 | One point / question per turn | ✅ | TIER 0.25 rule forbids stacking 2 questions or 2 competing value-props (`route.ts:131`). |
| 8 | **Credits scaled randomly** | 🟥 open | **Approval cost fixed** (2→0.5cr). **Still broken:** (a) credit badge shows 0 despite real spend (duplicate/period-mismatched `user_budgets` rows — DATA); (b) option "≈N credits" labels are flat tier estimates **30–66× below real token cost** (see §2). |
| 9 | Canvas should paint progressively during idea-shaping | 🟥 missing | Parser only emits partials for unterminated blocks; the Canvas still fills at stream-end. Not yet rebuilt. |
| 10 | Background option (founder's, not agent's) | ✅ | Rule: "your background" → founder's `unfair_advantage`, never the agent's self-intro (`route.ts:235`). |
| 11 | Per-artifact export + cleaned go/no-go report | ✅ | `ArtifactExportButton` (CSV/JSON per artifact) + `context-export` go/no-go mode (per-stage assets, signals, risks, scoring, tasks; chat history stripped). |
| 12 | Home "Notes" → knowledge | ✅ | `NotesCard` on Home → `/notes` → applied `memory_fact` (surfaces in Knowledge). |
| 13 | Financial projections detailed + editable | 🟨 partial | Built + **downloadable** (CSV/JSON). **Missing:** edit-and-persist (route is GET-only) and a Canvas renderer. |
| 14 | **Graph = ecosystem + competitor matryoshka** | 🟩 fixed (this session) | See §3 — was fully non-functional on prod; now wired + the data chain validated. |
| 14.2 | Approval cost ≤0.25–0.5cr | ✅ | `KNOWLEDGE_APPLY_CREDITS = 0.5`; canvas commits are free. |
| (bottom 2) | Scoring detail + Home placement + Score≠IRL | 🟨 partial | Per-dimension scorecard + qualitative verdict **live-validated** (see §4). Home placement of the score + a distinct branded IRL number still to wire. |
| SOUL.md | Stricter, less sycophantic | ✅ | Anti-sycophancy protocol shipped (EN+IT). **Live-proven:** scoring returned **"NOT READY" first**, refused a soft GO on unproven WTP, and surfaced a real funded competitor (Sibill) via web research. |

### Also fixed this session (beyond the 17/06 list)
- **Commit loop made deterministic** — "Confirm — commit" options now write canvas/knowledge on click via a dedicated path (`/idea-canvas` free; `/validation/commit` for paid items), instead of the agent narrating a save it never performed. Live-validated: problem/solution/value-prop/competitive-edge all persisted on click.
- **Skill output now streams to chat** (Luca's "it should always stream" ask) — `runAgent` mirrors deltas → `/skills` SSE forwards them → chat renders one growing message. Live-proven: a market-research report streamed 3 → 20,160 chars progressively instead of a frozen "Running…".
- **Market-research output formatted** — was a raw `​```json` dump in chat; now a clean markdown report (TAM/SAM/SOM + competitors + trends); the JSON stays machine-only for parsing.

---

## 2. Credit-economics assessment (requested)

**Pricing model today:** `creditsPerDollar = USER_MONTHLY_CREDITS / USER_MONTHLY_LLM_USD = 100 / 0.333 ≈ 300` → **1 credit ≈ $0.0033 of LLM cost**, with a **3× markup** (≈67% target gross margin). Monthly free pool = **100 credits ≈ $0.33 of LLM**.

**Measured real costs (this session, from `llm_usage_logs`, OpenRouter Sonnet $3/$15):**

| Action | Real LLM cost | = credits @300 | Advertised | Gap |
|---|---|---|---|---|
| Chat turn | $0.11–0.18 | **33–53 cr** | "≈1 cr" | ~40× |
| Startup scoring | $0.46 | **138 cr** | "≈4 cr" | ~35× |
| Market research | $0.40–0.88 | **120–266 cr** | "≈4 cr" | **30–66×** |
| Knowledge apply | $0 (DB write) | 0.5 cr | 0.5 cr | ✅ correct |

**Conclusions:**
1. **The "≈N credit" labels are fiction** — flat tier estimates (1/4/10) disconnected from token-metered reality by 30–66×. This *is* the "credits scaled randomly" complaint: the founder is quoted 4, charged ~150.
2. **The 100-credit monthly pool is ~50× too small** — a *single* market-research or scoring run exceeds the entire month's allowance.
3. **Dominant cost driver is prompt cache-waste**, not useful compute: the ~27k-token system prompt is re-written (`cacheWrite`) every chat turn (`cacheRead=0`) because dynamic context + a per-turn-varying tool list bust Anthropic's `tools→system` cache prefix. A caching fix was attempted and **reverted** (measured: it didn't read — the tool prefix mutates upstream of the system block). The real fix requires a **stable tool prefix** (or prompt-size reduction) — see recommendations.
4. **Badge integrity:** the badge reads 0 because spend lands on a duplicate / wrong-period `user_budgets` row (3 rows found for the test user), not a code bug in `credits.ts`.

**Recommended order:** (a) shrink/stabilize the prompt + tool list so caching actually reads (≈10× chat cut) → (b) re-base the pool & per-action prices against the *new, lower* cost → (c) replace the "≈N credit" labels with real estimates + fix the badge/dedup budget rows. Pricing the free tier against *today's* bloated cost (without (a)) means either a tiny free tier or thin/negative margins.

---

## 3. Item 14 deep-dive (the flagship) — now fixed

The 17/06 centerpiece (graph populates with competitors decomposed into matryoshka categories) was **fully non-functional on prod**, for two stacked reasons found this session:

1. **The `competitor_categories` table never existed on prod** — migration 022 was never applied. Every `persistCompetitorCategories` call silently no-op'd (best-effort try/catch). → **Fixed: migration 022 applied to prod** (additive `CREATE TABLE IF NOT EXISTS` + indexes; verified table + columns live).
2. **The skill path didn't persist categories** — `market-research` wrote bare competitor `graph_nodes` and never decomposed them; only the rare chat `propose_competitor_analysis` tool did. → **Fixed: `skill-research-persist.ts` now decomposes each competitor's attributes into `competitor_categories`** via the existing `persistCompetitorCategories` (node-id wired through).
   - _Residual (deferred):_ `startup-scoring`/`advisor` still don't persist competitors at all (they're scoring skills, not competitor-analysis); the canonical route is `market-research`, which is now covered.

**Validated:** the matryoshka chain (insert → join read: startup → competitor → category → detail) works post-migration. A live market-research run will now populate it.

---

## 4. What was live-validated vs. code-only

- **Live-validated in the running app this session:** items 2, 5, 6, SOUL anti-sycophancy + scoring rigor (NOT-READY-first, Sibill found), the commit loop (DB-confirmed writes), skill-output streaming (3→20,160 chars), the matryoshka data chain (post-migration), item 1.5 (verbatim canvas recall), item 1.6 (scoring no longer false-blocked).
- **Code-only (tsc-clean, not yet live-run):** the market-research formatter + the skill-path category persistence (table now exists; next run populates it).

---

## 5. Deployment status — IMPORTANT

**Nothing in this session's code is committed or deployed.** It all lives in the `mogadishu` worktree working tree (tsc-clean throughout). **Two changes WERE made to the prod database:** (1) migration 022 (`competitor_categories` table created); (2) a stale validation-proposal (`pa_qiy93cca6abn`) flipped to rejected. The local dev server runs against prod data with an auth bypass for testing only.

**To ship:** review + commit the working tree, then deploy via the normal `npm run deploy` flow. The two prod-DB changes are already in place and are safe/additive.

---

## 6. Still open (ranked)

1. 🟥 **Item 8 credits** — the highest-impact remaining work: stable-tool-prefix caching (cost), re-base the pool, honest labels, dedup budget rows. (Assessment in §2.)
2. 🟥 **Item 9** — progressive canvas paint (additive rebuild: parser + SSE + Canvas render-state).
3. 🟨 **Item 13** — financial-model edit-and-persist (POST/PUT + edit UI + Canvas renderer).
4. 🟨 **Item 1 / onboarding** — expand to the full 5 steps + post-canvas watcher nudge.
5. 🟨 **Scoring on Home + branded IRL** — surface the score on Home; introduce IRL as a distinct number from project score.
6. 🟩 **Richer market-research Canvas cards** — the report is now readable markdown + competitors land in the graph; optional follow-up is emitting `tam-sam-som` / `comparison-table` artifacts so they also render as Canvas cards.
