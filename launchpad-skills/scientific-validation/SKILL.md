---
name: scientific-validation
description: Generates detailed buyer personas and empathy maps grounded in the founder's ICP and research
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


# Scientific Validation

Produce structured, evidence-grounded buyer personas and empathy maps that the founder can actually use to drive positioning, copy, and outreach decisions. "Scientific" here means testable: every persona attribute should be falsifiable through at least one customer conversation.

## When to Use

- After idea shaping and market research, before writing GTM or landing-page copy
- When startup scoring flags Customer Demand below 60
- When the founder cannot clearly answer "who is this for?" in one sentence
- Before outreach sequences — each persona unlocks one message variant
- When pivoting — new persona work always precedes new copy

## Instructions

### Validation Principles

1. **Three personas, not ten.** Early-stage startups die from breadth, not depth. Produce a primary, a secondary, and an anti-persona (the customer you will intentionally not serve). More than three dilutes focus.

2. **Grounded in data, or labeled as hypothesis.** If the founder has run interviews, reference specific quotes and behaviors. If not, mark every claim as a hypothesis and list the interview question that would falsify it.

3. **Specific over demographic.** "35-year-old marketing manager" is useless. "Marketing manager at a 20-50 person B2B SaaS, reports to founder, has a Linear board, two annual reviews away from VP title" is a person. Persona detail should drive one concrete channel or message decision.

4. **Empathy map before features.** For each persona, fill the empathy map (says / thinks / does / feels / pains / gains) before discussing what to build. The map prevents feature-first thinking.

5. **One day-in-the-life per persona.** A narrative ("Monday 8am she opens Slack, sees...") beats a demographic list. It forces concreteness and surfaces the actual intervention moment.

6. **Anti-persona is non-optional.** Who would be a bad fit? Who would consume support time without paying? Who would require custom work? Saying no is the strongest positioning tool at pre-seed.

### Empathy Map Structure

For each persona, produce:

- **Says** — 2-3 verbatim phrases they actually use (from interviews if available, hypothesized with ⚠ marker otherwise)
- **Thinks** — internal monologue about the problem, 2-3 items
- **Does** — current workarounds and tools
- **Feels** — emotional texture: frustrated, anxious, competitive, trapped
- **Pains** — 3-5 concrete pains ranked by frequency × intensity
- **Gains** — what "good" looks like to them — not features, outcomes

### Falsifiability Requirements

Each persona MUST include:

- **Interview target**: concrete criteria the founder can use to find this persona on LinkedIn, Slack communities, events
- **3 disconfirming interview questions**: questions whose answers would prove the persona wrong
- **Watering-hole list**: 5+ specific places (Subreddits, Discord servers, newsletters, conferences) where this persona actually hangs out

## Output Format

```json
{
  "scientific_validation": {
    "icp_statement": "One sentence: who this product is for and what job they hire it for",
    "primary_persona": {
      "name": "Descriptive handle, e.g. 'Seed-Stage SDR Lead'",
      "role_and_context": "Role, company stage, team size, reporting line",
      "seniority_and_tenure": "Years of experience, trajectory expectation",
      "empathy_map": {
        "says": ["..."],
        "thinks": ["..."],
        "does": ["..."],
        "feels": ["..."],
        "pains": [{"pain": "...", "frequency": "daily|weekly|monthly", "intensity": 1-5}],
        "gains": ["..."]
      },
      "day_in_the_life": "Narrative paragraph, Monday 8am to EOD",
      "current_stack": ["tool1", "tool2"],
      "current_workaround": "What they do today instead of the founder's product",
      "willingness_to_pay_signal": "Quote or behavior suggesting budget authority + intent",
      "disqualifying_signals": ["What would tell you they are not actually this persona"],
      "interview_target": "How to find 10 of them on LinkedIn/Slack/etc",
      "falsification_questions": ["..."],
      "watering_holes": ["..."],
      "confidence": 0.0
    },
    "secondary_persona": { /* same structure */ },
    "anti_persona": {
      "name": "The customer you will not serve",
      "why_not": "Why this segment is a trap — support cost, custom work, misalignment",
      "how_to_recognize": ["Signal 1", "Signal 2"]
    },
    "data_gaps": [
      "What the founder needs to learn via interviews before relying on these personas"
    ],
    "next_actions": [
      "Schedule 5 interviews with primary persona, targeting watering-hole X",
      "..."
    ]
  }
}
```

## Examples

### Example: Grounding When There Is Data

**Founder:** "I've talked to 12 founders running 5-20 person B2B SaaS. They all complain about metric tracking."

**Agent:** Good — 12 conversations is enough to ground a primary persona. What jumped out in at least 8 of those 12? Before we write the persona, let me pull the common pain pattern from what you just shared. Do you have notes where they describe the current workaround in their own words? A verbatim phrase from at least three of them goes in `says`. Without that we are inventing the persona.

### Example: Marking Hypothesis vs. Data

**Agent:** Your primary persona's `says` entries are marked with ⚠ — these are hypotheses, not interview quotes. Before you write GTM copy off this persona, run 5 interviews from the watering-hole list and either replace the ⚠ quotes with real ones or rewrite the persona. GTM built on hypothesized personas fails silently: your copy will sound like it could be for anyone, because it is.

### Example: Anti-Persona Saves Time

**Agent:** I'm adding "Agency owner" as an anti-persona. They will sign up, ask for white-label + custom dashboards + SSO immediately, and churn in 60 days when you say no. Three founders I've seen burn 2-3 months chasing agency logos before reaching this conclusion. If an agency owner reaches out, politely decline and point them at a broader tool. This saves you roadmap.
