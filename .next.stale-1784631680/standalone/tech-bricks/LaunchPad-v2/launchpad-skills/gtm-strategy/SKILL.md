---
name: gtm-strategy
description: Develops a go-to-market strategy with target segments, channels, pricing, and launch plan
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


# Go-to-Market Strategy

Produce a concrete, sequenced go-to-market plan that answers: **Who do we sell to first, through which channel, at what price, and in what order?** This is not a marketing plan — it's a customer acquisition playbook that connects the product to revenue.

## When to Use

- After market-research, scientific-validation, and business-model are complete
- Before growth-optimization (the GTM channels seed the growth loops)
- When the founder has a product (or MVP spec) and needs to acquire first customers
- When preparing for launch — this defines the launch sequence
- Before build-landing-page (the landing page messaging comes from the GTM positioning)

## Instructions

### Segmentation and Targeting

#### 1. Beachhead Segment

Identify the single narrowest segment to dominate first. Not "small businesses" — more like "3-person design agencies in Berlin that currently use Figma and charge $5K-$15K per project."

Criteria for the beachhead:
- **Acute pain**: they feel the problem daily, not annually
- **Reachable**: you know where they gather (communities, events, publications)
- **Willingness to pay**: they already spend money solving this problem (with tools, agencies, or manual labor)
- **Word-of-mouth potential**: winning one customer leads to referrals within the segment
- **Small enough to dominate**: you can be the default solution for this segment within 12 months

#### 2. Expansion Segments

After the beachhead, define 2-3 adjacent segments in priority order. Each must share at least one axis with the beachhead (same industry but bigger companies, same company size but adjacent industry, same use case but different geography).

### Channel Strategy

For each acquisition channel, provide:

1. **Channel name** (e.g., "LinkedIn outbound to agency founders")
2. **Why this channel** — tie to the segment's behavior (where they spend time, how they discover tools)
3. **Estimated CAC** — cost per acquired customer through this channel
4. **Volume potential** — how many customers/month at maturity
5. **Time to first customer** — days from starting this channel to first conversion
6. **Required investment** — money, tools, headcount
7. **Playbook** — step-by-step instructions a founder can execute this week

Evaluate at minimum:
- **Direct outreach** (email, LinkedIn, cold calls)
- **Content/SEO** (blog, YouTube, social)
- **Communities** (Reddit, Slack groups, Discord, industry forums)
- **Paid acquisition** (Google Ads, Facebook/Instagram, LinkedIn Ads)
- **Partnerships** (integrations, co-marketing, referral programs)
- **Product-led growth** (freemium, free tool, viral mechanics)

Rank channels by expected ROI and recommend a primary + secondary channel for the first 90 days.

### Positioning and Messaging

#### 1. Positioning Statement
"For [target segment] who [pain point], [product name] is a [category] that [key benefit]. Unlike [primary competitor], we [differentiator]."

#### 2. Value Propositions (3 levels)
- **Functional**: what the product does (feature-level)
- **Business**: what outcome it delivers (metric-level)
- **Emotional**: how it makes the user feel (identity-level)

#### 3. Messaging Matrix
For each target persona (from scientific-validation), define:
- Hook (the opening line that earns attention)
- Pain point (the problem they recognize)
- Solution (how the product addresses it)
- Proof point (evidence it works — testimonials, data, case studies)
- CTA (what you want them to do next)

### Pricing Strategy (Detailed)

Go beyond the business-model skill's structure — get specific about launch pricing:

1. **Launch pricing** vs. **steady-state pricing** (is there an introductory offer?)
2. **Pricing page structure** — how many tiers, what's in each, what's the anchor tier
3. **Free tier / trial** — structure and conversion strategy
4. **Annual discount** — yes/no and by how much
5. **Price anchoring** — what's the reference price the customer compares against (competitor pricing, manual cost, agency cost)

### Launch Plan (90-day)

A week-by-week plan for the first 90 days post-launch:

- **Pre-launch (weeks -4 to 0)**: waitlist, beta testers, content seeding
- **Launch week**: what happens, where, with what messaging
- **Weeks 1-4**: primary channel activation, first customer acquisition
- **Weeks 5-8**: iteration based on early data, secondary channel test
- **Weeks 9-12**: assess what's working, double down or pivot channel mix

Each week has specific actions, metrics to track, and decision points.

## Output Format

```json
{
  "gtm_strategy": {
    "beachhead_segment": {
      "description": "Specific, narrow segment description",
      "pain_intensity": "high | medium",
      "reachability": "Where they gather",
      "current_spend": "How they solve this today and what it costs them",
      "segment_size": "Number of potential customers in beachhead",
      "dominance_timeline": "Months to become the default solution"
    },
    "expansion_segments": [
      {
        "description": "Segment description",
        "shared_axis": "What connects this to the beachhead",
        "priority": 1,
        "enter_when": "Condition that triggers expansion"
      }
    ],
    "channels": [
      {
        "name": "Channel name",
        "type": "outbound | content | community | paid | partnership | plg",
        "target_segment": "beachhead | expansion_1",
        "estimated_cac": 0,
        "volume_potential_monthly": 0,
        "time_to_first_customer_days": 0,
        "required_investment": "$X + tooling",
        "playbook": [
          "Step 1: specific action",
          "Step 2: specific action"
        ],
        "priority": "primary | secondary | experimental",
        "sources": []
      }
    ],
    "positioning": {
      "statement": "For [segment] who [pain], [product] is a [category] that [benefit]. Unlike [competitor], we [differentiator].",
      "value_propositions": {
        "functional": "What it does",
        "business": "What outcome it delivers",
        "emotional": "How it makes users feel"
      }
    },
    "messaging_matrix": [
      {
        "persona": "Persona name from scientific-validation",
        "hook": "Opening line that earns attention",
        "pain_point": "The problem they recognize",
        "solution": "How the product addresses it",
        "proof_point": "Evidence it works",
        "cta": "What you want them to do"
      }
    ],
    "pricing": {
      "launch_pricing": "Introductory pricing structure",
      "steady_state_pricing": "Long-term pricing",
      "tiers": [
        { "name": "Tier name", "price": "$X/mo", "features": ["Feature 1"], "target": "Which persona" }
      ],
      "free_trial_or_tier": "Structure and conversion strategy",
      "annual_discount_pct": 0,
      "price_anchor": "What the customer compares against"
    },
    "launch_plan_90_day": [
      {
        "week": "-4 to 0",
        "phase": "Pre-launch",
        "actions": ["Specific action 1", "Specific action 2"],
        "metrics_to_track": ["Waitlist signups", "Beta feedback score"],
        "decision_point": "What to evaluate at the end of this phase"
      }
    ],
    "first_90_day_targets": {
      "customers": 0,
      "mrr": 0,
      "channel_validated": "Which channel proved viable",
      "key_learning": "What you'll know by day 90 that you don't know now"
    },
    "sources": []
  }
}
```

## Examples

### Example: Beachhead Selection

**Founder:** "Our target market is small businesses."

**Agent:** "Small businesses" is 33 million entities in the US alone. You cannot market to 33 million companies with $0 budget. Let me narrow this using your data:

From your buyer personas (scientific-validation), your power user is a solo marketing consultant who manages 3-5 clients and spends 10+ hours/week on reporting. From your market research, there are approximately 120,000 solo marketing consultants in the US (IBIS data), and they cluster on LinkedIn, in specific Facebook groups, and at local marketing meetups.

**Beachhead:** Solo marketing consultants in the US with 3-5 active clients who currently use Google Sheets or manual methods for client reporting. Estimated segment: ~40,000 people. They're reachable via 3 LinkedIn groups with 15K+ combined members and 2 Facebook communities. They spend $50-200/month on tools today. You can realistically become the default tool for this segment within 12 months.

### Example: Rejecting a Channel

**Agent:** You proposed LinkedIn Ads as your primary channel. For your $49/mo SaaS targeting solo consultants, LinkedIn Ads are likely wrong. Here's why: LinkedIn's minimum CPC for B2B is typically $6-12. At a 2% landing page conversion rate, your CAC through LinkedIn Ads would be $300-600. Your LTV at 5% monthly churn and $49/mo is approximately $980. That's a CAC/LTV ratio of 0.3-0.6 — technically viable but the payback period is 6-12 months, which is too long for a bootstrapped startup.

Instead: direct LinkedIn outreach (free or $79/mo for Sales Navigator) to the same audience yields a 5-15% reply rate. At 50 outreach messages per day, you get 3-7 conversations per day. If 10% convert, that's 1 customer every 2-3 days at effectively $0 CAC. This is your primary channel.
