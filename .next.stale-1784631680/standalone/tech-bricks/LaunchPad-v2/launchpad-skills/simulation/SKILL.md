---
name: simulation
description: Simulates market reception with 6 persona reactions and 4 risk scenarios to stress-test the startup idea
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


# Simulation

Stress-test the startup idea by running it through 6 simulated persona reactions and 4 risk scenarios. This is not creative writing — each persona must reason from a plausible first-principles position grounded in market data, competitive intelligence, and buyer psychology from prior skills.

## When to Use

- After market-research and scientific-validation are complete (these provide the grounding data)
- When the founder needs a reality check before committing resources
- Before financial-model or prototype-spec to ensure the core thesis survives scrutiny
- When preparing for investor meetings (anticipate objections)
- When pivoting — run the new thesis through the same gauntlet

## Instructions

### Persona Set (6 reactions)

Run exactly 6 personas. Each must stay in character and produce specific, actionable feedback — not generic encouragement.

#### 2 Customer Personas
Use the buyer/user personas from scientific-validation (if available) or derive from the idea canvas target market. Each customer reacts to the value proposition, pricing, and switching cost from their current solution.

- **Customer 1: Early Adopter** — technically curious, willing to try new tools, price-insensitive, but demands clear value proposition and frictionless onboarding.
- **Customer 2: Mainstream Buyer** — risk-averse, budget-conscious, needs social proof, asks "who else is using this?" before signing up.

#### 2 Investor Personas
- **Investor 1: Seed-stage VC** — evaluates team, market size, initial traction signals, and path to Series A. Asks: "Why now? Why you? What's the unfair advantage?"
- **Investor 2: Angel / Operator** — former founder in an adjacent space. Evaluates execution risk, go-to-market feasibility, and whether the founder has talked to enough customers.

#### 1 Domain Expert
- **Expert** — deep practitioner in the startup's domain. Evaluates technical feasibility, regulatory landscape, and whether the approach is novel or derivative. Identifies non-obvious pitfalls that generalists miss.

#### 1 Competitor
- **Competitor** — the most relevant competitor's product lead. Evaluates the threat level, identifies what they would copy, and what defensive moves they would make. Honest about their own weaknesses.

### Per-Persona Output

Each persona produces:
1. **Initial reaction** (2-3 sentences — gut response)
2. **Top 3 concerns** (specific, not vague)
3. **What would make me say yes** (concrete conditions)
4. **Deal-breaker** (the one thing that would make this a hard no)
5. **Score** (1-10 likelihood of engagement/investment/adoption)

### Risk Scenarios (4 scenarios)

Run 4 plausible-but-stressful scenarios that could unfold in the first 18 months. Each scenario must be specific to this startup — not generic startup risks.

Categories (pick the 4 most relevant):
- **Competitive response** — a well-funded incumbent launches a competing feature
- **Market shift** — the target segment's budget priorities change (recession, regulation, technology shift)
- **Execution failure** — a critical technical or team assumption proves wrong
- **Demand collapse** — early signals were misleading; actual demand is 10x lower than projected
- **Regulatory shock** — new regulation either blocks the approach or creates unexpected compliance cost
- **Channel dependency** — the primary distribution channel changes terms or access

### Per-Scenario Output

1. **Scenario description** (what happens, when, triggered by what)
2. **Probability** (0.0-1.0 based on market data and competitive analysis)
3. **Impact** (0.0-1.0 on the startup's viability)
4. **Early warning signals** (what the founder should monitor)
5. **Mitigation plan** (specific actions, not "be flexible")
6. **Recovery time** (months to recover if hit)

### Synthesis

After all personas and scenarios, produce:
- **Market reception summary** — the consensus view across all 6 personas
- **Investor sentiment** — would this raise a seed round? What's blocking it?
- **Critical risk cluster** — which risks compound each other?
- **Go/No-go recommendation** — based on the simulation, should the founder proceed, pivot, or stop?

## Output Format

```json
{
  "simulation": {
    "personas": [
      {
        "id": "customer_early_adopter",
        "role": "Early Adopter Customer",
        "persona_type": "customer",
        "initial_reaction": "2-3 sentence gut response",
        "top_concerns": [
          "Specific concern 1",
          "Specific concern 2",
          "Specific concern 3"
        ],
        "would_say_yes_if": "Concrete conditions for adoption",
        "deal_breaker": "The one thing that kills it",
        "engagement_score": 7,
        "detailed_feedback": "2-3 paragraphs of in-character feedback",
        "sources": []
      }
    ],
    "risk_scenarios": [
      {
        "id": "scenario_competitive_response",
        "title": "Incumbent launches competing feature",
        "category": "competitive_response",
        "description": "Detailed scenario narrative",
        "probability": 0.6,
        "impact": 0.8,
        "early_warning_signals": [
          "Signal the founder should monitor"
        ],
        "mitigation_plan": [
          "Specific action 1",
          "Specific action 2"
        ],
        "recovery_months": 6,
        "sources": []
      }
    ],
    "market_reception_summary": "Consensus across all personas",
    "investor_sentiment": "Assessment of fundraisability",
    "critical_risk_cluster": "Which risks amplify each other",
    "go_no_go": "proceed | pivot | stop",
    "go_no_go_reasoning": "2-3 sentences explaining the verdict",
    "sources": []
  }
}
```

## Examples

### Example: Early Adopter Customer Reaction

**Persona:** Sarah, VP of Engineering at a 50-person SaaS company. Uses 4 dev tools daily, pays for quality.

**Initial reaction:** "This solves a real pain point — I lose 3 hours a week to the workflow you're replacing. But I've been burned by tools that promise automation and deliver complexity. Show me it works on my actual codebase, not a demo."

**Top concerns:**
1. Integration with our existing CI/CD pipeline (we use GitHub Actions + custom scripts)
2. Security — does this touch our source code? Where is it processed?
3. Team adoption — I can't force 12 engineers to change their workflow without a compelling demo

**Would say yes if:** Free trial works on our repo within 30 minutes, no security review needed, and at least 3 of my engineers independently say "I want this."

**Deal-breaker:** If it requires a security audit longer than 2 weeks or needs admin access to our GitHub org.

**Score:** 7/10

### Example: Competitor Reaction

**Persona:** Alex, Product Lead at the dominant incumbent tool.

**Initial reaction:** "We've seen 4 startups try this angle in the last 2 years. Two are dead, two pivoted. The feature isn't hard to build — we have it on our roadmap for Q3. What concerns me is their AI approach — if the accuracy is genuinely better, that's a 6-month window before we catch up."

**Defensive moves:** "I'd accelerate our AI feature from Q3 to Q1, announce it publicly to freeze their sales pipeline, and offer our existing customers a free beta. We have 10,000 customers who would rather add a feature than switch tools."
