# LaunchPad

Autonomous AI co-founder for early-stage founders. LaunchPad walks a founder through a **7-stage validation journey** (Idea Validation → Operate), gating each stage on real evidence rather than vibes. A memory-grounded chat agent proposes work; nothing with a side effect runs until the founder approves it from an **approval inbox**; and a single daily cron quietly runs competitor/market **watchers**, folds findings into a **knowledge graph**, and ships a weekly **Monday Brief**. Built on the Pi Agent SDK + Anthropic Claude.

## Quick Start

```bash
git clone https://github.com/SenseFoundItaly/LaunchPad-v2.git
cd LaunchPad-v2
cp .env.example .env.local       # Fill in DATABASE_URL (Supabase Postgres) + ANTHROPIC_API_KEY + Supabase keys
npm install
npm run db:migrate               # Apply migrations (reads .env.local; add  -- --prod  to target prod)
npm run dev                      # http://localhost:3000
```

First login uses Supabase Auth (magic link) — see [Supabase setup](#supabase-setup).

---

## How it works

LaunchPad has four pillars: the **journey** (where the founder is), **skills** (how they make progress), the **approval inbox** (how the agent acts on their behalf), and **self-driving intelligence** (what runs while they're away). Most chat-driven state is written through **structured artifacts** — the agent emits `:::artifact{…}:::` blocks that `artifact-parser.ts` turns into Canvas tiles, knowledge entries, and inbox proposals.

### 1. The 7-stage journey

The spine of the product. `src/lib/journey/` defines a canonical 7-stage journey and evaluates it with **31 evidence gate checks** read straight from the project's data — a stage is only "done" when **every** check passes. There's no fuzzy score deciding the gate: the evidence is in the record or it isn't (most checks read structured rows; a handful match against captured memory facts).

| # | Stage | Checks | A stage clears when… |
|---|-------|:-----:|----------------------|
| 1 | **Idea Validation** | 6 | problem, solution (+detailed), value prop (+sharp), and competitive edge are articulated in the idea canvas |
| 2 | **Market Validation** | 8 | segment named · **3+ competitors** mapped · market size (TAM/SAM/SOM) · **5+ interviews** logged · top pain captured · **1+ active watcher** · differentiation evidenced |
| 3 | **Persona** | 4 | target market named · ICP described · acquisition channels identified · segment validated by **10+ signals** |
| 4 | **Business Model** | 5 | anchor price set · 2+ tiers · willingness-to-pay researched · pricing model chosen · **unit economics viable (LTV/CAC ≥ 1)** |
| 5 | **Build & Launch** | 4 | workflow active · MVP scope defined · **something shipped** (a published asset) · 3+ early-user signals |
| 6 | **Fundraise** | 2 | **runway ≥ 12 months** · capital plan in motion (open round or revenue metric) |
| 7 | **Operate** | 2 | 1+ active growth loop · 3+ metrics tracked |

`buildProjectSnapshot()` runs ~18 guarded facet queries in parallel (each degrades to empty on error rather than failing the whole evaluation), then `evaluateAllStages()` marks the first incomplete stage `active` and the rest `pending`. The active stage, its passed/missing checks, and the gap hints are injected into the chat system prompt (the **spine**, `formatStageContextForPrompt`) and rendered in the Canvas — so the agent always pushes toward the *specific* missing evidence.

> **Two "stages" modules — don't conflate them.** `src/lib/journey/` is the **evidence journey** above (*"does the founder have the proof to advance?"*). `src/lib/stages.ts` is a separate **skill pipeline** used for 0–10 readiness *scoring* and `next_recommended_skill` (*"which skills did they run, how rich was the output?"*). Both share the canonical 1–7 labels; `/api/projects/[id]/intelligence` joins them by stage number and `blendStageVerdict()` reconciles skill score with journey evidence (full evidence floors the verdict at **go**, never demoting a fully-evidenced stage).

### 2. Skills — 19 expert playbooks

Each skill is a `launchpad-skills/<id>/SKILL.md` file (YAML frontmatter + a markdown body used as the skill's system prompt). `getSkillTools()` loads all **19** and exposes each to the chat agent as a `skill_<id>` tool (e.g. `skill_market_research`).

- **18 skills are wired into the 7-stage readiness pipeline** (`src/lib/stages.ts`) — e.g. `idea-shaping` + `startup-scoring` (Stage 1), `market-research` + `simulation` (Stage 2), … `weekly-metrics` (Stage 7). Running them feeds stage scoring and the next-recommended-skill nudge.
- **1 skill is an ad-hoc meta-advisor** (`startup-advisor`) — invocable from chat for free-form guidance, deliberately *outside* the pipeline so it doesn't move the score.

**Skills propose → approve → run** (they do **not** run synchronously in chat). When the agent decides a skill should run, its tool call creates a `run_skill` **pending action** (a fast DB insert with a credit estimate) and tells the agent not to wait — this is what keeps chat turns snappy instead of blocking on a 2-minute LLM job. The founder approves it in the inbox; the `run_skill` executor then runs the skill for real and upserts `skill_completions` + `section_scores`.

### 3. The approval inbox (approve-first)

Every agent-proposed side effect — run a skill, configure a watcher, accept a signal into knowledge, draft an email, set a budget — lands as a row in `pending_actions` for the founder to **approve / edit / reject**. Nothing that spends credits or writes durable state happens without a click.

- **One transition endpoint:** `POST /api/projects/[projectId]/actions/[actionId]` with a verb — `apply | edit | reject | mark_sent | mark_failed`. `src/lib/pending-actions.ts` owns transition legality (a terminal row 409s).
- **Executor registry** (`src/lib/action-executors.ts`): each action type maps to a handler. *Direct* handlers write a domain row and chain straight to `sent`; *click-to-send* handlers (email/LinkedIn) return a URL and wait for `mark_sent`.
- **Four lanes** (`src/lib/action-lanes.ts`): `todo`, `approval`, `notification`, `monitor`. Everything with a real executor lives in `approval`.
- **Rejections teach the agent:** a reject writes a low-confidence `preference` fact ("user rejected X") that future prompts read, and propagates the dismissal to the source signal/brief/assumption.

### 4. Self-driving intelligence — one unified cron

All scheduled background work runs in **a single endpoint**, `GET /api/cron`, triggered **once daily at 08:00 UTC** by GitHub Actions (`.github/workflows/scheduled-cron.yml`, bearer-gated by `CRON_SECRET`). There is no separate heartbeat job and no separate monitor job — they are phases of this one worker, recorded as one auditable `cron_runs` row per tick:

| Phase | What it does | Cadence |
|-------|--------------|---------|
| **Monitors** | run due watchers → `ecosystem_alerts` + inbox proposals + `memory_facts` | daily |
| **Watch sources** | URL change-detection (≤10/tick) | daily |
| **Brief expiry** | expire intelligence briefs older than 7 days | daily |
| **Correlation** | cross-signal synthesis → `intelligence_briefs` | **weekly (Mon)** |
| **HEARTBEAT + Monday Brief** | weekly reflection (score-delta + priorities + risks) → email digest | **weekly (Mon)** |
| **Notification sweep** | auto-dismiss notification-lane rows older than 7 days | daily |

The weekly phases are gated by `isWeeklyPulseDay()` (default Monday UTC, override with `WEEKLY_PULSE_DAY`). `POST /api/cron` is a manual trigger for re-firing monitors only.

**`GET /api/cronbeat` is not a second cron** — it's a read-only **health probe** that reports `healthy` / `stale` / `dead` from the last few `cron_runs` (healthy < 26h, stale 26–50h, dead > 50h). It *watches* the cron; the cron does the work.

**Run the cron locally:** `curl localhost:3000/api/cron`. In dev the endpoint is open when `CRON_SECRET` is unset; set the secret and pass `Authorization: Bearer <secret>` to require it (production always does).

### 5. Knowledge & the signal→knowledge loop

Knowledge lives in several specialized stores with a unified **read** layer (`src/lib/knowledge/unified.ts`) over `graph_nodes`, `memory_facts`, `ecosystem_alerts`, `intelligence_briefs`, `competitor_profiles`, and `interviews`, each carrying a provenance tier (`founder_asserted < workflow_derived < externally_verified`). `graph_nodes` is the curated knowledge graph (D3 force-directed in the UI), seeded with a `your_startup` root node at project creation so entity edges have a hub to attach to.

When a founder **accepts an ecosystem alert**, `acceptAlertIntoKnowledge()` marks the alert accepted, upserts an `applied` `graph_node` (atomic on `(project_id, LOWER(name))`), back-links the alert, and records a monitor-sourced memory fact — so a watcher signal the founder approved shows up as durable, cited knowledge the agent reasons over next turn.

A **premortem assumptions** layer (`src/lib/assumptions.ts`) extracts categorized, criticality-rated assumptions the first time the idea canvas has real substance, and materializes the open ones into the inbox as `assumption_review` proposals.

---

## What you get

- **Memory-grounded chat** — the agent remembers decisions, commitments, and preferences across sessions via a structured facts + events layer, not just transcripts.
- **Evidence-gated journey** — always know the one missing piece of proof blocking the next stage.
- **19 expert skills** — market research, buyer personas, business/financial modeling, GTM, growth loops, pitch deck, investor readiness, weekly metrics, and more — run on approval.
- **Self-driving watchers** — competitor / market / news monitors that fold findings into the knowledge graph.
- **Approval inbox** — every agent action is a reviewable proposal; rejections become preference signals.
- **Monday Brief** — a weekly digest of priorities, fresh signals, and a readiness delta (in-app + email; set `RESEND_API_KEY` for real delivery).
- **Cost-aware autonomy** — task-tier model routing (Haiku/Sonnet/Opus), Langfuse observability, per-project monthly budget caps with warn + throttle.

## Tech stack

- **Next.js 16** — App Router, TypeScript, Turbopack
- **Supabase Auth** — magic link / OAuth / SSO-ready
- **Supabase PostgreSQL** via [`postgres.js`](https://github.com/porsager/postgres) — `src/lib/db` exposes `query()` / `run()` / `get()` using `?` placeholders (converted to `$1…` at runtime); **50 tables** (`db/schema.sql`), migrations in `db/migrations/` (`npm run db:migrate`)
- **Pi Agent SDK** — [`@mariozechner/pi-ai`](https://www.npmjs.com/package/@mariozechner/pi-ai) + `@mariozechner/pi-agent-core`; agent runner in `src/lib/pi-agent.ts` (`runAgent` / `runAgentStream`)
- **Anthropic Claude**, tier-routed per task (`src/lib/llm/router.ts` + `models.ts`): **cheap → Haiku 4.5**, **balanced → Sonnet 4.6**, **premium → Opus 4.7**. Provider swaps to **OpenRouter** automatically when `OPENROUTER_API_KEY` is set (env + restart, no code change)
- **Langfuse** — LLM observability + per-call cost logging
- **D3.js** — knowledge-graph rendering

## Project structure

```
src/
  app/
    api/
      chat/                       # Streaming chat agent (memory + skill + project tools)
      cron/                       # The single unified background worker (GET) + manual monitor trigger (POST)
      cronbeat/                   # Read-only cron health probe (healthy/stale/dead)
      projects/[projectId]/       # stages, intelligence, actions, monitors, watchers, knowledge, idea-canvas, ...
    project/                      # Per-project UI (chat + Canvas, inbox, knowledge, usage)
    login/  onboard/              # Auth + partner onboarding
  components/
    canvas/                       # Canvas + SpineSection (live journey spine)
    chat/                         # Chat panel + artifact renderers
    graph/                        # KnowledgeGraph (D3) + detail panels
    design/                       # Founder-OS design primitives + chrome
  lib/
    journey/                      # 7-stage EVIDENCE engine — canonical.ts, stage-1..7-*.ts, snapshot.ts, index.ts, stage-prompt.ts
    stages.ts  scoring.ts         # Skill PIPELINE + 0–10 readiness scoring + blendStageVerdict
    skill-tools.ts  skill-executor.ts   # Load launchpad-skills/*, propose→approve→run, persist completions
    pending-actions.ts  action-executors.ts  action-lanes.ts   # Approval inbox: state machine, executors, lanes
    knowledge/                    # unified.ts (read layer + provenance) + root-node.ts (your_startup seed)
    assumptions.ts                # Premortem extraction → assumption_review inbox
    ecosystem-*.ts  monitor-*.ts  watch-source-processor.ts  intelligence-correlator.ts   # Watchers + signals + briefs
    memory/                       # facts.ts, events.ts, context.ts (buildMemoryContext)
    llm/                          # router.ts + models.ts (tier→model, Anthropic/OpenRouter)
    pi-agent.ts  agent-prompt.ts  # Agent runner + SOUL/AGENTS/HEARTBEAT composition (locale-aware)
    cost-meter.ts  db/            # Budget accrual + Postgres connection
  middleware.ts                   # Supabase session refresh + /login redirect
agents/                           # SOUL.md + AGENTS.md + HEARTBEAT.md (EN + .it.md) — canonical agent persona
launchpad-skills/                 # 19 SKILL.md playbooks — loaded as skill_<id> tools
db/
  schema.sql                      # 50 tables: projects, memory, journey data, ecosystem intel, pending_actions, ...
  migrations/  migrate.ts         # Ordered SQL migrations + runner (npm run db:migrate)
.github/workflows/scheduled-cron.yml   # Daily 08:00 UTC → GET /api/cron
```

## Configuration

See `.env.example` for the full list.

- **Required:** `DATABASE_URL` (Supabase Postgres), an LLM key — `ANTHROPIC_API_KEY` **or** `OPENROUTER_API_KEY` — and `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Optional:** `OPENROUTER_API_KEY` (route all LLM calls via OpenRouter), `CRON_SECRET` (required to enable cron in production), `WEEKLY_PULSE_DAY` (0=Sun…6=Sat; default Monday), `RESEND_API_KEY` (real Monday Brief email), `JINA_API_KEY` / `FIRECRAWL_API_KEY` (web fetch + change detection), `LANGFUSE_*` (observability), `LLM_ROUTING_JSON` (override per-task tiers at runtime), `PI_CACHE_RETENTION` (prompt-cache TTL)

## Develop, test & deploy

| Command | What it does |
|---------|--------------|
| `npm run dev` | Next.js dev server (Turbopack) on `:3000` |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Apply `db/migrations` — reads `.env.local`; add `-- --prod` to target `.env.production` |
| `npm run e2e:agent-flow` | End-to-end founder-flow harness (`scripts/e2e-agent-flow.mjs`) |
| `npm run deploy` | Build with the Netlify CLI + upload to production (`deploy:preview` / `deploy:dry` variants) |

**Deploy is not git-push CI.** `npm run deploy` builds locally via `netlify-cli` and uploads the output to Netlify (`scripts/deploy.sh`); database migrations are applied separately with `npm run db:migrate -- --prod`.

## Supabase setup

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. **Authentication → Providers → Email** → enable magic link.
3. **Authentication → URL Configuration** → add `http://localhost:3000/**` and your production URL to **Redirect URLs**; set the production URL as **Site URL**.
4. Copy the project's `DATABASE_URL` (Connection string → Transaction pooler, port 6543), `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` into `.env.local`.
5. Run `npm run db:migrate` to create the schema, then `npm run dev`.
