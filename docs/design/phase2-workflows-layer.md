# Phase 2 — Workflows Execution Layer (Design)

**Status:** Design only. No code, no migrations applied, no core files touched.
**Author:** Backend Architect
**Base commit:** `f96c45c` (origin/main)
**Scope:** Architecture for the "workflows" execution layer that wires LaunchPad-v2 to external execution tools and feeds **real** data back into the 7-stage journey gates, replacing founder self-report.

---

## 0. Executive summary (10 lines)

1. **Phase 1 closes gates on self-report** (chat → `memory_facts` / `interviews` / structured tool writes). The team calls this "fake data." Phase 2 fixes the *source*, not the gates.
2. **A "workflow" is a scoped, executable unit**: `{category, connected tool, steps, real output}` — bucketed into MVP / GTM / Marketing / Emails (the user's stated buckets).
3. **Three new additive tables** carry the layer: `integration_connections` (per-project auth), `workflows` + `workflow_runs` (the executable units), and `ingested_events` (inbound webhook facts). Nothing existing is altered.
4. **The provenance bridge is the whole point.** Reuse the *existing* tier ladder already shipped in migration 014: `founder_asserted < workflow_derived < externally_verified`. `metrics.provenance` and the "self-reported" pill already exist.
5. **Workflow outputs write to the SAME tables the gates already read** (`metrics`, `published_assets`, `growth_loops`, `monitors`, `interviews`) — only stamped with a higher provenance tier. The gate evaluators **do not change**.
6. **Inbound data path:** external tool fires a webhook → `/api/webhooks/[connectionId]` verifies signature → row in `ingested_events` → a deterministic **projector** maps the event to a gate-backing write (e.g. a Stripe `checkout.session.completed` increments a `signups` metric tagged `externally_verified`).
7. **`update_metrics` already accepts `provenance: 'workflow_derived'`** (project-tools.ts:2263) — the projector is a *server-side* caller of the same write path the chat tool uses, so the seam already exists.
8. **Connection model:** OAuth2 (Stripe, Webflow, Mailchimp, GA/PostHog), API-key (Resend, Typeform), and inbound-webhook-only (Zapier/Make catch-hooks) — secrets encrypted at rest, never in `payload` JSONB.
9. **Thinnest first slice that proves the model:** Typeform (or a generic inbound webhook) → `ingested_events` → projector → `early_users` flips from `memory_facts` keyword-match to a real signup count. One integration, end-to-end, in one PR.
10. **Biggest risk:** the gates that are *easiest* to "upgrade" (`early_users`, `something_shipped`) read **counts of qualitative rows**, so a naive projector can inflate them just like self-report did — provenance must be enforced at *read* time (gate discounts low-tier rows), not only stamped at write time. Detailed in §7.

---

## 1. Where Phase 1 stands today (grounded in the code)

The journey is seven stages in `src/lib/journey/stage-N-*.ts`, each exposing `checks[]` with an `id`, a human `label`, a `source:` pointer, and an `evaluate(snapshot)` function. `evaluateAllStages` (`index.ts`) runs every check against a single `ProjectSnapshot` built once by `buildProjectSnapshot` (`snapshot.ts`). The snapshot is a lean read of facet tables; every facet query is `.catch(() => [])`-guarded so one missing column degrades that facet, never 500s the whole evaluation.

**Today's evidence sources, by category (verbatim `source:` strings):**

- **Canvas text** (`idea_canvas.problem/solution/value_proposition/...`) — Stage 1, 2, 3, 4. These are *articulation* checks, not *validation* checks. They legitimately stay self-authored. Out of Phase 2 scope.
- **`memory_facts` keyword matches** — `market_size`, `differentiation_evidence`, `icp_defined`, `channels_identified`, `early_users`, `pain_validated` (fallback). These are the weakest: `countMemoryFactsMatching(s, [...])` regex-scans chat-captured facts. **Pure self-report.**
- **Structured tool writes** — `interviews` rows (`interviews_logged`, `pain_validated` primary), `pricing_state.*` (Stage 6), `workflow.status/current_step` (`workflow_active`, `scope_defined`), `metrics` rows (`metrics_tracked`, `capital_plan`), `burn_rate` (`runway_clear`), `published_assets` count (`something_shipped`), `growth_loops` (`loop_active`), `monitors` (`monitors_set`), `competitor_profiles` + `graph_nodes` (`competitors_mapped`, `segment_signals`). Structured, but still **founder-entered via chat tools** today.
- **`monitors` + competitor signals** — `monitors_set`, `segment_signals`. This is the one source that *already* has an autonomous inbound loop (cron → monitor_runs → ecosystem_alerts → competitor `total_signals`). It is the **proof-of-concept** that the workflows model generalizes.

The team's complaint ("fake data") is precisely the `memory_facts`-backed and chat-entered-structured checks. Phase 2 swaps the *writer* of those rows from "founder typing in chat" to "external tool emitting a real event," and records that swap in `provenance`.

---

## 2. Integration model

### 2.1 What the app connects to

| Bucket | Example tools | Primary inbound data | Gate(s) it can back |
| --- | --- | --- | --- |
| **MVP build** | Webflow / Framer / Vercel (site), Typeform (waitlist) | published URL, form submissions | `something_shipped`, `early_users` |
| **GTM** | Stripe (checkout), auth provider (Supabase Auth/Clerk) | paying customers, signups | `early_users`, `metrics_tracked`, `capital_plan` |
| **Marketing** | PostHog / GA4, Ahrefs (already an MCP) | activation, retention, traffic | `metrics_tracked`, `segment_signals` |
| **Emails** | Resend / Mailchimp | sends, opens, click-throughs, referral fires | `loop_active`, `channels_identified` (evidenced) |
| **Automation glue** | Zapier / Make (catch-hooks) | anything the founder wires | wildcard → `ingested_events` |

### 2.2 Auth model (three connection types)

The layer must support all three; one column (`auth_type`) discriminates.

1. **OAuth2** (Stripe Connect, Webflow, Mailchimp, GA4, PostHog Cloud) — store `access_token` + `refresh_token` encrypted; background refresh. Best UX, scoped, revocable.
2. **API key** (Resend, Typeform, self-hosted PostHog) — store one encrypted secret. Simplest; acceptable for v1.
3. **Inbound-webhook-only** (Zapier/Make catch-hook, or any tool the founder points at our URL) — no outbound auth; we mint a per-connection **inbound secret** and verify HMAC on every event. This is the *universal escape hatch* — if no first-class integration exists, the founder pipes the tool through Zapier into our webhook.

**Secret storage:** secrets live in a dedicated encrypted column (`integration_connections.secret_encrypted`, app-level AES-GCM with a KMS/env key), **never** in any `*.payload` / `config` JSONB and **never** logged. The `cost-meter` / Langfuse paths must redact.

### 2.3 Inbound webhook ingestion (the workhorse)

```
POST /api/webhooks/[connectionId]
  → look up integration_connections by id (indexed)
  → verify provider signature (Stripe-Signature / HMAC of body w/ inbound secret)
  → INSERT INTO ingested_events (raw payload, event_type, dedupe_hash)
  → enqueue/inline-run the projector for (provider, event_type)
  → 200 fast (ack within 5s; projection is idempotent + retry-safe)
```

This mirrors the **already-built** monitor inbound path: `monitor_runs.trigger_type` already has a `'webhook'` value (schema.sql:480) and `ecosystem_alerts` already ingests external signals. We are generalizing that pattern from "competitor news" to "founder's own execution tools."

### 2.4 Outbound (optional, later)

Workflows can *also* push (create a Resend campaign, publish a Webflow page) via stored OAuth/API creds. This is **not required for the provenance bridge** — the bridge only needs *inbound* data. Keep outbound as a Phase 2.5 add-on so v1 ships on read-only inbound.

---

## 3. Workflow categories (the executable units)

A **workflow** = `{ id, project_id, category, connection_id, title, steps[], status, output }`.

- `category ∈ { mvp_build, gtm, marketing, emails }` — the user's four buckets, 1:1.
- `steps[]` is an ordered JSONB list `{ label, status, kind }`. This **reuses the existing `workflow_step` pending_action** type (already in the migration 009 CHECK union) for per-step approval/edit/done — no new approval surface needed. (Note the known open follow-up: per-step edit/done UI on the artifact card — see memory `finding_workflow_step_inbox_graveyard`.)
- `output` is the *real artifact*: a published URL, a Stripe product id, a Resend campaign id. The output is what links a workflow to the `ingested_events` it should expect.

**Lifecycle:** `draft → connected → running → producing → complete`.
- `draft`: scoped in chat (from Phase 1 work), no tool wired.
- `connected`: an `integration_connections` row is attached.
- `running`/`producing`: events arriving in `ingested_events`.
- `complete`: enough events to satisfy the workflow's target gate.

Workflows are **proposed by chat** exactly like monitors and skills today (`propose_monitor` → `configure_monitor` pending_action → executor). Add a `propose_workflow` tool + `configure_workflow` pending_action type (requires BOTH the TS union AND a new DB CHECK value, per memory `finding_skills_propose_not_run` — the migration-009 lesson). This keeps the founder-approval-first invariant intact.

---

## 4. The provenance bridge (most important)

### 4.1 The tier ladder (already half-shipped)

Migration 014 established: `founder_asserted < workflow_derived < externally_verified`. The `metrics.provenance` column exists; the "self-reported" pill renders on `founder_asserted` / NULL. `update_metrics` (project-tools.ts:2263-2266) **already accepts `workflow_derived`** and only honors it for non-chat callers. The bridge extends this one idea to the other gate-backing tables.

**Rule of thumb for tiering:**
- `founder_asserted` — a human typed it (chat, manual entry). Current default.
- `workflow_derived` — produced by an executed workflow/skill *we ran* (e.g. a deployed landing page we published → `something_shipped`). Trusted because the app did it, but the *outcome* (did anyone sign up?) is still our claim.
- `externally_verified` — an **independent external system** asserted it via signed webhook (Stripe says someone paid; PostHog says activation = 32%). Highest trust; cannot be faked by chat.

### 4.2 The projector (server-side write, gate tables unchanged)

For each `(provider, event_type)` a small deterministic **projector** maps an `ingested_events` row to a write on a table the gate already reads — **stamping provenance**. Projectors are the only new "business logic"; they call the *same* write paths chat tools use:

```
Stripe checkout.session.completed
  → upsert metric "paying_customers" current_value+1, provenance='externally_verified'
  → (closes/strengthens metrics_tracked, capital_plan)

Typeform form_response / Webflow form submission / auth user.created
  → upsert metric "signups" current_value+1, provenance='externally_verified'
  → ALSO insert a memory_fact "signup: <email/ts>" provenance-tagged (so early_users keyword check still finds it, but now backed by real provenance)

Webflow site.published / Vercel deployment.succeeded
  → insert published_assets row (real daytona_url/external URL), provenance in metadata
  → (closes something_shipped)

Resend/Mailchimp referral automation fired (email.delivered on a referral campaign)
  → upsert growth_loops row status='active', provenance-tagged
  → (closes loop_active)

PostHog/GA4 daily metric sync (pull, not webhook)
  → upsert metrics current_value, provenance='externally_verified'
  → (closes metrics_tracked with real numbers)
```

**Why the gates don't change:** every projector target (`metrics`, `published_assets`, `growth_loops`, `memory_facts`, `interviews`) is *already* in `buildProjectSnapshot`. The snapshot reads rows; the gate counts/thresholds them. Phase 2 makes those rows *real* and *tagged*. The only gate-evaluator change worth doing later is **read-time discounting** (§7), and even that is additive (a filter), not a rewrite.

### 4.3 Gate → integration provenance mapping (concrete, by check ID)

| Stage | check `id` | current `source:` | today's tier | Phase-2 integration | new tier | how it closes |
| --- | --- | --- | --- | --- | --- | --- |
| 5 MVP | `early_users` | `memory_facts (users)` | founder_asserted | Stripe / Webflow form / Typeform / auth provider webhook | **externally_verified** | each signup/checkout event → +1 on a `signups` metric + tagged memory_fact; gate's `>= 3` now counts real events |
| 5 MVP | `something_shipped` | `published_assets` | founder_asserted (count only) | Webflow/Framer `site.published` or Vercel `deployment.succeeded` | **workflow_derived** | webhook inserts a `published_assets` row with the real live URL in `daytona_url`/metadata |
| 7 Growth | `metrics_tracked` | `metrics` | founder_asserted | PostHog/GA4/Stripe scheduled pull | **externally_verified** | projector upserts `metrics.current_value` from analytics; gate's `>= 3` now counts measured metrics |
| 7 Growth | `loop_active` | `growth_loops` | founder_asserted | Resend/Mailchimp referral automation firing | **workflow_derived** | a referral campaign delivering emails flips a `growth_loops` row to `active` |
| 7 Growth | `capital_plan` | `fundraising_rounds OR revenue metric` | founder_asserted | Stripe (revenue) | **externally_verified** | a positive Stripe-derived `MRR`/`revenue` metric satisfies the existing `hasRevenue` branch |
| 4 Segment | `segment_signals` | `competitor_profiles + monitors` | partly automated | **monitors (already built)** + new marketing-traffic signal | workflow_derived → externally_verified | existing weekly monitor loop already raises `total_signals`; add PostHog/GA referral-source traffic as a second signal feed |
| 2 Problem | `monitors_set` | `monitors` | founder/chat-proposed | monitors (already built) | workflow_derived | unchanged mechanism — a live monitor already satisfies it |
| 2 Problem | `interviews_logged` / `pain_validated` | `interviews` | founder_asserted | Calendly/Zoom/Fathom (transcript → interview row) | **externally_verified** | a real booked+recorded call inserts an `interviews` row; Fathom MCP already exists in this stack |
| 4 Segment | `channels_identified` | `memory_facts (channels)` | founder_asserted | Resend/GA UTM data | workflow_derived | a real send/click on a channel evidences it beyond a chat claim |

**Stays analytical (NOT verifiable, by design — do not fake-verify):**

| Stage | check `id` | why it stays self-/analyst-authored |
| --- | --- | --- |
| 1 Spark | `problem_defined`, `solution_sketched`, `value_prop` | articulation of the idea — there is no external system to verify "you wrote it down" |
| 2 Problem | `problem_defined`, `segment_named`, `market_size` | `market_size` is a *research estimate* (TAM/SAM/SOM); it's analytical, not measurable from a connected tool. Keep at `founder_asserted`/research, surface the assumption explicitly. |
| 3 Solution | `solution_detailed`, `edge_articulated`, `value_prop_sharp`, `differentiation_evidence` | judgment/articulation checks |
| 4 Segment | `target_market`, `icp_defined` | articulation — the *validation* of the ICP flows through `segment_signals`, not these |
| 6 Pricing | `anchor_set`, `tiers_defined`, `wtp_researched`, `model_chosen`, `unit_econ_viable` | pricing *decisions*. The one upgradeable here is `unit_econ_viable`: real CAC/LTV could later derive from Stripe + ad-spend, but that's a Phase 2.5 stretch. |
| 7 Growth | `runway_clear` | derived from `burn_rate` (founder-entered cash/burn); could later read a connected bank/accounting tool but not v1 |

---

## 5. Data model sketch (additive only)

All new tables follow existing conventions: `VARCHAR` PKs via `generateId('prefix')`, `project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE`, JSONB for flexible payloads, `created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`. **No ALTER on existing tables.**

```sql
-- migration 016_workflows_layer.sql (NOT APPLIED — design only)

-- 5.1 Per-project connection to an external tool
CREATE TABLE IF NOT EXISTS integration_connections (
  id                VARCHAR PRIMARY KEY,                       -- generateId('conn')
  project_id        VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  provider          VARCHAR NOT NULL,                          -- 'stripe'|'webflow'|'resend'|'typeform'|'posthog'|'zapier'|...
  auth_type         VARCHAR NOT NULL,                          -- 'oauth2'|'api_key'|'inbound_webhook'
  status            VARCHAR DEFAULT 'connected',               -- 'connected'|'error'|'revoked'
  display_name      VARCHAR,
  external_account_id VARCHAR,                                 -- e.g. Stripe acct_..., for support/debug
  secret_encrypted  TEXT,                                      -- AES-GCM blob: api key / oauth tokens. NEVER logged.
  scopes            JSONB,
  inbound_secret_hash VARCHAR,                                 -- HMAC key for webhook verification (hashed)
  config            JSONB,                                     -- non-secret settings (account name, default list id...)
  last_event_at     TIMESTAMP,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conn_project_provider
  ON integration_connections(project_id, provider);

-- 5.2 The executable unit, bucketed to the founder's Phase-1 work
CREATE TABLE IF NOT EXISTS workflows (
  id            VARCHAR PRIMARY KEY,                           -- generateId('wf')
  project_id    VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  connection_id VARCHAR REFERENCES integration_connections(id) ON DELETE SET NULL,
  category      VARCHAR NOT NULL,                              -- 'mvp_build'|'gtm'|'marketing'|'emails'
  title         VARCHAR NOT NULL,
  objective     TEXT,                                          -- mirrors monitors.objective convention
  target_check  VARCHAR,                                       -- the journey check id this workflow aims to close
  steps         JSONB DEFAULT '[]'::jsonb,                     -- [{label,status,kind}]
  status        VARCHAR DEFAULT 'draft',                       -- draft|connected|running|producing|complete
  output_url    VARCHAR,                                       -- the real published artifact, when relevant
  output_ref    JSONB,                                         -- provider-specific id(s): {stripe_product_id, resend_campaign_id,...}
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_workflows_project_status
  ON workflows(project_id, status, created_at DESC);

-- 5.3 Execution receipts (parallels monitor_runs exactly)
CREATE TABLE IF NOT EXISTS workflow_runs (
  id           VARCHAR PRIMARY KEY,                            -- generateId('wfrun')
  workflow_id  VARCHAR REFERENCES workflows(id) ON DELETE CASCADE,
  project_id   VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  trigger_type VARCHAR DEFAULT 'webhook',                      -- 'manual'|'scheduled'|'webhook' (same vocab as monitor_runs)
  status       VARCHAR DEFAULT 'completed',
  summary      TEXT,
  events_ingested INTEGER DEFAULT 0,
  cost_usd     DOUBLE PRECISION DEFAULT 0,                     -- recordUsage() integration for any LLM step
  run_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5.4 Raw inbound facts (parallels ecosystem_alerts as the "inbound feed")
CREATE TABLE IF NOT EXISTS ingested_events (
  id            VARCHAR PRIMARY KEY,                           -- generateId('evt')
  project_id    VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  connection_id VARCHAR REFERENCES integration_connections(id) ON DELETE SET NULL,
  workflow_id   VARCHAR REFERENCES workflows(id) ON DELETE SET NULL,
  provider      VARCHAR NOT NULL,
  event_type    VARCHAR NOT NULL,                              -- 'checkout.session.completed'|'form_response'|...
  payload       JSONB NOT NULL,                                -- raw provider body (secrets stripped)
  provenance    VARCHAR DEFAULT 'externally_verified',        -- the tier this event grants downstream
  projected     BOOLEAN DEFAULT false,                        -- has the projector run?
  projection_target VARCHAR,                                  -- 'metrics:signups' | 'published_assets' | ...
  dedupe_hash   VARCHAR,                                       -- provider event id; UNIQUE per project for idempotency
  occurred_at   TIMESTAMP,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, dedupe_hash)                              -- copies the ecosystem_alerts idempotency pattern
);
CREATE INDEX IF NOT EXISTS idx_ingested_events_project_created
  ON ingested_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingested_events_unprojected
  ON ingested_events(project_id, projected) WHERE projected = false;
```

### 5.1 Relationship to existing tables & the snapshot

- **No change to `ProjectSnapshot` or any evaluator is required for v1.** Projectors write into `metrics`, `published_assets`, `growth_loops`, `memory_facts`, `interviews`, `monitors` — all already in `buildProjectSnapshot`. The gates light up "for free."
- The only *additive* snapshot change worth considering (Phase 2.x) is surfacing `provenance` so gates can discount low tiers at read time (§7). That's: extend the `metrics` SELECT to include `provenance` (column exists), and add a tier filter in `metrics_tracked` / `capital_plan`. Additive, guarded, reversible.
- **Provenance enum** should be promoted to a tiny shared TS union (`'founder_asserted' | 'workflow_derived' | 'externally_verified'`) reused by `update_metrics`, the projector, and any future writer — single source of truth, not stringly-typed in three places.

---

## 6. Phasing & migration path (don't break Phase 1)

The Phase-1 core works (full-rework cert 2026-06-09: 20/31 journey checks, spine strong, zero timeouts). The cardinal rule: **never touch the gate evaluators or the snapshot writer in the first slices.**

**Slice 0 — schema + connection shell (1 PR, no behavior change).**
Add migration 016 (the four tables). Add `/api/webhooks/[connectionId]` returning 200 + inserting `ingested_events` only. No projector yet. Proves the inbound pipe + signature verification in isolation. Zero risk to Phase 1 because nothing reads the new tables.

**Slice 1 — THINNEST end-to-end: Typeform/inbound-webhook → `early_users` (1 PR). [the proof]**
1. Founder connects a Typeform (API key) **or** points any tool at the inbound webhook URL (Zapier escape hatch — zero first-class integration work).
2. Each `form_response` lands in `ingested_events`.
3. A single projector: `form_response → +1 on a "signups" metric (externally_verified) + a provenance-tagged memory_fact "signup ..."`.
4. `early_users` (currently `memory_facts (users)`, threshold `>= 3`) now closes on **real** submissions.
**Why this slice:** `early_users` is the loudest "fake data" complaint, the projector is ~30 lines, and it reuses the *existing* `memory_facts` read path so **no gate code changes at all**. It is the smallest change that visibly converts self-report → real provenance.

**Slice 2 — Stripe → `early_users` + `capital_plan` + `metrics_tracked`.**
OAuth (Stripe Connect), `checkout.session.completed` → `paying_customers`/`revenue` metrics (externally_verified). Now the highest-trust tier is live and `capital_plan`'s `hasRevenue` branch closes on real money.

**Slice 3 — Webflow/Vercel publish → `something_shipped`.**
`site.published`/`deployment.succeeded` → real `published_assets` row.

**Slice 4 — Resend/Mailchimp → `loop_active`; PostHog/GA pull → `metrics_tracked` real numbers.**

**Slice 5 (Phase 2.x) — read-time provenance enforcement (§7).** Only after real data flows: extend the metrics snapshot SELECT to include `provenance` and have `metrics_tracked`/`capital_plan` optionally discount `founder_asserted` rows. Ship behind a flag; measure before enforcing.

**Migration safety invariants (all slices):**
- Additive, `IF NOT EXISTS`, nullable, idempotent — same discipline as migrations 013/014.
- Every new snapshot read is `.catch(() => [])`-guarded (the snapshot's existing contract).
- New `pending_action` action types (`configure_workflow`) need BOTH the TS union AND a DB CHECK widen — the migration-009 lesson, or the INSERT throws.
- Cost: any LLM step inside a projector/workflow run goes through `recordUsage()` and respects `isProjectCapped()` before spending.

---

## 7. Open questions / risks (for the user to decide)

**R1 — BIGGEST RISK: count-based gates can be inflated by a sloppy projector exactly like self-report.**
`early_users` (`>= 3`) and `something_shipped` (`> 0`) count *rows*, not *verified distinct entities*. A misconfigured Zapier could POST the same `form_response` 50 times, or a test submission could count. **Mitigation:** (a) idempotency via `ingested_events.UNIQUE(project_id, dedupe_hash)` so duplicate provider event ids collapse; (b) **read-time provenance enforcement** — the real fix is for the gate to *discount* low-tier rows, so the count that matters is "distinct externally_verified events," not "rows that exist." If we stamp provenance at write time but never enforce it at read time, we've rebuilt the fake-data problem with extra steps. This is the one thing that must not be deferred indefinitely.

**R2 — Provenance enum lives in 3+ places.** `update_metrics` hardcodes the union (project-tools.ts:2263), migration 014's comment names the tiers, the projector will too. Decide: promote to one shared TS const + a DB CHECK now, or accept drift. Recommend: shared const before Slice 2.

**R3 — Secret storage / compliance.** Where does the encryption key live (env vs KMS)? Stripe/OAuth tokens are PII-adjacent. Decide the key-management story before any OAuth slice. API-key + inbound-webhook slices (Slice 1) sidestep most of this — another reason to start there.

**R4 — Webhook reliability & ordering.** Providers retry; events arrive out of order; some (PostHog/GA) have no webhook and need a *pull* sync (a new cron leg next to the existing monitor cron). Decide per-provider: webhook-push vs scheduled-pull. The cron route (`/api/cron`) already orchestrates monitors → watch sources → heartbeats; a `workflow_pull` leg slots in naturally.

**R5 — Who maps an event to a workflow?** A signup webhook arrives — which `workflow` (if any) does it belong to? Options: (a) match by `connection_id` only (simplest); (b) require `output_ref` matching (precise but brittle). Recommend (a) for v1; events attach to the connection, workflow linkage is best-effort.

**R6 — UI surface.** Does "workflows" get its own NavRail page, or live inside the existing journey/Canvas? Recommend a thin `/workflows` page listing connections + workflow status, but the *gate* surfaces (journey) just start showing real provenance pills — the founder feels it there first.

**R7 — Does `market_size` ever become verifiable?** Decision: no — it's an analytical estimate. Keep it explicitly `founder_asserted`/research-backed and don't pretend a tool can verify TAM. Document this so no one wires a fake "verification" later.

---

## 8. One-paragraph "why this is safe"

Every claim above is grounded in code at `f96c45c`: the gate `source:` strings are verbatim from `src/lib/journey/stage-*.ts`; `metrics.provenance` and the tier ladder exist (migration 014); `update_metrics` already accepts `workflow_derived` (project-tools.ts:2263); the inbound-event pattern already exists for monitors (`monitor_runs.trigger_type='webhook'`, `ecosystem_alerts` with `UNIQUE(project_id, dedupe_hash)`); and the propose→approve→execute flow with a CHECK-constrained `pending_actions.action_type` is the established way to add a founder-approved capability (migration 009). The design adds four additive tables and a projector, writes into tables the gates already read, and changes **no** gate evaluator in the first four slices. The Phase-1 core is untouched until real data is flowing and measured.
