---
name: risk-scoring
description: Comprehensive risk audit with severity x likelihood matrix across market, technical, regulatory, financial, and competitive categories
---

# Risk Scoring

Conduct a comprehensive risk audit across five categories, producing a severity x likelihood matrix, mitigation strategies, and an overall risk profile. Use this before major decisions -- fundraising, launch, pivot, or significant investment of time and capital.

## When to Use

- Before fundraising to identify and address risks investors will spot
- Before product launch to ensure no critical risks are unmitigated
- When evaluating a pivot to understand the risk profile of the new direction
- Periodically (quarterly) to update the risk landscape
- When something feels wrong but the founder cannot articulate what

## Instructions

### Risk Categories

Assess risks across all five categories. Do not skip a category even if it seems low-risk -- explicitly state why it is low-risk.

#### 1. Market Risk
- **Demand uncertainty:** Is there validated evidence that customers want this?
- **Timing risk:** Is the market too early, too late, or changing?
- **Adoption barriers:** What prevents customers from switching to this solution?
- **Market size risk:** Could the market be smaller than estimated?
- **Macro factors:** Economic conditions, industry cycles, geopolitical factors

#### 2. Technical Risk
- **Feasibility:** Can this be built with current technology?
- **Scalability:** Will the architecture handle 10x, 100x growth?
- **Security:** What are the attack vectors and data breach risks?
- **Dependency risk:** Critical third-party services that could fail or change terms
- **Technical debt:** Current state and trajectory

#### 3. Regulatory Risk
- **Compliance requirements:** GDPR, SOC2, industry-specific regulations
- **Legal barriers:** Licensing, certifications, permits required
- **IP threats:** Patent infringement risk, competitor IP claims
- **Liability:** Product liability, data breach liability
- **Regulatory change:** Pending legislation that could help or harm

#### 4. Financial Risk
- **Runway:** Months of cash remaining at current burn
- **Unit economics:** Are they sustainable? What is the path to profitability?
- **Funding dependency:** What happens if the next round does not close?
- **Revenue concentration:** Dependency on a small number of customers
- **Currency / market risk:** Exposure to exchange rates or market conditions

#### 5. Competitive Risk
- **Incumbent response:** How will established players react?
- **New entrants:** Who else might enter this space?
- **Substitutes:** Alternative solutions that solve the same problem differently
- **Talent competition:** Can you hire against larger, better-funded competitors?
- **Platform risk:** Dependency on a platform (App Store, AWS, Google) that could change rules

### Risk Assessment per Item

For each identified risk:

- **Description:** Specific, concrete description (not "market risk is medium")
- **Category:** Market / Technical / Regulatory / Financial / Competitive
- **Severity:** Critical / High / Medium / Low
  - Critical: Could kill the company
  - High: Would cause major setback (6+ months delay, 50%+ revenue impact)
  - Medium: Significant but manageable with effort
  - Low: Minor inconvenience
- **Likelihood (1-5):**
  - 5: Almost certain (>90%)
  - 4: Likely (60-90%)
  - 3: Possible (30-60%)
  - 2: Unlikely (10-30%)
  - 1: Rare (<10%)
- **Impact (1-5):**
  - 5: Existential (company failure)
  - 4: Severe (major pivot required)
  - 3: Significant (quarter lost, plan change)
  - 2: Moderate (delays, cost overruns)
  - 1: Minor (inconvenience, workaround exists)
- **Risk Score:** Likelihood x Impact (1-25)
- **Mitigation Strategy:** Specific action to reduce likelihood or impact
- **Mitigation Timeline:** When this must be addressed
- **Mitigation Cost:** Estimated EUR or time investment
- **Residual Risk:** What risk remains after mitigation

### Risk Matrix

Organize all risks into a 5x5 matrix (Likelihood x Impact):

| | Impact 1 | Impact 2 | Impact 3 | Impact 4 | Impact 5 |
|---|---|---|---|---|---|
| **Likelihood 5** | | | | | CRITICAL |
| **Likelihood 4** | | | | HIGH | |
| **Likelihood 3** | | | MEDIUM | | |
| **Likelihood 2** | | LOW | | | |
| **Likelihood 1** | LOW | | | | |

### Overall Risk Profile

- **Low Risk:** No critical risks, all high risks have mitigation plans, total risk score <30
- **Moderate Risk:** 1-2 high risks with viable mitigation, no unmitigated critical risks
- **High Risk:** Multiple high risks or 1 critical risk with unclear mitigation
- **Critical Risk:** Multiple critical risks or unmitigated existential threats

### Existential Risks

Flag the top 3 risks that could kill the company. These get special attention:
- Why it is existential
- What would trigger it
- Early warning signs to monitor
- Emergency response plan

## Output Format

```json
{
  "risk_scoring": {
    "risks": [
      {
        "id": "R1",
        "description": "Specific risk description",
        "category": "Market",
        "severity": "High",
        "likelihood": 3,
        "impact": 4,
        "risk_score": 12,
        "mitigation": {
          "strategy": "Specific action",
          "timeline": "By end of Q2 2026",
          "cost": "€15,000 + 40 hours founder time",
          "residual_risk": "What remains after mitigation"
        }
      }
    ],
    "risk_matrix": {
      "critical_zone": ["R1 description"],
      "high_zone": ["R3 description"],
      "medium_zone": ["R5 description"],
      "low_zone": ["R7 description"]
    },
    "overall_profile": "Moderate Risk",
    "total_risk_score": 45,
    "existential_risks": [
      {
        "risk_id": "R1",
        "why_existential": "Explanation",
        "trigger": "What would cause this",
        "early_warnings": ["Signal to monitor"],
        "emergency_plan": "What to do if triggered"
      }
    ],
    "category_summary": {
      "market": { "risk_count": 3, "highest_severity": "High", "summary": "One sentence" },
      "technical": { "risk_count": 2, "highest_severity": "Medium", "summary": "One sentence" },
      "regulatory": { "risk_count": 1, "highest_severity": "Low", "summary": "One sentence" },
      "financial": { "risk_count": 2, "highest_severity": "High", "summary": "One sentence" },
      "competitive": { "risk_count": 2, "highest_severity": "Medium", "summary": "One sentence" }
    },
    "recommended_actions": [
      { "priority": 1, "action": "Most urgent mitigation", "timeline": "This week", "risk_addressed": "R1" }
    ],
    "recommended_next": "founder-lens"
  }
}
```
