# LaunchPad — agent guide

Next.js app (App Router) deployed to Netlify via OpenNext. Prod: launchpad.sensefound.io. Locales EN/IT.

## Architecture
- **DB**: Supabase Postgres via postgres.js. Use `query`/`run`/`get` from `@/lib/db` with `?` placeholders. IDs via `generateId('prefix')`. JSONB columns: bind the RAW object — `JSON.stringify` double-encodes.
- **LLM**: task→tier routing in `src/lib/llm/router.ts` (Haiku cheap / Sonnet balanced / Opus premium). The agent runtime is `runAgent` from `@/lib/pi-agent` (NOT `src/agents`). Chat `ARTIFACT_INSTRUCTIONS` live inline in `src/app/api/chat/route.ts` — editing `prompts.ts` is a no-op. Keep chat on Sonnet: smaller models break the artifact contract.
- **Design**: CSS variables, no Tailwind. Primitives (`Panel`, `Pill`, …) from `@/components/design/primitives`. Layout: `div.lp-frame` → TopBar + NavRail + content. Pages are `'use client'`.
- **API**: respond with `json({success, data})` / `error(msg, status)`. Middleware returns 415 on mutating `/api` requests without `Content-Type: application/json`.
- **Cost**: `recordUsage` / `isProjectCapped`. Cron entrypoint: `GET /api/cron`.
- `@/lib/journey` (7-stage evidence checks) is NOT `@/lib/stages` (pipeline skills). Two stage pointers exist: `projects.current_step` vs journey `activeStage`.
- **i18n**: in-project UI locale comes from `project.locale` (LocaleProvider mounted in the project layout), not the account locale.

## Product invariants
- Skills **propose, not run**: `run_skill` pending_action + executor. A new `action_type` needs BOTH the TS union AND a DB CHECK migration.
- Validation gate: nothing turns green without explicit founder approval (e.g. `market_size` needs an `approved: true` stamp).
- The system must never dead-end the founder: any gating loop/review needs a dismiss/override path.

## Footguns
- OpenNext 404s a static leaf after two dynamic segments (`[a]/…/[b]/verb`) — fold the verb onto the dynamic leaf.
- `schema.sql` drifts from prod — verify columns against the live DB before relying on it.
- dev == prod: there is ONE Supabase project; local testing hits prod data.

## Build / test / deploy
- Worktrees have no own `node_modules` (symlinked from the main checkout): use `node_modules/.bin/tsc` (npx false-passes) and `next build --webpack` / `next dev --webpack` (turbopack panics on the symlink).
- Tests: `vitest`; live e2e sims are `node scripts/e2e-*.mjs` / `sim-*.mjs`. Auth bypass for QA: `E2E_AUTH_ENABLED=1` + `x-e2e-user` cookie/header (403 in prod).
- Deploy: `npm run deploy` (netlify-cli upload, NOT git CI) from the real main checkout only. To clear cache remove ONLY `.netlify/functions-internal` and `.next` — never `.netlify` itself (deletes the project link).
