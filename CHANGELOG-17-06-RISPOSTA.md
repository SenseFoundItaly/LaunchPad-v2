# Changelog 17/06 — Risposta & Stato Remediation

_Preparato il 2026-06-19. Stato di ogni punto sollevato da Luca nel test del 17/06: cosa è stato cambiato, come è stato verificato, e cosa resta aperto. Più la valutazione dell'economia dei crediti richiesta._

**Legenda:** ✅ fatto & validato dal vivo · 🟩 risolto nel codice (tsc-clean, vedi Deployment) · 🟨 parziale · 🟥 aperto/rotto

---

## 1. Stato di ogni punto

| # | Punto (17/06) | Stato | Cosa è stato fatto / evidenza |
|---|---|---|---|
| 1 | Mini tutorial / onboarding al primo accesso | 🟨 parziale | `OnboardingCard` presente nella Home (`today/page.tsx:142`) con obiettivo-piattaforma + link alle azioni. **Manca:** il percorso completo a 5 step + il reminder post-canvas "attiva il tuo primo watcher settimanale". |
| 2 | Traduzione IT (Knowledge→"Sapere", Inbox→"Posta") | ✅ | La nav ora mostra **"INTEL"** + **"Knowledge"** mantenuto non tradotto (termini di brand congelati, uguali in tutte le lingue). Verificato dal vivo nell'app. |
| 3 | L'icona account/impostazioni sparisce | ✅ | Guardia `flexShrink:0` sul chip della rail bassa (`chrome.tsx:246`). |
| 4 | Il co-pilot torna all'inglese seguendo i suggerimenti | ✅ | Reminder `[LANGUAGE — THIS TURN]` iniettato a ogni turno non-EN (`route.ts:637`); SOUL/AGENTS/skill IT caricati per locale. |
| 5 | Dettagli watcher poco chiari | ✅ | Riepilogo watcher leggibile + lista chiara (nome / cadenza / stato / ultima esecuzione). Verificato dal vivo — creato un watcher "Sibill" end-to-end (creato, attivo, settimanale). |
| 6 | Sparita la sezione upload knowledge | ✅ | Pulsante "+ Add documents" su Knowledge; componente upload morto rimosso. Verificato dal vivo. |
| 7 | Un punto / una domanda alla volta | ✅ | Regola TIER 0.25: vietato impilare 2 domande o 2 value-prop in competizione (`route.ts:131`). |
| 8 | **I crediti vengono scalati a caso** | 🟥 aperto | **Costo di approvazione corretto** (2→0.5cr). **Ancora rotto:** (a) il badge crediti mostra 0 nonostante la spesa reale (righe `user_budgets` duplicate/di periodo sbagliato — è un problema di DATI); (b) le label "≈N crediti" sulle opzioni sono stime forfettarie **30–66× sotto il costo reale in token** (vedi §2). |
| 9 | Il Canvas dovrebbe popolarsi man mano durante l'idea-shaping | 🟥 mancante | Il parser emette parziali solo per blocchi non terminati; il Canvas si riempie ancora a fine stream. Non ancora ricostruito. |
| 10 | Opzione "background" (del founder, non dell'agente) | ✅ | Regola: "il tuo background" → `unfair_advantage` del founder, mai l'auto-presentazione dell'agente (`route.ts:235`). |
| 11 | Export per singolo artefatto + report go/no-go ripulito | ✅ | `ArtifactExportButton` (CSV/JSON per artefatto) + modalità go/no-go di `context-export` (asset per stage, signals, rischi, scoring, task; chat history rimossa). |
| 12 | "Notes" in Home → knowledge | ✅ | `NotesCard` in Home → `/notes` → `memory_fact` applicato (compare in Knowledge). |
| 13 | Financial projections dettagliate + editabili | 🟨 parziale | Costruite + **scaricabili** (CSV/JSON). **Manca:** modifica-e-salva (la route è solo GET) e un renderer nel Canvas. |
| 14 | **Graph = ecosistema + matryoshka competitor** | 🟩 risolto (questa sessione) | Vedi §3 — era totalmente non funzionante in prod; ora cablato + la catena dati validata. |
| 14.2 | Costo approvazione ≤0,25–0,5cr | ✅ | `KNOWLEDGE_APPLY_CREDITS = 0.5`; i commit del canvas sono gratuiti. |
| (in fondo, 2) | Dettaglio scoring + posizione in Home + Score≠IRL | 🟨 parziale | Scorecard per-dimensione + verdetto qualitativo **validati dal vivo** (vedi §4). Restano da cablare la posizione dello score in Home e un numero IRL distinto e brandizzato. |
| SOUL.md | Più rigoroso, meno accondiscendente | ✅ | Protocollo anti-piaggeria attivo (EN+IT). **Provato dal vivo:** lo scoring ha restituito **"NOT READY" per prima cosa**, ha rifiutato un GO morbido su WTP non provata, e ha fatto emergere un competitor reale e finanziato (Sibill) tramite ricerca web. |

### Risolto anche in questa sessione (oltre la lista 17/06)
- **Loop di commit reso deterministico** — le opzioni "Conferma — commit" ora scrivono canvas/knowledge al click tramite un percorso dedicato (`/idea-canvas` gratuito; `/validation/commit` per gli item a pagamento), invece che l'agente che narra un salvataggio mai eseguito. Validato dal vivo: problem/solution/value-prop/competitive-edge tutti persistiti al click.
- **L'output degli skill ora streamma in chat** (richiesta di Luca "deve sempre streammare") — `runAgent` rispecchia i delta → la SSE di `/skills` li inoltra → la chat renderizza un unico messaggio che cresce. Provato dal vivo: un report di market-research è cresciuto da 3 a 20.160 caratteri progressivamente invece del "Running…" congelato.
- **Output di market-research formattato** — era un dump grezzo `​```json` in chat; ora un report markdown pulito (TAM/SAM/SOM + competitor + trend); il JSON resta solo per il parsing macchina.

---

## 2. Valutazione economia dei crediti (richiesta)

**Modello di pricing attuale:** `creditsPerDollar = USER_MONTHLY_CREDITS / USER_MONTHLY_LLM_USD = 100 / 0.333 ≈ 300` → **1 credito ≈ $0.0033 di costo LLM**, con un **markup 3×** (~67% margine lordo target). Pool mensile gratuito = **100 crediti ≈ $0.33 di LLM**.

**Costi reali misurati (questa sessione, da `llm_usage_logs`, OpenRouter Sonnet $3/$15):**

| Azione | Costo LLM reale | = crediti @300 | Pubblicizzato | Scarto |
|---|---|---|---|---|
| Turno di chat | $0.11–0.18 | **33–53 cr** | "≈1 cr" | ~40× |
| Startup scoring | $0.46 | **138 cr** | "≈4 cr" | ~35× |
| Market research | $0.40–0.88 | **120–266 cr** | "≈4 cr" | **30–66×** |
| Applicazione knowledge | $0 (scrittura DB) | 0,5 cr | 0,5 cr | ✅ corretto |

**Conclusioni:**
1. **Le label "≈N crediti" sono fittizie** — stime forfettarie a fasce (1/4/10) scollegate dalla realtà token-metered di 30–66×. Questo *è* il reclamo "crediti scalati a caso": al founder viene preventivato 4, ne vengono addebitati ~150.
2. **Il pool mensile da 100 crediti è ~50× troppo piccolo** — un *singolo* market-research o scoring supera l'intera disponibilità del mese.
3. **Il driver di costo dominante è lo spreco di cache del prompt**, non compute utile: il system prompt da ~27k token viene ri-scritto (`cacheWrite`) a ogni turno di chat (`cacheRead=0`) perché il contesto dinamico + una lista di tool che varia ogni turno rompono il prefisso di cache `tools→system` di Anthropic. Un fix di caching è stato tentato e **revertato** (misurato: non leggeva — il prefisso dei tool muta a monte del system block). Il fix vero richiede un **prefisso di tool stabile** (o una riduzione della dimensione del prompt) — vedi raccomandazioni.
4. **Integrità del badge:** il badge mostra 0 perché la spesa finisce su una riga `user_budgets` duplicata / di periodo sbagliato (trovate 3 righe per l'utente di test), non per un bug in `credits.ts`.

**Ordine raccomandato:** (a) ridurre/stabilizzare il prompt + la lista tool così che la cache legga davvero (taglio chat ~10×) → (b) ri-tarare il pool e i prezzi per-azione sul costo *nuovo, più basso* → (c) sostituire le label "≈N crediti" con stime reali + sistemare il badge/deduplicare le righe budget. Tarare il tier gratuito sul costo *attuale* gonfiato (senza la (a)) significa o un tier gratuito minuscolo o margini sottili/negativi.

---

## 3. Approfondimento punto 14 (il fiore all'occhiello) — ora risolto

Il fulcro del 17/06 (il graph si popola di competitor scomposti in categorie matryoshka) era **totalmente non funzionante in prod**, per due ragioni sovrapposte trovate questa sessione:

1. **La tabella `competitor_categories` non è mai esistita in prod** — la migration 022 non era mai stata applicata. Ogni `persistCompetitorCategories` falliva silenziosamente (try/catch best-effort). → **Risolto: migration 022 APPLICATA in PROD** (tabella+indici verificati dal vivo; sostituisce la vecchia nota "022 non applicata").
2. **Il percorso skill non persisteva le categorie** — `market-research` scriveva nodi competitor "nudi" e non li scomponeva mai; solo il raro tool chat `propose_competitor_analysis` lo faceva. → **Risolto: `skill-research-persist.ts` ora scompone gli attributi di ciascun competitor in `competitor_categories`** tramite l'esistente `persistCompetitorCategories` (con il node-id propagato).
   - _Residuo (rimandato):_ gli skill `startup-scoring`/`advisor` ancora non persistono competitor (sono skill di scoring, non di analisi competitor); il percorso canonico è `market-research`, ora coperto.

**Validato DAL VIVO questa sessione:** l'endpoint `/competitors/breakdown` restituisce **8 competitor × 4 categorie ciascuno** (general / pricing / competitive_advantage / criticality) e la UI Knowledge renderizza il nidificato startup → competitor → categoria → dettaglio con Applica/Ignora. Le categorie sono state popolate con un backfill fedele degli attributi già salvati sui nodi — perché la **ri-esecuzione di market-research ha parsato 0 competitor** (bug di varianza del parser). Quel bug ora è **protetto**: l'upsert della research mantiene competitor/market-size/trend precedenti quando un re-parse torna vuoto (`skill-research-persist.ts`, guardia JSONB CASE), così una run a 0 competitor non può più cancellare il graph.

---

## 4. Cosa è stato validato dal vivo vs solo-codice (aggiornato 2026-06-19)

- **Validato dal vivo nell'app questa sessione** (Playwright + un secondo giro di QA con gstack concordano, 0 bug funzionali): punti 2, 5, 6; anti-piaggeria SOUL + rigore scoring (NOT-READY-first, Sibill trovato; ha tenuto la posizione sotto contestazione diretta); il loop di commit (scritture confermate in DB); lo streaming output skill (3→20.160 caratteri); **la matryoshka end-to-end (8 competitor × 4 categorie nel Knowledge + endpoint breakdown)**; **chat↔graph — l'agente ora elenca tutti gli 8 competitor pending via query live sul graph** (prima diceva "0 competitor"); **la Home ridisegnata — Score + IRL (1/7, Market Validation) + Ecosistema + Onboarding + Note renderizzano, 0 errori in console**; **Note → memory_fact applicato** (round-trip + pulizia); **modifica/eliminazione watcher** (Sibill settimanale→giornaliero; Market Trends in pausa — entrambi via Applica → executor → DB, poi ripristinati); punto 1.5 (richiamo verbatim del canvas); punto 1.6 (scoring non più bloccato erroneamente).
- **Solo codice (tsc-clean, non ancora eseguito dal vivo):** il ramo **hard-delete** del watcher (testato solo `pause`; il delete ripiega su disattivazione in caso di conflitto FK); la UI del **percorso di fallimento** di `commit:apply` (revert + label d'errore — non forzabile da browser); l'export del financial-model **con dati reali** (nessun progetto ha ancora un modello; il builder è provato con dati sintetici).

---

## 5. Stato del deployment — IMPORTANTE (aggiornato 2026-06-19)

**Ora è tutto COMMITTATO + PUSHATO sulla PR #75, NON mergiato, NON deployato.** Branch `feat/changelog-1706-remediation` (HEAD `fd01ad1`); `npm run deploy` NON è stato eseguito, quindi nulla è ancora sul sito live. Il dev server locale gira su questo worktree contro i dati di prod con il bypass E2E solo-localhost.

**Modifiche al DB di prod fatte questa sessione (tutte additive / sicure):** (1) migration **022** (tabella `competitor_categories`); (2) migration **023** (allargato il CHECK su `pending_actions.action_type` con `edit_monitor` + `delete_monitor`); (3) una validation-proposal stale (`pa_qiy93cca6abn`) portata a rejected.

**Per rilasciare:** revisionare + mergiare la PR #75, poi `npm run deploy`. Le migration sono già in prod, quindi al deploy è solo codice.

---

## 6. Ancora aperto (in ordine di priorità, aggiornato 2026-06-19)

1. 🟥 **Punto 8 crediti** — il lavoro a impatto più alto rimasto e il reclamo più forte del founder: caching con prefisso-tool stabile (costo), ri-tarare il pool, label "≈N crediti" oneste, deduplicare le righe budget. (Valutazione in §2.) Non iniziato.
2. 🟥 **Punto 9** — popolamento progressivo del Canvas (ricostruzione additiva: parser + SSE + stato di render del Canvas).
3. 🟨 **Punto 13** — modifica-e-salva del financial-model (POST/PUT + UI di edit + renderer Canvas); l'export è fatto.
4. 🟨 **Punto 1 / onboarding** — `OnboardingCard` presente e renderizza; espandere ai 5 step completi + reminder watcher post-canvas.
5. 🟩 **Scoring in Home + IRL brandizzato — FATTO + validato dal vivo** (ScorePanel: PROJECT SCORE + un readout IRL "stage validati" distinto in Home). Tolto dagli "aperti".
6. gap minori di test dal vivo: ramo hard-delete watcher, UI di fallimento commit:apply, export financial con dati reali (vedi §4).

---

## 7. Risolto anche questa sessione (oltre la lista 17/06)

- **Fix chat ↔ knowledge-graph** — `list_graph_nodes` mostrava solo gli `applied`, quindi l'agente diceva "0 competitor" mentre il founder li vedeva. Ora mostra applied+pending, etichettati per stato. Provato dal vivo.
- **Guardia upsert research** — una ri-esecuzione di market-research che parsa 0 competitor non cancella più la riga `research` esistente (guardia JSONB CASE, si auto-ripara alla prossima run pulita).
- **3 difetti da un audit avversariale** (review a 16 agenti): silent-failure di `commit:apply` (await+catch+revert), dimensioni a object-map in ScorePanel (il breakdown per-dimensione non renderizzava mai), CSV formula-injection negli export. L'unico HIGH dell'audit era un **falso positivo** dovuto a `db/schema.sql` derivato da prod (`chat_messages.created_at` esiste live) — colto verificando il DB live.
- **Accessibilità watcher per l'agente (CRUD)** — `list_watchers` (legge attivi/pausa/inattivi + obiettivo/cadenza/stato), `edit_watcher` e `delete_watcher` (proponi → l'Applica del founder conferma → executor `editMonitor`/`deleteMonitor`). Migration 023. Validato end-to-end dal vivo. È il template per dare all'agente edit/delete sicuri su altre entità (competitor, task, fatti).
- **Fallback dettaglio watcher** — i watcher senza obiettivo non mostrano più il prompt grezzo OUTPUT-CONTRACT; mostrano un hint "nessuna descrizione — Modifica", con il prompt grezzo sotto "avanzate".
