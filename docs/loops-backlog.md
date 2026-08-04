# Loops & infra — backlog (nice-to-have)

Captured 2026-07-08 from a "make Claude 10x with loops" session, grounded in the
Claude Code loops article (turn-based / goal-based / time-based / proactive) +
an inventory of this project's actual recurring work. **None of this is urgent.**

## Done already (not backlog)
- ✅ Prod cleanup: repaired 29 corrupted `memory_events` rows; ghost Vercel executor deleted by founder (see memory `ghost_vercel_executor` — RESOLVED).
- ✅ `.claude/settings.json` — allow-list (auto-mode for safe commands) + a `PostToolUse` guard hook (`scripts/loop-guard.sh`) that nudges on repo footguns (i18n both-files, action_type CHECK, migration↔schema.sql, JSONB raw). Tested. **Uncommitted** — commit on a separate branch when ready (not part of PR #218).

## Nice-to-have — pick up when there's appetite

### P1 — one morning `/schedule` routine (cloud, survives PC-off)
Pick ONE to start:
- **PRs/CI**: "check my open PRs, address review comments, fix failing CI." → wake up to green PRs.
- **Cron health**: after the 06:17 UTC tick, "confirm `/api/cron` drained, 0 stuck runs, Exa/Jina balance non-zero, no budget-paused watchers."
- **Nightly sims**: run the paid/nondeterministic sims CI skips (`founder-sim-full`, `marketing-sim`, `mvp-sim`, `gtm-sim`, `e2e-validation-gate`, `e2e-loop1-psf`), budget-capped, post score diffs.
Guardrails: pin model (Haiku for watch/triage, Opus for judgment); always set an explicit stop + turn cap (there is NO native `/goal` here); use `/schedule` (cloud) not `/loop` (local dies with the Mac).

### P1 — commit the loop config
Move `.claude/settings.json` + `scripts/loop-guard.sh` onto their own branch/commit (team-shared infra, separate from the build-hub feature PR).

### P2 — more loop candidates (from the bottleneck inventory)
- **Pre-ship green gate** as a `verify-ship` skill: `tsc` + `vitest` + `next build --webpack`, auto-fix, re-run until green.
- **Deploy-verify** loop wrapping `canary`: stop only when the fix is provably live (`published_at` > merge + endpoint probe + login 200) — beats the 8-min deploy/merge race.
- **Changelog "is it actually live" audit** — goal loop, stop when each item confirmed (code + prod DB + endpoint).
- **Watcher/signal inbox triage** — proactive, surface stale `signal_alert`s.

### P1 — Build generate must go ASYNC on serverless (found on staging 2026-07-08)
`POST /api/projects/[id]/builds` (and the iterate PATCH) run the mvp-build-spec skill (~30s LLM) SYNCHRONOUSLY → exceeds Netlify's ~10–26s function timeout → HTTP 000 on any Netlify deploy (worked locally only). Move generate/iterate to a background function + polling/SSE (write the `mvp_builds` row as `building`, kick off async, poll for `live`). Blocks the Build section from working in prod/staging until fixed.

### P2 — infra hygiene (separate from loops)
- **STAGING now exists** (see memory `staging_environment` + `scripts/deploy-staging.sh` → https://launchpad-staging.netlify.app, separate Supabase `ebbhkuvkhkjubhyeaimm`). dev==prod (`ghjbxnnkdketrtmebzxl`) is still one DB for LOCAL work — point `.env.local` at the staging Supabase if you want local testing off prod too. Optional next: custom subdomain `staging.sensefound.io` (DNS CNAME → launchpad-staging.netlify.app).

## Reference
- Loop types: turn-based (you hand off *the check* → verification skills), goal-based (*the stop condition* → self-paced `loop` + explicit stop, or a `Workflow` evaluator), time-based (*the trigger* → `loop`/`schedule`), proactive (*the prompt* → schedule + goal + workflow + auto-mode).
- Available primitives here: `Workflow` (dynamic workflows) ✓, `code-review --ultra` ✓, `verify`/`no-mistakes` ✓, `loop`/`schedule` ✓; **no native `/goal`**; `/fewer-permission-prompts` for auto-mode.
