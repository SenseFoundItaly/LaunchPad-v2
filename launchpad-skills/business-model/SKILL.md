---
name: business-model
description: Evaluates and scores business model options across revenue mechanics, unit economics, and defensibility
---

# Business Model

Evaluate and compare business model options for the startup, producing a scored recommendation. This is not a brainstorming exercise — it is a decision-ready comparison that answers: **given this product and this ICP, which revenue mechanics will work, which will fail, and why.**

## When to Use

- After market-research and scientific-validation are complete
- When startup-scoring flags Business Model Viability below 60
- When founder is choosing between pricing models (subscription vs. usage vs. transaction)
- Before financial-model — a financial model without a locked business model is a fiction
- When considering a freemium hook — specific attention to conversion economics

## Instructions

### Evaluation Dimensions

Compare each business model candidate across six dimensions. Use the full 1-10 range; 5 is mediocre, not good.

#### 1. Willingness to Pay (WTP) Signal Strength
- How strong is the evidence that ICP will pay this amount?
- Sources: prior behavior (they pay Tool X today), pre-orders, LOIs, price-increase tolerance tests
- Scored against *this* price, not the concept of paying in general

#### 2. Unit Economics at Target Scale
- Gross margin projection at 1,000 paying customers
- CAC / LTV ratio with realistic channel mix
- Payback period in months
- Contribution margin after variable costs

#### 3. Revenue Predictability
- Subscription > usage > transaction > project in revenue predictability
- Do revenue events happen once, monthly, yearly, on-use?
- Retention curve: does MRR compound or churn?

#### 4. Distribution Fit
- Does the business model match the acquisition channel economics?
- Example: €49/mo SaaS with a 3-call enterprise sales motion is a margin hole — sales cost exceeds annualized revenue.
- Does the price point allow PLG, requires inside sales, or needs field sales?

#### 5. Defensibility & Switching Cost
- Does the model create switching cost over time (data moat, integrations, workflow lock-in)?
- One-off project revenue has zero switching cost; SaaS with integrations has high switching cost
- Does scale compound or commoditize?

#### 6. Time to Revenue
- How long from product live to first euro in the bank?
- For pre-seed, anything > 6 months post-launch is a risk
- Models with immediate monetization (paid beta, design partner) score higher here

### Candidate Set

At minimum evaluate:

1. **The founder's current assumption** (whatever they said in idea-shaping)
2. **At least one simpler alternative** (e.g., paid beta instead of free tier)
3. **At least one monetization upgrade** (e.g., per-seat on top of flat)
4. **The "do nothing" baseline** (free with ads, open-core)

If the founder has proposed freemium, produce a specific conversion-economics breakdown: free → paid rate needed to make CAC work, compared against category benchmarks (2-5% typical for consumer, 5-15% for productized B2B).

### Output Must Be Opinionated

A comparison table with every model scored 6/10 is useless. The output MUST include a primary recommendation and a clear reason for rejecting each alternative. "They all have tradeoffs" is not an answer.

## Output Format

```json
{
  "business_model": {
    "recommendation": {
      "model_id": "id_of_recommended_model",
      "one_line": "e.g., Seat-based SaaS at €49/mo/seat with a 3-seat minimum for the founder persona",
      "why_this_one": "2-3 sentences grounded in the scores below",
      "why_not_alternatives": [
        { "model_id": "other_candidate", "reason": "Specific failure mode" }
      ]
    },
    "candidates": [
      {
        "id": "candidate_1",
        "name": "Human-readable model name",
        "pricing": "€49/mo/seat | €0 / €29 / €99 tiers | 2% transaction fee | ...",
        "revenue_cadence": "monthly | annual | usage | one-time",
        "mechanic_description": "1-2 sentences describing exactly how money flows",
        "scores": {
          "wtp_signal": 1-10,
          "unit_economics": 1-10,
          "predictability": 1-10,
          "distribution_fit": 1-10,
          "defensibility": 1-10,
          "time_to_revenue": 1-10
        },
        "unit_economics_model": {
          "target_scale_customers": 1000,
          "gross_margin_pct": 0.0,
          "cac_estimate_eur": 0,
          "ltv_estimate_eur": 0,
          "ltv_cac_ratio": 0.0,
          "payback_months": 0
        },
        "strengths": ["..."],
        "risks": ["..."],
        "validation_plan": "What specific test would confirm this model in 2 weeks"
      }
    ],
    "freemium_economics": {
      "applicable": true,
      "free_to_paid_conversion_needed_pct": 0.0,
      "category_benchmark_pct": 0.0,
      "verdict": "viable | risky | unviable"
    },
    "pricing_validation_next_steps": [
      "Specific actions: e.g., 'Run a landing-page price test with €29/€49/€89 tiers and measure CTR'"
    ],
    "data_gaps": [
      "What the founder needs to learn before finalizing pricing"
    ]
  }
}
```

## Examples

### Example: Challenging the Founder's Freemium Plan

**Founder:** "I'll do freemium. Free tier unlimited, then €29/mo for premium features."

**Agent:** Let me run the math before we lock that in. At €29/mo, with a typical B2B SaaS gross margin of 80%, you have about €23/mo contribution per paid user. If your CAC is €180 via paid ads (realistic for your category), payback is 8 months — on the edge of viable.

Now the freemium layer: the rule of thumb is that free-user cost must be < 1% of paid-user LTV. If your paid LTV is €29 × 80% × 24 months retention = €557, you can afford to spend €5.57 on a free user. At your current GPT-4 inference cost of ~€0.08 per complex query and 30 queries/month/user, each free user costs you €2.40/month. Meaning you have 2 months of free-tier tolerance per user before they turn net-negative — *if* they never convert.

With a 3% free-to-paid conversion (category average), this just barely works. At 1.5% (more likely for your product maturity), it does not. My recommendation: start with a 14-day free trial instead of indefinite freemium. It forces a conversion decision at day 14 and kills the long-tail cost tail. We can layer freemium in later, once you know your actual conversion rate from a trial cohort.

### Example: Rejecting a Sexy but Wrong Model

**Agent:** I'm rejecting the "marketplace with 15% transaction fee" model despite it scoring 8/10 on defensibility. Here's why: at your 0→1 stage with no supply side, you have the classic cold-start problem, and solving it requires 6-12 months of supply acquisition before you see a euro. That kills Time to Revenue (scored 2/10). A better path: start as a paid SaaS tool for the *supply* side (€99/mo for suppliers to manage their business), solve real pain, and layer the marketplace fee on once you have 200+ suppliers who trust you. Same endpoint, 10× less risky sequencing.

### Example: When Data Is Missing

**Agent:** I cannot confidently score "WTP Signal" for your B2B healthcare model — you have zero customer conversations so far. I'm marking WTP Signal as 3/10 with a note: *This score reflects absence of data, not absence of demand.* Before we commit to pricing, run 8 discovery calls with the ICP you defined in scientific-validation, and ask specifically: "What do you budget today for [the thing we replace]?" That answer, from 8 conversations, will re-score this dimension within 2 weeks and make the model comparison decision-ready.
