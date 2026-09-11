---
name: investment-readiness
description: Assesses fundraising readiness across OKRs, deck, data room, and identifies gaps to close before raising
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


# Investment Readiness

Produce an honest assessment of whether this startup is ready to raise, what's missing, and what to do about it. This is not encouragement — it's a pre-flight checklist that prevents the founder from burning investor relationships by going out too early.

## When to Use

- After financial-model, startup-scoring, and risk-scoring are complete
- When the founder is considering raising capital
- Before pitch-coaching (no point coaching the pitch if the fundamentals aren't ready)
- After completing 3+ stages of the validation pipeline (stages 1-3 minimum)
- When a specific fundraising timeline is emerging (e.g., "I want to raise in Q2")

## Instructions

### Readiness Dimensions (8 areas)

Score each dimension 1-10 and provide specific evidence for the score. Use the full range — a 5 means mediocre, not good.

#### 1. Problem-Solution Fit
- Is the problem validated beyond the founder's belief? (customer interviews, usage data, waitlist demand)
- Does the solution address the problem directly, or is it a solution in search of a problem?
- Evidence: reference idea-canvas, startup-scoring, scientific-validation data

#### 2. Market Validation
- Is there evidence of real demand? (pre-orders, LOIs, beta signups, paying customers)
- Is the market large enough for VC-scale returns? (TAM > $1B for seed, > $10B for Series A)
- Evidence: reference market-research data

#### 3. Traction / Metrics
- What metrics exist? Revenue, users, engagement, growth rate?
- Are the metrics trending in the right direction?
- For pre-revenue: what proxy metrics demonstrate demand?
- Benchmark against stage-appropriate standards (e.g., seed SaaS: $10K-$100K MRR, 15%+ MoM growth)

#### 4. Business Model Clarity
- Is the revenue model locked or still experimental?
- Are unit economics viable? (positive or credibly path-to-positive)
- Evidence: reference business-model and financial-model data

#### 5. Team
- Does the team have the skills to execute the plan?
- Is there a technical co-founder (for tech startups)?
- What key hires are needed, and does the raise cover them?
- Domain expertise or relevant track record?

#### 6. Competitive Moat
- What's defensible? (IP, network effects, data moats, brand, regulatory)
- How would the plan change if a well-funded competitor entered tomorrow?
- Evidence: reference market-research competitive analysis

#### 7. Financial Plan
- Is there a credible financial model with multiple scenarios?
- Does the raise amount tie to specific milestones?
- What's the runway at current burn? How much does the raise extend it?
- Evidence: reference financial-model data

#### 8. Fundraising Materials
- Does a pitch deck exist? Is it investor-grade?
- Is there a one-pager / executive summary?
- Is the data room prepared? (cap table, incorporation docs, financials, contracts)
- Has the founder practiced the pitch?

### Overall Readiness Verdict

Based on the 8 dimensions:
- **READY TO RAISE**: 7+ average, no dimension below 5, materials prepared
- **ALMOST READY**: 5-7 average, 1-2 critical gaps that can be closed in 2-4 weeks
- **NOT READY**: below 5 average or 3+ dimensions below 4 — raising now would waste time and burn relationships
- **TOO EARLY**: pre-product or pre-validation — focus on building and learning, not fundraising

### Gap Analysis and Action Plan

For each dimension scoring below 7, provide:
1. **What's missing** (specific gap)
2. **How to close it** (specific actions)
3. **Effort required** (days/weeks)
4. **Which LaunchPad skill helps** (cross-reference other skills)

### Fundraising OKRs

Define 3-5 OKRs the founder should hit before scheduling investor meetings:
- Each OKR must be measurable and time-bound
- Each must address a specific weakness from the readiness assessment
- Include both business OKRs (metrics to hit) and process OKRs (materials to prepare)

### Recommended Round Structure

Based on the financial model and current traction:
- **Round type** (pre-seed, seed, Series A)
- **Target raise amount** (and the math behind it: months of runway needed x burn rate + buffer)
- **Implied valuation range** (based on stage, traction, and market comps)
- **Instrument recommendation** (SAFE, convertible note, priced round) with reasoning
- **Timeline** (when to start reaching out, expected close timeline)

## Output Format

```json
{
  "investment_readiness": {
    "overall_score": 0,
    "overall_verdict": "READY TO RAISE | ALMOST READY | NOT READY | TOO EARLY",
    "verdict_reasoning": "2-3 sentences explaining the verdict",
    "dimensions": [
      {
        "name": "Problem-Solution Fit",
        "score": 0,
        "evidence": "Specific data points supporting this score",
        "gap": "What's missing (null if score >= 7)",
        "action": "How to close the gap",
        "effort": "X days/weeks",
        "related_skill": "skill-id that helps close this gap",
        "sources": []
      }
    ],
    "critical_gaps": [
      {
        "gap": "Description of the most important gap",
        "impact": "Why this gap matters for fundraising",
        "action_plan": ["Step 1", "Step 2"],
        "timeline": "X weeks to close"
      }
    ],
    "okrs": [
      {
        "objective": "What to achieve",
        "key_results": [
          { "metric": "Measurable target", "current": "Current value", "target": "Target value", "deadline": "Date" }
        ],
        "priority": "critical | high | medium"
      }
    ],
    "round_recommendation": {
      "round_type": "pre-seed | seed | series-a",
      "target_amount": 0,
      "amount_rationale": "Math: X months runway x $Y burn + $Z buffer",
      "valuation_range": { "low": 0, "high": 0 },
      "valuation_basis": "How the valuation range was derived",
      "instrument": "SAFE | convertible_note | priced_round",
      "instrument_rationale": "Why this instrument",
      "timeline": {
        "start_outreach": "When to start",
        "expected_close": "When to target closing",
        "total_process_weeks": 0
      }
    },
    "data_room_checklist": [
      { "item": "Cap table", "status": "ready | needs_work | missing", "action": "What to do if not ready" }
    ],
    "sources": []
  }
}
```

## Examples

### Example: Honest "Not Ready" Assessment

**Agent:** Your overall readiness score is 3.8/10 — NOT READY. Here's why:

- **Traction (2/10):** You have zero users and zero revenue. You haven't talked to a single potential customer outside your personal network. Investors at seed stage expect at minimum 10-20 design partner conversations, and ideally $5-10K MRR or a meaningful waitlist (500+).
- **Team (3/10):** You're a solo non-technical founder building a technical product. Every investor will ask "who's building this?" and "why should I bet on a team that can't ship the product?" You need either a technical co-founder or $50K+ to outsource an MVP — and that spend would eat 40% of a typical pre-seed raise.
- **Financial Plan (2/10):** You haven't run the financial-model skill. Your "plan" is a single number ($500K raise) with no breakdown of how it gets spent or what milestones it achieves.

**Verdict:** Raising now would waste 3-4 months of meetings, damage your reputation with investors you'll want to approach later, and yield rejection. Instead:

1. Run financial-model skill (1 day)
2. Find a technical co-founder or technical advisor (2-4 weeks)
3. Build an MVP (4-6 weeks)
4. Get 10 paying customers or 500+ waitlist signups (4-8 weeks)
5. Re-assess readiness — you'll likely score 6-7/10, enough for pre-seed

### Example: Challenging the Raise Amount

**Founder:** "I want to raise $2M at seed."

**Agent:** Based on your financial model, your monthly burn is $18K (solo founder + infrastructure). A $2M raise at $18K/month gives you 111 months of runway — over 9 years. No seed investor will fund 9 years of runway because it signals that you don't know what you'd do with the money.

The right amount is the minimum needed to reach your next milestone. From your financial model's base case, you reach $50K MRR (Series A territory) at month 14, with peak cash need of $280K. Adding a 50% buffer for things going wrong: $420K.

Recommended raise: $400-500K on a SAFE with $5-6M post-money cap. This gives you 18-24 months of runway, enough to hit Series A metrics if the thesis is right, and not so much that you lose urgency. The $2M round would require a $15-20M valuation to avoid excessive dilution — and your current traction doesn't support that valuation.
