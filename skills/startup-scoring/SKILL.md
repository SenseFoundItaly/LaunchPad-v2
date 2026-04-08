---
name: startup-scoring
description: Scores a startup idea across 6 dimensions with weighted methodology and actionable rationale
---

# Startup Scoring

Evaluate a startup idea across six critical dimensions, producing a rigorous, transparent score with clear rationale. This is not a cheerleading exercise. The score should help founders see their idea honestly and prioritize what to fix.

## When to Use

- After idea shaping is complete (requires a structured Idea Canvas or equivalent context)
- Founder requests an evaluation of their current idea
- Before market research to identify which dimensions need deeper investigation
- When comparing pivot options or idea variations
- Periodically to re-score after new data or iterations

## Instructions

### Scoring Philosophy

1. **Be honest, not harsh.** A low score is useful information. Sugarcoating helps no one. But always pair criticism with a path forward.

2. **Ground every score in evidence.** If the founder has provided metrics, research, or customer data, reference it. If they have not, note the absence of data as a factor in the score.

3. **Score what exists, not what is promised.** "We plan to build a network effect" scores lower than "We have 500 users who each invited 3 friends." Aspirations are noted but do not inflate scores.

4. **Use the full range.** A score of 50 means mediocre, not good. Most early-stage ideas should land between 30-70 on most dimensions. Scores above 80 require strong evidence. Scores below 20 indicate fundamental problems.

### The Six Dimensions

#### 1. Market Opportunity (Weight: 20%)

Evaluates the size and accessibility of the market.

- **80-100:** Large addressable market (TAM >$1B) with clear entry point, growing rapidly
- **60-79:** Solid market ($100M-$1B TAM), moderate growth, accessible beachhead
- **40-59:** Niche market or unclear sizing, some growth indicators
- **20-39:** Small market, flat or declining, difficult to access
- **0-19:** No identifiable market or fundamentally shrinking category

Consider: TAM/SAM/SOM estimates, market growth rate, timing (why now?), regulatory tailwinds or headwinds.

#### 2. Competitive Landscape (Weight: 15%)

Evaluates positioning relative to existing and potential competitors.

- **80-100:** Clear differentiation with defensible moat, weak or fragmented competition
- **60-79:** Meaningful differentiation, some competition but no dominant incumbent
- **40-59:** Moderate differentiation, established competitors exist
- **20-39:** Crowded market, weak differentiation, strong incumbents
- **0-19:** Dominated by well-funded incumbents, no clear angle of attack

Consider: Number and strength of competitors, switching costs, network effects, proprietary advantages, brand moats.

#### 3. Feasibility (Weight: 15%)

Evaluates whether this team can actually build and deliver this product.

- **80-100:** Team has deep domain expertise, MVP is achievable in weeks, clear technical path
- **60-79:** Team has relevant skills, MVP achievable in 1-3 months, some technical unknowns
- **40-59:** Skills gaps exist but are addressable, MVP timeline 3-6 months, moderate technical risk
- **20-39:** Significant skills gaps, complex technical requirements, regulatory hurdles
- **0-19:** Requires breakthroughs in technology, regulation, or team composition

Consider: Technical complexity, team capabilities, regulatory requirements, capital requirements for MVP, time to first usable product.

#### 4. Business Model Viability (Weight: 20%)

Evaluates whether the economics can work.

- **80-100:** Proven revenue model in category, strong unit economics, clear path to profitability
- **60-79:** Logical revenue model, reasonable unit economics assumptions, some validation
- **40-59:** Revenue model identified but unvalidated, unit economics uncertain
- **20-39:** Revenue model unclear, questionable willingness to pay, high CAC likely
- **0-19:** No revenue model or fundamentally broken economics

Consider: Revenue model clarity, pricing validation, CAC/LTV ratio potential, gross margins, path to break-even.

#### 5. Customer Demand (Weight: 20%)

Evaluates evidence that customers actually want this.

- **80-100:** Paying customers or strong pre-orders, measurable pull from market
- **60-79:** Validated interest (waitlists, LOIs, successful landing page tests)
- **40-59:** Anecdotal interest from conversations, surveys show intent
- **20-39:** Assumed demand based on founder intuition, no validation
- **0-19:** Evidence suggests customers do not want this or already have satisfactory alternatives

Consider: Customer interviews conducted, sign-ups or pre-orders, willingness to pay signals, NPS or satisfaction data from prototypes.

#### 6. Execution Risk (Weight: 10%)

Evaluates what could go wrong and how catastrophic it would be. NOTE: This dimension is inverse -- higher scores mean LOWER risk.

- **80-100:** Low execution risk, straightforward path, team has done this before
- **60-79:** Moderate risk, identifiable challenges with known solutions
- **40-59:** Meaningful risk, several things must go right simultaneously
- **20-39:** High risk, depends on external factors outside founder control
- **0-19:** Extreme risk, multiple existential threats with no mitigation path

Consider: Key person dependencies, regulatory risk, technology risk, market timing risk, funding dependencies.

### Scoring Process

1. Evaluate each dimension independently. Do not let a strong score in one area inflate another.
2. Write the rationale before assigning the number. This prevents anchoring.
3. List specific strengths and risks for each dimension.
4. Calculate the weighted overall score.
5. Identify the top 2-3 priorities the founder should address to improve their score.

## Output Format

```json
{
  "startup_score": {
    "overall_score": 0,
    "overall_grade": "A+ | A | B+ | B | C+ | C | D | F",
    "summary": "2-3 sentence overall assessment",
    "dimensions": {
      "market_opportunity": {
        "score": 0,
        "weight": 0.20,
        "rationale": "Why this score",
        "strengths": ["Specific strength"],
        "risks": ["Specific risk"]
      },
      "competitive_landscape": {
        "score": 0,
        "weight": 0.15,
        "rationale": "Why this score",
        "strengths": ["Specific strength"],
        "risks": ["Specific risk"]
      },
      "feasibility": {
        "score": 0,
        "weight": 0.15,
        "rationale": "Why this score",
        "strengths": ["Specific strength"],
        "risks": ["Specific risk"]
      },
      "business_model_viability": {
        "score": 0,
        "weight": 0.20,
        "rationale": "Why this score",
        "strengths": ["Specific strength"],
        "risks": ["Specific risk"]
      },
      "customer_demand": {
        "score": 0,
        "weight": 0.20,
        "rationale": "Why this score",
        "strengths": ["Specific strength"],
        "risks": ["Specific risk"]
      },
      "execution_risk": {
        "score": 0,
        "weight": 0.10,
        "rationale": "Why this score",
        "strengths": ["Specific strength"],
        "risks": ["Specific risk"]
      }
    },
    "grade_scale": {
      "A+": "90-100: Exceptional across all dimensions",
      "A": "80-89: Strong with minor gaps",
      "B+": "70-79: Promising with clear improvement areas",
      "B": "60-69: Viable but needs significant work",
      "C+": "50-59: Questionable, major gaps to address",
      "C": "40-49: Weak, fundamental issues present",
      "D": "25-39: Unlikely to succeed without major pivot",
      "F": "0-24: Fundamentally flawed concept"
    },
    "top_priorities": [
      {
        "dimension": "Weakest dimension name",
        "action": "Specific action to improve score",
        "expected_impact": "How much improvement this could drive"
      }
    ],
    "data_gaps": [
      "Information the founder should gather to enable more accurate scoring"
    ]
  }
}
```

## Examples

### Example: Scoring with Limited Data

**Founder:** "Score my idea. I want to build a CRM for freelancers."

**Agent response:** I can score this, but I want to flag that several dimensions will score lower due to lack of data rather than a bad idea. Let me walk through each dimension.

**Market Opportunity: 52/100** -- The freelancer tools market is growing but fragmented. CRM is a well-understood category, which helps, but "freelancers" is a broad segment. Have you identified which type of freelancers? A graphic designer and a plumbing contractor have very different workflows. Without TAM sizing specific to your segment, I am estimating conservatively.

### Example: Honest Low Score

**Agent:** **Competitive Landscape: 28/100** -- This is the toughest dimension for your idea. HubSpot offers a free CRM. Notion and Airtable serve as lightweight CRMs for many freelancers. You mentioned no specific differentiation beyond "simpler." Simpler than free HubSpot is a hard sell. The risk here is not that your product would be bad, but that the switching cost from free tools is essentially zero while the switching benefit is unclear.

**Strengths:** You understand the freelancer workflow from personal experience.
**Risks:** Competing against free products from well-funded companies. No identified moat.
