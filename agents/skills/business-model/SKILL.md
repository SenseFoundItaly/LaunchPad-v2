---
name: business-model
description: Scores 3-5 business model options across financial viability, market fit, and scalability with investment-grade rationale
---

# Business Model Evaluation

Evaluate 3-5 business model options with rigorous multi-dimensional scoring. This skill helps founders choose the right business model by scoring each option on financial viability, market fit, and scalability -- with specific rationale for every score.

## When to Use

- After scientific-validation when buyer personas clarify who pays and how
- When founder is deciding between revenue models (SaaS vs marketplace vs usage-based vs transactional)
- When pivoting and need to evaluate the economics of a new model
- Before financial-model to ensure projections are based on the best model choice
- When investors ask "why this business model?"

## Instructions

### Model Identification

Propose 3-5 candidate business models appropriate to the startup's context. Common models include:
- Subscription SaaS (monthly/annual recurring)
- Usage-based / consumption pricing
- Marketplace (take rate on transactions)
- Freemium with premium tiers
- Enterprise licensing
- Transactional / per-unit pricing
- Hybrid models

Each model must be specific to the founder's situation, not generic descriptions. For example, not just "SaaS" but "Per-seat SaaS at €49-199/user/month targeting 50-200 person engineering teams."

### Scoring Framework

Score each model on three meta-dimensions. Write the rationale BEFORE assigning the number.

#### 1. Financial Viability (each sub-dimension 1-10)

- **Profitability:** What are the expected gross margins at scale? Reference comparable companies.
  - 9-10: >80% gross margin (pure SaaS)
  - 7-8: 60-80% (SaaS with some services)
  - 5-6: 40-60% (marketplace, managed service)
  - 3-4: 20-40% (hardware-heavy, high COGS)
  - 1-2: <20% (commodity, razor-thin margins)

- **Capital Efficiency:** What is the expected CAC payback period?
  - 9-10: <6 months payback, LTV/CAC >5x
  - 7-8: 6-12 months, LTV/CAC 3-5x
  - 5-6: 12-18 months, LTV/CAC 2-3x
  - 3-4: 18-24 months, LTV/CAC 1-2x
  - 1-2: >24 months or LTV/CAC <1x

- **Revenue Recurrence:** What percentage of revenue is recurring?
  - 9-10: >90% recurring (SaaS)
  - 7-8: 70-90% recurring
  - 5-6: 40-70% recurring
  - 3-4: 10-40% recurring
  - 1-2: <10% (project-based, one-time)

- **Break-even Timeline:** Months to break-even from launch
  - 9-10: <12 months
  - 7-8: 12-18 months
  - 5-6: 18-30 months
  - 3-4: 30-48 months
  - 1-2: >48 months or unclear path

#### 2. Market Fit (each sub-dimension 1-10)

- **Product-Market Fit Potential:** How well does this model align with buyer behavior from scientific-validation?
  - Reference specific persona purchase criteria and willingness to pay signals

- **Market Timing:** Where is this model on the adoption curve for this market?
  - Early adoption = higher risk, higher upside
  - Late majority = lower risk, more competition

- **Competitive Position:** How strong is the potential moat?
  - Score 1-10 with specific moat type (network effects, data moat, switching costs, IP, brand)

- **Customer Acquisition:** Estimated CAC in EUR per channel
  - Reference GTM channels from market research
  - Specific cost per channel, not just "low CAC"

#### 3. Scalability (each sub-dimension 1-10)

- **Revenue Scaling:** Does revenue grow faster than costs?
  - Describe the specific scaling model (per-seat, usage multiplier, marketplace liquidity)

- **Operational Scaling:** What are the constraints?
  - Does it require proportional headcount growth? Does it need local operations?

- **Geographic Expansion:** Which markets and timeline?
  - List specific target markets with timeline (e.g., "EU Year 1, US Year 2, APAC Year 3")

### Overall Score and Recommendation

Calculate composite score (0-10) as average of all sub-dimensions.

**Recommendation thresholds:**
- **STRONG BUY (8.0+):** Excellent across all dimensions, clear path to venture-scale returns
- **BUY (7.0-7.9):** Strong overall with manageable weaknesses
- **HOLD (5.0-6.9):** Viable but significant concerns to address
- **PASS (below 5.0):** Fundamental issues make this model unlikely to succeed

### ESG / Sustainability Assessment

For the recommended model:
- **Environmental (0-10):** Carbon footprint, resource efficiency, circular economy alignment
- **Social (0-10):** Job creation impact, diversity, community benefit, labor practices
- **Governance (0-10):** Board structure, ethics framework, transparency, data privacy
- **Overall ESG (0-10):** Weighted composite
- **SDG Alignment:** Map to minimum 3 UN Sustainable Development Goals with alignment type (Direct/Indirect) and impact level (High/Medium/Low)

### Quality Standards

Follow the shared quality standards in `_shared/quality-standards.md`:
- Every score must have a written rationale with specific evidence
- No banned vague terms
- Source industry benchmarks for margin and CAC comparisons
- Confidence scoring on uncertain estimates

## Output Format

```json
{
  "business_model_evaluation": {
    "models": [
      {
        "name": "Per-seat SaaS (€49-199/user/month)",
        "description": "Specific description of how this model works for this startup",
        "financial_viability": {
          "profitability": { "score": 8, "rationale": "Why this score with evidence", "comparable": "Company X achieves 82% gross margin" },
          "capital_efficiency": { "score": 7, "rationale": "CAC payback analysis", "ltv_cac_ratio": "3.2x" },
          "revenue_recurrence": { "score": 9, "rationale": "95% recurring from annual contracts" },
          "break_even": { "score": 6, "rationale": "Estimated 20 months based on hiring plan" }
        },
        "market_fit": {
          "product_market_fit": { "score": 7, "rationale": "Persona 2 budget and buying process align" },
          "market_timing": { "score": 8, "rationale": "Early majority adoption phase" },
          "competitive_position": { "score": 6, "rationale": "Moat type and strength", "moat_type": "data + switching costs" },
          "customer_acquisition": { "score": 7, "rationale": "Estimated CAC per channel", "estimated_cac": "€2,400" }
        },
        "scalability": {
          "revenue_scaling": { "score": 8, "rationale": "Per-seat model with expansion revenue" },
          "operational_scaling": { "score": 7, "rationale": "Constraints and headcount needs" },
          "geographic_expansion": { "score": 6, "rationale": "Markets and timeline", "target_markets": ["EU Y1", "US Y2"] }
        },
        "composite_score": 7.2,
        "recommendation": "BUY"
      }
    ],
    "recommended_model": {
      "name": "Model name",
      "reasoning": "Why this model over the others, specific to founder's situation",
      "key_risks": ["Risk 1 with mitigation"],
      "next_steps": ["Specific action with timeline"]
    },
    "esg_assessment": {
      "environmental": { "score": 6, "rationale": "Assessment" },
      "social": { "score": 7, "rationale": "Assessment" },
      "governance": { "score": 5, "rationale": "Assessment" },
      "overall": 6.0,
      "sdg_alignment": [
        { "sdg": "SDG 9: Industry, Innovation and Infrastructure", "alignment": "Direct", "impact": "High", "description": "How" }
      ]
    },
    "data_gaps": ["What information would improve scoring accuracy"],
    "recommended_next": "prototype-spec"
  }
}
```

## Examples

### Example: Honest Model Comparison

**Founder:** "Should we do SaaS or marketplace?"

**Agent:** Let me score both based on your data.

**Per-seat SaaS (€99/user/month): Composite 7.4 — BUY**
Your Persona 2 (Platform Team Lead) has a budget of €10K-50K/year and a 2-4 week decision cycle. SaaS fits this buying pattern. Your competitor analysis shows the market supports this price point -- Competitor X charges €79/user and Competitor Y charges €149/user. Gross margins should be >80% (pure software). The risk is customer acquisition: at your estimated €2,400 CAC, you need 8 months to payback on an annual contract. That is acceptable but not great.

**Marketplace (8% take rate): Composite 5.1 — HOLD**
A marketplace requires liquidity on both sides. Your market research identified only 200,000 potential supply-side participants and 15,000 demand-side companies. That is a thin market for marketplace dynamics. Cold-start is the existential risk. Your Persona 1 (Solo Builder) might list on a marketplace, but Persona 2 will not -- they buy through procurement, not marketplaces. I would not pursue this model unless you can solve the supply-side density problem.

**Recommendation: SaaS.** It matches your buyer personas, has proven economics in your competitive set, and does not require solving a two-sided marketplace cold-start problem.
