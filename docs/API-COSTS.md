# LaunchPad — API & Infrastructure Cost Reference

_Last audited: 2026-07-03; cost mechanics re-measured 2026-08-10/13 and again 2026-08-31. Live numbers below are from `llm_usage_logs` (prod) over the trailing 30 days. Update the figures when the mix changes materially._

> **2026-08-31 — the two biggest levers in this doc have shipped** (PR #445, branch `feat/harness-levers`; **merge + `npm run deploy` still required** for prod to see them). `CHAT_CACHE_SPLIT` now defaults ON, and the balanced tier moved from Sonnet 4.6 to **Sonnet 5** ($2/$10 vs $3/$15). Measured live on the new path: a cold turn cost $0.150 and the very next turn **$0.032** (47,986 tokens read from cache vs 3,252 written — ~94% prefix hit), against the $0.156/turn baseline this doc measured. The tables below are the pre-change 30-day windows; re-run the queries in §7 after the deploy has a few days of real traffic. §1 marks what is now historical.

Every external service the app pays for, what drives its cost, how it's metered, and the levers. Grounded in code + prod spend, not estimates.

---

## TL;DR

- **Total external spend ≈ $88 / 30 days (~$2.93/day)**, and **~94% of it is one thing: LLM tokens via OpenRouter** (Claude Sonnet — 4.6 through 2026-08-31, **Sonnet 5** after PR #445 deploys).
- **Chat is ~89% of all spend** ($74.55/30d as of 2026-08-10); of that, **74% was prompt-cache *writes*, not reads** — root cause + the fix that closed it in §1 below (`CHAT_CACHE_SPLIT`, default ON since PR #445 — **not** the old `CACHE_PREFIX_SPLIT`, which is superseded/do-not-use).
- Search/scrape (Exa + Jina) is **negligible** (< $1/30d).
- Infra (Supabase, Netlify, Langfuse) is flat monthly subscription, not per-request.
- **Caveats in the current numbers:** ~31 of 34 prod users are `@e2e.local` test accounts, so real-founder burn is far lower than the totals; and **$2.59/30d is the rogue "ghost" Vercel executor** (direct Anthropic) that should be killed.

---

## 1. LLM tokens — the ~94% (OpenRouter → Anthropic Claude)

All chat, monitor scans, skills, heartbeats and reflections run through **OpenRouter** (`OPENROUTER_API_KEY`) to Anthropic models. Task→tier routing lives in `src/lib/llm/router.ts`:

| Tier | Model | Used for |
|---|---|---|
| `cheap` | `anthropic/claude-haiku-4.5` | classification, summaries, signal-classify, heartbeat-propose, assumption-extract |
| `balanced` (default) | `anthropic/claude-sonnet-5` | chat, monitor scans, correlation, most skills |
| `premium` | Opus | scaling-plan, milestones, premium skills (landing page, pitch deck) |

Balanced moved 4.6 → 5 on 2026-08-31 (PR #445): $2/$10 vs $3/$15, but Sonnet 5's tokenizer yields ~30% more tokens for the same text, so budget **~13% net**, not the headline 33%. The `claude-sonnet-4-6` entry stays in `models.ts` marked `legacy: true` — it never wins a tier, it exists so this ledger keeps pricing historical rows correctly. Adding a model needs an `LP_EXTRA_MODELS` entry in `pi-agent.ts` too; see CLAUDE.md's footgun.

**30-day spend by provider/model** _(window ending 2026-07-03 — a historical ledger, deliberately left at the model IDs that were live then. After PR #445 deploys, `claude-sonnet-4.6` rows are historical and any NEW `claude-sonnet-4-20250514` row can only be the external ghost deploy: that pin no longer exists anywhere in this codebase, and the snapshot itself 404s since June 2026.)_:

| Provider / model | Calls | Cost |
|---|---|---|
| openrouter · claude-sonnet-4.6 (balanced) | 625 | **$83.04** |
| anthropic · claude-sonnet-4-20250514 (**ghost — kill**) | 107 | $2.59 |

| openrouter · claude-haiku-4.5 (cheap) | 220 | $1.01 |
| anthropic · claude-opus-4-7 (premium) | 1 | $0.48 |

**30-day spend by task (`step`):**

| Task | Cost | Notes |
|---|---|---|
| `chat` | **$61.20** | founder co-pilot — the dominant cost |
| `heartbeat-executor` | $8.22 | weekly pulse reflections (being cut — see digest note) |
| `daily_reflection` | $5.55 | project reflections |
| `cron.health` / `cron.ecosystem.*` / `manual.ecosystem.*` | ~$6 total | **watcher / monitor scans** |
| `task_proposer`, `assumption-*` | < $1 each | background helpers |

**Cost driver in chat WAS prompt-cache *writes*.** _(Diagnosis re-measured 2026-08-10/13, six weeks after the tables above — the $ figures differ from row totals up top because they're a fresher 30-day window, not a contradiction. **Fixed 2026-08-31 by PR #445**, which turned the breakpoint on by default; the diagnosis is kept in full because it is the reasoning that justifies the fix and the invariant it leaves behind — see "what this buys" at the end of the section. The mechanism below also supersedes the `CACHE_PREFIX_SPLIT` note that used to live here; keep reading before touching that flag.)_ 30d as of 2026-08-10: chat = **$74.55 of ~$84 total spend**, and cache **writes alone are ~$55 — 74% of chat cost** (writes 14.73M tok, reads 21.21M tok). **84% of those writes land on turns arriving within 5 minutes of the previous turn** — i.e. while the cache entry is still *alive*. The prefix is being **invalidated, not expiring**, so raising the TTL cannot help (and can't even be tried here: pi-ai only emits `ttl:"1h"` when `baseUrl` is `api.anthropic.com`, and prod is 100% OpenRouter).

**Root cause, found by per-section fingerprinting:** the chat system prompt is ~84,041 characters that are byte-identical on essentially every turn (SOUL + AGENTS + ARTIFACT_INSTRUCTIONS + JOURNEY_RULES — measured 0/5 turns moved) followed by ~3,800 characters (live memory context + steering) that mutate almost every turn. On the **OpenRouter path specifically**, pi-ai does *not* use its `anthropic.js` provider (which sets up to 3 breakpoints) — it uses `openai-completions.js`, which for `provider=openrouter` + `anthropic/*` models sends the system prompt as **one plain string with no `cache_control` at all**, and puts its only breakpoint on the last message. So the volatile 4% invalidates the stable 96% every single turn. This is OpenRouter-passthrough-specific — reading `anthropic.js` in isolation (the direct-Anthropic provider) gives the wrong mental model for what actually happens on this stack.

**A second invalidator sat even further forward.** The cached prefix is `tools → system → messages`, so the **tool array is position 0** — ahead of all 84,041 characters above. Two things mutated it almost every turn: a per-message write-intent regex that flipped ~10 write tools in and out, and a Haiku classifier that picked a different top-3 skill-tool set per message. Both were written as token savings (~800 tokens of schema), and both were net losses by an order of magnitude: the schema they saved would have ridden the cache at 0.1×, while the array change they caused re-wrote the entire ~25k-token prefix at 1.25–2×. PR #445 froze the array (write tools always attach; all skill tools are offered; the classifier call is deleted, which also removes a Haiku call and ~300ms per free-form turn) and moved the per-turn tool budget into pi-agent-core's `beforeToolCall` hook — the previous "strip `agent.state.tools` to force synthesis" was a no-op, because `Agent.prompt()` snapshots the array at run start.

- **`CACHE_PREFIX_SPLIT` (`src/lib/chat-cache-split.ts`) is SUPERSEDED — do not flip it.** It moves the *volatile content itself* onto the user turn behind a "reference data" fence. Tried once: cut cost 57%, dropped the Validation Gate from 8/8/8 → 1/1/6, because directives like `stageContext`'s "close THIS check" stopped being read as authoritative once demoted to reference data. Left in the repo as a cautionary flag, default OFF.
- **The actual lever — `CHAT_CACHE_SPLIT` (`src/lib/chat/cache-breakpoint.ts` + `patches/@earendil-works+pi-ai+0.84.4.patch`).** Marks a cache breakpoint at the static/volatile boundary instead of moving any content — the model receives **byte-identical content in identical order** (asserted in `cache-breakpoint.test.ts` against the real prompt builder), so the Validation Gate risk above does not apply. Requires `npm ci` to actually apply the patch (it patches `openai-completions.js` in `node_modules` — see the patch file for why). **Status: ON by default since PR #445 (2026-08-31).** It self-disables unless the active provider is OpenRouter, so the marker can never reach a provider that would not strip it; `CHAT_CACHE_SPLIT=0` is the kill switch. The earlier controlled A/B (short scripted non-streaming conversations, zero tool calls) predicted writes −55% / input cost −50%; the **live streaming, tool-bearing** check on the shipped path came in consistent with it: cold turn $0.150 → next turn **$0.032**, 47,986 read vs 3,252 written. Keep watching `cache_read_tokens` in `llm_usage_logs WHERE step='chat'` — a sustained collapse of that number means something upstream started mutating the prefix again.
- **Two things must stay byte-stable or this lever silently dies**, which is why PR #445 also froze them: the **tool array** (it renders at prefix position 0 — the retired per-message write-intent regex and the Haiku top-3 skill-tool classifier each re-wrote a ~25k-token prefix to save a few hundred tokens of schema) and the **static system half**. Treat "drop content per turn to save tokens" as an anti-pattern in chat: at 0.1× read vs 1.25–2× write, the arithmetic almost always runs the other way.
- **What this buys, and what it does not.** It converts the dominant *write* line item into reads; it does **not** shrink the volatile tail, the replayed history, or the tool-result payloads inside it — those are still billed at full input price every turn and are the next levers (history diet, retrieval instead of full-dump memory injection, Batch API for cron). See the 2026-08-31 harness audit for the ranked list.

**Metering:** `recordUsage()` (`src/lib/cost-meter.ts`) writes every call to `llm_usage_logs` with token counts + `total_cost_usd`. Traces also flush to Langfuse.

---

## 2. Search & scrape (Exa, Jina, Firecrawl) — < $1 / 30d

The Intelligence layer (watchers, monitor scans, co-pilot web research) reads the live web through a provider chain. Per-call list-price defaults (env-overridable) in `src/lib/tool-spend.ts`:

| Provider | Key | Search | Read/contents | Status |
|---|---|---|---|---|
| **Exa** (primary) | `EXA_API_KEY` ✅ set | $0.005 / search | $0.01 / read | **Active & working** |
| **Jina** (fallback) | `JINA_API_KEY` ✅ set | $0.001 | $0.001 | quota-exhausted (HTTP 402) — the chain falls through to it last |
| **Firecrawl** (opt) | `FIRECRAWL_API_KEY` ✗ unset | native diff | — | not configured |

**30-day actual:** Exa `web_search` 52 calls ($0.26) + `read_url` 31 calls ($0.31) = **~$0.57**. Trivial today, but scales linearly with watcher volume × founders.
**Metered** per call into `llm_usage_logs` (provider=`exa`/`jina`, marked as a tool fee) via `recordToolSpend` — so search cost sits in the same ledger as tokens.

---

## 3. Infrastructure (flat monthly, not per-request)

| Service | What | Plan / cost model |
|---|---|---|
| **Supabase** | Postgres DB (`DATABASE_URL`, PgBouncer pooler) + Auth (magic-link login) | Subscription (Pro tier assumed) — flat, plus usage above quota. Auth emails are Supabase's. |
| **Netlify** | Hosting, SSR functions (OpenNext), edge middleware, bandwidth | **Pro plan.** Functions billed by invocation+duration; **26s sync limit** is why long monitor runs stream (see §5). |
| **Langfuse** | LLM observability / tracing (`LANGFUSE_*`) | Free or paid tier depending on volume — not per-app-request billed by us. |

---

## 4. Email (Resend) — configured in code, **STUBBED in prod**

`src/lib/email.ts` sends the "Monday Brief" via **Resend** (`RESEND_API_KEY`). **The key is UNSET on prod**, so `sendBrief()` is a no-op stub ("would have emailed X") — **no email actually sends today.** (One more reason the weekly digest is inert; see the digest decision.) Cost is $0 until a key is added.

---

## 5. Long-running processes & their cost profile

- **Monitor / watcher scans** are the only genuinely long tasks: one agent run = **60–180s**, ~$0.10–0.60 in Sonnet+Exa. They **cannot** run inside Netlify's synchronous function budget, so they execute via the **streaming** `GET /api/cron/run-monitor` endpoint, driven one-at-a-time by the GitHub Actions scheduler (`.github/workflows/scheduled-cron.yml`). This is the fixed, proven path (2026-07-03).
- **Cost cadence:** daily cron at 06:17 UTC runs each *due* monitor once (weekly per monitor). Roughly `#active_watchers × ~$0.30` per week.
- **The "ghost"** — a rogue old Vercel deploy (`launchpad`, direct Anthropic) still runs monitors daily (~$2.59/30d) on stale code and writes corrupt data. **Kill it** (disable the Vercel project); the deployed stack now covers monitor execution. _(Separately, this codebase's own no-task fallback used to name the same retired model — that pin is gone as of PR #445 and now derives from `MODEL_CONFIG`, so the two failure modes can no longer be confused in the ledger.)_
- **Weekly pulse** (heartbeats + correlations + Monday email) still runs inline and is being **cut** for the Rocket-like direction — removing `heartbeat-executor` (~$8/30d) + `daily_reflection` (~$5.5/30d) from the bill.

---

## 6. Business-side cost model (credits)

Founder billing (`src/lib/credit-costs.ts`), decided 2026-06-26 — **"1 message = 1 credit, everything else free":**
- `CREDITS_PER_MESSAGE = 1`; knowledge-apply, document-audit, skills, watchers, background = **0 credits (absorbed).**
- Unit: **50 credits/month = $10 LLM budget per user** → **5 credits/$1** (1 credit ≈ $0.20).
- Enforcement: `CREDITS_HARD_STOP` gate exists but is **OFF on prod** (credits hidden + unenforced during alpha).
- **Implication:** all non-message cost (watcher scans, reflections, background) is company-absorbed and uncapped per user. Fine at current scale ($88/mo); revisit before scale (founder-approved "OK to lose money for now").
- **Margin note (2026-08-31):** the unit math above was set when a chat turn cost ~$0.156. A cached turn on the shipped path measured **$0.032** — so 1 credit ≈ $0.20 now buys roughly 6× the model spend it did, and the "50 credits = $10 budget" equivalence is conservative rather than tight. Nothing to change today (credits are hidden + unenforced during alpha), but re-derive the unit before switching enforcement on, using post-deploy numbers rather than these.

---

## 7. Where to see live spend

- **Per-call ledger:** `llm_usage_logs` table (project_id, step, provider, model, tokens, `total_cost_usd`, latency). Query by `step` for task breakdown, by `provider`/`model` for mix, by `created_at` for trend.
- **Traces:** Langfuse dashboard (per-turn token + latency).
- **This doc's queries** live in the 2026-07-03 cost audit; re-run them to refresh the tables above.
- **The one open verification (post-PR-#445 deploy):** group `llm_usage_logs WHERE step='chat'` by day and compare `cache_read_tokens` against `cache_creation_tokens`. Expect reads to dominate writes by roughly an order of magnitude once the first turn of each session has warmed the prefix; if writes stay level with reads, something upstream is mutating the prefix again (tool array, system static half, or a non-deterministic memory serialization) and the lever is silently dead.

---

## Action items surfaced by this audit

1. **Kill the ghost Vercel project** → removes $2.59/30d of rogue spend + corrupt data. _(founder — Vercel access)_
2. ~~**Flip `CHAT_CACHE_SPLIT`**~~ — **DONE 2026-08-31 (PR #445): default ON, plus the tool-array freeze that protects it and the Sonnet 5 tier.** Still owed: merge + `npm run deploy`, then watch `cache_read_tokens` on `step='chat'` for a few days to confirm the ~94% prefix hit holds under real founder traffic, and re-run §1's tables. (`CACHE_PREFIX_SPLIT` — a different, older flag — remains superseded and should stay OFF; it broke the Validation Gate 8/8/8→1/1/6 when tried.)
3. **Cutting the weekly digest** removes ~$14/30d (heartbeat + reflection).
4. **Add `RESEND_API_KEY`** only if/when a real email surface is wanted (not needed for the Rocket-like direction).
5. **Purge `@e2e.local` test accounts** from prod so cost numbers reflect real founders.
6. **Build the cache-hit dashboard** (new, from the 2026-08-31 harness audit). Every lever in §1 is now protected by a number nobody watches: a silent prefix regression costs ~$40/mo until someone re-runs a query by hand. Also fix the blind spot the audit found — `extractTokens` misses pi-ai's buffered-path `cacheWrite` key, so cache accounting reads as zero for skills and monitors, which makes `pi-agent.ts`'s stated ">70% cron hit rate" target unverifiable today.
7. **Next cost levers, ranked** (2026-08-31 audit, none implemented): per-task `effort` levels — the `thinkingLevel → reasoning → output_config.effort` chain already exists end-to-end and is never set; history diet (the 16-message window counts messages, not tokens, and replays whole tool-result payloads); Batch API for cron/watchers (−50%, and it removes the 50-monitor/day serial ceiling); injecting `get_project_summary` as opener context instead of mandating a tool round-trip; structured outputs to kill the quiet-week second-pass extract.
