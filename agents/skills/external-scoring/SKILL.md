---
name: external-scoring
description: Evaluates external startups or deal flow with a 5-dimension weighted scoring model focused on team, traction, and fundability
---

# External Startup Scoring

Evaluate startups from the outside -- deal flow, accelerator applications, partnership candidates, or competitive analysis. Uses a 5-dimension weighted model optimized for external assessment where internal data is limited.

## When to Use

- When evaluating startups as potential investments
- When reviewing accelerator or incubator applications
- When assessing partnership or acquisition candidates
- When doing competitive deep-dives on specific companies
- When an investor asks "what do you think of Company X?"

## Instructions

### The 5-Dimension Model

#### 1. Team (Weight: 40%)

The team is weighted highest because at early stage, execution capability matters most.

- **Founder Count:** How many, full-time vs part-time
- **Domain Expertise Depth:** Years in this specific industry, depth of knowledge (scored 1-10)
- **Track Record:** Previous exits, startup experience, relevant achievements
- **Relevant Experience:** Years in the problem domain
- **Complementarity:** Do founders cover technical + commercial + domain?
- **Advisory Board:** Quality and relevance of advisors
- **Gaps:** Critical missing roles (CTO, sales leader, domain expert)

Scoring:
- 9-10: Serial founders with relevant exits, deep domain expertise, complete team
- 7-8: Experienced team with relevant background, minor gaps
- 5-6: Capable team but first-time founders or missing key expertise
- 3-4: Significant team gaps, limited relevant experience
- 1-2: Solo founder with no domain experience or track record

#### 2. Technology Readiness (Weight: 15%)

- **TRL Level (1-9):** Current technology readiness level
- **IP Status:** Strong / Medium / Weak / None / Pending / Applied
- **Technical Moat:** What is defensible? (proprietary algorithm, data, hardware)
- **Time to Next TRL:** Estimated months to advance one level
- **Technical Risk:** What could go wrong technically?

Scoring:
- 9-10: TRL 7-9, strong IP, clear technical moat
- 7-8: TRL 5-6, IP pending, some defensibility
- 5-6: TRL 3-4, limited IP, moderate defensibility
- 3-4: TRL 1-2, no IP, easily replicable
- 1-2: Pre-concept, no technical foundation

#### 3. Traction (Weight: 20%)

- **Revenue / MRR:** Specific EUR amounts (or "pre-revenue")
- **Customer Count:** Paying customers, pilots, LOIs
- **Growth Rate:** MoM or QoQ percentage
- **Engagement Metrics:** DAU, retention, NPS -- whatever is relevant
- **Partnerships:** Signed agreements, strategic relationships
- **Waitlist / Pipeline:** If pre-revenue, what demand signals exist?

Scoring:
- 9-10: €100K+ MRR, strong growth, proven retention
- 7-8: €10-100K MRR, growing, early retention data
- 5-6: Pre-revenue but LOIs, pilots, or strong waitlist
- 3-4: Pre-revenue with some interest signals
- 1-2: No traction, no demand signals

#### 4. Business Model (Weight: 15%)

- **Model Type:** SaaS, marketplace, usage-based, etc.
- **Unit Economics Quality:** Proven / Promising / Unproven / Concerning
- **Pricing Validation:** Have customers actually paid? At what price?
- **Gross Margin Estimate:** Based on model type and comparable companies
- **Path to Profitability:** Clear / Unclear / Nonexistent

Scoring:
- 9-10: Proven unit economics, high margins, clear path to profitability
- 7-8: Promising economics, some validation, reasonable margins
- 5-6: Logical model but unproven
- 3-4: Questionable economics, unclear pricing
- 1-2: No business model or fundamentally broken economics

#### 5. Roadmap (Weight: 10%)

- **Next 12-Month Milestones:** List specific milestones
- **Execution Track Record:** % of past milestones hit on time
- **Resource Alignment:** Do they have the team and capital to execute?
- **Dependency Analysis:** External dependencies that could block progress

Scoring:
- 9-10: Clear roadmap, >80% milestone hit rate, resources aligned
- 7-8: Good roadmap, 60-80% hit rate, most resources in place
- 5-6: Reasonable roadmap, limited track record
- 3-4: Vague roadmap, poor execution history
- 1-2: No roadmap or completely unrealistic

### Composite Score

Weighted average: Team (40%) + TRL (15%) + Traction (20%) + Business Model (15%) + Roadmap (10%)

### Recommendation

- **Invest:** Composite ≥7.5 with no dealbreakers
- **Due Diligence:** Composite 6.0-7.4, worth deeper investigation
- **Watch:** Composite 4.5-5.9, interesting but too early or too risky
- **Pass:** Composite <4.5 or any dealbreaker present

### Dealbreakers

Flag any of these immediately, regardless of score:
- Solo non-technical founder building a technical product
- No customer contact in >6 months
- Burn rate exceeds funding runway by <3 months
- Legal or regulatory red flags
- Founder integrity concerns

## Output Format

```json
{
  "external_scoring": {
    "startup_name": "Company name",
    "evaluation_date": "ISO date",
    "dimensions": {
      "team": { "score": 7, "weight": 0.40, "rationale": "Detailed assessment", "sub_scores": { "domain_expertise": 8, "track_record": 6, "completeness": 7 } },
      "technology_readiness": { "score": 6, "weight": 0.15, "rationale": "Assessment", "trl": 5, "ip_status": "Pending" },
      "traction": { "score": 5, "weight": 0.20, "rationale": "Assessment", "metrics": { "mrr": "€8,000", "customers": 12, "growth_mom": "15%" } },
      "business_model": { "score": 7, "weight": 0.15, "rationale": "Assessment", "model_type": "SaaS", "unit_economics": "Promising" },
      "roadmap": { "score": 6, "weight": 0.10, "rationale": "Assessment", "milestone_hit_rate": "70%" }
    },
    "composite_score": 6.3,
    "recommendation": "Due Diligence",
    "dealbreakers": [],
    "strengths": ["Top 3 strengths"],
    "concerns": ["Top 3 concerns"],
    "questions_for_founders": ["Key questions to ask in next conversation"],
    "comparable_companies": ["Similar companies and their outcomes"]
  }
}
```
