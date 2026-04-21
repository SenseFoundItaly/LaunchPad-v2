---
name: risk-scoring
description: Runs a comprehensive risk audit across technical, market, regulatory, team, and financial dimensions
---

# Risk Scoring

Produce a structured risk audit that surfaces the 5-10 things most likely to kill the startup, ranked by probability × impact, each paired with a concrete mitigation. Unlike a generic SWOT, this audit is decision-ready: every risk has a falsifiable trigger and a named owner.

## When to Use

- After startup-scoring, before financial-model or investment-readiness
- When a founder is committing capital (hire, office, big build decision)
- When preparing for investor Q&A — risks will be asked
- After a major external event (regulator announcement, competitor funding, tech breakthrough)
- Every 90 days as part of operating cadence

## Instructions

### Risk Dimensions

Evaluate each dimension. For any risk you surface, it must belong to exactly one dimension — avoid double-counting.

#### 1. Technical Risk
- Unproven technology in the stack
- Integration risk with third-party APIs/platforms
- Scalability assumptions that have not been tested
- Security posture vs. the sensitivity of data handled
- Dependency on a single LLM provider, payment processor, or infrastructure vendor

#### 2. Market Risk
- Timing: is the market ready? Too early kills more startups than too late.
- Substitutes: "good enough" free or incumbent solutions
- Category risk: is this a real category, or an aggregation of features?
- Demand durability: are the tailwinds permanent or a hype wave?
- Geographic risk: does the product work outside your launch market?

#### 3. Regulatory / Compliance Risk
- Existing regulations affecting the category (GDPR, HIPAA, SOC2, DSA, EU AI Act)
- Pending legislation that could shift ground rules
- License or accreditation requirements
- Data residency and cross-border transfer constraints
- Industry-specific certifications (e.g. ISO 27001 for enterprise B2B)

#### 4. Team / Execution Risk
- Key-person risk: what breaks if any single founder leaves?
- Skills gap: critical roles missing from the founding team
- Burnout risk: unrealistic timeline, no backup
- Equity dynamics: vesting, cliff, distribution fairness
- Advisor/board gaps for the stage

#### 5. Financial Risk
- Runway: months to zero at current burn
- Burn concentration: single-category spend that cannot be cut fast
- Revenue concentration: % of revenue from top 3 customers
- Collection risk: DSO, churn, payment failure rate
- Funding dependency: have you identified the next 3 realistic sources of capital?

#### 6. Dependency / Platform Risk
- Distribution dependency: >30% of users from one channel
- Partner dependency: critical integration that could change terms
- Open-source license risk: AGPL / non-commercial components in the product
- Talent market: can you hire the skills you need at this price?

### Scoring Methodology

For each risk:

- **Probability** (1-5): 1 = unlikely in 2 years, 5 = expected within 6 months
- **Impact** (1-5): 1 = nuisance, 5 = startup-ending
- **RiskScore** = Probability × Impact (1-25)
- **Severity band**:
  - 20-25 = Critical (requires mitigation plan this quarter)
  - 12-19 = High (requires monitoring + contingency within 6 months)
  - 6-11 = Medium (accept with awareness)
  - 1-5 = Low (accept, revisit in 6 months)

### Mitigation Requirements

Each Critical or High risk MUST have:

- **Mitigation action**: specific, owned, time-bound
- **Owner**: named person
- **Early warning signal**: a metric or observable change that fires before the risk materializes
- **Trigger threshold**: the value at which the mitigation escalates

## Output Format

```json
{
  "risk_audit": {
    "audit_date": "ISO date",
    "top_risks": [
      {
        "id": "risk_001",
        "dimension": "market | technical | regulatory | team | financial | dependency",
        "risk": "1-line description",
        "probability": 1-5,
        "impact": 1-5,
        "risk_score": 1-25,
        "severity": "critical | high | medium | low",
        "narrative": "2-3 sentences: what exactly goes wrong and why this is the likely failure mode",
        "early_warning_signal": "Observable metric or event that precedes this risk",
        "trigger_threshold": "Specific value that escalates mitigation",
        "mitigation": "Concrete action owned by a named person, due within N weeks",
        "mitigation_owner": "Name",
        "mitigation_due": "ISO date",
        "status": "new | in_progress | mitigated | accepted"
      }
    ],
    "dimension_summary": {
      "market": { "risk_count": 0, "max_score": 0 },
      "technical": { "risk_count": 0, "max_score": 0 },
      "regulatory": { "risk_count": 0, "max_score": 0 },
      "team": { "risk_count": 0, "max_score": 0 },
      "financial": { "risk_count": 0, "max_score": 0 },
      "dependency": { "risk_count": 0, "max_score": 0 }
    },
    "critical_count": 0,
    "high_count": 0,
    "overall_assessment": "2-3 sentences on the aggregate risk posture and whether it is compatible with the current stage and funding plan",
    "watch_list": [
      "External signal to monitor monthly that could shift one or more risks"
    ],
    "next_review_date": "ISO date — default 90 days out"
  }
}
```

## Examples

### Example: Forcing Specificity

**Founder:** "I'm worried about competition."

**Agent:** "Competition" is not a risk I can score. Which competitor, what specific move, affecting which of your metrics? If HubSpot launches a free tier tomorrow, that's a specific market-risk entry with a specific CAC and churn impact I can quantify. If you're worried about a future unknown competitor, that's a hypothesis, not a risk — note it on the watch list and revisit when there's a signal.

### Example: Forcing the Mitigation

**Agent:** "Runway at 4 months" is scored Critical (P=5, I=5). A mitigation of "raise more money" is not a mitigation — it is the thing you are trying to do. Let me rewrite: *Mitigation: Cut $8k/mo of non-essential tool spend by March 31 (Owner: Marco), accelerate 2 outstanding invoices totaling €12k (Owner: CFO), open a €50k bridge conversation with Angel #3 by March 15.* Now we have actionable mitigations with owners and dates. That is what Critical requires.

### Example: Accepted Risk

**Agent:** Your "OpenAI API price increase" risk: P=3, I=2, score 6 → Medium. Mitigation "multi-provider abstraction" would cost ~3 weeks of engineering. At your current burn that's €15k of engineer time to save against a risk that might never materialize. My recommendation: **accept**, set an early warning (re-evaluate if OpenAI announces >30% price increase or a major outage >6 hours), and re-score in 6 months. Engineering time is better spent on the Critical risks above.
