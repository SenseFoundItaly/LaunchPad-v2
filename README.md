# LaunchPad (SenseFound)

Autonomous AI co-founder for early-stage founders. LaunchPad is a four-surface workspace where a founder validates an idea through a 7-stage Solve flow, accumulates a project-specific knowledge brain, and runs always-on signal monitors against the outside world — all coordinated by a chat agent that can invoke domain skills, persist canvas decisions, and queue actions for the founder's approval.

> *Smart friend who keeps track of what you've decided, what you don't know yet, and what just changed in your market — instead of yet another dashboard.*

---

## Quick Start

```bash
git clone https://github.com/SenseFoundItaly/LaunchPad-v2.git
cd LaunchPad-v2
cp .env.example .env.local           # Fill Supabase + LLM keys
npm install
npm run db:migrate                   # Apply schema to your Supabase Postgres
npm run dev                          # http://localhost:3000
```

First-time setup details in [Setup](#setup) below.

---

## The Four Surfaces

Every project has the same four-tab navigation (left rail):

| Tab | What it is | When you open it |
|---|---|---|
| **Today** | Daily briefing — what changed since yesterday, what's queued, what the agent thinks you should do next. Cold-start variant offers a "tell me about you" card for brand-new projects. | First thing in the morning. |
| **Signals** | Outside-world monitor. Active watchers, ecosystem alerts, and synthesized **briefs** (multi-signal narratives like "Khan Academy testing a $9/mo Khanmigo SAT add-on — your wedge is at risk"). Each brief has a one-click **Save to knowledge**. | When you want to know what moved. |
| **Knowledge** | The project's brain. Knowledge gaps, 7-stage readiness, the Idea Canvas, market research, competitors, applied facts grouped by kind, entities, active briefs, recent skill outputs. Read-only mirror of everything the system understands. | When you want to know what *you* know. |
| **Co-pilot** | The chat workshop. Skills live here as invocable tools, the agent grounds every answer in `get_project_summary` (which now includes a `## Known knowledge gaps` block), and every write flows through skills + a confirmation inbox. | When you want to work on something. |

The mental model: **Today = your daily heartbeat. Signals = what's moving outside. Knowledge = what we know. Co-pilot = let's work on it.**

---

## Core Features

### Knowledge accumulation (the brain)

- **Idea Canvas** — Lean Canvas fields (problem / solution / target market / value prop / business model / competitive + unfair advantage), populated by the `idea-shaping` skill or directly via the agent's `update_idea_canvas` write tool.
- **Memory facts** — confirmed insights surfaced by chat or saved from briefs. Grouped by `kind` (decision / observation / preference / note / fact) and surfaced with provenance pills (chat / skill / monitor / approval inbox / heartbeat).
- **Graph nodes & edges** — schema-flexible entity layer (`competitor`, `persona`, `customer`, `market_segment`, `partner`, `technology`, `trend`, `channel`, …) populated by skills and chat. Edges connect them with typed relations.
- **Stage readiness** — every skill completion contributes to a per-stage score across the 7 stages. Readiness emits a `next_recommended_skill` that the agent uses to steer the option-set.
- **Knowledge gaps** — live-computed "what's missing" block. 9 gap kinds (no_idea_canvas, no_market_research, no_competitors, no_personas, no_risks, no_pricing, no_facts, stale_skill, next_skill), top-5 capped, surfaced both as an actionable card on the Knowledge page and as a `## Known knowledge gaps` block in the agent's system context so it can honestly say *"I don't have X yet — want me to run the skill that fills it?"* instead of fabricating.

### Signals (outside-world monitoring)

- **Watch sources** — founder-approved monitors (competitors, IP filings, hiring signals, ad activity, partnerships, regulatory, social mentions, …) seeded by ecosystem-monitor skill runs and surfaced as `configure_monitor` pending actions for explicit founder approval before they go live.
- **Ecosystem alerts** — structured findings emitted by monitors, scored by relevance, deduped by hash. Alerts route through the unified inbox.
- **Intelligence briefs** — multi-signal syntheses with a confidence score, narrative, and recommended actions. Each brief can be saved into `memory_facts` with a single click (Save to knowledge).
- **Today briefing** — the morning heartbeat surfaces fresh alerts + briefs + the project's next move.

### Chat (Co-pilot)

- **Skills as invocable tools** — 19 markdown-defined skills (see catalog below). The agent picks one when the founder's intent matches, runs it in a sub-agent loop with project-scoped write tools (`update_idea_canvas`, `create_pending_action`, …), and the result lands in `skill_completions` with a `summary` + `section_scores`.
- **Project-scoped tools** — `get_project_summary` (now with the gaps block), `list_ecosystem_alerts`, `list_pending_actions`, `list_intelligence_briefs`, `update_idea_canvas`, `create_pending_action`, and more, all closed over the current `projectId`. The agent cannot read or write another project's data.
- **Cost-aware routing** — each task label maps to a tier (cheap = Haiku, balanced = Sonnet, premium = Opus) via `src/lib/llm/router.ts`. Override at runtime with `LLM_ROUTING_JSON`.
- **Prompt-cache discipline** — Pi Agent SDK caches the system prompt + last user message via Anthropic ephemeral caching. Defaults to 5-minute TTL, tunable to 1 hour via `PI_CACHE_RETENTION=long`.

### Unified inbox

- One canonical `InboxItem` shape (`source: 'action' | 'fact' | 'alert'`) wraps pending actions, fact-review proposals, and ecosystem alerts under a single confirmation surface in Co-pilot's ContextPanel.
- **Apply / Reject** for individual items, **Apply All** for facts (the safe bulk), 8-second undo queue, optimistic hide. Lives in `src/components/inbox/UnifiedInbox.tsx`.
- Fan-out hook (`useInbox.ts`) listens for the universal `lp-actions-changed` CustomEvent so every surface refreshes when state mutates anywhere in the app.

### Cost governance

- **Per-project monthly budget cap** (`project_budgets`) with 80% warning + hard throttle. Tracked via `recordUsage` in `src/lib/cost-meter.ts`. The chat path routes through `accumulateMonthlyBudget` from `telemetry.ts` so both server-side LLM logging and the budget accrual stay in sync.
- **Langfuse observability** — every LLM call logs prompt, completion, model, latency, cost.
- **Usage page** (`/usage`) — per-project spend breakdown by skill, model, and step.

---

## A Normal Founder Flow

Walk-through of how a founder typically uses LaunchPad from day 0 onward. Names are placeholders; the underlying surfaces are real.

### Day 0 — Create the project

1. Sign in via magic link.
2. Hit **New project**, type a one-sentence pitch ("AI-tutored SAT prep for parents who want accountability").
3. Land on **Today**. With nothing in the brain yet, the cold-start card invites you to *"Tell me about you"* and links to the **Co-pilot**.
4. Open **Knowledge**. Almost everything is empty states — but the **Knowledge gaps** card at the top shows:
   - *Idea Canvas is empty* — kickoff: `"Help me structure my startup idea into a Lean Canvas. Walk me through each section."`
   - *Next move: Idea Shaping* — Stage 1 below GO.
5. Open **Co-pilot**, paste the kickoff. The agent runs the `idea-shaping` skill, asks 5–7 framing questions, and as you answer it persists each field to `idea_canvas` via `update_idea_canvas` and writes a `skill_completions` row when the canvas is locked.

### Day 1 — Validate the idea

6. Open **Today**. The brief now reads *"Canvas locked; risk audit + market research are your highest-leverage next moves."*
7. **Knowledge** now shows your filled canvas, plus three remaining gaps: *No market research*, *No competitors*, *No risk audit*. Each row has a copyable kickoff prompt.
8. Run `market-research` in Co-pilot. It fills `research.market_size`, `research.competitors`, `research.trends`, `research.key_insights`, and synthesizes a comparison table. Competitors mapped → the *No competitors* gap disappears on the next page load (gaps are derived, not stored).
9. Run `risk-scoring` next. `simulation.risk_scenarios` populates; the *No risk audit* gap clears too.

### Day 2–5 — Stack the validation stages

10. With Stage 2 (Market) above GO, the readiness block recommends **Stage 3 (Solve & Build)**. The Knowledge page's *Next move* card surfaces `business-model`, then `prototype-spec`.
11. Each skill completion deepens the brain: `business-model` fills the pricing rationale, `prototype-spec` produces a tech stack + feature map, the score climbs.
12. The agent now grounds answers in real data: "your TAM estimate is $4.2B per market-research run on 2026-05-30; pricing currently $19/mo per business-model skill; you have no GTM strategy yet — want me to run it?" — no fabrication.

### Day 5+ — Turn on signals

13. The `market-research` skill emitted `configure_monitor` pending actions (one per competitor + one per category). Approve them in the inbox. Each one becomes an active **watch source** with a category (`competitor_activity`, `ip_filing`, `funding_event`, `hiring_signal`, …).
14. Watchers run via `/api/cron` (Netlify scheduled or external cron). New findings land as `ecosystem_alerts`. High-relevance bursts get synthesized into **intelligence briefs**.
15. Open **Signals** when alerts appear. The brief: *"Khan Academy testing $9/mo Khanmigo SAT add-on (confidence 0.82) — your wedge of accountability + daily habit may be at risk."* Hit **Save to knowledge** — the synthesis lands in `memory_facts` with `source_type: 'monitor'`.

### Day 6+ — Compounding intelligence

16. The agent now references the saved fact next time you ask *"how does our positioning hold up against Khan Academy?"* It will name the brief, cite confidence, and recommend the wedge-defense kickoff.
17. **Today** continues to surface what's new each morning: fresh alerts, stale skills (skills run more than 14 days ago show in the gap list as *Refresh X*), and the next-recommended skill.
18. When a stage drifts below GO (skills go stale, new risks surface), the next-recommended-skill block changes accordingly, and the Knowledge page's gap list reorders.

The loop:

```
Idea → skills → canvas + facts + entities → score + readiness
   ↓                                              ↑
gaps (visible to founder + agent) ────────────────┘

Outside world → watch sources → alerts → briefs → save to knowledge
       ↓                                              ↑
       └────────── feedback into facts ───────────────┘
```

---

## Skills catalog (19)

Each skill is a markdown file under `launchpad-skills/<id>/SKILL.md` with frontmatter (`name`, `description`) and a body that defines instructions, inputs, and expected artifacts. The agent picks one when the founder's intent matches; you can also invoke directly via `runSkill(projectId, skillId)` from the cron heartbeat (analytical skills only — draft producers are excluded from auto-rerun).

| Stage | Skill | Purpose |
|---|---|---|
| 1 | `idea-shaping` | Lean Canvas walkthrough |
| 1 | `startup-scoring` | 6-dimension idea score |
| 2 | `market-research` | TAM/SAM/SOM + competitors + trends |
| 2 | `scientific-validation` | Buyer personas + empathy map |
| 2 | `risk-scoring` | Risk audit across all dimensions |
| 3 | `business-model` | Model + pricing rationale |
| 3 | `financial-model` | 3-year projections + scenarios |
| 3 | `prototype-spec` | MVP tech stack + features + brand |
| 4 | `gtm-strategy` | Segments + channels + launch plan |
| 4 | `growth-optimization` | Experiment loops + metrics |
| 5 | `investment-readiness` | OKRs + deck + data room audit |
| 5 | `pitch-coaching` | Narrative arc + objection handling |
| 5 | `investor-relations` | Pipeline + outreach planning |
| 6 | `simulation` | 6 persona reactions + 4 risk scenarios |
| 6 | `weekly-metrics` | Burn / runway / alerts |
| 7 | `build-landing-page` | Responsive landing page artifact |
| 7 | `build-pitch-deck` | Sequoia-format deck artifact |
| 7 | `build-one-pager` | Executive summary artifact |
| — | `startup-advisor` | General-purpose advisor (always available) |

`startup-scoring`, `market-research`, `risk-scoring`, `simulation`, and `scientific-validation` are whitelisted for auto-rerun by the heartbeat when they go stale (>14 days). Draft producers (`pitch-coaching`, `prototype-spec`, `gtm-strategy`, `investor-relations`) are excluded — their output needs founder editorial review, not silent refresh.

---

## Architecture

### Storage

- **Supabase Postgres** via `postgres.js` with a custom `?` → `$N` placeholder converter. All access through `query<T>()` / `run()` / `get<T>()` from `@/lib/db`.
- ID convention: `generateId('prefix')` → `prefix_12randomchars` from `@/lib/api-helpers`.
- JSONB fields are returned as objects by postgres.js most of the time, but defensive `safeParse` is in place for the (rare) string case.

### LLM routing

- Task labels (e.g. `chat`, `skill-invoke`, `monitor-agent`, `heartbeat`, `signal-correlator`) map to tiers (`cheap`/`balanced`/`premium`) in `src/lib/llm/router.ts`.
- Defaults: Haiku 4.5 (cheap), Sonnet 4.6 (balanced), Opus 4.7 (premium).
- Set `OPENROUTER_API_KEY` to route through OpenRouter for free tiers / single invoice / +5% markup; else direct Anthropic via `ANTHROPIC_API_KEY`.
- Override per-task tiers at runtime with `LLM_ROUTING_JSON='{"chat":"premium"}'`.

### Cron / heartbeat

`GET /api/cron` runs the daily pipeline:

1. Monitor sweeps → watch sources fetch their categories → alerts emit.
2. Stale-skill check → if any whitelisted analytical skill is >14 days old, `runSkill` reruns it and writes back to `skill_completions`.
3. Brief proposer + correlator → multi-signal narratives synthesized from the alert stream, deduped, surfaced with confidence.
4. Heartbeat narration → memory_event entries that populate **Today**.
5. Stale notification cleanup.

### Design system

- No Tailwind in app code (Tailwind is installed for build infrastructure but isn't used for component styling). Components consume CSS custom properties (`--ink`, `--line`, `--surface`, `--paper`, `--accent`, `--clay`, `--moss`).
- Primitives: `Panel`, `Pill`, `MetricTile`, `StatusBar`, `IconBtn` from `@/components/design/primitives`.
- Chrome: `TopBar` + `NavRail` (4 items: Today / Signals / Knowledge / Co-pilot) + `StatusBar`.
- Monoline SVG icons in `src/components/design/icons.tsx`, referenced as `I.name`.
- Pages are `'use client'` with `use(params)` for Next.js async params.

### API conventions

- Routes return `json({ success: true, data })` / `error(msg, status)` from `@/lib/api-helpers`.
- Project access guarded by `tryProjectAccess(projectId)` from `@/lib/auth/require-project-access`.
- Aggregator endpoints (e.g. `/api/projects/{p}/overview`) batch reads in parallel with per-section try/catch and surface partial failures in `failedSections` rather than 500-ing the whole page.

---

## Project structure

```
src/
  app/
    api/                        # Next.js App Router endpoints
      auth/                     # Supabase session handlers
      chat/                     # Streaming chat with project-scoped tools
      cron/                     # Daily heartbeat (monitors + briefs + stale skills)
      projects/[projectId]/
        overview/               # Knowledge page aggregator (incl. gaps)
        intelligence-briefs/    # Active brief CRUD + save-to-knowledge
        actions/                # Pending action lifecycle
        memory-facts/           # Facts CRUD + state transitions
        ecosystem-alerts/       # Alert listing + state transitions
        watch-sources/          # Watcher CRUD
        ...
    project/[projectId]/
      today/                    # Daily briefing
      signals/                  # Briefs + watchers + alerts
      knowledge/                # The brain — read-only mirror
      chat/                     # Co-pilot
      usage/                    # Cost breakdown
  components/
    inbox/UnifiedInbox.tsx      # Apply / Reject / Apply All
    signals/BriefCard.tsx       # Brief with Save-to-knowledge
    chat/                       # ChatPanel, ContextPanel, artifact renderers
    design/                     # Founder OS primitives + chrome + icons
  lib/
    db.ts                       # Postgres pool + placeholder converter
    api-helpers.ts              # json / error / generateId
    memory/
      facts.ts                  # listFacts / recordFact / state transitions
      events.ts                 # memory_events timeline
      gather-context.ts         # The agent's per-turn context aggregator
      gaps.ts                   # Knowledge-gap computation
    stage-readiness.ts          # 7-stage scoring + next-recommended
    scoring.ts, section-scoring.ts
    stages.ts                   # STAGES + SKILL_KICKOFFS + SKILL_NEXT_STEPS
    skill-tools.ts              # Skills as invocable agent tools
    skill-executor.ts           # Headless runSkill for the cron heartbeat
    project-tools.ts            # get_project_summary, update_idea_canvas, ...
    pi-agent.ts                 # runAgent / runAgentStream wrappers
    llm/router.ts               # Task → tier → provider+model
    cost-meter.ts               # project_budgets accrual + caps
    telemetry.ts                # Langfuse + llm_usage_logs writes
    artifact-persistence.ts     # Routes skill artifacts to domain tables
    ecosystem-monitors.ts       # Seed configure_monitor pending actions
    monitor-dedup.ts            # Hash-based alert dedup
    signal-proposer.ts, signal-correlator.ts  # Brief synthesis pipeline
  hooks/
    useInbox.ts                 # Fan-out inbox state
    useSkillStatus.ts           # Per-skill completion / staleness
    useOpenActionCount.ts       # NavRail inbox badge
launchpad-skills/               # 19 SKILL.md files
db/
  schema.sql                    # Source-of-truth schema
  migrate.ts                    # Apply schema to Supabase Postgres
scripts/
  deploy.sh                     # netlify-cli prod deploy
```

---

## Setup

### Prerequisites

- Node 20+
- A Supabase project (free tier works)
- An LLM provider key: `ANTHROPIC_API_KEY` (direct) or `OPENROUTER_API_KEY` (gateway)
- Optional: Langfuse account for observability, Resend account for Monday Brief email delivery

### Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **Authentication → Providers → Email** → enable magic link.
3. **Authentication → URL Configuration** → add `http://localhost:3000/**` and your production URL to **Redirect URLs**. Set production URL as **Site URL**.
4. Copy `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `DATABASE_URL` (transaction pooler) into `.env.local`.
5. Run `npm run db:migrate` to apply `db/schema.sql`.

### Environment

See `.env.example` for the full list. Required: an LLM key + Supabase URL/anon key + `DATABASE_URL`. Optional: `LANGFUSE_*` for observability, `PI_CACHE_RETENTION` for prompt-cache TTL tuning, `LLM_ROUTING_JSON` to override per-task tiers, `RESEND_API_KEY` for Monday Brief email.

### Running

```bash
npm run dev                          # Dev server (Turbopack HMR)
npm run build                        # Production build
npm run deploy                       # Build locally + upload to Netlify
npm run deploy:preview               # Deploy to a preview URL
```

### Hitting the cron endpoint locally

```bash
curl http://localhost:3000/api/cron
```

In production the cron runs on Netlify scheduled functions (or any external scheduler hitting `/api/cron`).

---

## Conventions worth knowing before contributing

- **No Tailwind in component code.** Inline styles + CSS custom properties.
- **No backwards-compatibility shims.** When a feature ships, the old code is deleted; we don't keep `// removed` comments or shim re-exports.
- **Skills are markdown.** Add a new skill by creating `launchpad-skills/<id>/SKILL.md` with `name` + `description` frontmatter and a body. Register the kickoff in `src/lib/stages.ts`. Add to `STAGES[stage].skills` if it belongs to the 7-stage flow.
- **Project tools are projectId-scoped.** `makeProjectTools(projectId, { includeWriteTools })` closes over the project; the LLM can never read or write another project's data.
- **Write tools require a write-intent verb.** The chat route gates `update_idea_canvas` etc. behind `WRITE_INTENT_PATTERN` (save / persist / commit / record / store / remember / update / write / capture / lock / log / fill in / complete / finalize / canvas / fact). This prevents accidental writes from passive conversation.
- **Gaps are derived, never stored.** When the underlying data appears, the gap disappears automatically on the next read.
- **All writes flow through the unified inbox.** Apply / Reject / Apply All. No silent mutations.

---

## License

Proprietary. Contact m.cecconello@sensefound.io for partnership / licensing.
