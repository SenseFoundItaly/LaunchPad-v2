---
name: investor-lens
description: Investment-focused view with 4 independent scoring dimensions (return potential, defensibility, fundability, risk profile) as an investor would evaluate
---

# Investor Lens

Produce an investment-focused view of the project as a VC or angel investor would evaluate it. Four independent scoring dimensions, each with supporting signals. This helps founders understand how investors will perceive their startup and identify gaps to close before fundraising.

## When to Use

- When founder asks "how would an investor see this?"
- Before fundraising to identify weaknesses from the investor perspective
- When preparing for investor meetings
- After completing scoring skills to translate internal scores into investor language
- When deciding whether now is the right time to raise

## Instructions

### The 4 Independent Dimensions

These dimensions are INDEPENDENT of each other. High return potential can coexist with low defensibility. Score each separately based on available evidence.

#### 1. Return Potential (0-10)

How attractive is the financial return opportunity?

**Signals to evaluate:**
- Market size and growth trajectory
- Revenue model scalability
- Path to €100M+ ARR (or comparable exit value)
- Comparable exits in the space
- Capital efficiency

**Score anchors:**
- 9-10: €1B+ exit potential, proven demand, efficient scaling model
- 7-8: €100M+ exit potential, strong market signals
- 5-6: Viable return but limited upside or long timeline
- 3-4: Uncertain returns, market too small or competitive
- 1-2: Unlikely to generate meaningful investor returns

**Signals (max 3, each max 60 chars):**
Example: "€50M TAM growing 35% YoY", "3-5yr path to €100M+ ARR", "Comparable exit: CompanyX at €800M"

#### 2. Defensibility (0-10)

How protected is this business from competition over time?

**Signals to evaluate:**
- Network effects (each user makes it more valuable for others)
- Data moat (proprietary data that improves with usage)
- Switching costs (how hard is it for customers to leave)
- IP protection (patents, trade secrets, regulatory approvals)
- Brand and trust (takes years to replicate)

**Score anchors:**
- 9-10: Multiple reinforcing moats, near-impossible to replicate
- 7-8: Strong moat in one dimension, building others
- 5-6: Some defensibility but could be overcome with capital
- 3-4: Weak moat, competition could replicate in 12-18 months
- 1-2: No defensibility, commodity product

**Signals (max 3, each max 60 chars):**
Example: "12 patents granted + 8 pending", "Proprietary dataset of 2M+ records", "NPS 72 vs competitor avg 34"

#### 3. Fundability (0-10)

How likely is this startup to successfully raise from investors?

**Signals to evaluate:**
- Team track record and credibility
- Traction and growth metrics
- Social proof (notable customers, advisors, previous investors)
- Narrative quality (is the story compelling?)
- Market timing (are investors currently interested in this space?)

**Score anchors:**
- 9-10: Oversubscribed round likely, proven team, strong traction
- 7-8: Will attract interest, some competitive tension expected
- 5-6: Fundable with effort, needs to close specific gaps
- 3-4: Difficult raise, needs significantly more traction or team
- 1-2: Unlikely to raise in current state

**Signals (max 3, each max 60 chars):**
Example: "Proven founding team (2 exits)", "€50K MRR, 20% MoM growth", "Strategic angel: former CEO of CompetitorX"

#### 4. Risk Profile (0-10, where 10 = lowest risk)

How risky is this investment from an investor perspective?

**Signals to evaluate:**
- Team execution risk (can they deliver?)
- Market risk (will demand materialize?)
- Technical risk (can it be built?)
- Regulatory risk (will regulations help or harm?)
- Competitive risk (will incumbents crush it?)

**Score anchors:**
- 9-10: Well-de-risked, proven across most dimensions
- 7-8: Key risks identified with mitigation plans
- 5-6: Meaningful risks but typical for stage
- 3-4: Above-average risk, multiple concerns
- 1-2: Extremely risky, existential threats unaddressed

**Signals (max 3, each max 60 chars):**
Example: "Regulatory path clear (EU approved class)", "Market timing: early adoption phase", "Technical prototype validated with 50 users"

### Investor Summary

One sentence, VC memo style. This is how an investor would describe this deal to a partner.

**Format:**
- WRONG: "This is an interesting company with some potential."
- RIGHT: "Series Seed candidate with strong unit economics (6x LTV/CAC) in a growing market, limited by first-time founding team and no enterprise sales experience."

### Deal Verdict

- **strong_go:** Compelling across all dimensions, would fight to lead the round
- **go:** Attractive investment, would participate
- **conditional:** Interesting but needs specific conditions met (name them)
- **no_go:** Would not invest at this stage (explain why specifically)

### Investment Thesis

Why this could be a 10x+ return (or why not). 100-200 words. Must reference specific data from the project -- market size, traction metrics, team credentials, competitive position.

### Dealbreakers

Anything that would make a serious investor pass immediately, regardless of other strengths:
- Team red flags
- Market too small for VC returns
- Unsolvable competitive dynamics
- Regulatory impossibility
- Fundamental economic issues

If no dealbreakers exist, state "None identified" -- do not invent problems.

### Gaps to Close Before Fundraise

Specific, actionable items the founder must complete before approaching investors. Ordered by impact.

## Output Format

```json
{
  "investor_lens": {
    "return_potential": {
      "score": 7,
      "signals": ["Signal 1 (max 60 chars)", "Signal 2", "Signal 3"],
      "rationale": "Detailed reasoning with data"
    },
    "defensibility": {
      "score": 5,
      "signals": ["Signal 1", "Signal 2", "Signal 3"],
      "rationale": "Detailed reasoning with data"
    },
    "fundability": {
      "score": 6,
      "signals": ["Signal 1", "Signal 2", "Signal 3"],
      "rationale": "Detailed reasoning with data"
    },
    "risk_profile": {
      "score": 6,
      "signals": ["Signal 1", "Signal 2", "Signal 3"],
      "rationale": "Detailed reasoning with data"
    },
    "investor_summary": "One-sentence VC memo assessment",
    "verdict": "conditional",
    "verdict_conditions": ["Condition 1 that must be met", "Condition 2"],
    "investment_thesis": "100-200 word thesis with data references",
    "dealbreakers": [],
    "gaps_to_close": [
      {
        "gap": "Specific gap",
        "impact": "Why this matters to investors",
        "action": "What to do",
        "timeline": "By when"
      }
    ],
    "comparable_deals": [
      { "company": "Similar funded company", "round": "Series Seed", "amount": "€2M", "relevance": "Why comparable" }
    ]
  }
}
```

## Examples

### Example: Honest Investor Assessment

**Founder:** "How would a VC see my startup?"

**Agent:**

**Return Potential: 7/10**
Signals: "€4.2B TAM growing 22% CAGR", "SaaS model targets 80%+ gross margin", "Comparable exit: ToolX acquired for €400M at 15x ARR"

Your market is large enough for venture returns and growing. The SaaS model with €400 ARPU and estimated 6x LTV/CAC is attractive. The concern is your SOM estimate of €8M ARR in 3 years -- that is a good seed-stage target but a VC will ask "what gets you to €50M ARR?" You need a credible expansion story (new segments, upsell, geographic).

**Defensibility: 4/10**
Signals: "No patents filed", "Data moat requires 10K+ users (currently 0)", "Feature parity achievable in 6 months"

This is your weakest dimension. Today, a well-funded competitor could replicate your feature set in 6 months. Your planned data moat requires significant user scale you do not have yet. Investors will probe this hard. Your best mitigation: accelerate to market, build switching costs through integrations, and file provisional patents on your unique approach.

**Investor Summary:** "Interesting seed opportunity in a growing market with strong unit economics potential, held back by zero traction and no technical moat -- conditional on shipping MVP and landing first 10 customers."

**Verdict: conditional**
Conditions: (1) Ship MVP and acquire 10 paying customers, (2) File provisional patent on core algorithm, (3) Close technical cofounder hire.
