<!-- /autoplan reviewed 2026-07-03 — subagent-only (Codex unavailable: gpt-5.3-codex unsupported on ChatGPT account). Restore point: ~/.gstack/projects/LaunchPad-v2/signal-routing-autoplan-restore-20260703-143541.md -->

# Plan: Signal Routing — enrich-first, timeline, awareness feed (REVIEWED v2)

## What the review changed (read this first)

Three independent reviewers (eng / design / CEO) converged. Headline corrections vs the v1 plan:

1. **The v1 premise was partly false.** `acceptAlertIntoKnowledge` → `upsertAlertGraphNode` (`action-executors.ts:~1118-1158`) already dedups signals onto one entity node via `ON CONFLICT (project_id, LOWER(name)) DO UPDATE`. It does **not** spawn a node per news event. The real defect is that the upsert **clobbers** the node's `summary`/`attributes` with the latest signal — history is lost. So the fix is *append-not-clobber a timeline*, not a large new router.
2. **Two bets were bundled.** (A) enrich-routing = the safe, valuable win. (B) kill the inbox + auto-flow signals into Knowledge on ingest = an irreversible write-to-truth decision on a just-relit pipeline with ~3 real founders and zero measured precision. **Split them.** Ship A; gate B on measured precision. (This is the open decision — see the gate at the bottom.)
3. **Removing the inbox with no replacement HIDES intelligence.** A graph that silently mutates gives no "what's new since I last looked". The inbox did two jobs: a bad mandatory *approval gate* and a good *awareness feed*. Kill the gate, keep the feed → build a read-only **"Recent moves"** feed.
4. **Several mechanisms in v1 are unsafe or wrong:** per-signal inline LLM classifier (re-creates the documented serverless fan-out cron-killer), JS read-modify-write on `attributes.timeline` (lost-update race + double-encode footgun), auto-"refresh summary" (destroys founder curate-after edits), `drop = nothing written` (auditability regression), "no migration needed" + "alias check" (there is no alias column).

---

## Corrected problem statement

Watcher signals already collapse onto one entity node, but each new signal **overwrites** that node's state, so the graph shows only the *latest* move and loses the entity's history. And the founder must approve each signal in a confusing inbox. We want: entities that accumulate a **dated timeline of moves** (richer, not longer), no per-item approval wall, and a single place to see **what changed lately** — without silently corrupting the graph the co-pilot trusts.

---

## Phase 1 — SHIP NOW: routing + timeline + awareness feed (on the Accept path)

Low blast radius, reversible, generates the precision data Phase 2 needs.

### 1a. Append-not-clobber timeline (the core win)
Edit `upsertAlertGraphNode`'s `DO UPDATE` clause to **append** to `attributes.timeline` instead of overwriting `summary`/`attributes`. Atomic, in SQL — no JS read-modify-write:
```sql
UPDATE graph_nodes
   SET attributes = jsonb_set(
         COALESCE(attributes,'{}'::jsonb), '{timeline}',
         (COALESCE(attributes->'timeline','[]'::jsonb) || $1::jsonb))
 WHERE id = $2
```
- Bind the entry as a **raw object** (postgres.js serializes; never `JSON.stringify` into JSONB — the codebase's #1 footgun).
- Entry shape: `{ date, headline, source_url, relevance, alert_id }`.
- **Cap** at 20 most-recent — done in a follow-up statement (subquery over `jsonb_array_elements ORDER BY date DESC LIMIT 20`), NOT in the `||` (a JS cap reintroduces the race).
- **Do NOT auto-refresh `summary`.** The timeline carries "latest state"; `summary` stays founder/curated text. A machine one-liner, if wanted, goes to a distinct `attributes.latest` the founder edit never touches.

### 1b. Routing decision (enrich / new_entity / fact / drop) — batched, out of band
- Match the signal subject against existing nodes **deterministically first** using `alert.entity` (LLM-emitted at parse time, language-agnostic) — **not** `cleanEntityName`/`entityNameFromHeadline` (English-only verb list → fails on IT projects; the product runs frozen-locale IT projects).
- Only ambiguous signals hit a classifier, and it runs **batched, out of the synchronous scan/cron request** (one call over N signals against the entity list). Per-signal inline classify is banned — it re-creates the serverless fan-out that stranded 51 cron_runs.
- **Fail-safe:** on classifier error/timeout, fall back to today's behavior (write the `ecosystem_alert` + `signal_alert` pending_action). Never silently drop on error.
- **drop = soft-delete, not gone:** write the `ecosystem_alerts` row with `reviewed_state='auto_dropped'` + the classifier `reason`. This preserves the audit trail *and* becomes the labeled data to tune thresholds.

### 1c. "Recent moves" awareness feed (build in this PR, not deferred)
Read-only, reverse-chronological, cross-node UNION over every node's `attributes.timeline` (source-linked, grouped by entity). One quiet "looks wrong? → open node" affordance + an "N unreviewed" read-receipt counter (not a gate). This is the good half of the inbox and the Rocket-like "surface the change" behavior. No new store — reuses timeline data.

### 1d. NodeDetailPanel timeline section
- **Exclude `timeline` from the generic `attrEntries` render** or it ships as a junk "Timeline: 20 items" row (`formatAttrValue` → "N items").
- Timeline section sits **directly under Summary** (freshest = highest), dated rows (date · headline · source ↗), ~3–5 visible + "show more", visually distinct from static Attributes.
- **Per-timeline-entry delete** (extend `onSaveEdit` with `removeTimelineEntry`) — whole-node delete is not a fix for one wrong dated move.
- Header "last move · Xd ago"; optional graph dot/glow on nodes enriched since last visit.

### 1e. Reconcile existing side-effects
- `memory_fact` is already written for every accepted alert (`action-executors.ts:~1244`) — decide `writeFact` replaces vs supplements (dedup by text; don't double-write).
- `updateCompetitorProfile` fires per persisted alert — decide whether `drop` gates it too.

### Phase 1 migrations (v1's "no migration" was false)
- `ecosystem_alerts.reviewed_state` add `'auto_dropped'` value + store classifier `reason`.
- `ecosystem_alerts.routed_at` / `verdict` (idempotency — a signal routes once).
- (Aliases deferred — see risks. No alias column exists today; name-match will miss Meta/Facebook, rebrands, subsidiaries until then.)

---

## Phase 2 — SHIPPED 2026-07-03 (founder overrode the hold): deterministic auto-flow on ingest

Founder decision: proceed without waiting for precision data. Built with every safety rail from the review; the LLM classifier remains NOT built — routing is **deterministic SQL only** (no model call in the scan/cron path, per the D1 cron-killer finding). Ambiguity falls back to the inbox, so autoflow can only reduce founder workload, never lose a signal.

**Routing table** (`src/lib/signal-autoflow.ts`, flag `SIGNAL_AUTOFLOW=1`):
| Signal at ingest | Route |
|---|---|
| relevance < 0.5 | `auto_dropped` (soft-delete; reason in `signal_activity_logs`) |
| entity matches a REJECTED node | `auto_dropped` (tombstone — founder said no; autoflow never resurrects; a MANUAL inbox accept still can) |
| entity matches an existing node | **enrich** — reuses `acceptAlertIntoKnowledge` (timeline append, no clobber, back-link, memory_fact); no inbox item |
| no match + relevance ≥ 0.8 | **new_entity** — node created applied; no inbox item |
| no resolvable entity, or mid-confidence new | **inbox** (exception queue = today's path) |

- **Provenance:** `founder_action_taken='autoflow'` on the alert row (vs `inbox_apply`) — auto-landed writes queryable/reversible as a class; activity log carries verdict+reason per signal.
- **Suppression mechanism:** routed alerts leave `pending` state → the parser auto-queue skips them (routed-set) AND materialize-on-read skips them (its `reviewed_state='pending'` filter). Inbox empties by construction; the surface stays for fallback signals + briefs.
- **Idempotency:** dedup-upserted alerts that were already reviewed are left untouched (route-once).
- **Fail-safe:** any routing error → inbox path.
- **OFF = byte-identical to Phase 1** (the block is inert without the flag).
- **No migration:** no CHECK constraints on ecosystem_alerts; `signal_activity_logs` (plural!) already exists.
- Tombstone works because UI node-delete = `reviewed_state='rejected'` (no hard DELETE of graph_nodes exists in src).

**Verified:** 7 unit tests (pure `decideAutoflowRoute`); live harness `signal-autoflow.live.test.ts` (env-guarded, skipped in CI) = **18/18** through the real `persistEcosystemAlerts` on the e2e project: enrich/no-clobber/backlink, new-entity create, tombstone no-resurrect, junk drop didn't enrich, exactly 1 inbox ticket for the unattributable signal, 2+2 audit events; self-cleaning.

---

## Rollout & flags
- `SIGNAL_ROUTING` (Phase 1, default OFF→ON after verify): enrich-routing + timeline + feed on the Accept path. OFF = byte-identical to today.
- `SIGNAL_AUTOFLOW` (Phase 2, default OFF, held): ingest auto-flow + inbox suppression. **Separate PR, separate decision.**
- Note: `signal_alert` is load-bearing in the just-shipped inbox-badge-truth logic (`action-lanes.ts` INTEL_INBOX_TYPES). If Phase 2 stops materializing it, verify the Signals tab/run-log reads routed outcomes from somewhere (else it goes blank).

## Verification
- Unit: routing verdicts + junk conditions (pure `routeSignal`, injected LLM).
- **Integration (real Postgres):** atomic `jsonb_set(... || entry)` append + cap; assert `jsonb_typeof(attributes->'timeline')='array'` (double-encode regression guard).
- Live (one project): force a run → timelines grow, node count flat, `auto_dropped` rows carry reasons, the enrich appears on the Recent-moves feed and the node shows "new" (read-path check, not just DB).
- Worktree test footgun: symlink node_modules from main or tsc/vitest false-pass.

---

## Decision Audit Trail

| # | Phase | Decision | Class | Principle | Rationale |
|---|---|---|---|---|---|
| 1 | Eng | Timeline via atomic `jsonb_set(||)`, bind raw object, cap in subquery | Mechanical | P5 explicit | Kills lost-update race + double-encode footgun |
| 2 | Eng+Design | Do NOT auto-refresh `summary` on enrich | Mechanical | P5 | Protects founder curate-after edits; avoids extra LLM call |
| 3 | Eng | Route batched, out of the sync scan/cron path | Mechanical | P2 | Per-signal inline classify = documented cron-timeout killer |
| 4 | Eng | `drop` = soft-delete (`auto_dropped` + reason), not gone | Mechanical | P1 completeness | Preserves audit + gives threshold-tuning data |
| 5 | Eng | Match on `alert.entity`, not `entityNameFromHeadline` | Mechanical | P5 | English-only verb list fails IT projects |
| 6 | Design | Build "Recent moves" feed in the same PR | Taste→include | P1 | Awareness is the good half of the inbox; else auto-land hides intel |
| 7 | Design | Per-timeline-entry delete + exclude timeline from generic attrs render | Mechanical | P5 | Ship-blocking render bug + curate-after needs entry granularity |
| 8 | Eng | Correct "no migration" → routed marker + auto_dropped (+ alias deferred) | Mechanical | — | v1 claim was false |
| 9 | CEO+Design+Eng | **Split flag: ship routing on Accept; hold auto-flow-on-ingest** | **User Challenge** | — | **RESOLVED 2026-07-03 → founder chose A (split). Phase 1 approved; Phase 2 auto-flow gated on measured precision.** |

---

## GSTACK REVIEW REPORT

- **Voices:** Claude eng + design + CEO subagents (independent). Codex unavailable (account/model error) → subagent-only.
- **Consensus:** enrich-first routing = sound. Auto-flow-on-ingest + inbox removal this cut = NO (all 3). ~14 concrete findings, 6 critical, all folded into Phase 1/2 above.
- **User Challenge RESOLVED (2026-07-03):** founder chose **A — split**. Phase 1 (routing + timelines + "Recent moves" feed on the Accept path) is approved to build. Phase 2 (auto-flow-on-ingest + inbox removal) is a separate PR, held until Phase 1 produces routing-precision data.
- **Status:** **Phase 1 IMPLEMENTED 2026-07-03** on branch `feat/signal-timeline` (tsc clean, 162/162 vitest green). Phase 2 (auto-flow-on-ingest) still held.

## Implementation log — Phase 1 (2026-07-03, branch feat/signal-timeline)

What landed (accept-path routing + timelines + awareness feed; nothing auto-lands):
- **Timeline append, not clobber** — `upsertAlertGraphNode` (`action-executors.ts`): on CONFLICT it now appends a dated `{date,headline,source_url,relevance,alert_id}` entry to `attributes.timeline` (atomic `jsonb_set` + correlated subquery, capped newest-20, chronological), keeps the founder/existing `summary` (no clobber), and appends provenance to `sources`. Verified the SQL append+cap against prod read-only.
- **Node timeline UI** — `NodeDetailPanel`: "Recent moves" section under Summary (newest-first, ~5 + expand, dated rows, source ↗); **timeline excluded from the generic Attributes render** (the ship-blocking "Timeline: N items" bug); **per-entry remove** wired through `PATCH /knowledge/[itemId]` (`remove_timeline_alert_id`, atomic jsonb rebuild) → `KnowledgeGraph` → `knowledge/page`. Empty-state hint accounts for timeline.
- **"Recent moves" awareness feed** — `GET /api/projects/[id]/recent-moves` (UNION over all applied nodes' timelines, project-access gated, jsonb_typeof-guarded against legacy double-encode) + `RecentMovesFeed` component + a third **Moves** view on the knowledge page. The read half of the old inbox without the approval wall.
- **Shared parse** — `src/lib/timeline.ts` (`coerceTimeline`, double-encode defensive) + `timeline.test.ts` (4 cases).
- **Live integration test caught a real double-encode** (2026-07-03): the append entry was first bound `JSON.stringify([entry])` into `?::jsonb`, which postgres.js double-encodes into a jsonb STRING scalar — every appended move lost its shape and read back as text (invisible to tsc, unit tests, and the build; only surfaced when run through the real driver). Fixed to bind the RAW array. Confirmed via a throwaway-node itest through the real `query()` helper: 15/15 (append, no-clobber, cap-20, feed, per-entry delete, jsonb_typeof='array'), self-cleaning.
- i18n EN+IT for all new strings.

Deliberately NOT in Phase 1 (correct per the review): the LLM enrich/new/fact/drop classifier (enrich-vs-new is already deterministic via the entity-name upsert; the classifier only earns its cost/risk at ingest, which is Phase 2). No new memory_fact double-write introduced (accept-path recordFact unchanged); competitor_profile update is ingest-time, untouched.
