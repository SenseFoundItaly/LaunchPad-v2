# LaunchPad — API & Infrastructure Cost Reference

_Last audited: 2026-07-03. Live numbers below are from `llm_usage_logs` (prod) over the trailing 30 days. Update the figures when the mix changes materially._

Every external service the app pays for, what drives its cost, how it's metered, and the levers. Grounded in code + prod spend, not estimates.

---

## TL;DR

- **Total external spend ≈ $88 / 30 days (~$2.93/day)**, and **~94% of it is one thing: LLM tokens via OpenRouter (Claude Sonnet 4.6).**
- **Chat is 69% of all spend** ($61/30d); of that, **~70% is prompt-cache *writes*, not reads** — the single biggest efficiency lever (`CACHE_PREFIX_SPLIT`, see below).
- Search/scrape (Exa + Jina) is **negligible** (< $1/30d).
- Infra (Supabase, Netlify, Langfuse) is flat monthly subscription, not per-request.
- **Caveats in the current numbers:** ~31 of 34 prod users are `@e2e.local` test accounts, so real-founder burn is far lower than the totals; and **$2.59/30d is the rogue "ghost" Vercel executor** (direct Anthropic) that should be killed.

---

## 1. LLM tokens — the ~94% (OpenRouter → Anthropic Claude)

All chat, monitor scans, skills, heartbeats and reflections run through **OpenRouter** (`OPENROUTER_API_KEY`) to Anthropic models. Task→tier routing lives in `src/lib/llm/router.ts`:

| Tier | Model | Used for |
|---|---|---|
| `cheap` | `anthropic/claude-haiku-4.5` | classification, summaries, signal-classify, heartbeat-propose, assumption-extract |
| `balanced` (default) | `anthropic/claude-sonnet-4.6` | chat, monitor scans, correlation, most skills |
| `premium` | Opus | scaling-plan, milestones, premium skills (landing page, pitch deck) |

**30-day spend by provider/model:**

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

**Cost driver in chat = prompt-cache *writes*.** Over 30d, chat wrote **11.6M cache tokens** vs **15.0M cache reads** (input 1.5M, output 0.6M). At Sonnet cache-write pricing (~$3.75/M) that's ≈ $43 of the $61 — i.e. the system prompt is being re-cached most turns instead of reused.
- **Lever:** `CACHE_PREFIX_SPLIT` (`src/lib/chat-cache-split.ts`) keeps the ~17k-token static prefix byte-stable so it's cache-*read* not re-written. Flag is OFF on prod; content-preserving; enabling with a cache-trace check should cut chat cost materially at scale. (Deliberately deferred until post-alpha — behavioural risk on the core agent.)

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
- **The "ghost"** — a rogue old Vercel deploy (`launchpad`, direct Anthropic) still runs monitors daily (~$2.59/30d) on stale code and writes corrupt data. **Kill it** (disable the Vercel project); the deployed stack now covers monitor execution.
- **Weekly pulse** (heartbeats + correlations + Monday email) still runs inline and is being **cut** for the Rocket-like direction — removing `heartbeat-executor` (~$8/30d) + `daily_reflection` (~$5.5/30d) from the bill.

---

## 6. Business-side cost model (credits)

Founder billing (`src/lib/credit-costs.ts`), decided 2026-06-26 — **"1 message = 1 credit, everything else free":**
- `CREDITS_PER_MESSAGE = 1`; knowledge-apply, document-audit, skills, watchers, background = **0 credits (absorbed).**
- Unit: **50 credits/month = $10 LLM budget per user** → **5 credits/$1** (1 credit ≈ $0.20).
- Enforcement: `CREDITS_HARD_STOP` gate exists but is **OFF on prod** (credits hidden + unenforced during alpha).
- **Implication:** all non-message cost (watcher scans, reflections, background) is company-absorbed and uncapped per user. Fine at current scale ($88/mo); revisit before scale (founder-approved "OK to lose money for now").

---

## 7. Where to see live spend

- **Per-call ledger:** `llm_usage_logs` table (project_id, step, provider, model, tokens, `total_cost_usd`, latency). Query by `step` for task breakdown, by `provider`/`model` for mix, by `created_at` for trend.
- **Traces:** Langfuse dashboard (per-turn token + latency).
- **This doc's queries** live in the 2026-07-03 cost audit; re-run them to refresh the tables above.

---

## Action items surfaced by this audit

1. **Kill the ghost Vercel project** → removes $2.59/30d of rogue spend + corrupt data. _(founder — Vercel access)_
2. **Flip `CACHE_PREFIX_SPLIT` post-alpha** with a cache-trace check → biggest chat-margin lever (~$18-20/mo now, dominant at scale).
3. **Cutting the weekly digest** removes ~$14/30d (heartbeat + reflection).
4. **Add `RESEND_API_KEY`** only if/when a real email surface is wanted (not needed for the Rocket-like direction).
5. **Purge `@e2e.local` test accounts** from prod so cost numbers reflect real founders.
