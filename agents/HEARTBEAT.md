# LaunchPad Heartbeat -- Weekly Autonomous Tasks

## Schedule Overview

The heartbeat runs weekly, triggered every Monday at 9:00 AM UTC. It performs proactive checks across all active projects and generates reminders, alerts, and summaries without waiting for founder input.

## Monday Morning Cycle

### Step 1: Metric Entry Check

**For each active project, check whether metric entries exist for the past 7 days.**

#### Projects WITH Recent Metrics

Run the weekly-metrics health analysis:

1. Calculate WoW growth rates for all tracked KPIs
2. Compare against project-specific targets (default: 5-10% WoW)
3. Calculate current burn rate and runway
4. Run alert detection (critical, warning, positive)
5. Generate a health summary

**Output:** Weekly health report delivered to the project. If critical alerts are detected, flag them prominently.

**Template for health summary notification:**

```
Weekly Health Check -- [Project Name] -- Week of [Date]

Growth: [Primary metric] is [X% WoW] ([above/below] your [Y%] target)
Runway: [X months] at current burn of [$X/month]
Alerts: [Number] critical, [Number] warnings, [Number] positive

[If critical alerts exist:]
ATTENTION NEEDED:
- [Alert description and recommended action]

[One-paragraph advisor note on what to focus on this week]
```

#### Projects WITHOUT Recent Metrics

Send a metric reminder:

**Template for metric reminder:**

```
Metric Reminder -- [Project Name]

It has been [X days] since your last metric entry. Consistent weekly tracking is essential for spotting trends early and making informed decisions.

Your tracked KPIs:
- [KPI 1]: Last value [X] on [date]
- [KPI 2]: Last value [X] on [date]

Quick update: What are this week's numbers?

If metric collection is difficult or the current KPIs do not feel right, let me know and we can simplify or adjust what you are tracking.
```

**Escalation:** If a project has not submitted metrics for 3+ consecutive weeks, upgrade the tone:

```
Metric Gap Alert -- [Project Name]

No metrics submitted in [X weeks]. Without data, I cannot provide meaningful guidance on growth, runway, or health.

This is not about busywork. The startups I have seen succeed track their numbers every week, even when the numbers are bad. Especially when the numbers are bad.

Two options:
1. Submit this week's numbers (even rough estimates are better than nothing)
2. Tell me what is blocking metric collection and we will fix it

Which would you prefer?
```

### Step 2: Growth Loop Check

**For each project with active growth optimization loops:**

Check if any loop has been in "testing" status for more than 7 days without an evaluation.

**If overdue loops are found, prompt for results:**

```
Growth Loop Follow-Up -- [Project Name]

Loop #[X] ([target]: "[hypothesis]") has been in testing for [X days].

Do you have results yet? Even partial results are useful:
- What is the metric showing so far?
- Has enough data been collected for the test to be meaningful?
- Did anything unexpected happen during the test?

If the test needs more time, let me know and I will check back in [suggested timeframe]. If you have decided to abandon this test, that is fine too -- tell me why and we will design the next one.
```

### Step 3: Fundraising Pipeline Check

**For each project with an active fundraising pipeline:**

Check for investors with overdue next_steps (next_action_due date has passed).

**If overdue follow-ups are found, send a reminder:**

```
Fundraising Follow-Up Reminder -- [Project Name]

[X] investor follow-ups are overdue:

[For each overdue investor:]
- [Investor Name] ([Firm]) -- [Stage]
  Last interaction: [date] ([X days ago])
  Overdue action: [next_action description]
  Suggested message: "[Draft follow-up message based on context]"

Momentum matters in fundraising. Delayed follow-ups signal low interest or disorganization. I recommend addressing these today.

[If any investor has been in "reached_out" with no response for 14+ days:]
Note: [Investor Name] has not responded to outreach in [X days]. Consider whether a different intro path exists or whether to move them to "passed" and focus energy elsewhere.
```

### Step 4: Weekly Summary Generation

**After all checks are complete, generate a cross-project weekly summary.**

```
LaunchPad Weekly Summary -- Week of [Date]

ACTIVE PROJECTS: [X]

[For each project, one-line status:]
- [Project Name]: [Primary metric] at [value] ([X% WoW]) | Runway: [X months] | [Key alert or status]

ATTENTION NEEDED:
- [List any critical alerts across all projects]
- [List any projects with 3+ weeks of missing metrics]
- [List any fundraising follow-ups overdue by 7+ days]

WINS THIS WEEK:
- [List any positive alerts: strong growth, good retention, runway extending]

UPCOMING:
- [Projects approaching runway warnings]
- [Growth loops needing evaluation]
- [Fundraising milestones approaching]
```

## Heartbeat Configuration

### Timing
- **Primary run:** Monday 9:00 AM UTC
- **Follow-up check:** Thursday 9:00 AM UTC (only for critical alerts and overdue items from Monday)

### Thresholds

| Check | Trigger | Severity |
|-------|---------|----------|
| No metrics in 7 days | Send reminder | Info |
| No metrics in 21 days | Send escalated reminder | Warning |
| No metrics in 35 days | Flag project as potentially inactive | Critical |
| Growth loop testing > 7 days | Prompt for results | Info |
| Growth loop testing > 21 days | Suggest abandoning or redesigning | Warning |
| Investor follow-up overdue 1-3 days | Include in reminder list | Info |
| Investor follow-up overdue 7+ days | Escalate urgency | Warning |
| Investor follow-up overdue 14+ days | Suggest moving to passed | Critical |
| Runway below 6 months | Warning alert | Warning |
| Runway below 3 months | Critical alert | Critical |
| Growth stall (3+ weeks below target) | Diagnosis prompt | Warning |
| Revenue decline 3+ consecutive weeks | Critical alert | Critical |

### Notification Priority

1. **Critical alerts** are always surfaced first and prominently
2. **Warnings** are included in the summary with recommended actions
3. **Informational items** are bundled into the weekly summary
4. **Positive alerts** are highlighted to maintain founder motivation

### Quiet Mode

If a founder explicitly requests reduced notifications for a project (e.g., "I'm on vacation for 2 weeks"), respect the request:
- Pause metric reminders and growth loop prompts
- Continue running health analysis in the background
- Resume notifications after the quiet period
- If a critical alert triggers during quiet mode (runway below 3 months), send it anyway with a note that it overrides quiet mode due to severity
