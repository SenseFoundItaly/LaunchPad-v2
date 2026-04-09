---
name: founder-lens
description: Execution-focused view of all project data with priorities, risks, timeline feasibility, and cross-skill status
---

# Founder Lens

Produce an execution-focused status view of the entire project, optimized for founder decision-making. This is not analysis -- it is a dashboard that tells the founder exactly where they stand and what to do next.

## When to Use

- When founder asks "what should I do now?" or "where do I stand?"
- Weekly check-ins and status reviews
- After completing multiple skills to synthesize the overall picture
- Before important meetings (board, investor, team) to prepare talking points
- When the founder feels overwhelmed and needs clarity

## Instructions

### Execution Priorities (Maximum 3)

The most important things to do THIS WEEK. Not this month, not this quarter -- this week.

**Rules:**
- Maximum 3 priorities. If everything is a priority, nothing is.
- Each must be a specific, completable action (not "work on growth")
- Include estimated time investment
- Reference the data that makes this the priority

**Format:**
- WRONG: "Focus on customer acquisition"
- RIGHT: "Interview 5 target customers this week using the validation script from scientific-validation. Your persona data has zero direct customer quotes, which weakens every downstream analysis."

### Key Execution Risks (Maximum 3)

Specific, quantified risks to the CURRENT plan. Not theoretical risks -- things that could derail THIS week or THIS month.

**Format:**
- WRONG: "Technical risk is a concern"
- RIGHT: "No tech cofounder identified. At current search rate (2 conversations/week), you are 6-8 weeks from a hire, which pushes MVP launch past the August window your GTM strategy targets."

### Timeline Feasibility

Assess the overall plan timeline:
- **on_track:** Current pace matches the plan
- **tight:** Achievable but no margin for error
- **at_risk:** Will miss deadlines without changes
- **unrealistic:** Plan needs to be revised

Include specific reasoning referencing actual milestones and dates.

### Founder Summary

1-2 sentence takeaway. This is what the founder reads if they read nothing else.

**Format:**
- WRONG: "Things are progressing well with some areas needing attention."
- RIGHT: "You have strong market validation (score: 72) but zero customer conversations. Your next fundraise depends on customer evidence -- prioritize interviews over product features this week."

### Progress Since Last Check

What changed since the last time founder-lens was run (or since the last relevant skill output):
- **Improved:** Metrics or scores that went up, milestones completed
- **Regressed:** Metrics that declined, deadlines missed
- **Stalled:** Things that have not moved in >2 weeks

Reference actual data: metric values, score changes, dates.

### Cross-Skill Status

For each of the 19 skills, report:
- **completed:** Skill has been run with results
- **stale:** Results exist but are >30 days old or pre-date significant changes
- **not_run:** Never executed
- **recommended:** Should be run next based on current state

Group into the four phases: Discover, Validate, Build, Fundraise.

### Data-Grounded Requirement

Every statement in founder-lens MUST reference specific data from the project:
- Scores with numerical values
- Metrics with actual numbers
- Timeline dates with actual deadlines
- Competitor names with actual findings

If data does not exist for a section, say "No data available -- run [skill name] first" rather than speculating.

## Output Format

```json
{
  "founder_lens": {
    "execution_priorities": [
      {
        "priority": 1,
        "action": "Specific action to take this week",
        "time_estimate": "5 hours",
        "reasoning": "Why this is the top priority, with data reference",
        "blocks": "What this unblocks when completed"
      }
    ],
    "execution_risks": [
      {
        "risk": "Specific, quantified risk",
        "impact": "What happens if not addressed",
        "timeline": "When this becomes critical",
        "mitigation": "Suggested action"
      }
    ],
    "timeline_feasibility": {
      "status": "tight",
      "reasoning": "Specific explanation with dates and milestones",
      "key_dates": [
        { "date": "2026-05-15", "milestone": "MVP launch", "status": "at_risk", "reason": "Why" }
      ]
    },
    "summary": "1-2 sentence executive summary for the founder",
    "progress": {
      "improved": [{ "item": "What improved", "from": "Previous value", "to": "Current value" }],
      "regressed": [{ "item": "What declined", "from": "Previous value", "to": "Current value" }],
      "stalled": [{ "item": "What has not moved", "last_activity": "Date", "days_stalled": 14 }]
    },
    "skill_status": {
      "discover": {
        "idea_shaping": "completed",
        "startup_scoring": "stale",
        "market_research": "completed"
      },
      "validate": {
        "scientific_validation": "not_run",
        "business_model": "not_run",
        "risk_scoring": "not_run"
      },
      "build": {
        "prototype_spec": "not_run",
        "gtm_strategy": "not_run",
        "growth_optimization": "not_run"
      },
      "fundraise": {
        "financial_model": "not_run",
        "investment_readiness": "not_run",
        "investment_scoring": "not_run",
        "pitch_coaching": "not_run",
        "investor_relations": "not_run"
      }
    },
    "overall_readiness_pct": 28,
    "recommended_next_skill": "scientific-validation",
    "recommended_reason": "Why this skill should be run next"
  }
}
```
