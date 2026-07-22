# Alpha feedback 15/07 — resolution log

Founder alpha-test feedback (Luca), submitted as "Changelog 15/07" with screenshots
dated 15/07 and 21/07. This is the durable record — the original doc + screenshots
arrived as a chat attachment (ephemeral) and are not otherwise in the repo.

**Status: every concrete item is fixed and in production.** The only items not shipped
are explicit product decisions (noted below). Worked 2026-07-15 → 2026-07-22 across
PRs #240–#282.

Legend: ✅ shipped · 💬 answered (no code) · ⚠️ partial (rest is a product decision) · 🎨 UX decision held.

---

## Block 1 — Home & Knowledge (screenshot 16:15:59)

| # | Feedback (IT) | Status | Resolution |
|---|---|---|---|
| 1 | "Se volessi eliminare un progetto dalla home come faccio?" | ✅ #240 | Delete-project affordance on each home card (hover trash + confirm; the DELETE API existed but had no UI). |
| 2 | Onboarding minimo; post-creazione manda subito al copilot → redirect su Home "Inizia da qui" | ✅ #240 | New projects now land on `/today` (START HERE), not `/chat`. |
| 3 | Evidenziare "Add documents" in Knowledge | ✅ #240 | Add-documents is now the primary CTA. |
| 4 | Tab IT "Grafo/Lista/Movimenti" poco chiare + sfondo selezione copre i nomi | ✅ #240 | Renamed **Mappa / Elenco / Cronologia**; fixed the selected-tab contrast (`--on-accent`). |

## Block 2 — Validation Gate & options (screenshot 16:38:44)

| # | Feedback (IT) | Status | Resolution |
|---|---|---|---|
| 1 | "Validation Gate è parziale, mancano step sia per market che per technical" | ⚠️ #240 / #265 | #240 added `trends_assessed` + `buyer_persona_defined` (market) and split `build_approach` + `technical_risk_named` (technical). #265 fixed the fragile `differentiation_evidence` (was the one 1A check with no deterministic staging). **Adding brand-new hard-gate checks is a held product decision** — re-locks in-flight projects; tracked in #251. |
| 2 | Testo delle alternative tagliato, leggibile solo dopo la selezione | ✅ #240 / #241 | "Mostra tutto" expand toggle — added to **both** option renderers (OptionSetCard + the co-pilot's InlineOption). |

## Block 3 — USP, credits, download, apply (screenshot 16:30:50)

| # | Feedback (IT) | Status | Resolution |
|---|---|---|---|
| 1 | "Value definition" skippata con default; USP serve più proattività | ✅ #240 | "VALUE PROPOSITION IS EARNED" prompt rules + a triviality floor on the `value_prop` check (≥25 chars, ≥5 words). |
| 2 | "Addebito 5€ su OpenRouter = i 50 crediti?" | 💬 | No — that's provider billing on the owner's API key; the 50 credits are a separate internal (free) quota. |
| 3 | Download di ogni singolo artifact | 💬 | Already exists — `ArtifactExportButton` (the ⤓ on each card; CSV for tables, JSON otherwise). |
| 4 | 3 proposte: l'agente ripropone il prompt invece di una proposta; "Apply" scala credito e non succede nulla | ✅ #249 / #261 | #249 stage-gated the chat fact-sweep (it was staging a Stage-2 card mid-Stage-1). #261 fixed the real "Apply does nothing": resolved proposal cards re-rendered as clickable after reload → a re-click hit the idempotent no-op. |

## Blocks 4–8 — the scoring → Validation Gate chain (screenshots 16:49 / 16:51 / 16:56 / 17:01 / 17:09)

This was the blocker: after completing Idea Canvas the founder couldn't get a score, the stage wouldn't close, and the Validation Gate was unreachable. Root-cause chain fixed across #249 + #255.

| Feedback (IT) | Status | Resolution |
|---|---|---|
| "Nel Canvas non compaiono vantaggio competitivo, canali, costi/ricavi" | ✅ #249 | The Canvas header now renders all 9 Lean Canvas blocks (was 5). |
| "Dopo tutti gli stages di Idea Canvas non riesce a fare lo scoring" | ✅ #249 / #255 | Skills now receive all 9 canvas blocks (were starved → asked for "more details" → quality-gate `incomplete`). #255 parses the skill's JSON scorecard (the first bare "NN/100" in prose was being stored instead). |
| "UI dello scoring bruttina, più dettaglio" | ✅ #263 | Rich baseline score card: score/100 + qualitative band + per-dimension bars + recommendation, matching Home. |
| Home mostra 0/100 dopo lo scoring | ✅ #249 | Dimension-only artifacts now INSERT `overall_score NULL` (never a fabricated 0); read-side treats 0 as unscored + heals legacy rows. |
| "Perché copilot in decimi e home in centesimi?" | ✅ #249 | Score scale unified to **0-100 everywhere** (persisters, Home, stage check, prompt, renderer). |
| "Scoring non flaggato nelle tasks; non chiude lo stage; Validation Gate non trova dati" | ✅ #249 / #255 | Same chain — once scoring lands 0-100 and the checks are fed, Stage 1 closes and the Gate unlocks. E2E-verified on throwaway IT projects (DeskMate walk tracked in #253). |

---

## Follow-up items surfaced while fixing the above (same alpha thread)

| Item | Status | Resolution |
|---|---|---|
| Finanze / crediti / "Knowledge" still English on IT projects | ✅ #256–#258 | Full i18n audit: ~230 strings localized (Financials page, credits badge/popover/recharge, all cards, Share, settings, home); "Knowledge" → **Conoscenza**; server strings via `translate()`; **Stage-3 keyword lists made bilingual** (a latent bug: an IT founder couldn't green ICP/channel checks). |
| "spine" untranslated in IT ("Validato sulla tua spine") | ✅ #262 | → "spina dorsale" everywhere (matching the existing `home.spine-*` keys). |
| Expand/inspector opened cramped, not full-screen; score sparkline overflowed the card | ✅ #281 | Inspector portaled to `document.body` (the card's `lp-rise` transform trapped `position:fixed`); sparkline clipped + headline wraps. |
| Score trajectory (`score_history` existed, unused) | ✅ #280 | Sparkline + delta on the baseline card and Home. |

## Housekeeping shipped alongside

- #264 deleted 12 orphaned legacy components (0 import sites).
- #252 healed legacy `scores` rows to the 0-100 canon (3 junk-zeros → NULL, 3 legacy 0-10 → ×10).
- #279 added a **CI i18n guard** (fails on new hardcoded founder-facing strings — caught 3 the manual audit missed) and a **deploy freshness guard** (refuses to ship unless `HEAD == origin/main`).
- #282 fixed the Finance CSV scenario labels (#167) and the Inbox double-click double-fire (#159).

## Explicitly held (product decisions, not bugs)

- **#251** — expanding the gate with *new* market/technical checks (`adoption_barriers`, `build_effort`): re-locks every in-flight alpha project; needs a product go-ahead.
- **#162** — closed: mid-project locale change contradicts the deliberate frozen-at-creation invariant.
- **#253** — the DeskMate-specific prod E2E walk (the scoring→gate chain was verified on throwaway projects).
