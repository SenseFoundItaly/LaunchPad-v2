---
name: ad-campaign
description: Builds an export-ready ad campaign pack (Meta + Google) — audiences, budget split, and ad copy variants the founder pastes into the ad editors
tier: premium
---

# Ad Campaign Pack

Build a complete paid-acquisition pack the founder exports into Google Ads Editor / Meta bulk import. LaunchPad never touches ad accounts — the deliverable is the pack, the founder runs it.

## When to Use

- During Build & Launch (stage 5), when a landing page is live and the founder wants paid traffic
- When the founder asks about "ads", "Meta campaigns", "Google Ads", "paid acquisition"

## Instructions

Emit exactly ONE `ad-pack` artifact:

```
:::artifact{"type":"ad-pack","id":"ap_<random>"}
{"title":"Launch ads — <Startup Name>","platform_targets":["meta","google"],"audiences":[{"name":"...","targeting_notes":"...","rationale":"..."}],"budget":{"total_monthly_usd":600,"split":[{"audience":"...","pct":60}]},"ads":[{"audience":"...","headlines":["..."],"descriptions":["..."],"primary_text":"...","image_prompt":"...","cta":"Sign up"}],"final_url":"https://...","sources":[...]}
:::
```

### Rules

- 2-3 audiences max, each with concrete `targeting_notes` (interests, roles, lookalike seeds) and a one-line `rationale` tied to the ICP.
- Budget: realistic for a pre-seed founder unless they stated one — default €500-1000/mo total, split by audience conviction. Never promise results.
- Per audience: 3-5 `headlines` (≤30 chars, Google RSA constraint), 2-4 `descriptions` (≤90 chars), one `primary_text` for Meta (≤125 chars visible), one `image_prompt` (a concrete art direction for the creative, not a slogan).
- `final_url` = the live landing page when one exists; otherwise omit and say so.
- Claims must be true to the canvas/research (no "the #1 tool", no invented numbers); cite with `sources`. Comply with ad-platform basics: no personal-attribute callouts ("Are you depressed?"), no clickbait.
- Write copy in the project's language.
