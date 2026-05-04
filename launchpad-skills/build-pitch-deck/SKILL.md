---
name: build-pitch-deck
description: Generates a Sequoia-format 10-12 slide investor pitch deck
tier: premium
---

# Build Pitch Deck

Generate a structured investor pitch deck in Sequoia format, grounded in the founder's validated data from prior skills.

## When to Use

- After completing at least stages 1-4 (Idea, Market, Persona, Business Model)
- When the founder asks to "build a pitch deck", "create investor slides", or "make a deck"
- During Fundraise stage (stage 6) preparation
- When preparing for investor meetings

## Instructions

### Output Requirements

Emit a SINGLE `document` artifact with `doc_type: "pitch-deck"`:

```
:::artifact{"type":"document","id":"doc_<random>"}
{"title":"Pitch Deck — <Startup Name>","doc_type":"pitch-deck","content":"<full markdown>","sections":[{"heading":"Slide 1: Title","body":"..."},{"heading":"Slide 2: Problem","body":"..."}]}
:::
```

### Slide Structure (Sequoia Format, 10-12 slides)

1. **Title Slide** — Company name, one-liner, founder name(s), date
2. **Problem** — The pain, who feels it, how they cope today (from idea canvas)
3. **Solution** — What you built, how it works (from idea canvas + prototype spec)
4. **Why Now** — Market timing, trends, inflection points (from market research)
5. **Market Size** — TAM / SAM / SOM with bottoms-up math (from market research)
6. **Product** — Key features, screenshots placeholder, demo flow
7. **Business Model** — Revenue model, pricing, unit economics (from business/financial model)
8. **Traction** — Metrics, milestones, growth rate (from metrics if available)
9. **Competition** — Landscape map, differentiation matrix (from market research)
10. **Team** — Founders, key hires, relevant experience
11. **The Ask** — Raise amount, use of funds, timeline (from financial model)
12. **Appendix** — Detailed financials, technical architecture, risk mitigations

### Content Grounding

- Every slide MUST pull from existing project data (idea canvas, scores, research, financial model)
- Mark any assumed content clearly: "[Founder to add: specific metric]"
- Include speaker notes for each slide as sub-sections
- Use concrete numbers from financial model for The Ask slide
- Reference competitive positioning from market research

### Format

- Each section in the `sections` array = one slide
- `heading` = slide title (e.g., "Slide 3: Solution")
- `body` = markdown content with bullet points, bold emphasis, and speaker notes
- The `content` field contains the full deck as continuous markdown
