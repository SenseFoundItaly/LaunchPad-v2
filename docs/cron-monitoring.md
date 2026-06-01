# Cron monitoring (issue #19)

LaunchPad's heartbeat cron writes a row to `cron_runs` per invocation:
`status='running'` at the start, transitioning to `'completed'` or
`'failed'` at the end. That captures the **internal** failure modes
(code ran and threw, or code ran and finished).

What it doesn't capture on its own is the **external** failure mode —
"the cron never ran at all" or "the cron is stuck partway through with
nothing reporting back." For those we need a check that lives outside
the same Postgres the cron writes to.

This doc covers the two pieces of that external check:

1. The internal stuck-row sweep (already in code)
2. The external dead-man's-switch (you wire up an uptime monitor)

## What's in code

### `/api/cron/health` — public liveness endpoint

`GET /api/cron/health` returns:

- **200** when the most recent `cron_runs.finished_at` (status='completed')
  is within 30 minutes of now AND no `'running'` row is older than 20 min.
- **503** otherwise, with a `reason` field. Reasons:
  - `no-completed-runs-ever` — the system has never recorded a successful
    cron tick. Indicates a brand-new deploy with no cron yet, or that the
    cron has never reached the finalize UPDATE.
  - `stale` — last successful run is older than 30 min. Includes
    `age_minutes` and `threshold_minutes` for context.
  - `stuck-runs` — at least one `'running'` row is older than 20 min.
    Includes `stuck_count`.
  - `health-query-failed` — the health endpoint couldn't query its own
    audit log. Database is unreachable or the schema is broken.

No auth. Safe to ping from anywhere. Response body is plain JSON with no
PII or project data.

### Stuck-row sweep (inside the cron handler)

At the top of `GET /api/cron`, before any new work begins, the handler
runs:

```sql
UPDATE cron_runs
   SET status = 'failed',
       finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP),
       error_message = 'presumed-stuck — sweeper marked'
 WHERE status = 'running'
   AND started_at < now - interval '20 minutes';
```

Idempotent. Healthy runs are untouched. Stuck runs get flagged so they
stop holding the system in an ambiguous state and so `/api/cron/health`
returns 503 with `reason='stuck-runs'` while they're around.

## What you wire up

The internal sweep + health endpoint can't catch "the cron never fires."
If Netlify's scheduler is misconfigured, the function is de-registered,
or the platform itself has a regional issue, no `cron_runs` row ever gets
inserted and nothing inside our system notices.

The fix is an **external pinger** — any service that lives in a
different cloud than our cron, hitting `/api/cron/health` on a separate
cadence, and paging you when it sees consecutive 503s.

### UptimeRobot (cheapest, free for 50 monitors)

1. Sign in at https://uptimerobot.com.
2. **Add New Monitor**
   - Type: HTTP(s)
   - Friendly name: `LaunchPad cron health`
   - URL: `https://launchpad.sensefound.io/api/cron/health`
   - Monitoring interval: 5 minutes
   - Monitor timeout: 30 seconds
3. **Alert Contacts**
   - Add your email (and/or Slack webhook).
   - Notify after: 2 consecutive failures (so a single transient blip
     doesn't page you, but anything sustained does).
4. **Optional — response checks**
   - "Keyword exists / does not exist" → keyword: `"ok":true`. UptimeRobot
     will flag any 200 response that's missing this string as a failure
     too. Useful if a malformed deploy returns 200 with the wrong body.

Cost: $0. Pages within ~10 minutes of a missed window.

### Alternatives if UptimeRobot doesn't fit

- **GitHub Actions cron** — a `.github/workflows/cron-health.yml` that
  runs `curl -f https://launchpad.sensefound.io/api/cron/health` on a
  10-minute schedule and opens an issue / pings Slack on failure. Free,
  lives in a different cloud from Netlify. Slower paging (cron schedules
  in GHA can drift by up to 15 min).
- **BetterUptime / Pingdom / Datadog Synthetics** — same shape, more
  features, paid.
- **Self-hosted** — any small VM with cron + curl + a webhook.

The point is just: the check must live in a different cloud from the
cron it's checking.

## Verification

Local:

```bash
curl -i http://localhost:3000/api/cron/health
```

Expected immediately after a successful `/api/cron` run:

```http
HTTP/1.1 200 OK
{"ok":true,"last_completed_at":"...","age_minutes":0}
```

After 30+ minutes with no successful run (or in a fresh DB):

```http
HTTP/1.1 503 Service Unavailable
{"ok":false,"reason":"stale","last_completed_at":"...","age_minutes":47,"threshold_minutes":30}
```

## What's still not in scope here

- **Exponential-backoff retries** on the internal cron pipeline. Useful
  for the "code ran and threw a transient error" path. Tracked in the
  remaining checkboxes on issue #19. The current PR's three pieces are
  the higher-leverage half of the original AC.
- **Per-phase health** (e.g. "watchers haven't ticked in 24h" even though
  the cron ran). Out of scope here — `/api/cron/health` is a coarse
  whole-pipeline check, not a per-phase scoreboard.
- **Dead-letter queue** for permanently failed jobs. The `error_message`
  column on `cron_runs` captures the failure reason for the cron itself.
  Per-job dead-lettering for the heartbeat sub-tasks (e.g. one project's
  skill rerun failing) is tracked separately.
