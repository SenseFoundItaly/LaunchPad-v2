---
name: prototype-spec
description: Generates MVP technical blueprint, brand identity, and Osterwalder Business Model Canvas from all previous validation data
---

# Prototype Specification

Produce an actionable MVP blueprint, initial brand identity, and Business Model Canvas by synthesizing all previous validation work. This is a synthesis-only skill -- it transforms existing data into build-ready specifications. No new research is generated.

## When to Use

- After business-model is selected and scored
- When founder is ready to start building the MVP
- When a technical cofounder or developer needs a spec to estimate and plan
- Before investment-readiness to ensure the build plan is concrete

## Instructions

### MVP Feature Specification

#### Feature Prioritization
List all features in two tiers:
- **Must-Have (MVP):** Features required for the first usable version. These directly address the primary pain point of Persona 1 (from scientific-validation). Maximum 5-7 features.
- **Nice-to-Have (V2):** Features that add value but are not required for initial validation. Save these for post-launch iteration.

#### Per Feature
- **Name:** Descriptive feature name
- **Description:** What it does in one sentence
- **User Story:** "As [persona], I want to [action] so that [outcome]"
- **Complexity:** S / M / L / XL with day estimates
  - S: 1-3 days
  - M: 4-7 days
  - L: 8-15 days
  - XL: 16+ days (should be broken down)
- **Dependencies:** What must be built first
- **Validation Signal:** How you know this feature is working (specific metric)

#### Specificity Requirements
- WRONG: "User authentication" → RIGHT: "Email + password auth with magic link option, Google OAuth, session management with 30-day refresh tokens"
- WRONG: "Dashboard" → RIGHT: "Single-page dashboard showing 3 KPIs (active users, conversion rate, MRR) with 30-day sparkline charts, refreshing every 5 minutes"
- WRONG: "Medium complexity" → RIGHT: "L (12-15 days) -- API integration 8-10 days, MFA implementation 3-4 days, audit logging 2 days"

### Tech Stack Recommendation

For each layer, specify exact technology with version and reasoning:

- **Frontend:** Framework + version + why (e.g., "Next.js 16 -- SSR for SEO, React ecosystem, team proficiency")
- **Backend:** Runtime + framework + version (e.g., "Node.js 22 LTS with Hono -- lightweight, TypeScript-native, fast cold starts for serverless")
- **Database:** Specific database + hosting (e.g., "PostgreSQL 16 on Supabase -- RLS for multi-tenancy, real-time subscriptions, generous free tier")
- **Auth:** Provider + method (e.g., "Supabase Auth -- email/password + Google OAuth, built-in RLS integration")
- **Hosting:** Platform + tier (e.g., "Vercel Pro -- Next.js native, preview deploys, 60s function timeout for LLM calls")
- **Key Libraries:** Only the non-obvious ones that matter (e.g., "Recharts for dashboards, Zod for validation, OpenRouter SDK for multi-model LLM")

#### Infrastructure Cost Estimate
Monthly cost with specific breakdown:
- WRONG: "Cloud costs" → RIGHT: "€285/month total: Vercel Pro €20, Supabase Pro €25, OpenRouter API ~€200 (est. 500K tokens/day), Domain €1, Email (Resend) €20, Monitoring (Sentry) €19"

### Development Timeline

Week-by-week milestones for the MVP build:

- **Week 1:** What is built and what is the deliverable
- **Week 2-3:** Core feature development milestones
- **Week N:** Launch-ready state

Specify total weeks as a number, not "a few months." Include buffer (typically 20-30% of estimated time).

### Brand Identity v1

Initial brand elements sufficient for MVP launch:

- **Name Assessment:** Is the current name good? Domain availability, trademark conflicts, memorability
- **Tagline:** One line that captures the value proposition (max 8 words)
- **Elevator Pitch:** 30-second version (60-80 words)
- **Tone of Voice:** 3 adjectives that define communication style + 1 sentence description
- **Visual Direction:** Color palette suggestion (primary, secondary, accent), typography feel (modern/classic/technical), logo direction (wordmark/icon/combination)

### Business Model Canvas (Osterwalder)

Complete 9-block canvas synthesized from all previous stages:

1. **Customer Segments:** From scientific-validation personas (priority order)
2. **Value Propositions:** Per segment, from idea-shaping + scoring strengths
3. **Channels:** Awareness, evaluation, purchase, delivery, after-sales (from market-research)
4. **Customer Relationships:** Self-service, personal assistance, automated, community
5. **Revenue Streams:** From business-model evaluation (type, model, gross margin %)
6. **Key Resources:** Intellectual, human, technological, financial
7. **Key Activities:** Production, problem solving, platform/network
8. **Key Partnerships:** Name, role, partnership type (strategic alliance, supplier, joint venture)
9. **Cost Structure:** Fixed costs (with EUR) and variable costs (with per-unit EUR)

Include validation notes: key assumptions that need testing and risks per block.

## Output Format

```json
{
  "prototype_spec": {
    "mvp": {
      "must_have": [
        {
          "name": "Feature name",
          "description": "What it does",
          "user_story": "As [persona], I want...",
          "complexity": "L (12-15 days)",
          "complexity_breakdown": "Integration 8-10d, MFA 3-4d, Logging 2d",
          "dependencies": ["Auth system"],
          "validation_signal": "Metric that proves it works"
        }
      ],
      "nice_to_have": [],
      "total_mvp_effort": "X developer-weeks"
    },
    "tech_stack": {
      "frontend": { "technology": "Next.js 16", "reasoning": "Why" },
      "backend": { "technology": "Node.js 22 + Hono", "reasoning": "Why" },
      "database": { "technology": "PostgreSQL 16 on Supabase", "reasoning": "Why" },
      "auth": { "technology": "Supabase Auth", "reasoning": "Why" },
      "hosting": { "technology": "Vercel Pro", "reasoning": "Why" },
      "key_libraries": ["Library + purpose"],
      "monthly_cost": {
        "total": "€285/month",
        "breakdown": { "Vercel Pro": "€20", "Supabase Pro": "€25" }
      }
    },
    "timeline": {
      "total_weeks": 8,
      "buffer_weeks": 2,
      "milestones": [
        { "week": 1, "deliverable": "What is done", "features": ["Feature 1"] }
      ]
    },
    "brand_identity": {
      "name_assessment": "Analysis of current name",
      "tagline": "Short tagline",
      "elevator_pitch": "30-second pitch",
      "tone_of_voice": { "adjectives": ["adj1", "adj2", "adj3"], "description": "One sentence" },
      "visual_direction": {
        "colors": { "primary": "#hex", "secondary": "#hex", "accent": "#hex" },
        "typography": "Direction description",
        "logo_direction": "Recommended approach"
      }
    },
    "business_canvas": {
      "customer_segments": [{ "segment": "Name", "description": "Detail", "priority": 1 }],
      "value_propositions": [{ "for_segment": "Name", "propositions": ["Prop 1"] }],
      "channels": { "awareness": [], "evaluation": [], "purchase": [], "delivery": [], "after_sales": [] },
      "customer_relationships": { "models": [], "success_metrics": [] },
      "revenue_streams": [{ "type": "Subscription", "model": "Per-seat", "gross_margin_pct": 82 }],
      "key_resources": { "intellectual": [], "human": [], "technological": [], "financial": [] },
      "key_activities": { "production": [], "problem_solving": [], "platform": [] },
      "key_partnerships": [{ "name": "Partner", "role": "What they provide", "type": "Strategic alliance" }],
      "cost_structure": { "fixed_costs": [], "variable_costs": [] },
      "validation_notes": { "key_assumptions": [], "risks": [] }
    },
    "recommended_next": "investment-readiness"
  }
}
```
