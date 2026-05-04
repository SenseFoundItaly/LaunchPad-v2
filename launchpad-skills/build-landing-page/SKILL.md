---
name: build-landing-page
description: Generates a self-contained, responsive HTML landing page for the startup
tier: premium
---

# Build Landing Page

Generate a production-ready, self-contained HTML landing page using the founder's validated idea, market research, and brand positioning.

## When to Use

- After completing Idea Validation (stage 1) and at least Market Validation (stage 2)
- When the founder asks to "build a landing page", "create a website", or "make a homepage"
- During the Build & Launch stage (stage 5) as a concrete deliverable
- When preparing to test messaging with real users

## Instructions

### Output Requirements

Generate a SINGLE self-contained HTML file with ALL CSS inline (no external dependencies). The output MUST be emitted as a single `html-preview` artifact:

```
:::artifact{"type":"html-preview","id":"hp_<random>"}
{"html":"<!DOCTYPE html>...","title":"Landing Page — <Startup Name>","viewport":"desktop"}
:::
```

### Page Structure

1. **Hero Section** — Headline (value prop), sub-headline (problem framing), primary CTA button
2. **Problem Section** — 3 pain points the target market faces (from idea canvas)
3. **Solution Section** — How the product solves each pain point
4. **Social Proof / Traction** — Metrics, testimonials, logos (use placeholder data clearly marked)
5. **Features / How It Works** — 3-4 key differentiators
6. **Pricing** (if available from business model) — or "Get Early Access" CTA
7. **Final CTA** — Repeated call to action with email capture placeholder
8. **Footer** — Copyright, minimal links

### Design Principles

- Mobile-first responsive design using CSS media queries
- Clean, modern aesthetic with the startup's positioning in mind
- All CSS must be inline in a `<style>` tag — no external stylesheets
- All fonts from Google Fonts via `<link>` tag (the only allowed external resource)
- Smooth scroll behavior, subtle animations (CSS only, no JS frameworks)
- Accessible: proper heading hierarchy, alt text, sufficient contrast
- Color palette: derive from the brand if defined, otherwise use a professional default

### Content Grounding

- Pull headline copy from the `value_proposition` in idea canvas
- Pull problem framing from the `problem` field
- Pull target market language from `target_market`
- If market research exists, incorporate TAM/traction numbers
- If scores exist, reflect the strongest dimensions in the messaging

### What NOT to Include

- No JavaScript frameworks (React, Vue, etc.)
- No external CSS frameworks (Tailwind, Bootstrap)
- No placeholder Lorem Ipsum — use real copy derived from project data
- No fake testimonials — mark any social proof as "[Placeholder]"
