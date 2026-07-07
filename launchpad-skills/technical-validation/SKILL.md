---
name: technical-validation
description: Validates the technical feasibility of the idea — build approach, key dependencies, and regulatory/compliance constraints (L2 Validation Gate, track 1B)
---

## What this skill does (L2 — Validation Gate · track 1B)

This is the **Technical Validation** track of the L2 Validation Gate (Phase 1). It runs
**in parallel** with the 1A Market track and feeds Problem-Solution Fit (1C): before
talking to users you should already know whether the thing is *buildable*, what it
*depends on*, and whether any *regulatory/legal* constraint blocks it.

It is designed to validate **incrementally, as the conversation goes** — you do NOT need
a single big run. Whenever the founder discusses a technical aspect, capture it as a
durable fact so the gate's three 1B checks (`tech_feasibility`, `key_dependencies`,
`regulatory_check`) close progressively:

- **Feasibility (`tech_feasibility`)** — is the core approach technically possible with today's
  tools? What is the build approach / architecture at a high level? What is the single biggest
  technical risk?
- **Key dependencies (`key_dependencies`)** — the critical external dependencies the product
  relies on: third-party APIs, models, infrastructure, vendors, data sources, integrations.
- **Regulatory / compliance (`regulatory_check`)** — any regulation, licensing, certification,
  or data-protection constraint (e.g. GDPR, sector licenses) that affects whether/how this can
  be built or shipped.

## How findings persist (so the gate validates "man mano")

This skill has **no tools** — it persists by **emitting `insight-card` artifacts** that the skill
runner saves to the project's memory facts. The Validation-Gate **1B** checks read those facts on
the next evaluation, so emitting these cards is what turns the technical track green. Emit **one
card per area** (feasibility + dependencies use `category: "technology"`; the regulatory card
uses `category: "regulatory"`), with keyword-bearing `body` text the gate can match, and at least
one source:

```
:::artifact{"type":"insight-card","id":"ins_<random>","category":"technology","title":"Technical feasibility","body":"<feasibility verdict — note the build approach/architecture and the single biggest technical risk>","confidence":"medium","sources":[{"type":"user","title":"founder","quote":"<what the founder said>"}]}
:::
:::artifact{"type":"insight-card","id":"ins_<random>","category":"technology","title":"Key dependencies","body":"<the critical external dependencies: APIs, models, infra, vendors, integrations>","confidence":"medium","sources":[{"type":"user","title":"founder","quote":"..."}]}
:::
:::artifact{"type":"insight-card","id":"ins_<random>","category":"regulatory","title":"Regulatory / compliance","body":"<regulation/licensing/data-protection constraints, e.g. GDPR>","confidence":"medium","sources":[{"type":"user","title":"founder","quote":"..."}]}
:::
```

> **Safety net:** if you write a substantive assessment but emit no parseable
> insight-cards, the runtime deterministically stages the three findings from
> your summary as one approve-to-green card (so the 1B gate can never be left
> red after a real run). Emitting the cards above is still preferred — it gives
> the founder cleaner per-finding provenance.

The founder can also validate these **incrementally in normal chat** — the chat co-pilot captures
technical facts as the conversation goes; this skill is the structured, in-bulk path. Do NOT invent
specifics: if a dependency isn't decided or a constraint can't be assessed, say so plainly and ask
the one question that unblocks it.

## Output

A short, founder-facing technical-validation summary with three sections (Feasibility,
Key dependencies, Regulatory/compliance), each with a 1-line verdict and the open question(s)
that remain. Cite sources for any external claim (regulations, vendor capabilities, benchmarks).
Keep it tight — this is a gate check, not an architecture doc.

<!-- sources-required-block -->
## Source Requirements

Every external-world claim (a regulation, a vendor capability, a benchmark, a named tool) MUST
cite a source. Founder-stated facts use `type: 'user'`; project data uses `type: 'internal'`.
Never fabricate URLs, regulations, or vendor names — if you don't have a source, say so.
