---
name: technical-validation
description: Validates the technical feasibility of the idea — build approach, key dependencies, and regulatory/compliance constraints (L2 Validation Gate, track 1B)
---

## What this skill does (L2 — Validation Gate · track 1B)

This is the **Technical Validation** track of the L2 Validation Gate (Phase 1). It runs
**in parallel** with Market Validation (1A) and feeds Problem-Solution Fit (1C): before
talking to users you should already know whether the thing is *buildable*, what it
*depends on*, and whether any *regulatory/legal* constraint blocks it.

It is designed to validate **incrementally, as the conversation goes** — you do NOT need
a single big run. Whenever the founder discusses a technical aspect, capture it as a
durable fact so the gate's 1B checks close progressively:

- **Feasibility** — is the core approach technically possible with today's tools? What is the
  build approach / architecture at a high level? What is the single biggest technical risk?
- **Key dependencies** — the critical external dependencies the product relies on: third-party
  APIs, models, infrastructure, vendors, data sources, integrations.
- **Regulatory / compliance** — any regulation, licensing, certification, or data-protection
  constraint (e.g. GDPR, sector licenses) that affects whether/how this can be built or shipped.

## How to capture evidence (so the gate validates "man mano")

For every technical finding, persist it with `save_memory_fact` so the 1B checks read it on
the next evaluation. Use clear, keyword-bearing phrasing the gate can match:

- feasibility → e.g. *"Technical feasibility: the matching engine is feasible with a vector DB;
  main technical risk is latency at scale."*
- dependencies → e.g. *"Key dependency: relies on the Stripe API for billing and OpenAI for
  embeddings."*
- regulatory → e.g. *"Regulatory: handling EU user data → GDPR applies; needs a DPA with vendors."*

Do NOT invent specifics. If the founder hasn't decided a dependency or you can't assess a
constraint, say so plainly and ask the one question that unblocks it — then capture the answer.

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
