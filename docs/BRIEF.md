# LaunchPad (SenseFound) — Complete Platform Brief

## What LaunchPad Is

LaunchPad is an **AI-native startup operating system** — a co-pilot that walks founders through the entire lifecycle of building a startup, from raw idea to operating company. It combines a structured 7-stage validation pipeline with an autonomous intelligence layer that monitors the ecosystem, surfaces risks, and proposes actions — even when the founder isn't actively using the product.

The core thesis: **most startups fail from building the wrong thing, not from building it badly.** LaunchPad exists to compress the validation cycle — the time between "I have an idea" and "I know whether this idea has legs" — from months to days, while building a compounding intelligence repository that becomes more valuable over time.

The product is **not** a chatbot. It's a structured operating environment where the AI agent has persistent memory, tools, a knowledge graph, and scheduled background processes. The chat interface is the primary interaction surface, but the system works between sessions too.

---

## Architecture Overview

**Stack:** Next.js (App Router) → Supabase (PostgreSQL) → Anthropic Claude (Sonnet/Haiku) via a custom agent SDK (`pi-agent.ts`)

**Agent system:** A custom agentic runtime (`runAgentStream`) that:
- Loads a personality (SOUL.md) and operating rules (AGENTS.md) into the system prompt
- Injects per-user/per-project memory context (facts, events, risks, graph, tasks, briefs)
- Provides 13 project-scoped tools + 3 base tools + skill tools
- Streams responses with inline artifacts (rich cards, charts, tables rendered client-side)
- Persists conversation history as JSONL sessions with a sliding window (12 messages max)
- Enforces a hard cap of 4 tool calls per turn to prevent cost runaway

**Cost governance:**
- Per-project monthly budget caps (default $5.00/month)
- Credit system (500 credits = ~131 messages at current pricing)
- Haiku routing for simple follow-ups (~80% cheaper)
- Prompt caching via `ANTHROPIC_CACHE_CONTROL=true`
- Lazy-loading write tools on read-only turns
- LLM usage logged to `llm_usage_logs` with full token/cost telemetry

---

## The 7-Stage Validation Pipeline

This is the core product. A founder creates a project, and LaunchPad guides them through 7 stages — each with 2-6 skills. Skills are structured AI workflows that produce typed artifacts (idea canvases, scores, research reports, financial models, etc.) persisted to the database.

The pipeline is **not linear** — founders can run skills in any order, but the system tracks readiness per stage (0-10 score with GO/CAUTION/NOT READY verdicts) and always recommends the next highest-impact skill.

### Stage 1: Idea Validation
- **Idea Canvas** (`idea-shaping`): Structures the raw idea into a Lean Canvas — problem, solution, target market, business model, competitive advantage, value proposition, unfair advantage, key metrics, revenue streams, cost structure. Stored in `idea_canvas` table.
- **Startup Score** (`startup-scoring`): Evaluates the idea across 6 dimensions and produces an overall 0-10 score with specific ratings per dimension. Stored in `scores` table. This score becomes a persistent benchmark referenced by every subsequent skill.

### Stage 2: Market Validation
- **Market Research** (`market-research`): TAM/SAM/SOM sizing, competitor landscape, trend analysis, case studies, key insights. All sourced and cited. Stored in `research` table.
- **Simulation** (`simulation`): Runs 6 persona reactions (2 customers, 2 investors, 1 expert, 1 competitor) and 4 risk scenarios. Produces market reception summary and investor sentiment. Stored in `simulation` table.

### Stage 3: Persona Validation
- **Buyer Personas** (`scientific-validation`): Detailed buyer personas with empathy maps, Jobs-to-be-Done analysis.
- **Risk Audit** (`risk-scoring`): Comprehensive risk audit across technical, market, regulatory, team, and financial dimensions. Each risk has probability, impact, early warning signals. These risks become the anchors for the monitor system — every ecosystem monitor is tied to a specific named risk.

### Stage 4: Business Model
- **Business Model** (`business-model`): Evaluates and scores business model options. Pricing strategies, revenue models, unit economics.
- **Financial Model** (`financial-model`): 3-year projections with scenario analysis (base/optimistic/pessimistic). Stored in `workflow` table under `financial_model` key.

### Stage 5: Build & Launch
- **MVP Spec** (`prototype-spec`): Tech stack, core features, brand identity, build timeline.
- **GTM Strategy** (`gtm-strategy`): Target segments, channels, pricing, launch plan.
- **Growth Loops** (`growth-optimization`): Sets up growth experiment loops to improve specific metrics. These are persistent — tracked in `growth_loops` and `growth_iterations` tables. Each loop has a hypothesis, proposed changes, baseline value, and accumulated learnings.
- **Landing Page** (`build-landing-page`): Generates a responsive landing page based on validated project data. Full HTML/CSS output stored as a build artifact.
- **Pitch Deck** (`build-pitch-deck`): Sequoia-format investor pitch deck generated from project data.
- **One-Pager** (`build-one-pager`): Concise executive summary for investor outreach.

### Stage 6: Fundraise
- **Investment Readiness** (`investment-readiness`): Assesses fundraising readiness — OKRs, deck, data room, gaps to close.
- **Pitch Coaching** (`pitch-coaching`): Narrative arc, key slides, objection handling. Versioned in `pitch_versions` table.
- **Investor Pipeline** (`investor-relations`): CRM for investor tracking. Investors move through stages (target → reached_out → meeting → dd → term_sheet → closed). Each has interactions, next steps, check sizes. Fundraising rounds tracked with targets, valuations, instruments.

### Stage 7: Operate
- **Weekly Metrics** (`weekly-metrics`): KPI tracking, WoW growth rates, burn rate, runway, health alerts. Stored in `metrics` / `metric_entries` / `burn_rate` tables.
- **Dashboard**: Single-pane-of-glass (greeting, metric tiles with sparklines, heartbeat activity, approval inbox preview, graph preview, milestones, budget usage).
- **Journey**: Milestones and startup updates — weekly morale, metrics snapshots, highlights/challenges.

### Readiness Scoring

Each stage gets a 0-10 score based on skill completion:
- **8+** = STRONG GO
- **6-8** = GO
- **4-6** = CAUTION
- **0-4** = NOT READY

The overall score is weighted across all 7 stages. Staleness is tracked — skills completed >14 days ago are marked stale and eligible for automatic re-run by the heartbeat.

The system always computes a `next_recommended_skill` — the first missing skill from the lowest-numbered stage that hasn't reached GO. This drives the conversation: the agent pushes this skill until the stage clears.

---

## The Intelligence Layer

This is the autonomous half of the product — it works **between founder sessions** to build a compounding intelligence repository.

### Ecosystem Monitors
Scheduled background checks tied to specific risks from the risk audit. Four types:
- `ecosystem.competitors` — competitor activity (product launches, funding, hires, pricing changes)
- `ecosystem.ip` — intellectual property alerts (patents, trademarks)
- `ecosystem.trends` — market trends, regulatory changes
- `ecosystem.partnerships` — partnership and acquisition signals

Each monitor has:
- A `linked_risk_id` connecting it to a specific risk from the risk audit
- A schedule (daily/weekly/manual)
- A dedup hash to prevent duplicate alerts
- Config for URLs to track, keywords, etc.

Monitors run via the cron endpoint (`/api/cron`), emit structured `ecosystem_alert` artifacts, which are parsed and persisted into the `ecosystem_alerts` table.

### Ecosystem Alerts (Signal Feed)
Each alert has:
- `relevance_score` (0-1) — how relevant to this specific startup
- `confidence` (0-1) — how confident the signal is real
- `reviewed_state` — pending / reviewed / dismissed
- `graph_node_id` — link to knowledge graph entity

Alerts with `relevance_score >= 0.8` automatically generate `pending_actions` (capped at 5 per weekly run to prevent inbox fatigue).

### Watch Sources (URL Change Detection)
Founders can track specific URLs for content changes:
- Competitor pricing pages
- Job boards
- Product pages
- Regulatory sites

The system scrapes these on schedule, diffs content, classifies significance (`noise` / `minor` / `moderate` / `major`), and generates ecosystem alerts for significant changes. Stored in `watch_sources` and `source_changes` tables.

### Intelligence Briefs (Cross-Signal Correlation)
The correlation engine (`intelligence-correlator.ts`) runs weekly per project:
1. Groups recent signals by entity
2. Identifies patterns across signals (e.g., "competitor X raised funding AND launched new feature AND is hiring aggressively — likely entering your market segment")
3. Synthesizes strategic narratives with temporal predictions
4. Produces `intelligence_briefs` with recommended actions (urgency: low/medium/high/critical)
5. Old briefs expire after 7 days

Briefs are surfaced in:
- Memory context (top 3 active briefs with urgent actions)
- Conversation opener (high-urgency briefs lead the opening)
- Signals dashboard sidebar
- Monday Brief email

### Competitor Profiles
Per-competitor intelligence dossiers aggregated from signals. Each profile tracks:
- Signal counts by category
- Trend direction (stable/rising/declining)
- Latest intelligence brief
- All signals linked to this competitor

### Knowledge Graph
A living entity-relationship graph that grows between sessions:
- **Nodes**: your_startup, competitor, market_segment, technology, trend, partner, ip_alert
- **Edges**: relationships between entities with weights
- Each ecosystem alert above relevance 0.6 creates/updates graph nodes
- Visualized as an interactive SVG canvas on the Intelligence page

---

## The Approval Inbox (Pending Actions)

Everything the AI wants to do externally goes through founder approval. The `pending_actions` table is the central inbox, organized into 3 lanes:

### TODOs Lane
Tasks the founder should do. Created by:
- The chat agent via `create_task` tool
- The heartbeat via `proposeHeartbeatTasks` (up to 3/day)
- Skill completion follow-ups

### Approvals Lane
Drafts and proposals requiring founder sign-off:
- Emails (`queue_draft_for_approval`)
- Monitor proposals (`propose_monitor`)
- Budget changes (`propose_budget_change`)
- Watch source proposals (`propose_watch_source`)
- Skill rerun results from heartbeat

### Notifications Lane
Informational items auto-dismissed after 7 days:
- Ecosystem alert notifications
- Skill completion notifications
- System notifications

Each pending action has a state machine: `pending` → `edited` → `approved` → `sent` (executed) or `rejected`.

The inbox renders as a Linear-style ticket table with agent attribution (Scout, Chief, Analyst, Outreach, Designer, Architect — derived from action_type).

---

## The Heartbeat (Autonomous Daily Cycle)

A cron-triggered (`/api/cron`, every 15 minutes) background process that runs once per project per 24 hours. The full cycle:

1. **Run due monitors** — ecosystem scans that are past their next_run timestamp
2. **Process watch sources** — scrape URLs, diff content, generate alerts (up to 10 per tick)
3. **Cross-signal correlation** — synthesize intelligence briefs from recent signals, expire old ones
4. **Heartbeat reflection** — LLM generates a 120-250 word summary of what changed, what to prioritize, what risks are emerging. Uses the project's full memory context.
5. **Task proposal** — LLM proposes up to 3 high-impact tasks based on the reflection + signals + risks
6. **Stale skill refresh** — automatically re-runs ONE skill that's >14 days old (capped at 1/day for cost)
7. **Monday Brief email** — sends the weekly digest via Resend (or stubs in dev)
8. **Auto-dismiss stale notifications** — notification-lane items >7 days old are auto-rejected

The heartbeat is cost-gated:
- Budget cap check before each LLM call
- Credit check before task proposals and skill reruns
- Observe mode when over budget (logs but doesn't hard-block critical operations)
- Auto-pause ecosystem monitors when spend exceeds cap

---

## Memory System

Persistent per-user-per-project memory that survives across chat sessions:

### Facts (`memory_facts`)
Curated observations about the founder and project:
- Kind: `fact`, `decision`, `observation`, `preference`, `note`
- Confidence score (0-1)
- Source tracking (which conversation, skill, or event produced this fact)
- Dismissable by founder

### Events (`memory_events`)
Timeline of what happened:
- `chat_turn` — conversation happened
- `skill_invoked` — skill was run
- `monitor_alert` — monitor produced an alert
- `heartbeat_reflection` — daily reflection completed
- `task_proposed` — heartbeat proposed a task
- `fact_recorded` — new fact captured

### Memory Context Builder
`buildMemoryContext()` assembles all of this into a structured block prepended to the system prompt:
1. Project snapshot (name, stage, step, locale)
2. Latest score (overall/10 with recommendation)
3. Curated facts (up to 20, with confidence badges)
4. Recent activity timeline (up to 15 events)
5. Founder inbox (pending approvals)
6. Open tasks
7. Active intelligence briefs (top 3 with urgent actions highlighted)
8. Top risks from risk audit (sorted by severity = probability x impact)
9. Knowledge graph summary (node type counts + top weighted relationships)
10. Completed skills

This context block is what makes the agent personalized — it has full situational awareness of everything that happened, what the founder committed to, what risks exist, and what the ecosystem is doing.

---

## Chat System (The Primary Interface)

### Agent Personality (SOUL.md)
The agent is "an experienced startup advisor who has seen thousands of startups." Key traits:
- **Direct and honest** — tells founders what they need to hear, not what they want to hear
- **Data-driven** — every claim must carry a source (URL, skill run, project data, or founder quote)
- **Challenging but encouraging** — pushes back on untested assumptions
- **Practical** — every piece of advice ends with a specific next step
- **Calm under pressure** — provides perspective when founders panic

### Artifact System
The agent renders rich inline content via `:::artifact{}` blocks:
- `insight-card` — key findings with sources
- `metric-grid` — KPI tables
- `comparison-table` — side-by-side comparisons
- `entity-card` — competitor/entity profiles
- `gauge-chart` / `radar-chart` / `bar-chart` / `pie-chart` — data visualizations
- `score-card` — scoring results
- `fact` — captured observations
- `option-set` — interactive choice buttons for the founder
- `solve-progress` — skill execution progress tracking
- `task-card` — inline task approval cards
- `monitor-card` — monitor proposal approval cards
- `budget-card` — budget change approval cards
- `watch-source-card` — watch source proposal cards

Every factual artifact MUST include a non-empty `sources` array. This is enforced at the prompt level.

### Skill Execution Flow
When a skill runs in chat:
1. Agent calls `get_project_summary` to check readiness
2. Identifies the right skill (via `next_recommended_skill` or classifier)
3. Runs the skill conversation (structured prompt from `STEP_SYSTEM_PROMPTS`)
4. Produces typed artifacts that are parsed (`artifact-parser.ts`) and persisted (`artifact-persistence.ts`)
5. Records skill completion in `skill_completions`
6. Advances project step if all skills in current stage are complete
7. Shows next recommended steps via `SKILL_NEXT_STEPS`

### Conversation Cost Management
- **Haiku routing**: Simple follow-ups ("yes", "go ahead") route to Haiku (~80% cheaper)
- **Skill relevance classifier**: Haiku call picks top-3 relevant skills from full manifest (skipped for simple follow-ups)
- **Write tool lazy-loading**: Write tools excluded when message has no write intent
- **Max tool calls**: Hard cap at 4 per turn
- **Sliding window**: History capped at 12 messages to prevent unbounded token growth
- **Prompt caching**: Anthropic cache control enabled for static prompt prefixes

---

## Frontend Surfaces

### Primary Navigation (NavRail)
4 primary + 3 secondary routes:
- **Dashboard** (`/dashboard`) — single-pane-of-glass: greeting, metric tiles, heartbeat feed, inbox preview, graph mini, milestones, budget
- **Chat** (`/chat`) — main conversation interface with context panel sidebar
- **Signals** (`/signals`) — intelligence feed table + watch source management
- **Inbox** (`/actions`) — Linear-style ticket table with 3-lane tabs (TODOs / Approvals / Notifications)
- **Intelligence** (`/intelligence`) — full-canvas knowledge graph with filters and node detail
- **Workflow** (`/workflow`) — workflow plans and execution
- **Fundraising** (`/fundraising`) — investor CRM, pipeline, term sheets

### Other Pages
- **Readiness** (`/readiness`) — 7-stage radar chart with per-skill completion status
- **Research** (`/research`) — market research results viewer
- **Scoring** (`/scoring`) — startup score dimension breakdown
- **Simulation** (`/simulation`) — persona reactions and risk scenarios
- **Growth** (`/growth`) — growth loop management
- **Journey** (`/journey`) — milestones and startup updates
- **Usage** (`/usage`) — LLM cost breakdown by step/skill
- **Brief** (`/brief`) — Monday Brief viewer
- **Assets** (`/assets`) — generated deliverables (landing pages, decks, one-pagers)
- **Org** (`/org`) — organization and team management

### Onboarding
- `/login` — Supabase auth
- `/onboard/[partnerSlug]` — partner-branded onboarding flow

---

## The Data Model (40+ Tables)

### Core
- `users` / `organizations` / `memberships` — auth & org structure
- `projects` — the central entity (name, step, status, locale, partner_slug)
- `partner_configs` — white-label partner configurations

### Validation Pipeline
- `idea_canvas` — Lean Canvas fields
- `scores` — overall score + dimension breakdown
- `research` — market sizing, competitors, trends
- `simulation` — personas, risk scenarios, market reception
- `workflow` — GTM strategy, pitch deck, financial model, roadmap
- `skill_completions` — tracks which skills have been run and when

### Intelligence
- `monitors` — scheduled background checks with linked risks
- `monitor_runs` — execution audit trail
- `ecosystem_alerts` — signal feed with relevance/confidence scoring
- `watch_sources` — URL change detection configuration
- `source_changes` — detected content diffs
- `intelligence_briefs` — cross-signal correlation synthesis
- `competitor_profiles` — per-competitor intelligence dossiers
- `graph_nodes` / `graph_edges` — knowledge graph
- `signal_activity_logs` — audit trail for the signal pipeline

### Founder Inbox
- `pending_actions` — approval inbox (tasks, drafts, monitor proposals, budget changes, etc.)

### Operations
- `metrics` / `metric_entries` — KPI tracking
- `burn_rate` — monthly burn and cash on hand
- `alerts` — system alerts
- `growth_loops` / `growth_iterations` — growth experiment tracking
- `milestones` — journey milestones
- `startup_updates` — weekly update snapshots

### Fundraising
- `investors` / `investor_interactions` — investor CRM
- `fundraising_rounds` — round configuration
- `pitch_versions` — versioned pitch decks
- `term_sheets` — term sheet tracking and analysis

### System
- `chat_messages` — conversation persistence
- `llm_usage_logs` — cost telemetry
- `project_budgets` — per-project monthly spend caps
- `memory_facts` / `memory_events` — persistent memory
- `tools` — tool registry
- `drafts` / `draft_versions` — versioned content artifacts
- `tool_executions` — task queue
- `workflow_plans` — multi-step execution chains
- `published_assets` — deployed deliverables
- `build_artifacts` — generated content (landing pages, decks, one-pagers)
- `cron_runs` — cron execution audit trail

---

## Key Flows (End-to-End)

### Flow 1: New Founder Creates a Project
1. Founder signs up via Supabase Auth at `/login`, user record created
2. Creates project with name + description. `projects` row + `project_budgets` row (default $5/mo cap) inserted
3. First chat message triggers Tier 1.5 opener (new project path):
   - Agent calls `get_project_summary`, sees empty project
   - If description has enough signal, destructures the idea immediately, asks founder to confirm
   - If vague, asks 2-3 focused questions
4. Agent guides toward first skill: Idea Canvas
5. Skill runs. `idea_canvas` + `skill_completions` rows created
6. Stage 1 score updates. Agent recommends Startup Scoring next
7. Founder works through stages at their own pace

### Flow 2: Returning Founder Opens Chat
1. Chat loads, POST `/api/chat` fires
2. Session history loaded from JSONL, capped at 12 messages via sliding window
3. Memory context built (facts, events, risks, graph, tasks, briefs)
4. Tier 1 opener: `get_project_summary` called (single tool call, not three)
5. Agent checks for urgent intelligence (high-urgency briefs, hot signals >= 0.9)
   - If urgent: leads with intelligence, frames with Three-Question Protocol
   - If quiet: opens with validation flow (stage readiness, next skill)
6. Founder can chat freely, trigger skills, or review inbox items

### Flow 3: The Heartbeat Runs (Founder Not Present)
1. Cron fires every 15 minutes
2. Checks which monitors are due, runs them sequentially
3. Processes watch source scrapes, diffs content, generates alerts
4. Runs cross-signal correlation, synthesizes intelligence briefs
5. For each active project (once per 24h):
   - Computes score delta (yesterday vs today)
   - Generates heartbeat reflection (120-250 words)
   - Proposes up to 3 tasks
   - Refreshes 1 stale skill if credits allow
   - Sends Monday Brief email (or stubs)
6. Auto-dismisses stale notifications (>7 days)
7. All results logged to `cron_runs` for audit

### Flow 4: Ecosystem Alert to Founder Action
1. Monitor runs, detects competitor raised funding
2. Alert persisted to `ecosystem_alerts` with relevance 0.85, confidence 0.9
3. Above 0.8 threshold: `pending_action` auto-created (approval lane)
4. Knowledge graph updated: competitor node gets new edge
5. Correlation engine picks it up, synthesizes intelligence brief linking this funding to the founder's market expansion risk
6. Next chat: agent surfaces the brief in the opener: "Your competitor just raised $10M. This connects to your market expansion risk — here's what to consider."
7. Founder reviews pending action in inbox: approves, edits, or dismisses

### Flow 5: Growth Experiment Cycle
1. Founder activates Growth Loops skill, defines a metric to optimize
2. System creates `growth_loop`, proposes first hypothesis
3. Founder implements, marks "testing"
4. Heartbeat checks testing loops >7 days, prompts for results
5. Founder inputs results, system calculates improvement
6. If positive: learnings accumulated, next hypothesis proposed
7. If negative: learnings recorded, alternative approach suggested
8. Accumulated learnings compound — each subsequent hypothesis is informed by all prior experiments

### Flow 6: Fundraising Pipeline
1. Investment Readiness skill assesses gaps
2. Pitch Coaching refines the narrative
3. Build skills generate pitch deck + one-pager
4. Investor Relations skill builds target list
5. Investors tracked through stages with interaction history
6. Heartbeat flags overdue follow-ups
7. Term sheets tracked and analyzed
8. Fundraising round configuration (target amount, valuation cap, instrument)

---

## Dev Roadmap Status (Cross-Referenced May 2026)

This section maps the business proposal dev roadmap against the actual codebase. Each item is verified against source files.

### S1 — Platform OS

#### 1.1 Layer 1 Intelligence — ✅ 100% Complete

| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | Viability scoring (idea scoring) | ✅ Done | `startup-scoring` skill + `scores` table + `scoring.ts` |
| 2 | Risk analysis by category | ✅ Done | `risk-scoring` skill with 5 risk categories |
| 3 | Strategic suggestions prioritized | ✅ Done | `next_recommended_skill` + heartbeat task proposals |
| 4 | Cumulative repository (knowledge base) | ✅ Done | `memory_facts` + `memory_events` + `buildMemoryContext()` in `context.ts` |
| 5 | Smart control panel (dashboard signals) | ✅ Done | `/dashboard` page + `/signals` page + `ecosystem_alerts` table |
| 6 | Knowledge graph human-in-the-loop | ✅ Done | `graph_nodes`/`graph_edges` tables + `/intelligence` page + `memory_facts` for notes |
| 7 | Global startup intelligence (automated) | ✅ Done | Heartbeat cron (`/api/cron`), monitors, watch sources, intelligence briefs, correlator |
| 8 | AI Mentor (contextual agent) | ✅ Done | Full chat agent with SOUL.md + AGENTS.md + 10-section memory context + 16 tools |

#### 1.2 Base Infrastructure — ~90% Complete

| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | UX/UI responsive (web-first) | ✅ Done | Next.js App Router with 20+ pages, NavRail, responsive components |
| 2 | Auth system (auth, profiles, roles) | ✅ Done | Supabase Auth + `users`/`organizations`/`memberships` tables + `/login` |
| 3 | Memory layer (persistence per user) | ✅ Done | `memory_facts` + `memory_events` + `buildMemoryContext()` |
| 4 | Cloud infrastructure + deploy pipeline | ✅ Done | Next.js + Supabase + Vercel deploy |
| 5 | Output export (PDF, markdown, JSON) | ⚠️ Partial | JSON artifacts + HTML landing page generation exist. **PDF export missing** — no PDF library in `package.json` |
| 6 | Dashboard utente | ✅ Done | `/dashboard` with greeting, metric tiles, sparklines, heartbeat feed, inbox preview, graph mini, milestones, budget |

#### 1.3 The Forge Integration (First Block) — ~25% Complete

| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | Dashboard admin The Forge | ⚠️ Partial | `partner_configs` table + `/api/partner-configs/[slug]` route (read-only). No admin UI. |
| 2 | User management (invites, mentor 1:1) | ⚠️ Partial | `memberships` table exists. No invite flow or mentor assignment. |
| 3 | Aggregate view (anonymized, real-time) | ❌ Not built | No portfolio/aggregate view exists |
| 4 | Export report per founder (PDF/CSV) | ❌ Not built | Depends on PDF export |
| 5 | Onboarding self-service (<10 min) | ⚠️ Partial | `/onboard/[partnerSlug]` route exists. Wizard needs completion. |
| 6 | Co-branded onboarding | ⚠️ Partial | Partner slug + brand config in `partner_configs`. Visual branding partial. |
| 7 | Pre-loaded templates (Forge methodology) | ❌ Not built | `knowledge_seed` field exists in `partner_configs` but no template content |
| 8 | Auto-notification to mentor | ❌ Not built | No notification system to external mentors |
| 9 | Layer 1 pre-configured with Forge method | ⚠️ Partial | `preferred_skills` + `knowledge_seed` in partner_configs. Needs Forge-specific content. |

**Blocked items:** #3, #4 deferred to S2. Items #7, #9 require content from The Forge team.

#### 1.4 Pricing & Billing — ~15% Complete

| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | Paywall & upgrade flow | ❌ Not built | Budget system exists but no paywall UI |
| 2 | Seat management (Team S/M) | ⚠️ Partial | `memberships` table exists. No seat-based plans. |
| 3 | Billing integration (Stripe) | ❌ Not built | No Stripe library in `package.json` |
| 4 | Credit asset generation counter | ⚠️ Partial | `credits.ts` fully implemented (credit tracking, `CreditsBadge.tsx`). No purchase flow. |
| 5 | Trial 14d trigger for active free users | ❌ Not built | No trial logic |

#### 1.5 Layer 2 Iteration (Workflow Skills) — ~70% Complete

| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | Idea pre-validation with scoring | ✅ Done | `idea-shaping` + `startup-scoring` skills with full SKILL.md |
| 2 | Hypothesis canvas & assumption mapping | ✅ Done | `idea_canvas` table + idea-shaping skill |
| 3 | Synthetic validation (buyer personas) | ✅ Done | `simulation` skill (6 persona reactions) + `scientific-validation` skill |
| 4 | Real market validation framework | ⚠️ Partial | `market-research` skill exists. No structured interview CRM/tracker. |
| 5 | Outreach automation (scraper + CRM) | ⚠️ Partial | `investor-relations` skill exists. No lead scraper or email sequences for customer outreach. |
| 6 | Asset generation: BMC + pricing + brand | ✅ Done | `business-model` + `prototype-spec` (brand identity section) skills |
| 7 | Asset generation: financial + pitch | ✅ Done | `financial-model` + `build-pitch-deck` + `build-one-pager` skills |
| 8 | MVP canvas & tech roadmap | ✅ Done | `prototype-spec` skill covers this fully |
| 9 | Brief for Frontier Lab / TechBricks | ❌ Not built | TechBricks integration not started — defer to S3 |
| 10 | GTM plan generator | ✅ Done | `gtm-strategy` skill with full SKILL.md |
| 11 | Outreach multichannel orchestrated | ❌ Not built | No orchestrated outreach system — defer |

#### 1.6 The Forge Integration (Second Block) — ~20% Complete

| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | Guided unlock (step progression) | ⚠️ Partial | Stage readiness scoring exists. No per-user unlock logic tied to partner. |
| 2 | AI Mentor contextualized | ✅ Done | Agent already uses full memory context per-project |
| 3 | Event-driven notifications | ⚠️ Partial | Heartbeat proposes tasks. No inactivity >3d trigger or step-completion notifications. |
| 4 | Mentor access to founder repo | ❌ Not built | No mentor view of founder data |
| 5 | NPS survey per step | ❌ Not built | Use 3rd-party (Typeform/Tally embed) |
| 6 | Rolling metrics dashboard (internal) | ⚠️ Partial | `llm_usage_logs` + usage page exists. No activation rate / dropout tracking. |

#### 1.5b Sandbox GTM (Bohm) — ⚠️ Blocked Until Bohm Alignment

| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | Synthetic buyer personas | ✅ Done | `simulation` skill generates personas + `scientific-validation` |
| 2 | Message response simulation | ✅ Done | Simulation skill produces persona reactions with scores |
| 3 | A/B test on synthetic audiences | ❌ Not built | No A/B framework — defer (blocked) |
| 4 | Simulation results dashboard | ✅ Done | `/simulation` page exists |
| 5 | White label for Bohm | ⚠️ Partial | `partner_configs` infrastructure exists. Bohm config not created. |
| 6 | Public API for Sandbox | ❌ Not built | No public API layer — defer (blocked) |

---

### S2 — Versioning B2B (Q4 2026) — Deferred

All items not built. Building blocks exist (`partner_configs`, `investment-readiness` skill, `investors`/`investor_interactions` tables). Depends on S1.6 completion. Design `partner_configs` generically now for forward compatibility.

### S3 — Core OS + CVB (Q4 2026 – Q1 2027) — 50% of Optimizations Done

| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | LLM routing (dynamic model selection) | ✅ Done | Haiku routing in `skill-relevance.ts`, `pickModel()` in `pi-agent.ts` |
| 2 | Memory layer scaling (>1000 users) | Deferred | Current implementation works; optimize when needed |
| 3 | A/B testing framework | ❌ Not built | No libraries or infrastructure |
| 4 | API cost monitoring per user | ✅ Done | `llm_usage_logs` + `project_budgets` + budget cap checks in cron |
| 5 | CVB Enterprise (all items) | ❌ Not built | Defer to 2027 |

### S4 — Cluster + Deeptech & S5 — Growth Stage — Deferred

All items not built and scheduled for 2027.

---

### Build Priority Queue

#### P0 — Before The Forge Launch (May 22 Deadline)

1. **PDF export** — Add PDF generation from skill artifacts. Unblocks 1.2.5 and future report exports.
   - New: `src/lib/pdf-export.ts`, PDF export API endpoint
2. **Partner admin write routes** — Upgrade `/api/partner-configs/[slug]` from read-only to CRUD. Add admin UI page.
   - Update: `src/app/api/partner-configs/[slug]/route.ts`, new admin page
3. **Onboarding wizard completion** — Complete self-service onboarding at `/onboard/[partnerSlug]` end-to-end.
   - Update: `src/app/onboard/` pages

#### P1 — High Priority (Before June 14)

4. **Stripe billing integration** — Add `stripe` package, billing API routes, paywall/upgrade UI.
5. **Credit purchase flow** — Connect existing `credits.ts` to Stripe for credit top-ups.
6. **Invite flow for team/mentor** — Build on `memberships` table to support invite links and mentor assignment.

#### P2 — Important (June–July)

7. **Event-driven notifications** — Inactivity triggers (>3d), step completion alerts, mentor notifications via Resend.
8. **Outreach automation foundation** — Basic email sequence support for customer validation interviews.

### Deferred / Removed

- **S2 Versioning B2B** — All items. Q4 2026, depends on S1 completion.
- **S3.2 CVB Enterprise** — 2027.
- **S4 Cluster + Deeptech** — 2027.
- **S5 Growth Stage** — Q4 2027.
- **Bohm Sandbox specifics** (A/B testing, public API, white label) — Blocked until Bohm alignment.
- **TechBricks integration** — No contract defined.
- **NPS/Survey system** — Use 3rd-party embed (Typeform/Tally).
- **Aggregate founder view** — Defer to S2 multi-project portfolio.

---

## Localization

The platform supports English and Italian (locale stored per-project). Agent personality files have `.it.md` variants (SOUL.it.md, AGENTS.it.md, HEARTBEAT.it.md). The system prompt builder selects the right locale files. Skill kickoffs have Italian-localized messages.

---

## Cost Model

At current Sonnet pricing ($3/M input, $15/M output):
- Average chat turn: ~$0.03-0.05 (reduced from ~$0.05-0.10 via recent optimizations)
- Conversation opener: ~$0.03 (reduced from ~$0.10 via consolidated tool calls)
- Heartbeat reflection: ~$0.02-0.04
- Monitor run: ~$0.03-0.05
- Skill rerun: ~$0.10-0.25
- Default cap: $5.00/month (~131 messages + background intelligence)

---

## Summary

LaunchPad is a three-layer product:

1. **Validation Pipeline** (7 stages, 19 skills) — structured AI workflows that produce typed artifacts, scored against a readiness framework, with contextual next-step recommendations.

2. **Intelligence Layer** (monitors, alerts, watch sources, correlation, knowledge graph) — an autonomous system that watches the ecosystem between sessions, synthesizes patterns, and surfaces actionable intelligence with risk-to-signal mapping.

3. **Operating System** (inbox, tasks, metrics, growth loops, fundraising CRM, budget governance) — the day-to-day tools a founder needs to run their startup, with AI-proposed actions flowing through a human-approval gate.

The moat is **compounding context**: every conversation, every skill run, every signal, every decision — all accumulate in the memory system and knowledge graph, making the co-pilot more useful over time. The longer a founder uses LaunchPad, the harder it is to replicate that context elsewhere.
