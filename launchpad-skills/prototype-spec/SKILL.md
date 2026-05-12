---
name: prototype-spec
description: Creates an MVP blueprint with tech stack, core features, brand identity, and build timeline
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


# MVP Spec (Prototype Specification)

Produce a build-ready MVP blueprint that answers: **What is the smallest thing we can build that proves the core thesis, and how do we build it?** This is not a feature wishlist — it's a scalpel that cuts to the one workflow the startup must nail.

## When to Use

- After idea-shaping and business-model are complete
- When the founder is ready to start building
- Before build-landing-page (the landing page should reflect the MVP scope)
- When evaluating build vs. buy vs. partner decisions
- When scoping work for a technical co-founder or dev agency

## Instructions

### Core Principle: Minimum Viable, Maximum Learning

The MVP exists to learn, not to impress. Every feature must answer a specific question about the business:

- **Must-have features** answer: "Can the user complete the core workflow?"
- **Should-have features** answer: "Does the user come back?"
- **Could-have features** are cut. They answer questions that don't matter yet.

### MVP Scope Definition

#### 1. Core Workflow

Identify the single workflow that, if it works, proves the business. Describe it step-by-step:
- What triggers the workflow (user action, event, schedule)?
- What happens at each step?
- What's the output/value the user receives?
- How long should the workflow take (target: under 2 minutes for first value)?

#### 2. Feature Set (MoSCoW)

- **Must-have** (launch blockers): 3-5 features maximum. Each must directly serve the core workflow.
- **Should-have** (week 2-4 adds): features that improve retention but aren't needed for first use.
- **Won't-have** (explicitly cut): name the features the founder will be tempted to build but shouldn't. Explain why each is cut.

#### 3. Non-functional Requirements

- **Performance**: response time targets for the core workflow
- **Security**: authentication, data handling, compliance requirements
- **Scale**: how many concurrent users must the MVP support? (Usually: 100 is plenty)

### Tech Stack Recommendation

Recommend a specific tech stack based on:
1. **Founder's existing skills** (if known from chat context)
2. **Speed to market** — optimize for build speed, not elegance
3. **Cost at MVP scale** — free tiers should cover the first 6 months
4. **Ecosystem** — strong library/plugin ecosystem for the core domain

For each technology choice, explain the specific tradeoff: why this over alternatives.

Categories:
- Frontend framework
- Backend/API
- Database
- Authentication
- Hosting/deployment
- Key third-party APIs or services
- Monitoring/analytics

### Brand Identity (Lightweight)

Not a full brand guide — just enough to build a consistent MVP:
- **Name** (if not already chosen): 2-3 options with domain availability note
- **Tagline**: one sentence that communicates the core value proposition
- **Visual direction**: color palette (2-3 colors with hex codes), typography recommendation, overall aesthetic (minimal, bold, playful, professional)
- **Voice**: 3 adjectives that describe how the product speaks to users

### Build Timeline

A phased timeline with concrete milestones:
- **Phase 1: Foundation** (week 1-2) — auth, basic UI shell, database schema, deployment pipeline
- **Phase 2: Core** (week 2-4) — the core workflow, end to end
- **Phase 3: Polish** (week 4-6) — onboarding flow, error handling, basic analytics
- **Phase 4: Launch** (week 6-8) — landing page, beta invite system, feedback loop

Each phase has specific deliverables and a "done when" criterion.

### Build vs. Buy Matrix

For each significant component, evaluate:
- **Build**: when it's core IP or doesn't exist as a service
- **Buy/use SaaS**: when a $20/mo tool saves 2 weeks of dev time
- **Open source**: when a mature library exists and maintenance burden is low

## Output Format

```json
{
  "prototype_spec": {
    "core_workflow": {
      "trigger": "What starts the workflow",
      "steps": [
        { "step": 1, "action": "User does X", "system_response": "System does Y", "time_target": "< 5 seconds" }
      ],
      "value_delivered": "What the user gets at the end",
      "time_to_value": "Under 2 minutes"
    },
    "features": {
      "must_have": [
        { "name": "Feature name", "description": "What it does", "validates": "What business question this answers" }
      ],
      "should_have": [
        { "name": "Feature name", "description": "What it does", "add_in_week": 3 }
      ],
      "wont_have": [
        { "name": "Feature name", "reason": "Why it's cut for MVP" }
      ]
    },
    "non_functional": {
      "performance_target": "Core workflow completes in < X seconds",
      "security_requirements": ["Auth method", "Data handling"],
      "scale_target": "Support X concurrent users"
    },
    "tech_stack": {
      "frontend": { "choice": "Framework", "rationale": "Why this one" },
      "backend": { "choice": "Framework/language", "rationale": "Why" },
      "database": { "choice": "DB", "rationale": "Why" },
      "auth": { "choice": "Service/approach", "rationale": "Why" },
      "hosting": { "choice": "Platform", "rationale": "Why", "estimated_monthly_cost": "$X" },
      "key_services": [
        { "service": "Name", "purpose": "What it does", "cost": "$X/mo" }
      ]
    },
    "brand_identity": {
      "tagline": "One sentence value proposition",
      "colors": { "primary": "#hex", "secondary": "#hex", "accent": "#hex" },
      "typography": "Font recommendation",
      "aesthetic": "minimal | bold | playful | professional",
      "voice_adjectives": ["adj1", "adj2", "adj3"]
    },
    "build_timeline": [
      {
        "phase": 1,
        "name": "Foundation",
        "weeks": "1-2",
        "deliverables": ["Auth system", "DB schema", "Deploy pipeline"],
        "done_when": "User can sign up and see empty dashboard"
      }
    ],
    "build_vs_buy": [
      { "component": "Component name", "decision": "build | buy | open-source", "rationale": "Why", "cost_if_buy": "$X/mo" }
    ],
    "total_estimated_cost_6mo": "$X",
    "biggest_technical_risk": "The one thing most likely to blow up the timeline",
    "sources": []
  }
}
```

## Examples

### Example: Cutting Scope Aggressively

**Founder:** "We need user profiles, social features, messaging, a marketplace, analytics dashboard, and an AI recommendation engine."

**Agent:** That's 6 features. Your core thesis from idea-shaping is "help freelancers find clients through skill-matching." The only feature that tests this thesis is the matching algorithm. Everything else is infrastructure that makes the matching *nicer* but doesn't prove it *works*.

MVP scope: A form where freelancers describe their skills. A form where clients describe their needs. A matching function that produces ranked results. An email notification. That's it. No profiles, no messaging, no marketplace, no dashboard. If the matches are good, people will reply to the email. If they don't, no amount of social features will fix a bad matching algorithm.

### Example: Tech Stack for Speed

**Agent:** Given that you're a solo founder with Python experience and need to ship in 6 weeks:

- **Frontend:** Next.js — not because it's trendy, but because Vercel gives you free hosting, instant deploys, and you can write the API in the same repo. The alternative (separate React + Flask API) doubles your deploy complexity for zero user benefit at MVP scale.
- **Database:** Supabase (Postgres) — free tier covers 500MB and 50K monthly active users. That's 10x what you need for 6 months. Built-in auth saves you 1 week of dev time.
- **AI:** OpenAI API directly — don't build a custom model. At your scale (< 1000 requests/day), the API cost is under $30/month. Fine-tune later when you have data.

Total hosting cost at MVP: $0/month (all within free tiers).
