---
name: investment-scoring
description: Investment-grade idea scoring with evidence-backed metrics across market, technology, impact, and risk dimensions
---

# Investment Scoring

Produce an investment-grade evaluation of a startup idea with evidence-backed scoring across four metric groups. Unlike startup-scoring (which is conversational and fast), this skill requires source citations for every claim and produces output suitable for investor memos and due diligence.

## When to Use

- When a more rigorous evaluation is needed than startup-scoring provides
- When preparing materials for investor conversations
- After market-research to incorporate sourced data into the evaluation
- When an investor asks "what's your investment thesis?"
- For periodic re-evaluation with updated evidence

## Instructions

### Scoring Philosophy

1. **Every score must be backed by evidence.** A score without a source or calculation is just an opinion. Cite market reports, competitor data, public filings, or benchmarks.
2. **Minimum 100 words of reasoning per metric.** This is not a quick scan -- it is a thorough analysis.
3. **Minimum 2 supporting evidence items per metric.** Each with a URL, snippet, and credibility tier.
4. **Quantitative data required.** Every metric must include specific numbers (EUR, percentages, counts).
5. **Follow source attribution standards** from `_shared/quality-standards.md`.

### Metric Group 1: Market Metrics

#### TAM Score (0-10)
- Specific TAM in EUR with calculation methodology
- Source: min 2 from different credibility tiers
- Consider: market growth rate (CAGR), market maturity, regulatory environment
- Scoring: 9-10 (>€10B + >20% CAGR), 7-8 (€1-10B), 5-6 (€100M-1B), 3-4 (€10-100M), 1-2 (<€10M)

#### Market Timing Score (0-10)
- Where is the market on the adoption curve? (Innovators / Early Adopters / Early Majority / Late Majority)
- Evidence: adoption rate trends, technology maturity indicators, regulatory catalysts
- Scoring: 9-10 (perfect timing, catalysts aligning), 7-8 (good timing), 5-6 (slightly early or late), 3-4 (too early), 1-2 (too late, saturated)

#### Competition Score (0-10)
- Number and strength of competitors with funding data
- Market concentration (fragmented vs. dominated)
- Scoring: 9-10 (fragmented, no dominant player), 7-8 (competitors exist but weak), 5-6 (moderate competition), 3-4 (strong incumbents), 1-2 (monopoly/duopoly)

### Metric Group 2: Technology Metrics

#### Feasibility Score (0-10)
- Technology Readiness Level (TRL 1-9)
- Technical complexity assessment
- Team capability match
- Scoring: 9-10 (TRL 7-9, proven tech), 7-8 (TRL 5-6, prototype works), 5-6 (TRL 3-4, concept proven), 3-4 (TRL 1-2, theoretical), 1-2 (requires breakthroughs)

#### IP Strength Score (0-10)
- Patent landscape analysis
- Freedom to operate assessment
- Proprietary data or algorithmic advantages
- Scoring: 9-10 (strong patent portfolio + trade secrets), 7-8 (pending patents + data moat), 5-6 (some protectable IP), 3-4 (weak IP position), 1-2 (no IP, easily replicated)

#### Innovation Score (0-10)
- Degree of technical novelty
- Differentiation from existing solutions
- Scoring: 9-10 (paradigm shift), 7-8 (significant improvement), 5-6 (incremental innovation), 3-4 (minor variation), 1-2 (commodity/clone)

### Metric Group 3: Impact Metrics

#### SDG Alignment Score (0-10)
- Map to specific UN Sustainable Development Goals (minimum 3)
- Alignment type per SDG: Direct (core business) / Indirect (secondary effect)
- Impact level per SDG: High / Medium / Low

#### ESG Score (0-10)
- Environmental: carbon footprint, resource efficiency, circular economy
- Social: job creation, diversity, community benefit, labor practices
- Governance: board structure, ethics framework, transparency, data privacy
- Score each pillar (0-10) and provide overall composite

### Metric Group 4: Risk Assessment

#### Overall Risk Level: Low / Medium / High / Critical

#### Key Risks (minimum 3)
Each risk with:
- Description (specific, not generic)
- Category: Market / Technical / Regulatory / Financial / Competitive
- Severity: Critical / High / Medium / Low
- Likelihood: 1-5 (5 = almost certain)
- Impact: 1-5 (5 = existential)

#### Mitigation Strategies (minimum 2)
Each with timeline and estimated cost.

#### Risk Score (0-10, where 10 = lowest risk)

### Composite Score and Recommendation

**Composite Score (0-10):** Weighted average of all metric groups.

**Decision Thresholds:**
- **GO (7.0+):** Strong evidence supports this investment
- **WAITING LIST (5.0-6.9):** Promising but needs more evidence or de-risking
- **PARK (below 5.0):** Fundamental concerns -- do not proceed without major changes

**Investment Recommendation:** BUY / HOLD / SELL with 200+ word reasoning.

### Scoring Analytics (Meta-data)

- **Scoring Method:** weighted_average / hybrid
- **Confidence Level:** High / Medium / Low (based on data availability)
- **Data Quality:** Excellent / Good / Fair / Poor
- **Criteria Completeness:** 0-1 (percentage of metrics with valid, sourced data)

## Output Format

```json
{
  "investment_scoring": {
    "market_metrics": {
      "tam": { "score": 8, "reasoning": "100+ words with evidence", "supporting_evidence": [{ "title": "Source", "url": "URL", "snippet": "50+ char quote", "credibility": "Premium" }], "quantitative_data": { "tam_eur": "€4.2B", "cagr": "22%", "source_year": 2025 } },
      "market_timing": { "score": 7, "reasoning": "100+ words", "supporting_evidence": [], "quantitative_data": { "adoption_phase": "Early Majority" } },
      "competition": { "score": 6, "reasoning": "100+ words", "supporting_evidence": [], "quantitative_data": { "competitor_count": 12, "top_funded": "€125M Series C" } }
    },
    "technology_metrics": {
      "feasibility": { "score": 7, "reasoning": "100+ words", "supporting_evidence": [], "quantitative_data": { "trl": 5 } },
      "ip_strength": { "score": 5, "reasoning": "100+ words", "supporting_evidence": [], "quantitative_data": { "patents_filed": 0, "data_moat": "2M user dataset" } },
      "innovation": { "score": 6, "reasoning": "100+ words", "supporting_evidence": [], "quantitative_data": {} }
    },
    "impact_metrics": {
      "sdg_alignment": { "score": 7, "sdgs": [{ "sdg": "SDG 9", "alignment": "Direct", "impact": "High" }] },
      "esg": { "overall": 6, "environmental": 5, "social": 7, "governance": 6, "rationale": "Per-pillar assessment" }
    },
    "risk_assessment": {
      "overall_level": "Medium",
      "key_risks": [{ "description": "Specific risk", "category": "Market", "severity": "High", "likelihood": 3, "impact": 4 }],
      "mitigation_strategies": [{ "strategy": "Specific action", "timeline": "Q2 2026", "estimated_cost": "€50K" }],
      "risk_score": 6
    },
    "composite_score": 6.8,
    "decision": "WAITING LIST",
    "recommendation": "BUY / HOLD / SELL",
    "investment_thesis": "200+ word reasoning",
    "scoring_analytics": {
      "scoring_method": "weighted_average",
      "confidence_level": "Medium",
      "data_quality": "Good",
      "criteria_completeness": 0.85
    }
  }
}
```
