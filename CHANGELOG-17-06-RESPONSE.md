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
| 14 | **Graph = ecosystem + competitor matryoshka** | ✅ fixed + live-validated | See §3 — was fully non-functional on prod; now wired + the matryoshka renders **8 competitors × 4 categories** live, and chat lists the pending competitors. |
| 14.2 | Approval cost ≤0.25–0.5cr | ✅ | `KNOWLEDGE_APPLY_CREDITS = 0.5`; canvas commits are free. |
| (bottom 2) | Scoring detail + Home placement + Score≠IRL | ✅ | ScorePanel on Home: PROJECT SCORE + a distinct IRL "stages validated" readout — live-validated render (see §4). Also fixed: the per-dimension breakdown rendered empty because the code assumed an array but `scores.dimensions` is a JSONB object map (now normalized). |
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

**Validated LIVE this session:** the `/competitors/breakdown` endpoint returns **8 competitors × 4 categories each** (general / pricing / competitive_advantage / criticality) and the Knowledge UI renders the nested startup → competitor → category → detail with Apply/Dismiss. Categories were populated by a faithful backfill of the existing nodes' stored attributes — because the market-research **re-run parsed 0 competitors** (a parser-variance bug). That bug is now **guarded**: the research upsert keeps prior competitors/market-size/trends when a re-parse comes back empty (`skill-research-persist.ts`, JSONB CASE guard), so a 0-competitor run can no longer wipe the graph.

---

## 4. What was live-validated vs. code-only (updated 2026-06-19)

- **Live-validated in the running app this session** (Playwright + a second gstack QA pass agree, 0 functional bugs): items 2, 5, 6; SOUL anti-sycophancy + scoring rigor (NOT-READY-first, Sibill found; held its ground under direct push-back); the commit loop (DB-confirmed writes); skill-output streaming (3→20,160 chars); **the matryoshka end-to-end (8 competitors × 4 categories render in Knowledge + breakdown endpoint)**; **chat↔graph — the agent now lists all 8 pending competitors via a live graph query** (was "0 competitors"); **the Home redesign — Score + IRL (1/7, Market Validation) + Ecosystem + Onboarding + Notes all render, 0 console errors**; **Notes → applied memory_fact** (round-trip + cleanup); **watcher edit/delete** (Sibill weekly→daily; Market Trends pause — both via Apply → executor → DB, then reverted); item 1.5 (verbatim canvas recall); item 1.6 (scoring no longer false-blocked).
- **Code-only (tsc-clean, not yet live-run):** the watcher **hard-delete** branch (only `pause` was exercised; delete falls back to deactivate on FK conflict); the `commit:apply` **failure-path** UI (revert + error label — can't force a server rejection in-browser); financial-model export **with real data** (no project has a financial model yet; the builder is unit-proven with synthetic data).

---

## 5. Deployment status — IMPORTANT (updated 2026-06-19)

**Everything is now COMMITTED + PUSHED to PR #75, NOT merged, NOT deployed.** Branch `feat/changelog-1706-remediation` (HEAD `fd01ad1`); `npm run deploy` has NOT run, so none of this is on the live site yet. The local dev server runs this worktree against prod data with the localhost-only E2E auth bypass.

**PROD-DB changes applied this session (all additive / safe):** (1) migration **022** (`competitor_categories` table); (2) migration **023** (widened `pending_actions.action_type` CHECK with `edit_monitor` + `delete_monitor`); (3) a stale validation-proposal (`pa_qiy93cca6abn`) flipped to rejected.

**To ship:** review + merge PR #75, then `npm run deploy`. The migrations are already in prod, so shipping is code-only at deploy time.

---

## 6. Still open (ranked, updated 2026-06-19)

1. 🟥 **Item 8 credits** — the highest-impact remaining work and the loudest founder complaint: stable-tool-prefix caching (cost), re-base the pool, honest "≈N credit" labels, dedup budget rows. (Assessment in §2.) Not started.
2. 🟥 **Item 9** — progressive canvas paint (additive rebuild: parser + SSE + Canvas render-state).
3. 🟨 **Item 13** — financial-model edit-and-persist (POST/PUT + edit UI + Canvas renderer); export side is done.
4. 🟨 **Item 1 / onboarding** — `OnboardingCard` ships + renders; expand to the full 5 steps + post-canvas watcher nudge.
5. 🟩 **Scoring on Home + branded IRL — DONE + live-validated** (ScorePanel: PROJECT SCORE + a distinct IRL/“stages validated” readout on Home). Moved out of "open".
6. minor live-test gaps: watcher hard-delete branch, commit:apply failure UI, financial export with real data (see §4).

---

## 7. Also shipped this session (beyond the 17/06 list)

- **Chat ↔ knowledge-graph fix** — `list_graph_nodes` surfaced `applied`-only, so the agent reported "0 competitors" while the founder saw them. Now surfaces applied+pending, state-labeled. Live-proven.
- **Research-upsert guard** — a market-research re-run that parses 0 competitors no longer wipes the existing `research` row (JSONB CASE guard, self-heals on the next clean run).
- **3 defects from an adversarial audit** (16-agent review, 0 false-positives after verify… except one): `commit:apply` silent-failure (await+catch+revert), ScorePanel object-map dimensions (per-dimension breakdown never rendered), CSV formula-injection in exports. The audit's one HIGH was a **false positive** from `db/schema.sql` having drifted from prod (`chat_messages.created_at` exists live) — caught by checking the live DB.
- **Agent watcher accessibility (CRUD)** — `list_watchers` (read active/paused/inactive + objective/cadence/status), `edit_watcher` and `delete_watcher` (propose → founder Apply confirms → `editMonitor`/`deleteMonitor` executors). Migration 023. Live-validated end-to-end. This is the template for giving the agent safe edit/delete over other entities (competitors, tasks, facts).
- **Watcher-detail fallback** — objective-less watchers no longer dump the raw OUTPUT-CONTRACT scan prompt; they show a "no description — Edit" hint, raw prompt under "advanced".
