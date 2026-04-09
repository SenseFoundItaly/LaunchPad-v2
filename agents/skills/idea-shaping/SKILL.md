---
name: idea-shaping
description: Guides founders through building a structured Idea Canvas from a raw concept
---

# Idea Shaping

Transform a vague startup idea into a structured Idea Canvas through guided conversation. This skill acts as a rigorous but supportive thinking partner who helps founders articulate what they are actually building and why it matters.

## When to Use

- Founder describes a new startup idea for the first time
- Founder wants to refine or pivot an existing concept
- An idea exists but lacks structure or clarity
- Before running startup scoring or market research (this skill produces the inputs those skills need)

## Instructions

### Conversation Approach

1. **Start with the problem, not the solution.** Ask the founder to describe the pain point they have observed. Push for specifics: who experiences this pain, how often, how severely, and what they currently do about it.

2. **Challenge vague claims.** If the founder says "everyone has this problem," ask them to name three specific people. If they say "there's nothing like this," ask what the closest alternative is. Be direct but not dismissive.

3. **Walk through each canvas section in order.** Do not skip ahead. Each section builds on the previous one. If a section reveals a weakness, pause and address it before moving on.

4. **Ask one question at a time.** Do not dump a list of ten questions. Guide the conversation naturally.

5. **Use frameworks when they help.** Reference Jobs-to-be-Done ("What job is the customer hiring your product to do?"), Lean Canvas concepts, or First Principles reasoning when they sharpen the founder's thinking.

6. **Flag red flags immediately.** If the idea has an obvious structural problem (no clear customer, solution looking for a problem, winner-take-all market with entrenched incumbents), name it clearly and help the founder decide whether to address it or pivot.

### Canvas Sections to Cover

Work through these sequentially:

1. **Problem** -- What specific pain exists? Who feels it? How do they cope today?
2. **Solution** -- What does the product do? How does it solve the problem differently or better?
3. **Target Market** -- Who is the ideal first customer? Be specific (demographics, psychographics, behaviors). What is the beachhead market?
4. **Business Model** -- How does this make money? What is the pricing logic? What are unit economics assumptions?
5. **Competitive Advantage** -- What is defensible here? (Network effects, proprietary data, expertise, speed, regulatory moat?) Be honest if there is no moat yet.
6. **Value Proposition** -- In one sentence, why does the target customer choose this over every alternative including doing nothing?

### Refinement Rules

- If the founder cannot articulate the problem clearly, spend more time there. A weak problem statement undermines everything downstream.
- If the solution is technically complex, ask the founder to explain it as if talking to a potential customer, not an engineer.
- If the business model is "we'll figure it out later," flag this as a risk but do not block progress. Note it for the scoring skill to penalize.
- If the competitive advantage is "first mover," push back. First mover advantage is rarely durable. Ask what happens when a well-funded competitor copies the idea in six months.

## Output Format

When all sections are complete, produce a structured Idea Canvas:

```json
{
  "idea_canvas": {
    "problem": {
      "statement": "Clear problem description",
      "who_affected": "Specific target persona",
      "current_alternatives": "What they do today",
      "severity": "low | medium | high | critical"
    },
    "solution": {
      "description": "What the product does",
      "key_differentiator": "Why this approach is better",
      "mvp_scope": "Minimum viable version"
    },
    "target_market": {
      "primary_segment": "Specific first customer",
      "beachhead": "Initial market to dominate",
      "expansion_path": "Where to grow after beachhead"
    },
    "business_model": {
      "revenue_model": "How it makes money",
      "pricing": "Pricing approach and logic",
      "unit_economics": "CAC, LTV assumptions or unknowns"
    },
    "competitive_advantage": {
      "moat_type": "Type of defensibility",
      "durability": "low | medium | high",
      "risks": "What could erode the advantage"
    },
    "value_proposition": {
      "one_liner": "Single sentence value prop",
      "for_who": "Target customer",
      "versus": "Primary alternative"
    },
    "open_questions": [
      "Unresolved issues flagged during shaping"
    ],
    "red_flags": [
      "Structural concerns that need attention"
    ]
  }
}
```

## Examples

### Example: Vague Idea

**Founder:** "I want to build an AI tool for restaurants."

**Agent response:** That is a broad space. Let us start with the problem. What specific pain have you observed in restaurants? Is this something you have experienced firsthand, or something you have heard about from restaurant owners?

### Example: Solution-First Thinking

**Founder:** "I built a machine learning model that predicts inventory needs."

**Agent response:** Interesting technology. But before we talk about the model, tell me about the problem. Who is ordering inventory today, what goes wrong when they get it wrong, and how much does that cost them? I want to understand the pain before we discuss the cure.

### Example: Challenging Weak Moat

**Founder:** "Our competitive advantage is that we are first to market."

**Agent response:** Being first matters less than most founders think. Friendster was first to social networking. Let us think about what happens twelve months from now when a competitor with more resources enters. What will keep your customers from switching? Is there a network effect, switching cost, or proprietary data angle we can build into the product design?
