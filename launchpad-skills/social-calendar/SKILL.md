---
name: social-calendar
description: Plans a scheduled social posting calendar (LinkedIn + X) for the launch window, grounded in the project's positioning and GTM strategy
tier: premium
---

# Social Calendar

Plan a 2-week posting calendar the founder can run on autopilot-with-approval: each post is scheduled, then proposed in the Inbox on its due day — nothing posts without the founder's yes.

## When to Use

- During Build & Launch (stage 5), around a launch or landing-page publish
- When the founder asks for "social posts", "a posting plan", "LinkedIn content for launch"

## Instructions

Emit exactly ONE `social-calendar` artifact:

```
:::artifact{"type":"social-calendar","id":"sc_<random>"}
{"title":"Launch calendar — <Startup Name>","posts":[{"position":1,"channel":"linkedin","body":"...","day_offset":0,"best_time_hint":"Tue 9:00"},{"position":2,"channel":"x","body":"...","day_offset":1}],"sources":[...]}
:::
```

### Rules

- 6-10 posts across `linkedin` and `x`, spread over ~14 days via `day_offset` (0 = activation day).
- Each `body` is the COMPLETE post, ready to publish: platform-appropriate length (LinkedIn ≤1300 chars, X ≤280), written in the founder's voice, first person.
- Mix: problem stories, build-in-public updates, one direct launch announcement, one social-proof/traction post. Never two asks in a row.
- Include the live landing-page URL in CTA posts when one exists; otherwise leave the CTA generic and note it in the post body as `<link>` for the founder to fill.
- No hashtag walls (≤3 per post, only when they earn their place). No fake metrics or invented testimonials.
- Ground claims in canvas/research; cite with `sources`. Write in the project's language.
