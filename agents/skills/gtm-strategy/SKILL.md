---
name: gtm-strategy
description: Produces a go-to-market campaign brief with ICE-scored channels, launch sequence, and per-channel KPIs
---

# GTM Strategy

Produce a go-to-market campaign brief with channel identification, ICE scoring, a week-by-week launch sequence, budget allocation, and success KPIs per channel. Grounded in buyer personas and competitive positioning.

## When to Use

- After scientific-validation (requires buyer personas for channel selection)
- When founder is planning market entry or product launch
- When deciding how to allocate marketing budget across channels
- Before growth-optimization to establish baseline channels
- When preparing the GTM section of an investor deck

## Instructions

### Channel Identification

Identify 4-6 acquisition channels appropriate for the founder's buyer personas and market. For each channel, be specific:
- Not "social media" → "LinkedIn thought leadership targeting VP Engineering personas"
- Not "content marketing" → "Technical blog (SEO-optimized) targeting 'how to [solve problem]' queries with 2,400+ monthly search volume"
- Not "paid ads" → "Google Ads on competitor brand terms + problem-aware keywords, estimated €3.50 CPC"

Reference scientific-validation personas: where does Persona 1 discover solutions? What channels align with their buying process stages?

### ICE Scoring (per channel)

Score each channel on three dimensions (1-10):

**Impact (1-10):** How many qualified leads can this channel produce at scale?
- 9-10: Can produce 100+ qualified leads/month at maturity
- 7-8: 30-100 qualified leads/month
- 5-6: 10-30 qualified leads/month
- 3-4: 5-10 qualified leads/month
- 1-2: <5 qualified leads/month

**Confidence (1-10):** How certain are you this will work for THIS specific startup?
- 9-10: Proven channel for competitors in this exact market
- 7-8: Strong evidence from comparable markets
- 5-6: Reasonable hypothesis with some supporting data
- 3-4: Speculative but logical
- 1-2: Untested, high uncertainty

**Ease (1-10):** How quickly and cheaply can you test this channel?
- 9-10: Can test in 1 week for <€500
- 7-8: 2-4 weeks, <€2,000
- 5-6: 1-2 months, <€5,000
- 3-4: 2-3 months, <€10,000
- 1-2: 3+ months, >€10,000

**Composite Score:** (Impact + Confidence + Ease) / 3. Rank channels by composite score.

### Per-Channel Details

For each channel provide:

- **Estimated CAC:** Cost to acquire one customer through this channel (specific EUR)
- **Expected Conversion Rate:** From lead to paying customer (specific %)
- **Time to First Results:** When you will know if this channel works
- **Resource Requirements:** Who is needed (founder time, hire, agency) and hours per week
- **Competitive Presence:** Are competitors using this channel? How saturated is it?
- **Quick Win Test:** The minimum viable test to validate this channel in 2 weeks or less

### Launch Sequence

Week-by-week plan for the first 12 weeks:

**Weeks 1-2: Foundation**
- What to set up (landing page, tracking, content pipeline)
- Specific deliverables with owners

**Weeks 3-4: Test Top 2 Channels**
- Start with the two highest-ICE channels simultaneously
- Define success criteria for each (specific metrics)

**Weeks 5-8: Double Down or Pivot**
- Decision criteria: at what metrics do you double down vs. kill a channel?
- Second-tier channels to test if top channels underperform

**Weeks 9-12: Scale What Works**
- Increase budget on winning channels
- Optimization targets (reduce CAC, improve conversion)

### Budget Allocation

- **Total Monthly Budget:** Specific EUR amount
- **Per Channel:** EUR per month with percentage of total
- **Buffer:** 10-15% for opportunistic tests
- **Decision Rule:** "Kill a channel if CAC exceeds €X after Y weeks of testing"

### Success KPIs per Channel

For each channel, define:
- **Leading Indicator:** What you measure weekly (e.g., "impressions," "click-through rate")
- **Lagging Indicator:** What determines success (e.g., "qualified leads," "customers acquired")
- **Target:** Specific number within specific timeframe
- **Kill Threshold:** Below what number you abandon this channel

## Output Format

```json
{
  "gtm_strategy": {
    "channels": [
      {
        "name": "Specific channel description",
        "ice_score": {
          "impact": 8,
          "impact_rationale": "Why this impact score",
          "confidence": 7,
          "confidence_rationale": "Why this confidence",
          "ease": 6,
          "ease_rationale": "Why this ease score",
          "composite": 7.0
        },
        "estimated_cac": "€2,400",
        "conversion_rate": "4% from lead to customer",
        "time_to_results": "4-6 weeks",
        "resource_requirements": "Founder: 5 hrs/week + freelance writer: 10 hrs/week",
        "competitive_presence": "Competitor X runs €5K/month on this channel",
        "quick_win_test": "What to do in 2 weeks to validate"
      }
    ],
    "launch_sequence": [
      {
        "weeks": "1-2",
        "phase": "Foundation",
        "deliverables": ["Landing page live", "Analytics configured"],
        "success_criteria": "Baseline metrics established"
      }
    ],
    "budget": {
      "total_monthly": "€5,000",
      "allocation": [
        { "channel": "Channel name", "monthly_eur": "€2,000", "pct_of_total": 40 }
      ],
      "buffer": "€500 (10%)",
      "kill_rule": "Abandon channel if CAC > €5,000 after 6 weeks"
    },
    "kpis": [
      {
        "channel": "Channel name",
        "leading_indicator": { "metric": "Weekly signups", "target": "25/week by week 8" },
        "lagging_indicator": { "metric": "Paying customers", "target": "10 by week 12" },
        "kill_threshold": "<5 signups/week after 4 weeks"
      }
    ],
    "recommended_next": "growth-optimization"
  }
}
```

## Examples

### Example: Channel Prioritization

**Founder:** "I have €3,000/month for marketing. Where should I spend it?"

**Agent:** Based on your buyer persona (Platform Team Lead, 50-200 person companies, discovers tools via peer referrals and LinkedIn), here are your top channels ranked by ICE score:

**1. LinkedIn Organic + DMs (ICE: 8.3)**
- Impact: 8 -- Your Persona 2 lives on LinkedIn. 15-30 qualified conversations/month is realistic.
- Confidence: 9 -- Competitor Y built their first 100 customers this way (per their blog post from 2025).
- Ease: 8 -- Zero ad spend, 5 hours/week of founder time, test in 1 week.
- CAC: ~€0 (founder time only). This is your highest-ROI channel.
- Quick win: Post 3 thought leadership pieces this week, DM 20 target personas.

**2. Google Ads on Problem Keywords (ICE: 6.7)**
- Impact: 7 -- "How to manage developer productivity" gets 1,900 searches/month.
- Confidence: 6 -- Competitors bid on these terms, suggesting they convert, but your landing page is untested.
- Ease: 7 -- €1,500/month test budget, results in 2-3 weeks.
- CAC: ~€3,200 (estimated at €3.50 CPC, 2% CTR, 3% conversion).
- Quick win: Run €500 on top 5 keywords for 2 weeks, measure cost per signup.

**Recommendation:** Put 100% of effort into LinkedIn for weeks 1-4. It is free and highest-confidence. Start Google Ads in week 3 with €1,500. Kill Google Ads if CAC exceeds €4,000 by week 6.
