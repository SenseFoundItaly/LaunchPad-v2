# Daily incentivi.gov.it sync (LaunchAgent)

`incentivi.gov.it` silently **drops** traffic from AWS and Azure ranges. Proven
on prod 2026-09-06 — `connect ETIMEDOUT 94.86.69.151:443` from both the Netlify
background function (AWS) and a GitHub Actions runner (Azure), while an ordinary
machine completes the TCP handshake in 38ms and other datacenters answer
normally. It is not a blanket datacenter block, just the big two. A REJECT would
have surfaced as `ECONNREFUSED`; a silent DROP is why it presents as a timeout.

So the daily sync is split **by reachability**:

| Source | Runs from |
| --- | --- |
| SEDIA (EU) + Regione Lombardia | Netlify background function, daily via GitHub Actions |
| incentivi.gov.it | **this LaunchAgent**, on a machine the source will talk to |

## Install

```bash
scripts/launchd/install-incentivi-agent.sh          # daily 08:40 local
scripts/launchd/install-incentivi-agent.sh 7 15     # or pick a time
```

Idempotent — re-run it after moving the repo or changing the schedule.

## Operate

```bash
launchctl kickstart -k gui/$UID/tech.sensefound.grants-incentivi   # run now
tail -f ~/Library/Logs/sensefound/grants-incentivi.log             # watch
launchctl print gui/$UID/tech.sensefound.grants-incentivi | head   # state
```

## What to expect

- Asleep at the scheduled time? launchd runs it on the next wake instead of
  skipping the day.
- The sync gates itself to once per day per source, so extra runs are cheap
  no-ops and re-running after a failure is safe.
- A missed day is visible: the grants page's freshness row reads from
  `funding_source_state.last_success_at`, which only a SUCCESS advances.

## If this machine stops being reliable

Move it to any always-on host that is **not** AWS or Azure — Hetzner, Scaleway,
OVH, Aruba. Same script, a cron entry instead of a plist. Verify the origin
first with a single `curl` against the Solr endpoint before wiring anything up;
that assumption has already been wrong once.
