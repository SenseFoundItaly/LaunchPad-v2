---
name: financial-model
description: Produces 3-year financial projections with P&L, SaaS metrics, cost structure, and scenario analysis
---

# Financial Model

Generate a detailed 3-year financial model with revenue projections, profit & loss, cash flow analysis, SaaS metrics, cost structure, and three-scenario analysis. Every number must be specific and show its math.

## When to Use

- When founder needs detailed financials for fundraising, board meetings, or strategic planning
- After business-model is selected to project the economics
- When investors request a financial model or detailed projections
- When evaluating burn rate and runway under different scenarios
- Before investment-readiness for the financial foundation

## Instructions

### Revenue Projections

For each of the 3 years, provide:
- **Customer Count:** Specific number with growth assumptions
- **ARR:** Annual Recurring Revenue in EUR
- **MRR:** Monthly Recurring Revenue (ARR / 12)
- **Growth Rate:** YoY percentage with reasoning
- **ARPU:** Average Revenue Per User/Account
- **Revenue Assumptions:** Explicit list (pricing, conversion rate, churn, expansion)

Show the math: Customers x ARPU x 12 = ARR. Do not produce numbers without visible calculations.

### Profit & Loss (per year)

| Line Item | Requirement |
|-----------|-------------|
| Revenue | From revenue projections |
| COGS | Broken down (hosting, API costs, support, payment processing) |
| Gross Profit | Revenue - COGS |
| Gross Margin % | Must be benchmarked (e.g., "75% vs. 78% SaaS median, KeyBanc 2025") |
| R&D | Headcount x salary + tools |
| Sales & Marketing | CAC x new customers + brand + content |
| G&A | Office, legal, accounting, insurance |
| Total OpEx | Sum of R&D + S&M + G&A |
| EBITDA | Gross Profit - Total OpEx |
| Net Income | EBITDA - taxes - interest (if applicable) |

### Cash Flow Analysis

- **Initial Cash:** Current cash on hand
- **Funding Required:** How much capital needed and when
- **Runway:** Months at current burn rate
- **Break-even Point:** Month and year when revenue covers costs
- **Monthly Burn Rate:** Average monthly cash outflow

### SaaS Metrics

Calculate and benchmark each metric:

- **LTV (Lifetime Value):** ARPU x Average Customer Lifetime. Show both calculation and benchmark.
- **CAC (Customer Acquisition Cost):** Total S&M spend / New customers acquired. Break down by channel.
- **LTV/CAC Ratio:** Must be >3x for healthy SaaS. Benchmark: "Median 4.5x per Bessemer Cloud Index."
- **Payback Period:** Months to recover CAC from gross profit. Benchmark: "<12 months is good, <18 months is acceptable."
- **Monthly Churn Rate:** Percentage of customers lost per month. Benchmark: "<2% monthly for SMB SaaS, <1% for enterprise."
- **Net Revenue Retention (NRR):** Account for expansion revenue and contraction. Benchmark: ">100% means growing without new customers, best-in-class >120%."
- **Gross Margin:** Benchmark against SaaS median (75-80%).

### Cost Structure

#### Fixed Costs
List each with monthly EUR amount:
- Team salaries (by role and count)
- Office / coworking
- Software subscriptions (list each)
- Insurance
- Legal / accounting retainer

#### Variable Costs
List each with per-unit EUR amount:
- Hosting / infrastructure per customer
- API costs per request or per customer
- Payment processing (% of revenue)
- Customer support per ticket
- Sales commission (% of revenue)

### Scenario Analysis

Three scenarios, each with:
- **ARR Year 3:** Projected annual revenue
- **Probability:** Estimated likelihood (percentages should sum to ~100%)
- **Key Assumptions:** What differs from base case (3-5 bullets)
- **Headcount Year 3:** Team size under this scenario
- **Funding Required:** Total capital needed

#### Base Case (50-60% probability)
Conservative but achievable growth. Use realistic conversion rates and churn.

#### Optimistic Case (20-25% probability)
What happens if key bets pay off: viral growth, lower churn, faster sales cycle. Must be plausible, not fantasy.

#### Pessimistic Case (20-25% probability)
What happens if growth is slower: higher churn, longer sales cycle, competitive pressure. What is the survival plan?

### Assumptions List

Explicit, numbered list of every assumption used in the model. Each assumption should be:
- Specific (not "growth will be strong")
- Sourced when possible (industry benchmark or comparable company)
- Flagged with confidence level (high / medium / low)

## Output Format

```json
{
  "financial_model": {
    "revenue_projections": [
      {
        "year": 1,
        "customers": 50,
        "arr": "€240,000",
        "mrr": "€20,000",
        "growth_rate_yoy": "N/A",
        "arpu_monthly": "€400",
        "assumptions": ["€99/seat avg, 4 seats/customer, 12% annual conversion from free trial"]
      }
    ],
    "profit_and_loss": [
      {
        "year": 1,
        "revenue": "€240,000",
        "cogs": { "total": "€48,000", "breakdown": { "hosting": "€12,000", "api_costs": "€18,000", "support": "€12,000", "payment_processing": "€6,000" } },
        "gross_profit": "€192,000",
        "gross_margin_pct": 80,
        "gross_margin_benchmark": "75-80% SaaS median (KeyBanc 2025)",
        "opex": { "r_and_d": "€240,000", "sales_and_marketing": "€120,000", "g_and_a": "€60,000", "total": "€420,000" },
        "ebitda": "-€228,000",
        "net_income": "-€228,000"
      }
    ],
    "cash_flow": {
      "initial_cash": "€500,000",
      "funding_required": "€750,000",
      "runway_months": 18,
      "break_even_point": "Month 22 (Q4 Year 2)",
      "monthly_burn_rate": "€28,000"
    },
    "saas_metrics": {
      "ltv": { "value": "€14,400", "calculation": "€400 ARPU x 36 month avg lifetime", "benchmark": "Healthy for SMB SaaS" },
      "cac": { "value": "€2,400", "by_channel": { "content": "€800", "paid": "€1,000", "outbound": "€600" }, "benchmark": "<€5K for SMB SaaS" },
      "ltv_cac_ratio": { "value": 6.0, "benchmark": "3x+ is healthy, 6x is strong" },
      "payback_months": { "value": 6, "benchmark": "<12 months is good" },
      "monthly_churn_pct": { "value": 2.8, "benchmark": "<2% ideal for SMB, 2.8% needs work" },
      "nrr_pct": { "value": 110, "benchmark": ">100% means net expansion, best-in-class >120%" }
    },
    "cost_structure": {
      "fixed_costs": [
        { "item": "Engineering (2 FTE)", "monthly": "€16,000" }
      ],
      "variable_costs": [
        { "item": "Hosting per customer", "per_unit": "€20/month" }
      ]
    },
    "scenario_analysis": {
      "base": { "arr_year3": "€2.4M", "probability": "55%", "assumptions": [], "headcount": 15, "funding_required": "€750K" },
      "optimistic": { "arr_year3": "€5.1M", "probability": "20%", "assumptions": [], "headcount": 25, "funding_required": "€750K" },
      "pessimistic": { "arr_year3": "€800K", "probability": "25%", "assumptions": [], "headcount": 8, "funding_required": "€1M" }
    },
    "assumptions": [
      { "id": 1, "assumption": "Average seat count per customer: 4", "source": "Industry benchmark: Bessemer Cloud Index", "confidence": "medium" }
    ]
  }
}
```
