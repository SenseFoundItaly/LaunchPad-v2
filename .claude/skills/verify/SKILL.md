---
name: verify
description: Verify a LaunchPad change end-to-end — typecheck, tests, prod-mode build, and the relevant live e2e sim. Use before committing any nontrivial change, or when asked to verify/validate work.
---

# LaunchPad verify

Run these in order; stop and report on the first failure. All commands from the repo root.

## 1. Typecheck
```bash
node_modules/.bin/tsc --noEmit
```
NEVER `npx tsc` — in worktrees (node_modules symlinked from the main checkout) npx resolves the wrong binary and **false-passes**.

## 2. Unit tests
```bash
node_modules/.bin/vitest run
```
Baseline is ~440 tests green (grows over time). Any regression from the count on main is a failure even if the suite "passes" partially.

## 3. Production build
```bash
node_modules/.bin/next build --webpack
```
`--webpack` is REQUIRED in worktrees — turbopack panics on the node_modules symlink. A change is not verified until the prod build compiles.

## 4. Live e2e sim (pick what the change touches)
Sims hit the REAL DB (dev == prod — one Supabase project), so they create/clean their own rows; don't invent destructive variants.
```bash
node scripts/e2e-validation-gate.mjs   # validation gate / journey checks
node scripts/e2e-loop1-psf.mjs         # Loop-1 PSF propose/verdict/gate
node scripts/e2e-loop1-escape.mjs      # founder dismiss/override path
node scripts/sim-launch-pipeline.mjs   # launch pipeline (publish/email/ads/measure)
node scripts/sim-validated-founder-docs.mjs  # doc-upload digest
```
For UI changes with no sim: `next dev --webpack` + browser QA with `E2E_AUTH_ENABLED=1` and the `x-e2e-user` cookie/header (403 in prod, safe locally).

## 5. If deployed: prod smoke
After `npm run deploy` (main checkout only), confirm login returns 200 on https://launchpad.sensefound.io.

## Reporting
State each step's actual result (counts, exit codes). A skipped step is reported as skipped — never implied as passed.
