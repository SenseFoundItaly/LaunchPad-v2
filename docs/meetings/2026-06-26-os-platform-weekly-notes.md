# OS Platform — Weekly — 26 giu 2026

- **Data:** 26 giugno 2026, 08:35 (durata ~26 min)
- **Partecipanti:** Luca Boscariol, Mike Cecconello
- **Trascrizione:** [2026-06-26-os-platform-weekly-transcript.docx](2026-06-26-os-platform-weekly-transcript.docx)
- **Doc collegato:** [L2 Iteration Cycle Walkthrough](../2026-06-26-sensefound-l2-walkthrough.md)

---

## Decisioni

- **Lancio posticipato di ~1 settimana.** Si dà +1 settimana ai primi due stage, si semplifica, poi si lancia un **alpha/interno** (target ≈ **1–6 luglio 2026**). Anche un lancio piccolo raccoglie i primi feedback utili e posiziona bene per partire subito con L2.
- **Intel → repository semplice.** Per ora l'Intel resta come repository di ciò che i watchers analizzano/estraggono (semplice, intuitivo). Il resto (overlap chat/watchers, assumptions, risk assessment) è da reindirizzare meglio più avanti. **Non prioritario per l'alpha → si può anche solo nascondere** per ora.
- **Graph: logica approvata, categorizzazione da rifare.** Struttura "matrioska" — nodo startup → macro-categorie (concorrenza, clienti, partner, investitori) → sotto-nodi esplodibili. Riferimento: changelog punto 14. Lavoro **solo di prompt**.
- **Finance panel: approvato.** Tenuto separato per overview + export CSV; in futuro condensabile quando ci saranno MVP/operational workflow. RPU editabile, salvata nel contesto, con override del founder in chat.
- **Walkthrough del documento L2.** Luca prepara un walkthrough (~5 min) di ogni macro-categoria del documento di spec; Mike lo rivede per allineare l'incastro L1↔L2.

## Punti aperti / Idee future (non per adesso)

- **Contrarian / risk model routing.** Valutare routing verso un modello open-source con meno restrizioni quando non servono guardrail, e switch al modello "pro" quando un guardrail va attivato. Difficoltà: renderlo deterministico + hardening dei modelli open source. Costo self-hosting elevato. **Tenuto come punto da studiare.**
- **Bug i18n.** La sezione Intel resta in inglese anche con setting in italiano (changelog 26/06).

## Action items

- **Mike:** rilavora l'Intel in modo più specifico/ordinato *oppure* lo nasconde per l'alpha; ricategorizza il graph (prompt); verifica/testa la persistenza RPU del finance panel; sente cosa suggerisce "cloud" su cosa cambiare; valuta cosa riesce a chiudere nel weekend.
- **Luca:** invia il walkthrough del documento L2 (macro-categorie); manda il changelog 26/06 (pochi punti veloci).
- **Entrambi:** target sync sulla **settimana del 13 luglio** (Luca rientra ~13, resta una settimana).

---

## Reconciliation: trascrizione vs Dev roadmap (solo findings, roadmap non modificata)

| Tema | Transcript (26 giu) | Roadmap | Delta |
| --- | --- | --- | --- |
| Lancio | Alpha/interno ≈ 1–6 lug 2026, +1 settimana | CSV Stage-1 deadline mag–giu; `.md` inline senza milestone di lancio | **Gap** — manca milestone alpha; date in ritardo di ~1 sett |
| L2 (mod. 1.5) | Stabilizzare L1 (primi 2 stage) poi "partire subito con L2"; incastro L1→L2 (copilot) da definire | 1.5 step "In progress" | Coerente come direzione; **sequencing non catturato** |
| Intel | Repository watcher output; nascondere per alpha | Non è una voce di roadmap | Scope feature/changelog |
| Graph | Logica ok, ricategorizzare (matrioska, changelog #14) | Non in roadmap | Solo prompt |
| Finance | Panel nuovo, apprezzato (RPU + CSV) | 1.5 "asset generation: financial projections" (In progress) | Coerente |
