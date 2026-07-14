---
name: email-sequence
description: Drafts a founder-approved email campaign (3-5 staged messages) for launch, waitlist activation, or nurture — grounded in the project's GTM strategy and canvas
tier: premium
---

# Email Sequence

Draft a complete, ready-to-send email sequence from the founder's validated positioning. The output becomes a DRAFT campaign the founder activates with their own recipient list; every individual send then requires their explicit approval in the Inbox.

## When to Use

- During Build & Launch (stage 5), after the GTM strategy exists
- When the founder asks for "launch emails", "a waitlist sequence", "an email campaign", or "nurture emails"
- After a landing page is published and signups need activation

## Instructions

Emit exactly ONE `email-sequence` artifact:

```
:::artifact{"type":"email-sequence","id":"es_<random>"}
{"title":"Launch sequence — <Startup Name>","goal":"launch","messages":[{"position":1,"subject":"...","body_html":"<p>...</p>","send_offset_days":0},{"position":2,"subject":"...","body_html":"<p>...</p>","send_offset_days":3}],"audience_notes":"...","sources":[...]}
:::
```

### Rules

- 3-5 messages. `goal` is one of `launch` | `waitlist` | `nurture` — infer from the founder's ask.
- `body_html` is COMPLETE, HTML-safe copy (simple `<p>`, `<strong>`, `<a>` tags; no CSS, no images). Every email must stand alone.
- No bare placeholders: never `[NAME]` or `{{first_name}}` without a graceful fallback reading ("Hi there" beats a broken token).
- NEVER invent recipients, lists, or email addresses. Recipients are ALWAYS provided by the founder at activation — say so in `audience_notes`.
- Subjects: concrete and specific to the product's value proposition, under 60 characters. No clickbait, no ALL CAPS, no spam-trigger phrasing.
- `send_offset_days` spaces the sequence (0, 3, 7… from activation day). Front-load value; the ask escalates gently.
- Ground every claim in the project's canvas/research; cite with `sources`. If the GTM strategy hasn't been run, say so and base the sequence on the canvas instead.
- Write in the project's language.

### Sequence craft

1. Open with the problem the recipient already feels (canvas problem, verbatim where possible).
2. One idea per email. One CTA per email, always the same destination (the live landing page when one exists).
3. The final email is a direct, honest ask with a reason to act now.
