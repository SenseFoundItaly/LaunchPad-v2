# Credit Pricing Spec — "1 credit ≈ 1 message"

_Canonical model, 2026-06-21. Supersedes the old 300-credits/$ unit for all
founder-facing numbers. Grounded in prod-measured real LLM costs (llm_usage_logs,
OpenRouter Sonnet 4.6 $3/$15). USD→EUR ≈ 1.08._

> **⚠ The cost basis under this spec has moved (2026-08-31, PR #445 — pending merge/deploy).**
> The balanced tier is now Sonnet 5 ($2/$10, cacheWrite $2.50, cacheRead $0.20 —
> `src/lib/llm/models.ts`), and the chat prompt-cache split is on by default. A
> measured chat turn: **$0.15 cold, $0.032 warm** (~94% prefix hit), against the
> $0.14 average this spec is built on. **Every figure below still carries the old
> derivation** and needs re-deriving against a session-weighted blend of cold and
> warm turns — see "The cost lever", which anticipated exactly this and now has
> its decision fork live. Do not quote the per-action table to a founder until
> that re-derivation happens.

## The unit
**1 credit ≈ 1 chat message ≈ $0.14 (€0.13) of real LLM cost.**

Everything scales off the message. A skill is "a few messages' worth"; an approval
is a rounding error. This is the legibility fix for Luca's "credits scaled randomly":
the numbers are small, intuitive, and tied to real cost.

- **Metering** (what a action *debits*): `creditsPerDollar ≈ 7.1` (1 credit = real $0.14).
  Cost-true — the markup is NOT baked into the unit anymore.
- **Price** (what a credit *sells* for): **€0.40 / credit** → **3.1× markup, ~67% gross margin.**

## Per-action credit cost (today's bloated costs)
| Action | Real LLM cost | Credits |
|---|---|---|
| Chat message | $0.14 / €0.13 | **1** |
| Approve → graph | ~$0 (DB write) | **free** (≈0.05) |
| Manual insert (competitor/note) | ~$0 | **~0.1** |
| Startup scoring | $0.46 | **~3** |
| Market research | $0.40–0.88 | **~3–6** |
| Any skill | metered | `round(cost_usd / 0.14)` |

Principle (from Luca's changelog): no-LLM actions ≈ free; LLM actions priced at
their metered cost; the chat message is the base unit.

## Packs (base €0.40/cr, volume discount on larger packs)
| Pack | Credits | €/credit | ≈ messages | ≈ skill runs | margin |
|---|---|---|---|---|---|
| €5 | **12** | 0.42 | 12 | 2–4 | 67% |
| €15 | **40** | 0.375 | 40 | 7–13 | 65% |
| €40 | **120** | 0.33 | 120 | 20–40 | 60% |

## Free tier
**~10 credits/month** (≈10 messages, ~€1.30 real cost/free-user/mo). A CAC knob —
raise for a more generous trial, lower to protect margin. (The old "100 credits"
was ~2 messages in the old unit; do NOT carry the number over — carry the *intent*
of "a usable handful of messages.")

## The cost lever (makes heavy ops cheaper for real) — **LANDED, decision now live**
After caching (#78) + output cap + model-routing the non-artifact skill steps
(~3× realistic), a message drops to **~€0.045**. Then either:
- **keep €0.40/credit** → margin 67% → **~89%**, or
- **reprice to ~€0.14/credit** → keep 67% margin, **€5 buys ~36 credits/messages**.

Pricing tweaks redistribute; cost cuts grow the pie. Ship #78 before promising a
generous pack.

**Status 2026-08-31:** the caching lever shipped in PR #445 (`CHAT_CACHE_SPLIT`
default ON, provider-gated to OpenRouter) together with the Sonnet 5 tier move.
Measured warm turn **$0.032 ≈ €0.030 — already below the €0.045 target**; a cold
first turn is still ~$0.15, so the true per-message average depends on session
length and needs a session-weighted number from prod before repricing. **Not yet
merged/deployed**, so prod still bills at the old rates today. The fork above is
now a live founder decision, not a projection — and note the output cap and skill
model-routing halves of "#78" are still open (see the harness audit's remaining
levers), so there is more headroom after this.

## Wiring (NOT a one-line flip — a redenomination)
Switching `creditsPerDollar` 300 → ~7.1 rescales every credit number by ~42×. To
do it safely:
1. Change `USER_MONTHLY_CREDITS` / `USER_MONTHLY_LLM_USD` in `credit-costs.ts` so
   `creditsPerDollar ≈ 7.1` (e.g. CREDITS=10, LLM_USD=1.40) — cost-true unit.
2. **Migrate existing `user_budgets` balances** ÷42 (old credits → new) so live
   users' displayed usage stays consistent across the cutover.
3. Move the 3× markup to the **sale/checkout price** (€0.40/credit), out of the
   metering constant.
4. Re-derive per-action prices (approval → ~free, not 0.5; pool → ~10, not 100).
5. Flag-gate the cutover; verify the badge + per-message actual-credit display
   read the new unit. Gate behind the credit reconciliation fix (per-user drift).
