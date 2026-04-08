# LaunchPad

Startup OS with proactive AI advisor, knowledge graph, and workflow automation.

## Quick Start

```bash
git clone https://github.com/openmaiku/LaunchPad.git
cd LaunchPad
cp .env.example .env.local   # Add your API keys
npm install
npm run dev                   # http://localhost:3000
```

## What It Does

- **Proactive AI Chat** -- challenges assumptions, maps competitors, suggests next steps
- **Knowledge Graph** -- D3.js force-directed graph auto-populates from chat (competitors, markets, technologies, risks)
- **Inline Artifacts** -- clickable option cards, entity cards, insight cards, workflow cards, comparison tables
- **Workflows** -- captures actionable multi-step tasks from chat, trigger execution with one click
- **Intelligent Sidebar** -- auto-switches between Intelligence graph, Workflows, Metrics, Pipeline

## OpenClaw Integration (Optional)

If [OpenClaw](https://github.com/openclaw/openclaw) is installed, LaunchPad routes chat through the Gateway for:
- Web browsing and search tools
- Session memory across conversations
- Multi-channel messaging (WhatsApp, Slack, Telegram)
- 55+ skills including 8 LaunchPad-specific skills

```bash
npm i -g openclaw
openclaw setup              # Configure API keys
# LaunchPad auto-detects and uses the Gateway
```

Without OpenClaw, chat falls back to direct OpenAI/Anthropic API calls.

## Tech Stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS)
- **SQLite** (better-sqlite3, 22 tables)
- **D3.js** (force-directed knowledge graph)
- **OpenAI + Anthropic** (dual LLM support)
- **OpenClaw** (optional, for tools + multi-channel)

## Project Structure

```
src/
  app/
    api/          # 46+ API routes (projects, chat, graph, dashboard, growth, fundraising, journey)
    project/      # Unified chat-first UI with intelligent sidebar
  components/
    chat/         # Chat panel + 7 artifact renderers
    graph/        # D3 knowledge graph + node detail panel
  hooks/          # useChat, useKnowledgeGraph, useProject, useTaskPolling
  lib/
    db/           # SQLite connection + schema init
    llm/          # OpenAI + Anthropic unified client
    artifact-parser.ts   # Parses :::artifact{} blocks from AI responses
    gateway.ts           # OpenClaw WebSocket client (fallback path)
skills/           # 8 SKILL.md files for OpenClaw agent
agents/           # SOUL.md, AGENTS.md, HEARTBEAT.md
db/schema.sql     # SQLite schema (22 tables)
```
