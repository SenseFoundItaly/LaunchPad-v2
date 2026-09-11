---
name: build-one-pager
description: Generates a concise executive summary one-pager for investors or partners
tier: balanced
---

# Build One-Pager

Generate a concise, well-structured executive summary document suitable for investor outreach, partner introductions, or accelerator applications.

## When to Use

- After completing at least stages 1-3 (Idea, Market, Persona validation)
- When the founder asks to "create a one-pager", "write an executive summary", or "make a teaser"
- As a lightweight alternative to a full pitch deck for early outreach
- When preparing materials for accelerator applications

## Instructions

### Output Requirements

Emit a SINGLE `document` artifact with `doc_type: "one-pager"`:

```
:::artifact{"type":"document","id":"doc_<random>"}
{"title":"One-Pager — <Startup Name>","doc_type":"one-pager","content":"<full markdown>","sections":[{"heading":"Overview","body":"..."},{"heading":"Problem","body":"..."}]}
:::
```

### Document Structure

1. **Overview** — Company name, one-liner, stage, location
2. **Problem** — 2-3 sentences on the pain point (from idea canvas)
3. **Solution** — 2-3 sentences on the product (from idea canvas)
4. **Market Opportunity** — TAM/SAM/SOM one-liner + key stat (from market research)
5. **Business Model** — Revenue model in 1-2 sentences (from business model)
6. **Traction** — Key metrics or milestones achieved (from metrics/scores)
7. **Team** — Founder names + relevant experience
8. **The Ask** — What you need and what it enables

### Content Grounding

- Pull directly from validated project data
- Keep total length under 800 words
- Use bold for key numbers and metrics
- Mark any placeholder content: "[Founder to add]"

### Format

- Each section = one entry in the `sections` array
- Content should be scannable in under 2 minutes
- Professional tone suitable for cold outreach
