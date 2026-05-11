# LaunchPad

Autonomous AI co-founder for early-stage founders — proactive chat, self-driving ecosystem monitors, approval inbox for agent-proposed actions, and a Monday Brief digest - built on PI

## Quick Start

```bash
git clone https://github.com/SenseFoundItaly/LaunchPad-v2.git
cd LaunchPad-v2
cp .env.example .env.local   # Fill in Supabase + LLM keys
npm install
npm run dev                   # http://localhost:3000
```

First login: the app uses Supabase Auth. See the [Supabase setup](#supabase-setup) section below.

## What It Does

- **Proactive chat** grounded in your project memory — the agent remembers decisions, commitments, and preferences across sessions via a structured facts+events layer, not just chat transcripts.
- **Skills as invocable tools** — 11 startup-specific skills (market research, pitch coaching, scoring, investor relations, growth optimization, etc.) the agent can auto-invoke mid-conversation when the founder asks for them.
- **Ecosystem monitors** — scheduled background runs (competitors, market signals, news, IP alerts) that emit structured alerts into the approval inbox.
- **Approval inbox** — every agent-proposed action (outreach draft, workflow step, investor follow-up) lands as a `pending_action` you approve/edit/reject; your rejections feed back as preference signals.
- **HEARTBEAT reflection** — daily self-review where the agent scans memory + pending actions + ecosystem alerts and produces a short summary with a next-step suggestion.
- **Monday Brief** — weekly digest of top pending actions, ecosystem findings, and health summary (in-app + email stub; flip `RESEND_API_KEY` to enable real delivery).
- **Knowledge graph** — D3.js force-directed graph auto-populates from chat; now also retrieved at prompt-build time so the agent can reason over it.
- **Workflow capture** — when the agent proposes a multi-step workflow in chat, each step becomes a pending_action automatically.
- **Cost-aware autonomy** — task-complexity model routing (Haiku/Sonnet/Opus by task), Langfuse observability, per-project monthly budget cap with 80%-warn and hard throttle.

## Tech Stack

- **Next.js 16** (App Router, TypeScript, Turbopack)
- **Supabase Auth** (magic link / OAuth / SSO-ready) with a SQLite shadow-users table for FK targets
- **SQLite** (better-sqlite3, 41 tables) for app data — projects, memory, ecosystem intel, approval inbox, project budgets
- **Pi Agent SDK** ([@mariozechner/pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai) + `@mariozechner/pi-agent-core`) with Anthropic direct for LLM calls
- **Anthropic Claude** (Haiku 4.5 / Sonnet 4.6 / Opus 4.7) — tier-routed per task; OpenRouter swap available via a ~20-line change if needed
- **Langfuse** for LLM observability + per-call cost logging
- **D3.js** for the knowledge graph

## Supabase setup

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Authentication → Providers → **Email** → enable magic link.
3. Authentication → URL Configuration → add both `http://localhost:3000/**` and your production URL to **Redirect URLs**. Keep the production URL as **Site URL**.
4. Copy `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` from Project Settings → API into `.env.local`.
5. Run `npm run backfill:default-user` once after first `npm run dev` to attach any pre-existing projects to a dev user (no-op on empty DBs).

## Project Structure

```
src/
  app/
    api/          # Next.js App Router routes — auth, chat, cron, projects, dashboard,
                  # fundraising, growth, journey, monitors, memory, actions, brief, me
    project/      # Per-project UI (dashboard, chat, actions, workflow, intelligence, org, readiness)
    login/        # Magic-link sign-in page
    onboard/      # Partner onboarding (Forge / VS / incubator white-label prework)
  components/
    chat/         # ChatPanel + artifact renderers + copy/retry message actions
    dashboard/    # MonitorCard, SignalTimeline, DashboardOverviewStrip
    design/       # Founder OS design system primitives + chrome
    graph/        # KnowledgeGraph + NodeDetailPanel
    layout/       # AppHeader, NavRail, ProjectSidebar
  hooks/          # useChat, useProject, useKnowledgeGraph, useTaskPolling
  lib/
    auth/         # Supabase server + browser clients, requireUser() shadow-upsert
    db/           # SQLite connection + schema init
    llm/          # OpenAI + Anthropic legacy client + task-complexity router
    memory/       # facts.ts, events.ts, context.ts (buildMemoryContext)
    pi-agent.ts, pi-tools.ts, project-tools.ts, skill-tools.ts
    cost-meter.ts # project_budgets accrual, 80% warn, hard cap throttle
    agent-prompt.ts       # SOUL/AGENTS/HEARTBEAT composition (locale-aware)
    artifact-parser.ts    # Parses :::artifact{} blocks from agent responses
    ecosystem-monitors.ts, ecosystem-alert-parser.ts
    pending-actions.ts, action-executors.ts
    workflow-capture.ts   # Chat-proposed workflows → pending_actions
    email.ts              # Monday Brief template + Resend stub
    telemetry.ts          # Langfuse + llm_usage_logs pricing table
  middleware.ts           # Supabase session refresh + /login redirect
  types/                  # Artifact + domain type unions
agents/                   # SOUL.md + AGENTS.md + HEARTBEAT.md (EN + IT)
launchpad-skills/         # 11 SKILL.md files — invocable as agent tools
db/schema.sql             # 41 tables: projects, memory_facts, memory_events,
                          # ecosystem_alerts, pending_actions, project_budgets,
                          # workflow_plans, partner_configs, users/orgs, ...
scripts/
  backfill-default-user.cjs  # One-shot: attach pre-auth projects to a dev user
```

## Environment variables

See `.env.example` for the full list. Required: `ANTHROPIC_API_KEY` + (`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Optional: `LANGFUSE_*` for observability, `PI_CACHE_RETENTION` for prompt-cache TTL tuning, `LLM_ROUTING_JSON` to override per-task tiers at runtime, `RESEND_API_KEY` to enable real Monday Brief email delivery.
