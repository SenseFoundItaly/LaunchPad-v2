# Build & Launch feature — gap audit + plan to proceed

_Audit 2026-07-08 (3-way code audit: API/drivers, UI, data/infra). Target = "founder
types feedback → it iterates → live preview updates, working on Netlify serverless,
feels like v0's chat."_

## Where it stands
Deployed on **staging** (UI + routes + v0/E2B/stub drivers + `V0_API_KEY`), and the v0
create+iterate loop is **proven working** (run directly — create 152s, iterate 74s). But it
is **not functional through the deployed UI** because every real build blocks 1–2.5 min and
dies on Netlify's ~10–26s function limit. So: *deployed ≠ functional.*

## Gaps (prioritized)

### P0 — blocks the feature working on any Netlify deploy
1. **Synchronous execution → serverless timeout.** `POST /builds`, `PATCH …/[buildId]` iterate, and the `mvp_build_iteration` executor all block for the full build (v0 `responseMode:'sync'`; E2B `runAgent`+sandbox; skill `timeoutMs:170_000`). No background function, no polling, no SSE. Rows orphan in `building` (a killed function never runs the `catch`). **The keystone blocker.**
2. **v0 is async but treated as sync.** `sync` returns before `status==='completed'`; nothing polls building→live; `experimental_stream`/`parseStreamingResponse` unused.
3. **No cost gate** before paid drivers (`isProjectCapped` not enforced on v0/E2B/Opus).
4. **`BUILD_DRIVER=stub` on staging** while `V0_API_KEY` is live — v0 never selected.
5. **Zero test coverage** for the whole loop (no test references any builder/mvp module).

### P1 — loop + UX incomplete
6. **UI is fetch-and-wait** — no SSE/polling, **no chat thread** (single textarea), **no progress state** (button label only). Freezes for the full build. This is the "v0 feel" gap.
7. **v0 preview token expiry** — `demoUrl` `__v0_token` expires; no `chats.getById` refresh → iframe goes blank silently. Promised new-tab/`onError` fallback unwired.
8. **Auto-iteration proposer never fires for v0/E2B** — gates on `live_app_url` which neither driver sets; should key off `preview_url`/status.
9. **No builder selector; lane tabs non-functional** (static spans).
10. **PR #218 OPEN** — feature only on `staging`+feature branch, **not on main/prod**.
11. **Data-model gaps** — no `failure_reason` column; no async job/progress tracker beyond `status='building'`; `iteration` uniqueness only indexed, not constrained (concurrent iterate could collide).

### P2 — hardening / deferred
12. **E2B not hardened** — iterate regenerates from message alone (doesn't read prior files); static-only; **no persistence** (sandbox dies after 10 min → preview 404s, reconnect fails, no re-create fallback).
13. **`live_app_url → watch_source`** Firecrawl monitoring is a TODO (column unpopulated).
14. Coarse loading/error/retry states; status labels not i18n'd; feedback not threaded to iterations.
15. dev==prod on the local/prod path (staging isolated its own DB; local + prod still share one).

## Plan to proceed

### Phase A — Async execution core (unblocks P0 #1,2,4) ★ keystone
The insight: **v0 doesn't need a background worker.** Use v0's native async mode + client polling — every function call stays short.
- **Skip the `mvp-build-spec` skill on the v0 path.** `assembleMvpContext` (fast DB reads) → `renderMvpContextProse` → send that prose straight to v0. Removes the other ~30s LLM blocker; v0's own agent does the building.
- Extend `BuilderAdapter` with async verbs: `createAsync(spec) → {builderRef, status:'building'}` (v0: `chats.create({responseMode:'async'})`), and `getStatus(builderRef) → {status, previewUrl}` (v0: `chats.getById` → `latestVersion.{status,demoUrl}`).
- `POST /builds`: assemble → `createAsync` → insert row `building` → **return fast**.
- `GET /builds/[buildId]`: call `getStatus` → update + return (client polls this; also **refreshes the v0 `demoUrl`** here, fixing token expiry #7).
- `PATCH iterate`: `sendMessage({responseMode:'async'})` → new row `building` → poll.
- Flip **`BUILD_DRIVER=v0`** on staging.
- (E2B stays local-only until Phase E — its agent loop is genuinely long; needs a real background worker.)

### Phase B — v0-like UI (P1 #6,7,9)
- `BuildHub`/`CurrentBuildCard`: **poll `GET /builds/[buildId]` every ~3–5s** while `building`; show a live **progress state** (elapsed timer + status). Swap the iframe `src` on `live`.
- **Chat thread**: message history + input + agent replies (turn the single textarea into a conversation).
- iframe: `onError` → reload / open-in-new-tab fallback; reload on token refresh.
- **Optional streaming upgrade** (the true v0 feel): an **SSE route** using v0 `experimental_stream` + `parseStreamingResponse` → stream agent progress into the chat panel. (Polling makes it *work*; streaming makes it *feel like v0* — do polling first.)
- Builder selector (stub/v0/e2b) + functional lane tabs.

### Phase C — loop completeness + safety (P0 #3, P1 #8,11)
- **Cost gate**: `isProjectCapped` (+ a `BUILD_BUDGET_*` kill-switch) before any paid driver call.
- Proposer keys off `preview_url`/`status='live'`, not `live_app_url`.
- Migration: add `failure_reason`, a poll/progress field, and a `UNIQUE(project_id, iteration)` constraint.

### Phase D — tests + ship (P0 #5, P1 #10)
- Unit tests: builder adapters (v0/e2b mocked, stub real), `assembleMvpContext`, `applyIteration`, `iteration-proposer`, the `mvpBuildIteration` executor.
- A stub-driver E2E regression (the loop) as a script test.
- Once green on staging → **merge PR #218 → main** (feature reaches prod, still behind `BUILD_DRIVER`/flag).

### Phase E — E2B hardening + monitoring (P2 #12,13)
- E2B: read-and-patch iterate (read sandbox files first), sandbox **persistence/redeploy** for a durable URL, re-create-on-dead fallback, full-stack (dev server/DB); optional background-worker execution.
- Wire `live_app_url → watch_source` (Firecrawl) so live-app diffs feed the next iteration.

## Recommended sequence
**A → flip BUILD_DRIVER=v0 → B(polling) → C(gate) → verify live on staging → B(streaming) → D(tests+merge) → E.**
Fastest path to a **working, v0-feeling `/build` on staging** = Phase A + Phase B-polling + the cost gate. That's the next chunk.
