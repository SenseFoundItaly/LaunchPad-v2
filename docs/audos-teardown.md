# Audos — teardown from the shipped client, and what a lighter LaunchPad means

Recorded 2026-08-14, from the two workspace URLs supplied.

> **Method.** The workspace pages are an authenticated React SPA — an
> unauthenticated fetch returns a shell containing the word "Audos". No browser
> extension was connected and Playwright was unavailable, so I could not log in
> and drive the UI. Instead I pulled the **public JS bundles** the pages load
> (`/assets/index-BjJ0yt_f.js`, `WorkspaceDashboard-BAXig__u.js`,
> `DailyStandupWindow-D3O17Qex.js`) and read the routes, API calls, data model
> and UI copy directly out of the shipped client. Everything below is quoted or
> derived from their own code, not from press coverage.
>
> **Updated 2026-08-20:** the founder pasted the rendered kickoff workspace
> (FillAI). Section 2A below is that real content — it CORRECTS the press
> account of the flow, which said four steps. It is three.

---

## 1. The object model

A **workspace = one business**. Its centre is a **plan**, advanced through
**meetings** (threads), not through a checklist.

```
meetingType:  kickoff · standup · standup_kickoff · vision · gtm
              brainstorm · ads_marketing · whats_next · otto_chat · general
meetingStatus: active → awaiting_review → accomplished
```

`?kickoff=1` — the URL you sent — resolves to this, in `WorkspaceDashboard`:

```js
queryKey: ["/api/workspaces", e, "plan-threads", "kickoff"]
GET  /api/workspaces/{id}/plan/threads          // find existing
POST /api/workspaces/{id}/plan/threads          // body: {meetingType:"kickoff"}
```

It looks for a kickoff thread that isn't `accomplished`; if none exists it
**creates one**. Then it polls every 6s and opens an SSE stream for live
updates. So the kickoff is a *resumable meeting*, not a wizard — leave and come
back and you land in the same thread.

## 2A. The kickoff, as it actually renders (verbatim, 2026-08-20)

**Three questions, not four.** The header reads `Question 1 of 3`, tabbed:

| | |
|---|---|
| 01 | **Your fit** — "Why you — your fit with this" |
| 02 | **Your take** — "Your unique take" |
| 03 | **The problem** — "The one painful thing worth solving" |

Otto's opening line is the whole strategy in one sentence:

> "Hi, I'm Otto. I'm going to ask you three quick questions to get to the heart
> of your idea. **While we talk, I'm already building your first landing page in
> the background.** Here's the first one…"

Generation is **concurrent with the conversation**, not a reward at the end of
it. The right panel says `Building in the background…` while you type.

### The shape of question 1

> "Last-minute cancellations draining a studio's daily revenue — that's a real,
> specific pain, and FillAI's angle of filling those spots within two hours is a
> sharp one.
>
> Of everything you could build, why this? What's your history with boutique
> fitness — as an owner, instructor, member, or otherwise — that put this
> problem right in front of you?"

Two moves: **reflect the idea back with specificity** (proving it listened),
then ask for **personal history**, not market data. Founder-customer fit is
established from biography.

### The artifact being filled: "My North Star", five pillars

```
01 Who we serve      02 The problem      03 Our first move
04 Where it grows    05 Why it lasts
```

> "Your starting point is ready … Your notes fill in right here as you talk."

**This is LaunchPad's Idea Canvas with 5 fields instead of 11, populated by
conversation instead of commit cards.**

### The method, told to the founder in five words

> "Find your edge → Build small → Put it in front of customers →
> Learn from feedback → Build the relationship"

Against LaunchPad's 7 stages / 3 tracks / 40 checks. And the positioning:

> "Otto will guide you through your whole entrepreneurship journey — **finding
> real customers and growing a business, not just building a website.**"

### "Your desk" — the daily surface

> "Good evening · Thursday 20 August" → **"On your agenda today"**
>
> **Build — Build your v0**: "Lock the heart of your idea — who it's for and the
> problem — then define exactly what your first version does, so it's ready to
> build."  → `Accept` · `Let's chat`
>
> "Start a meeting — Sharpen any part of your plan or kick off some work"
> "Stuck? Let's figure out what your next steps should be!"

**ONE agenda item. Two buttons.** Accept it, or talk about it. Compare the
LaunchPad spine: 40 rows, each a judgement the founder must make alone.

Meetings render as `Kickoff — Set the direction for your business · 1h` with
`Mark as complete`, plus `Active meetings` / `Search meetings` /
`View completed meetings`. App preview toggles: `Signed out | Signed in`,
`Draft | Live`.

> Shipped with visible failure states in the same screenshot: "Workspace build
> hit a snag", "Video generation encountered an error". They ship broken edges
> rather than hide them — worth remembering before polishing ours to a standstill.

## 2. The engine is a daily standup, run by "Otto"

Otto is the AI co-founder. Their copy, verbatim from the bundle:

> **"Meet your daily stand-up"** · **"Five-minute daily check-in"**
> "Keep track of your progress" · "Customized to your business"
> **"Would you like your co-founder Otto to email you daily with next steps and keep you on track?"**
> "Yes, email me daily" / "Turn off daily emails"
> "You're set — Otto emails you daily with next steps to keep you on track."
> "Get a daily business briefing"

The recurring loop is **five minutes a day, pushed by email**, not a dashboard
the founder must remember to visit.

## 3. What the standup surfaces

From `DailyStandupWindow`: tasks with statuses, **drafts awaiting approval**
(`approveDraftIfNeeded(workspaceId, draftId)` → starts a job), and
**experiments that have come due**:

> "Check-by reached {date}" · "Traffic threshold reached ({observed}/{threshold})"
> "ready to observe" · "Continue experiment" · "You requested a review"

**This is the sharpest contrast with LaunchPad.** Audos gates on *real-world
signal* — a date arriving, traffic crossing a threshold. LaunchPad gates on
*founder-supplied evidence* — 40 checks the founder must populate before the
next stage unlocks.

## 4. The API surface (62 workspace endpoints)

| area | endpoints |
|---|---|
| **plan** | `plan`, `plan/draft`, `plan/threads`, `plan/meetings`, `plan/proposals`, `plan/experiments/`, `plan/capability-picks`, `plan/agenda-suggestion/ensure`, `plan/retro-cadence`, `plan/otto-notes`, `plan/start-with-context`, `plan/export` |
| **daily loop** | `standup/availability`, `standup-spotlight`, `standup-spotlight/events`, `todos`, `todos/suggest`, `todos/reorder` |
| **assets** | `landing-pages`, `hero-variants` (+ `/candidates`, `/copy/regenerate`, `/apply`, `/inspire`), `mini-apps`, `brand`, `email` |
| **build** | `imported-app` (+ `/rebuild`, `/env`, `/recreation-status`, `/recreation-secrets/provision`) |
| **ops** | `autopilot`, `wallet`, `publish-status`, `snapshots/`, `dashboard-status`, `bootstrap`, `driver/acquire|release|request` |

Notable: **`hero-variants/candidates` + `/apply`** is landing-page A/B testing as
a first-class primitive. **`imported-app`** with env vars and rebuilds is a full
app-hosting pipeline (the client also loads Replit's dev banner — they build on
Replit). **`wallet`** is per-workspace money.

## 5. Auth is a magic link, and sessions are disposable

> "Your session expired. Re-open this workspace from the email we sent you to share an update."

No password. Email owns identity, and the daily email is *also* the way back in.
The acquisition channel (Reddit + Google Ads pixels are in the page head; press
says Instagram) leads to a workspace URL you can bookmark.

## 6. Their front-end is an experiment farm

The router carries **20+ workspace variants** — `workspace-notion`,
`-notion-os`, `-notion-grid`, `-notion-canvas`, `-notion-people`,
`-notion-command`, `-apple`, `-apple-v2`, `-figma`, `-framer`, `-conversation`,
`-network`, `-ritual`, `-studio` — plus `onboarding`, `-new`, `-v2`, `-v3`,
`-v4`. 119 lazy chunks in total. They are clearly A/B-ing the entire shell.

---

## What this means for a lighter LaunchPad

### The one structural swap

| | Audos | LaunchPad |
|---|---|---|
| unit of progress | a **meeting** that reaches `accomplished` | a **check** that turns green |
| what unlocks the next step | the founder showing up tomorrow | evidence the founder must supply |
| cadence | 5 min/day, pushed by email | none — founder must return unprompted |
| proof | traffic thresholds, check-by dates | keyword families, applied facts |

**Measured on prod the same day: 116 of 116 LaunchPad projects are locked at 1C,
0 gate verdicts have ever been recorded, and Luca last logged in on 05/08.**
The evidence-first ordering has never let a single founder through. That is the
argument for the swap, not a preference.

### What LaunchPad already has

| Audos primitive | LaunchPad equivalent | gap |
|---|---|---|
| kickoff meeting | `idea-shaping` skill | needs to be a *resumable thread*, not a one-shot |
| landing page | `build-landing-page` | no hero-variant A/B loop |
| pitch deck | `build-pitch-deck` | — |
| needfinding | `customer-interviews` | — |
| roadmap | `mvp-build-spec` | — |
| todos | `pending_actions` inbox | exists, but nothing pushes it |
| experiments | `validation_loops` | fires on WTP%, not traffic/date |
| **daily standup + Otto's email** | **nothing** | **this is the missing engine** |
| **magic-link workspace URL** | login + project picker | heavier |
| **wallet per workspace** | credits per user | — |

### The build, in order of leverage

1. **A daily 5-minute standup with an email push.** Everything else in Audos
   hangs off this. LaunchPad has the Monday Brief email and an inbox but no
   daily loop and no "here are today's three things" moment. This is the single
   highest-leverage import, and most of the parts exist.
2. **Make the gate a resumable meeting, not a checklist.** The gate's 40 checks
   become the *agenda* Otto works through with the founder, one conversation at
   a time — the checks stay as the model, they stop being the interface.
3. **Time-triggered experiments.** `check-by date reached` and
   `traffic threshold reached` are cheap to implement and give the loop
   something real to react to. Today a LaunchPad loop only fires on evidence the
   founder enters.
4. **Magic-link workspace URLs.** Removes the login step entirely and makes the
   daily email the front door.

### What not to copy

The **evidence spine, knowledge graph and watchers** have no Audos equivalent
and are LaunchPad's actual differentiator. Keep them — stop making them a
prerequisite. Their 15% revenue share is a company shape, not a feature.

### The question this forces

If the founder is guided by a daily conversation, **what is the Validation Gate
for?** Either it becomes a *quality tier* (anyone can start; the gate certifies
the serious — which fits the IRL ladder and investability framing already
built), or it is dead weight and should be deleted rather than demoted. That is
a founder call.

---

# Engineering assessment of the Launchpad-Lite PRD (2026-08-20)

The PRD is accurate and well-scoped — the screenshots confirm it, including
`Using ToolSearch — select:mcp__otto-meeting…`, which settles the "Claude Agent
SDK" inference. Three things to add from the LaunchPad side.

## 1. Phase 1 is mostly a RESHAPE, not a build

Checked against the repo. Of the nine Phase-1 items, six have a working
equivalent already:

| PRD Phase 1 | LaunchPad today | real work |
|---|---|---|
| Two-pane chat + panels | `Canvas.tsx` + chat page | **none** — this is the shipped layout |
| Desk with agenda | `today/page.tsx` | re-rank to ~3 cards, add **Stuck?** |
| Passwordless auth | Supabase magic link (branded email, #411) | swap link → 4-digit OTP |
| Notes doc | Idea Canvas | **11 fields → 5 pillars** |
| Meeting proposal | `OptionSetCard` + `pending_actions` | add the third disposition ("later") |
| Streamed tool calls | persisted in `tools_json` | surface reasoning in the UI |
| Kickoff: 3 questions | `idea-shaping` skill | rewrite as a bounded 3-turn thread |
| Madlib entry | — | **new** |
| Parallel generation + gated reveal | — | **new** |

The genuinely new work is the **madlib**, **parallel generation**, and the
**meeting lifecycle** (typed thread + `active → awaiting_review → accomplished`).
Everything else is renaming and narrowing what exists.

⚠️ Runtime caveat: LaunchPad runs `@mariozechner/pi-agent-core`, not the Claude
Agent SDK. Tool-streaming and MCP work, but the PRD's "same harness you already
have" is only half true.

## 2. The PRD cuts the return loop, then names it as the top risk

§14 cuts "presence/standup" from lite. §16 Q3 then asks: *"What is the return
trigger? Without a notification channel, a desk nobody returns to is just a
form."*

**Measured on LaunchPad prod the same week: 116/116 projects locked at 1C, ZERO
gate verdicts ever recorded, 2 human accounts, and Luca's last session was
05/08 — nine days before thirteen deploys he has never seen.**

LaunchPad's problem was never time-to-first-artifact. It is that nobody comes
back. Audos's answer is the daily standup + Otto's email; the PRD cuts exactly
that. **Recommendation: promote the return trigger into Phase 1** — one daily
email with one agenda item is cheaper than the style picker and addresses the
failure we can actually measure.

## 3. Two places we are already ahead — do not regress them

- **§15.1 (unauthenticated workspace reads).** LaunchPad authorises every
  project-scoped route through `tryProjectAccess`; verified live today —
  `/gate-verdict` returns 401 unauthenticated while a nonexistent route returns
  404. Keep that property; it is the one the PRD says Audos got wrong.
- **The evidence spine, knowledge graph and watchers** have no Audos
  equivalent. The lite play is to stop making them a *prerequisite*, not to
  delete them.

## 4. On §13's commitment device

"$1 unlocks a $50 match" is worth stealing independently of any investment
model — especially since LaunchPad's measured economics are **~2.3× underwater**
($2.27 real LLM spend against $1.00 charged on the test project). A small
commitment step before generation both filters intent and covers cost.

## 5. The question I would answer first

§16 Q1 — "fewer features, or a narrower vertical?" — is the real fork, and the
prod data argues for **vertical**. A general lite version competes with Audos on
their strength (breadth, speed, capital). A vertical one can hard-code the three
kickoff questions and the aesthetic presets to a niche and win on quality, which
is where LaunchPad's evidence machinery is actually an advantage rather than a
tax.
