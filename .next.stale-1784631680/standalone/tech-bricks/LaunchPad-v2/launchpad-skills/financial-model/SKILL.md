---
name: financial-model
description: Builds 3-year financial projections with base, optimistic, and pessimistic scenario analysis
---

<!-- sources-required-block -->
## Source Requirements (MANDATORY)

Every factual claim in the output of this skill MUST cite at least one source. This applies to:

- Numbers (market sizes, percentages, timelines, costs, benchmarks)
- Named entities (competitors, regulations, tools, companies, people)
- External-world claims (trends, dates, events, expert opinions)
- Every risk, score dimension, recommendation, and workflow step

**Source schema** (include as a `sources: Source[]` field at every factual level of the output JSON, not just the top):

```ts
type Source =
  | { type: 'web'; title: string; url: string; accessed_at?: string; quote?: string }
  | { type: 'skill'; title: string; skill_id: string; run_id?: string; quote?: string }
  | { type: 'internal'; title: string; ref: 'graph_node'|'score'|'research'|'memory_fact'|'chat_turn'; ref_id: string; quote?: string }
  | { type: 'user'; title: string; chat_turn_id?: string; quote: string }
  | { type: 'inference'; title: string; based_on: Source[]; reasoning: string };
```

**Rules:**
1. No invented numbers, URLs, or company names. If you don't have a source, say so plainly — never fabricate.
2. Web sources must carry the verbatim URL — don't paraphrase.
3. Use `type: 'internal'` when citing the founder's own project data (scores, research rows, memory facts).
4. Use `type: 'user'` when quoting the founder verbatim from chat.
5. `type: 'inference'` is allowed ONLY when `based_on` is non-empty; `reasoning` must explain the synthesis chain.
6. Attach sources at BOTH the top level (skill-wide provenance) AND at each nested factual entry (per-risk, per-dimension, per-competitor).
7. A claim without a source is a rejected claim. The UI will display it as "UNSOURCED — discarded" and the parser will drop it from persistence.


# Financial Model

Build a grounded 3-year financial projection with three scenarios (base, optimistic, pessimistic). This is not a spreadsheet exercise — it's a decision tool that tells the founder: "Given your business model and market, here's what must be true for this to work, and here's when you run out of money."

## When to Use

- After business-model is complete (the revenue mechanics must be locked)
- After startup-scoring (the score dimensions inform growth assumptions)
- Before investment-readiness (investors will ask for projections)
- When evaluating fundraising amount (how much runway do you need?)
- When deciding team hiring sequence (when can you afford hire #2?)

## Instructions

### Input Data Required

Pull from prior skills:
- **business-model**: revenue model, pricing, unit economics (CAC, LTV, payback)
- **market-research**: TAM/SAM/SOM, competitor pricing benchmarks
- **startup-scoring**: overall score informs growth rate realism
- **idea-canvas**: cost structure, revenue streams

If any of these are missing, flag it explicitly and use conservative defaults with clear "ASSUMPTION" labels.

### Revenue Model

Build monthly revenue for 36 months. Start from the business model's pricing and work forward:

1. **Customer acquisition** — monthly new customers from each channel (organic, paid, referral, partnerships). Use realistic ramp: month 1 is not month 12.
2. **Retention/churn** — monthly churn rate. SaaS B2B benchmark: 3-7% monthly for early-stage. Use the higher end unless there's evidence of strong retention.
3. **Expansion revenue** — upsell/cross-sell. Only include if the business model has explicit expansion mechanics.
4. **MRR/ARR trajectory** — compute monthly MRR = (existing customers - churned + new) x ARPU.

### Cost Model

Categorize all costs:

1. **Team costs** — founders (with or without salary), first hires, when each role becomes necessary. Use market-rate salaries unless the founder specifies otherwise.
2. **Infrastructure** — hosting, APIs, tools, SaaS subscriptions. Scale with usage.
3. **Customer acquisition cost** — channel-by-channel: paid ads CPC, content marketing, sales headcount. Must tie to the revenue model's acquisition numbers.
4. **Variable costs** — COGS that scale with revenue (payment processing, API calls per customer, support per customer).
5. **One-time costs** — legal, incorporation, IP, initial marketing spend.

### Three Scenarios

All three share the same cost structure but vary the revenue assumptions:

- **Base case** — conservative growth, higher churn, longer sales cycles. This is what happens if nothing goes surprisingly well.
- **Optimistic case** — strong product-market fit signals, lower churn, viral growth kicks in. This is what happens if the thesis is right and execution is good.
- **Pessimistic case** — slow adoption, higher CAC, regulatory friction, key hire takes 3 extra months. This is what happens if multiple assumptions are wrong.

### Key Metrics to Compute

Per scenario, per month:
- MRR / ARR
- Net new MRR (new + expansion - churned)
- Gross margin %
- Monthly burn rate
- Cash remaining (from a specified starting cash amount)
- Runway in months
- CAC / LTV ratio
- Months to breakeven

### Fundraising Implications

Based on the model:
- How much capital is needed to reach the next milestone (e.g., $1M ARR, profitability, Series A metrics)?
- At what month does each scenario run out of cash?
- What's the minimum viable raise?
- What dilution is implied at standard seed/pre-seed valuations?

### Sensitivity Analysis

Identify the 3 assumptions that most affect the outcome:
- "If churn is 8% instead of 5%, runway shortens by X months"
- "If CAC is $200 instead of $100, breakeven moves from month 18 to month 30"
- "If ARPU is $29 instead of $49, the business never reaches profitability in 36 months"

## Output Format

```json
{
  "financial_model": {
    "assumptions": {
      "starting_cash": 0,
      "currency": "USD",
      "pricing_model": "From business-model skill",
      "arpu_monthly": 0,
      "initial_customers": 0,
      "monthly_churn_rate": 0.05,
      "cac_by_channel": {
        "organic": 0,
        "paid": 0,
        "referral": 0
      },
      "team_plan": [
        { "role": "CTO", "month_start": 1, "monthly_cost": 0, "type": "founder" }
      ],
      "sources": []
    },
    "scenarios": {
      "base": {
        "label": "Base Case",
        "description": "Conservative assumptions — what happens if nothing goes surprisingly well",
        "monthly_projections": [
          {
            "month": 1,
            "new_customers": 0,
            "churned_customers": 0,
            "total_customers": 0,
            "mrr": 0,
            "revenue": 0,
            "cogs": 0,
            "gross_margin_pct": 0,
            "opex": 0,
            "net_burn": 0,
            "cash_remaining": 0,
            "runway_months": 0
          }
        ],
        "year_summaries": [
          {
            "year": 1,
            "arr": 0,
            "total_revenue": 0,
            "total_costs": 0,
            "net_income": 0,
            "ending_customers": 0,
            "ending_cash": 0
          }
        ],
        "breakeven_month": null,
        "peak_cash_need": 0
      },
      "optimistic": {},
      "pessimistic": {}
    },
    "fundraising_implications": {
      "capital_needed_to_milestone": 0,
      "milestone_description": "e.g., $1M ARR or 1000 customers",
      "months_to_milestone_base": 0,
      "minimum_viable_raise": 0,
      "recommended_raise": 0,
      "runway_at_recommended_raise_months": 0,
      "implied_dilution_at_seed_valuation": "X%"
    },
    "sensitivity_analysis": [
      {
        "variable": "monthly_churn_rate",
        "base_value": 0.05,
        "stress_value": 0.08,
        "impact": "Runway shortens by X months; breakeven moves from month Y to month Z",
        "severity": "high | medium | low"
      }
    ],
    "key_risks": [
      "The single biggest financial risk and what to monitor"
    ],
    "data_gaps": [
      "What the founder needs to validate before this model is trustworthy"
    ],
    "sources": []
  }
}
```

## Examples

### Example: Challenging Unrealistic Growth

**Founder:** "We'll have 500 customers by month 6."

**Agent:** Let me stress-test that. Your CAC is $180 (from business-model), and you have $50K in starting cash. At $180/customer, 500 customers costs $90K in acquisition alone — before any team or infrastructure costs. You'd burn through your entire capital on acquisition by month 3.

A more realistic base case: 15 customers in month 1, growing 20% month-over-month (aggressive but achievable for B2B SaaS with good PMF). That gets you to ~95 customers by month 6, not 500. To reach 500, you need either a viral/referral channel (reducing effective CAC to under $50) or $250K+ in capital.

### Example: Sensitivity That Changes the Decision

**Agent:** The sensitivity analysis reveals a binary outcome on churn: at 4% monthly churn (top-quartile B2B SaaS), this model reaches profitability at month 22 with $180K remaining. At 7% monthly churn (median for early-stage), the model *never* reaches profitability in 36 months and runs out of cash at month 19.

This means your single most important metric is not growth — it's retention. Before raising more capital, prove month-2 and month-3 retention with your first 20 customers. If retention is below 93%, the financial model breaks regardless of how much you raise.
