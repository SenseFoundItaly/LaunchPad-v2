---
name: scientific-validation
description: Generates buyer personas with empathy maps and validation interview scripts grounded in market research data
---

# Scientific Validation

Generate rigorous buyer personas, empathy maps, and validation strategies grounded in the founder's market research data. This skill bridges the gap between "we think we know our customer" and "we have a structured, testable understanding of who buys and why."

## When to Use

- After market-research is complete (requires market sizing and competitive data as input)
- Before business-model to ensure the model fits actual buyer behavior
- When founder says "I don't really know who my customer is" or "I need to validate demand"
- Before building an MVP to ensure you are building for the right person
- When pivoting to a new customer segment

## Instructions

### Buyer Persona Generation

Generate a minimum of 3 distinct buyer personas. For each persona:

#### Profile
- **Name:** Descriptive archetype name (e.g., "The Overwhelmed CTO")
- **Title and Role:** Specific job title, not generic (e.g., "Director of Digital Transformation" not "manager")
- **Organization Level:** C-Suite / VP / Director / Manager / IC
- **Department:** Specific department or function
- **Company Size:** Employee count range and revenue range

#### Decision Authority
- **Budget Range:** Specific EUR range they can approve (e.g., "€500K-€2M annually")
- **Approval Level:** What they can sign off independently (e.g., "€250K without board approval")
- **Decision Timeline:** How long from problem recognition to purchase (e.g., "4-8 months")

#### Buying Process
- **Stages:** List the specific stages (e.g., Problem recognition → Internal research → Vendor shortlist → POC → Procurement → Legal → Deployment)
- **Timeline:** Duration of each stage
- **Stakeholders:** Who else is involved in the decision (min 2, with their role in the process)

#### Purchase Criteria
Minimum 3 criteria, weighted. Weights MUST sum to 1.0.

Example:
- Integration with existing stack: 0.30
- Time to value: 0.25
- Total cost of ownership: 0.25
- Vendor stability / support: 0.20

#### Objections
Minimum 2 per persona. Each objection must include:
- The objection itself (what they say)
- The real concern behind it (what they mean)
- Response strategy (min 50 chars, specific to this persona)
- Evidence or proof point that addresses the concern

#### Engagement Channels
Where this persona discovers and evaluates solutions (min 2). Be specific: not "social media" but "LinkedIn Groups for CTOs" or "Gartner Magic Quadrant reports."

### Empathy Map Generation

For each buyer persona, create a detailed empathy map:

#### Think & Feel
- **Thoughts:** What occupies their mind about this problem area (min 2)
- **Feelings:** Emotional state around the problem (min 2)
- **Worries:** What keeps them up at night (min 2)
- **Aspirations:** What success looks like to them (min 2)

#### See
- **Environment:** What their work environment looks like
- **Market Offerings:** What solutions they currently see advertised
- **Influencers:** Who shapes their opinions (specific people, publications, or peers)

#### Hear
- **From Peers:** What colleagues and industry contacts say (min 2)
- **From Market:** What vendors and analysts say (min 2)
- **From Leadership:** What their boss or board expects (min 2)

#### Say & Do
- **Public Statements:** What they say in meetings about this problem
- **Observed Behavior:** What they actually do (which may differ from what they say)
- **Workarounds:** Current hacks or manual processes they use

#### Pains
Each pain with severity rating (High / Medium / Low) and business impact description.

#### Gains
Each gain with value description and how they would measure success.

### Validation Interview Script

Create a validation interview script following The Mom Test principles:

1. **No leading questions.** Never ask "Would you use a product that does X?" Instead ask "Tell me about the last time you dealt with [problem]."
2. **No hypotheticals.** Never ask "Would you pay for X?" Instead ask "What are you currently spending to solve this problem?"
3. **Focus on past behavior, not future intentions.** People are terrible at predicting their own behavior.
4. **Minimum 10 questions** organized by theme (problem discovery, current solutions, decision process, willingness to pay).
5. **Include follow-up probes** for each question (what to dig into based on the answer).
6. **Red flags to listen for:** Signs the problem is not real or not painful enough.
7. **Green flags to listen for:** Signs of strong demand.

### Grounding in Market Research

All personas must reference data from market-research:
- Market segments identified → map to specific persona types
- Competitor analysis → inform what alternatives the persona currently uses
- Customer insights → validate or refine persona assumptions
- Trends → contextualize persona priorities and pain evolution

If market-research has not been run, flag this explicitly and recommend running it first.

## Output Format

```json
{
  "scientific_validation": {
    "personas": [
      {
        "name": "Archetype name",
        "profile": {
          "title": "Specific job title",
          "org_level": "Director",
          "department": "Engineering",
          "company_size": { "employees": "50-200", "revenue": "€5M-€20M" }
        },
        "decision_authority": {
          "budget_range": "€100K-€500K",
          "approval_level": "€100K independently",
          "decision_timeline": "3-6 months"
        },
        "buying_process": {
          "stages": ["Stage 1", "Stage 2"],
          "timeline_per_stage": { "Stage 1": "2 weeks" },
          "stakeholders": [
            { "role": "CFO", "involvement": "Budget approval at final stage" }
          ]
        },
        "purchase_criteria": [
          { "criterion": "Integration ease", "weight": 0.30, "description": "Must integrate with existing CI/CD pipeline" }
        ],
        "objections": [
          {
            "objection": "We already have an internal tool",
            "real_concern": "Switching cost and team disruption",
            "response": "Specific response strategy with evidence",
            "evidence": "Case study or data point"
          }
        ],
        "engagement_channels": ["LinkedIn CTOs group", "Gartner reports", "Peer referrals"],
        "confidence": 0.7
      }
    ],
    "empathy_maps": [
      {
        "persona_name": "Archetype name",
        "think_and_feel": {
          "thoughts": ["Thought 1", "Thought 2"],
          "feelings": ["Feeling 1", "Feeling 2"],
          "worries": ["Worry 1", "Worry 2"],
          "aspirations": ["Aspiration 1", "Aspiration 2"]
        },
        "see": {
          "environment": "Description",
          "market_offerings": "What they see",
          "influencers": ["Person or publication"]
        },
        "hear": {
          "from_peers": ["Quote or theme"],
          "from_market": ["Quote or theme"],
          "from_leadership": ["Quote or theme"]
        },
        "say_and_do": {
          "public_statements": "What they say",
          "observed_behavior": "What they actually do",
          "workarounds": "Current manual solutions"
        },
        "pains": [
          { "pain": "Description", "severity": "High", "impact": "Business impact" }
        ],
        "gains": [
          { "gain": "Description", "value": "What it means to them", "measurement": "How they would measure success" }
        ]
      }
    ],
    "validation_script": {
      "introduction": "How to open the interview",
      "questions": [
        {
          "theme": "Problem Discovery",
          "question": "Tell me about the last time you...",
          "follow_up_probes": ["What happened next?", "How did that affect your team?"],
          "red_flags": ["They cannot recall a specific instance"],
          "green_flags": ["They describe the problem with visible frustration"]
        }
      ],
      "closing": "How to end and next steps",
      "sample_size_recommendation": "Number of interviews needed for confidence"
    },
    "data_gaps": ["Information that would improve persona accuracy"],
    "recommended_next": "business-model"
  }
}
```

## Examples

### Example: Identifying the Real Buyer

**Founder:** "My target customer is developers."

**Agent:** That is too broad. Based on your market research showing a $2.4B developer tools market, let me generate three distinct personas that represent different segments:

1. **The Solo Builder** -- Independent developer or tiny startup (1-3 people). Budget: $0-50/month. Buys based on free tier quality and documentation. Decision: instant, no approval needed. This persona has volume but near-zero willingness to pay.

2. **The Platform Team Lead** -- Manages 5-15 developers at a mid-size company. Budget: €10K-50K/year. Buys based on team productivity gains and integration with existing CI/CD. Decision: 2-4 weeks, needs engineering VP sign-off. This is your beachhead buyer.

3. **The Enterprise Architect** -- Defines tooling standards for 100+ developers. Budget: €100K-500K/year. Buys based on security, compliance, and vendor stability. Decision: 3-9 months through procurement. High value but long sales cycle.

Your competitive analysis showed that Competitor X dominates Persona 3. I recommend targeting Persona 2 first -- they have budget, faster decisions, and your competitor analysis shows this segment is underserved.
