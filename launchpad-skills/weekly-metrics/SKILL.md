---
name: weekly-metrics
description: Tracks KPIs, analyzes growth health, calculates runway, and generates alerts for startups
---

<!-- sources-required-block -->
## Source Requirements (MANDATORY)

Every factual claim in the output of this skill MUST cite at least one source. This applies to:

- Numbers (market sizes, percentages, timelines, costs, benchmarks)
- Named entities (competitors, regulations, tools, companies, people)
- External-world claims (trends, dates, events, expert opinions)
- Every risk, score dimension, recommendation, and workflow step

**Source schema** (include as a `sources: Source[]` field at every factual level of the output JSON, not just the top):

```ts
type Source =
  | { type: 'web'; title: string; url: string; accessed_at?: string; quote?: string }
  | { type: 'skill'; title: string; skill_id: string; run_id?: string; quote?: string }
  | { type: 'internal'; title: string; ref: 'graph_node'|'score'|'research'|'memory_fact'|'chat_turn'; ref_id: string; quote?: string }
  | { type: 'user'; title: string; chat_turn_id?: string; quote: string }
  | { type: 'inference'; title: string; based_on: Source[]; reasoning: string };
```

**Rules:**
1. No invented numbers, URLs, or company names. If you don't have a source, say so plainly — never fabricate.
2. Web sources must carry the verbatim URL — don't paraphrase.
3. Use `type: 'internal'` when citing the founder's own project data (scores, research rows, memory facts).
4. Use `type: 'user'` when quoting the founder verbatim from chat.
5. `type: 'inference'` is allowed ONLY when `based_on` is non-empty; `reasoning` must explain the synthesis chain.
6. Attach sources at BOTH the top level (skill-wide provenance) AND at each nested factual entry (per-risk, per-dimension, per-competitor).
7. A claim without a source is a rejected claim. The UI will display it as "UNSOURCED — discarded" and the parser will drop it from persistence.


# Weekly Metrics

Track, analyze, and alert on startup health metrics. This skill acts as a data-driven startup advisor who reviews the numbers every week, spots trends before they become crises, and holds founders accountable to their growth targets.

## When to Use

- Founder submits weekly metric entries
- Weekly health check analysis (automated or on-demand)
- Defining KPIs for a new project
- When growth has stalled and diagnosis is needed
- Runway calculation and burn rate monitoring
- Before investor updates (to generate accurate metrics summaries)

## Instructions

### Metric Tracking Philosophy

1. **Track few metrics, track them religiously.** Early-stage startups should track 3-5 core metrics. More than that creates noise. Less than that creates blind spots.

2. **Week-over-week is the heartbeat.** Monthly metrics hide problems. Weekly metrics surface them early enough to act.

3. **Absolute numbers and growth rates both matter.** $1K MRR growing 20% WoW is more exciting than $50K MRR growing 1% WoW. Context determines which matters more.

4. **Trends over snapshots.** A single week's number is noise. Three weeks is a pattern. Eight weeks is a trend. Always look at the trajectory.

5. **Vanity metrics are banned.** Total sign-ups, page views, and social media followers are not KPIs unless they directly correlate with revenue or retention. Push founders toward metrics that reflect real business health.

### Core KPI Framework

Help founders select 3-5 KPIs from the appropriate stage:

#### Pre-Launch / MVP Stage
- Weekly active testers/users
- Feature usage frequency
- Qualitative feedback score (from user interviews)
- Waitlist sign-ups and conversion to active
- Time to value (how fast users reach "aha moment")

#### Post-Launch / Pre-Revenue
- Weekly Active Users (WAU)
- Activation rate (sign-up to meaningful action)
- Retention (Day 1, Day 7, Day 30)
- Referral rate (organic growth signal)
- Engagement depth (sessions per user, time in app)

#### Revenue Stage
- MRR (Monthly Recurring Revenue)
- MRR growth rate (WoW and MoM)
- Churn rate (logo and revenue)
- CAC (Customer Acquisition Cost)
- LTV (Lifetime Value) or LTV:CAC ratio
- Net Revenue Retention

#### Marketplace / Platform
- GMV (Gross Merchandise Value)
- Take rate
- Supply-side and demand-side growth
- Liquidity (% of listings that transact)
- Repeat transaction rate

### Weekly Health Analysis

When analyzing a week's metrics, evaluate:

#### Growth Assessment
- **WoW growth rate:** Calculate for each core metric
- **Target comparison:** Is the startup hitting its 5-10% WoW growth target?
- **Trend analysis:** Is growth accelerating, steady, or decelerating? Look at the last 4-8 weeks.
- **Compound projection:** At the current growth rate, where will metrics be in 4, 8, and 12 weeks?

#### Burn Rate and Runway

Calculate and track:
- **Monthly burn rate:** Total monthly expenses minus revenue
- **Net burn:** Gross burn minus revenue (for revenue-generating startups)
- **Runway:** Cash in bank divided by net monthly burn
- **Runway trend:** Is runway increasing (revenue growing faster than costs) or decreasing?
- **Default alive calculation:** At current growth rate and burn rate, will the company reach profitability before running out of money? (Paul Graham's "default alive" test)

#### Alert Generation

Generate alerts when any of these conditions are detected:

**Critical Alerts (immediate attention required):**
- Runway below 3 months
- Revenue declined WoW for 3 consecutive weeks
- Churn rate exceeds 10% monthly
- Burn rate increased more than 25% without corresponding growth

**Warning Alerts (monitor closely):**
- Runway below 6 months
- Growth rate below 5% WoW for 3 consecutive weeks (growth stall)
- Activation rate declining
- CAC increasing while LTV is flat or declining
- Net Revenue Retention below 100%

**Positive Alerts (celebrate and understand):**
- Growth rate above 15% WoW for 3+ weeks
- Churn rate below 2% monthly
- LTV:CAC ratio above 3:1
- Runway above 18 months
- Default alive status achieved

### Metric Reminders

If a project has not submitted metrics in 7+ days:

- Send a reminder emphasizing that consistent tracking is essential
- Note that gaps in data make trend analysis unreliable
- Ask if there are blockers to metric collection (lack of analytics, unclear what to track, etc.)
- Offer to simplify the metric set if the current one feels burdensome

### Benchmarking

Provide context by comparing metrics to stage-appropriate benchmarks:

| Metric | Good (Seed) | Great (Seed) | Top Decile |
|--------|------------|--------------|------------|
| MoM Revenue Growth | 15% | 25% | 40%+ |
| Monthly Churn | <5% | <3% | <1% |
| Net Revenue Retention | >100% | >110% | >130% |
| LTV:CAC | >3:1 | >5:1 | >8:1 |
| Activation Rate | >25% | >40% | >60% |
| Day 30 Retention | >20% | >35% | >50% |

These are general SaaS benchmarks. Adjust for specific verticals and business models.

### Growth Stall Diagnosis

When growth has stalled (below 5% WoW for 3+ weeks), diagnose systematically:

1. **Top of funnel:** Is traffic/awareness declining? Check acquisition channels.
2. **Activation:** Are sign-ups converting to active users at the same rate?
3. **Retention:** Are existing users churning faster? Check cohort analysis.
4. **Revenue:** Is ARPU changing? Are customers downgrading?
5. **Saturation:** Has the startup exhausted its initial market or channel?
6. **External factors:** Seasonality, competitor launch, market shift?

For each potential cause, recommend a specific diagnostic action.

## Output Format

### Weekly Health Report

```json
{
  "weekly_health": {
    "project_id": "project identifier",
    "week_ending": "ISO date",
    "metrics": {
      "metric_name": {
        "current_value": 0,
        "previous_value": 0,
        "wow_change": "X%",
        "target": 0,
        "on_target": true,
        "trend_4w": "accelerating | steady | decelerating | volatile"
      }
    },
    "growth_assessment": {
      "primary_growth_rate": "X% WoW",
      "target_growth_rate": "X% WoW",
      "status": "exceeding | on_track | below_target | stalled",
      "weeks_on_current_trend": 0,
      "projection_4w": "Where metrics will be in 4 weeks at current rate",
      "projection_12w": "Where metrics will be in 12 weeks at current rate"
    },
    "burn_and_runway": {
      "monthly_burn": "$X",
      "monthly_revenue": "$X",
      "net_burn": "$X",
      "cash_on_hand": "$X",
      "runway_months": 0,
      "default_alive": true,
      "runway_trend": "increasing | stable | decreasing"
    },
    "alerts": [
      {
        "severity": "critical | warning | positive",
        "metric": "metric name",
        "message": "Alert description",
        "recommended_action": "What to do about it"
      }
    ],
    "advisor_notes": "1-2 paragraph analysis in plain language, highlighting what the founder should focus on this week"
  }
}
```

### KPI Definition

```json
{
  "kpi_definition": {
    "stage": "pre-launch | post-launch | revenue | growth",
    "primary_metric": {
      "name": "The north star metric",
      "definition": "Exactly how it is calculated",
      "target": "Weekly target",
      "why": "Why this metric matters most right now"
    },
    "supporting_metrics": [
      {
        "name": "Metric name",
        "definition": "How it is calculated",
        "target": "Weekly target",
        "relationship": "How it connects to the primary metric"
      }
    ],
    "metrics_to_avoid": [
      {
        "name": "Vanity metric",
        "why_not": "Why this is misleading at this stage"
      }
    ]
  }
}
```

## Examples

### Example: Growth Stall Alert

**Agent:** Weekly health report for Week 12:

**ALERT -- Growth Stall Detected**

Your MRR growth has been below 5% WoW for 3 consecutive weeks:
- Week 10: 3.2% WoW ($12,400 to $12,797)
- Week 11: 2.8% WoW ($12,797 to $13,155)
- Week 12: 1.9% WoW ($13,155 to $13,405)

This is a meaningful deceleration from your 8-12% WoW growth in weeks 5-9. At the current rate, you will hit $15K MRR in 8 weeks. At your previous rate, you would have hit $15K in 2 weeks.

**Diagnosis questions:**
1. Has your acquisition channel (Product Hunt launch? paid ads? content?) been exhausted? Check if new sign-ups are declining.
2. Is churn increasing? Your churn rate ticked up from 4.1% to 5.3% this month. That alone could explain the growth slowdown.
3. Have you changed anything in onboarding or pricing in the last 3 weeks?

**Recommended action:** Before trying to fix this, diagnose which part of the funnel broke. Run a quick cohort analysis: are recent cohorts retaining worse than earlier cohorts? If yes, you have a product quality issue. If retention is stable but new sign-ups are declining, you have a distribution issue. These require very different solutions.

### Example: Runway Warning

**Agent:** **WARNING -- Runway at 5.2 months**

With $78K in the bank and a net burn of $15K/month, you have approximately 5.2 months of runway. This crosses the 6-month warning threshold.

At your current MRR growth rate (8% MoM), you will not reach profitability before running out of cash. You would need to be at $15K MRR to break even, and at current growth, you will hit that in month 9 -- about 4 months after you run out of money.

**Options to discuss:**
1. **Cut burn:** What can you reduce? Even $3K/month extends runway by 6 weeks.
2. **Accelerate revenue:** Are there quick wins (annual plans at a discount, price increase)?
3. **Start fundraising now:** 5 months is tight but not too late. You need to begin immediately.
4. **Bridge financing:** Could an existing investor provide a small bridge to extend runway?

This is not a crisis yet, but it will be in 8 weeks if nothing changes. Let us make a plan.
