---
name: growth-optimization
description: Runs iterative growth optimization loops using the Hypothesis-Test-Evaluate-Ratchet cycle
---

# Growth Optimization

Run structured optimization loops inspired by the AutoResearch pattern (Karpathy). Each loop follows a disciplined cycle: form a hypothesis, design a test, evaluate results, and ratchet forward by locking in what works. This skill tracks accumulated learnings across iterations and detects when a given optimization target has reached diminishing returns.

## When to Use

- Founder has a live product and wants to improve a specific metric
- After initial traction, when growth has stalled or plateaued
- When testing messaging, pricing, positioning, funnel steps, or outreach
- When the founder is making changes without a structured framework
- Periodically to review accumulated learnings and plan next optimization cycle

## Instructions

### The Optimization Cycle

Each iteration follows four steps:

#### Step 1: Hypothesis

Form a clear, falsifiable hypothesis:

- **Format:** "If we [change X], then [metric Y] will [improve/change] by [estimated amount] because [reasoning]."
- The hypothesis must be specific enough to test. "If we make the landing page better" is not a hypothesis. "If we change the headline from feature-focused to pain-focused, conversion rate will increase by 15% because our customer interviews showed pain is the primary motivator" is a hypothesis.
- Each hypothesis should target exactly one variable. If the founder wants to change three things, those are three separate tests.
- Rate the hypothesis confidence (low/medium/high) before testing.

#### Step 2: Test

Design a minimum viable test:

- **What to change:** Specific, concrete change to implement
- **How to measure:** Which metric, measured how, over what timeframe
- **Sample size needed:** Minimum data points for a meaningful result (avoid drawing conclusions from 12 visitors)
- **Duration:** How long the test should run
- **Success threshold:** What result would confirm the hypothesis? What would reject it?
- **Control:** What is the baseline being compared against?

Keep tests small and fast. A two-week A/B test beats a six-month product overhaul every time.

#### Step 3: Evaluate

Analyze results honestly:

- **Did the metric move?** By how much? Is the change statistically meaningful given the sample size?
- **Was the hypothesis confirmed, rejected, or inconclusive?**
- **What surprised you?** Unexpected results often contain the most valuable insights.
- **Confounding factors:** Did anything else change during the test period that could explain the results?
- **If inconclusive:** Was the test too short? Sample too small? Variable too subtle? Decide whether to extend, redesign, or abandon.

#### Step 4: Ratchet

Lock in learnings and decide next steps:

- **If confirmed:** Implement the change permanently. Document what worked and why. This becomes a "ratchet" -- you never go backward.
- **If rejected:** Revert the change. Document what did not work and the hypothesis about why. This is equally valuable data.
- **If inconclusive:** Decide whether the test is worth extending or whether to move to a higher-impact hypothesis.
- **Update the learning log** with the result, regardless of outcome.
- **Identify the next hypothesis** based on what was learned.

### Optimization Targets

The skill can optimize across these domains:

1. **Messaging** -- Headlines, copy, email subject lines, ad creative, value propositions
2. **Pricing** -- Price points, packaging, discounts, trial length, freemium limits
3. **Positioning** -- Market category, competitive framing, use case emphasis
4. **Funnel** -- Sign-up flow, onboarding steps, activation triggers, retention hooks
5. **Outreach** -- Cold email, content strategy, channel selection, partnership approaches

### Accumulated Learning Tracking

Maintain a learning log across all iterations:

```
Loop #: [sequential number]
Target: [messaging | pricing | positioning | funnel | outreach]
Hypothesis: [statement]
Confidence: [low | medium | high]
Result: [confirmed | rejected | inconclusive]
Key Learning: [one sentence]
Metric Impact: [quantified change or "no significant change"]
Date: [when completed]
```

After every 5 loops, generate a synthesis of accumulated learnings. Look for patterns:
- Which optimization targets yield the highest returns?
- Are there themes in what works (e.g., pain-focused messaging always outperforms feature-focused)?
- What assumptions have been invalidated?

### Diminishing Returns Detection

Monitor for these signals that an optimization target is exhausted:

- **Last 3 tests in the same target area showed less than 5% improvement each**
- **Hypothesis quality is declining** (ideas feel incremental rather than insightful)
- **The metric is within 10% of a theoretical or benchmark ceiling**
- **Opportunity cost is rising** (time spent here could yield more elsewhere)

When diminishing returns are detected, recommend shifting to a different optimization target and explain why.

### Guardrails

- Never recommend a test that could permanently damage the brand or customer relationships
- Flag when a test requires more traffic or users than the startup currently has
- Recommend qualitative research (customer interviews) when quantitative tests are not feasible due to low volume
- Warn against over-optimization of vanity metrics at the expense of core business metrics

## Output Format

### For a New Optimization Loop

```json
{
  "optimization_loop": {
    "loop_number": 1,
    "target": "messaging | pricing | positioning | funnel | outreach",
    "hypothesis": {
      "statement": "If we [X], then [Y] will [Z] because [reasoning]",
      "confidence": "low | medium | high",
      "variable": "The one thing being changed",
      "target_metric": "The metric being measured"
    },
    "test_design": {
      "change": "Specific change to implement",
      "measurement": "How to measure the result",
      "sample_size_needed": "Minimum data points",
      "duration": "Recommended test duration",
      "success_threshold": "What confirms the hypothesis",
      "failure_threshold": "What rejects the hypothesis",
      "control": "Baseline for comparison"
    },
    "status": "planned | testing | evaluating | complete"
  }
}
```

### For Evaluation Results

```json
{
  "evaluation": {
    "loop_number": 1,
    "result": "confirmed | rejected | inconclusive",
    "metric_before": "Baseline value",
    "metric_after": "Result value",
    "change_percent": "X%",
    "sample_size_actual": "How many data points collected",
    "confidence_level": "Statistical confidence if applicable",
    "surprises": "Unexpected findings",
    "confounding_factors": "Anything that may have affected results",
    "learning": "One-sentence key takeaway",
    "next_action": "implement | revert | extend test | new hypothesis",
    "ratchet": "What is permanently locked in (if confirmed)"
  }
}
```

### For Learning Synthesis

```json
{
  "learning_synthesis": {
    "loops_completed": 0,
    "by_target": {
      "messaging": {"loops": 0, "avg_impact": "X%", "best_learning": "..."},
      "pricing": {"loops": 0, "avg_impact": "X%", "best_learning": "..."}
    },
    "top_learnings": ["Learning 1", "Learning 2"],
    "invalidated_assumptions": ["Assumption 1"],
    "diminishing_returns_detected": ["target area if any"],
    "recommended_next_target": "Where to focus next and why"
  }
}
```

## Examples

### Example: Starting a Messaging Loop

**Founder:** "Our landing page converts at 2.1%. I want to improve it."

**Agent response:** A 2.1% landing page conversion rate is below average for most B2B SaaS (typical range is 3-8%). There is room to improve. Let me design the first optimization loop.

**Loop 1 -- Messaging -- Headline Test**

**Hypothesis:** If we change the headline from "AI-Powered Project Management" (feature-focused) to "Stop Losing 5 Hours a Week to Project Updates" (pain-focused), conversion rate will increase by at least 30% (to ~2.7%) because your customer interviews indicate time waste is the primary pain point.

**Confidence:** Medium -- pain-focused headlines generally outperform feature-focused ones, but the specific claim needs validation.

**Test design:**
- Split traffic 50/50 between current and new headline
- Measure sign-up conversion rate
- Need minimum 500 visitors per variation (1,000 total)
- Run for 2 weeks or until sample size is reached
- Success: conversion rate for new headline is >2.5% with >90% statistical confidence
- Failure: no significant difference or new headline performs worse

Based on your current traffic of ~200 visitors/day, this test will take approximately 5 days to reach statistical significance. Can you implement this split test?

### Example: Detecting Diminishing Returns

**Agent:** We have now run 4 consecutive messaging tests on the landing page headline. Results:

- Loop 3: +22% (pain-focused headline -- ratcheted)
- Loop 5: +11% (added social proof number)
- Loop 8: +4% (refined word choice)
- Loop 11: +2% (emoji variant)

The pattern is clear: each successive headline test yields smaller gains. Your conversion rate has improved from 2.1% to 3.4%, which is now within the normal B2B SaaS range. I recommend shifting optimization focus from messaging to funnel (specifically your sign-up flow, which has a 60% drop-off between landing page and completing onboarding). The potential impact there is much higher than squeezing another 1-2% from headlines.
