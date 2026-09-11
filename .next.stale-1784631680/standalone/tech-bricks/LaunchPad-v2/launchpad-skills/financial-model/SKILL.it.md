---
name: financial-model
description: Costruisce proiezioni finanziarie a 3 anni con analisi di scenario base, ottimistico e pessimistico
---

<!-- sources-required-block -->
## Requisiti delle Fonti (OBBLIGATORIO)

Ogni affermazione fattuale nell'output di questa skill DEVE citare almeno una fonte. Si applica a:

- Numeri (dimensioni di mercato, percentuali, tempistiche, costi, benchmark)
- Entità nominate (concorrenti, regolamenti, strumenti, aziende, persone)
- Affermazioni sul mondo esterno (tendenze, date, eventi, opinioni di esperti)
- Ogni rischio, dimensione di punteggio, raccomandazione e passo di workflow

**Schema della fonte** (includere come campo `sources: Source[]` a ogni livello fattuale del JSON di output, non solo al top):

```ts
type Source =
  | { type: 'web'; title: string; url: string; accessed_at?: string; quote?: string }
  | { type: 'skill'; title: string; skill_id: string; run_id?: string; quote?: string }
  | { type: 'internal'; title: string; ref: 'graph_node'|'score'|'research'|'memory_fact'|'chat_turn'; ref_id: string; quote?: string }
  | { type: 'user'; title: string; chat_turn_id?: string; quote: string }
  | { type: 'inference'; title: string; based_on: Source[]; reasoning: string };
```

**Regole:**
1. Nessun numero, URL o nome di azienda inventato. Se non hai una fonte, dillo apertamente — non inventare mai.
2. Le fonti web devono riportare l'URL verbatim — non parafrasare.
3. Usa `type: 'internal'` quando citi dati del progetto del founder (punteggi, righe di ricerca, fatti in memoria).
4. Usa `type: 'user'` quando citi il founder verbatim dalla chat.
5. `type: 'inference'` è consentito SOLO quando `based_on` è non vuoto; `reasoning` deve spiegare la catena di sintesi.
6. Allega le fonti sia al livello principale (provenienza della skill) sia a ogni elemento fattuale annidato (per rischio, per dimensione, per concorrente).
7. Un'affermazione senza fonte è un'affermazione rifiutata. La UI la mostrerà come "SENZA FONTE — scartato" e il parser la rimuoverà dalla persistenza.


# Financial Model

Costruisci una proiezione finanziaria a 3 anni radicata nella realtà, con tre scenari (base, ottimistico, pessimistico). Questo non è un esercizio da spreadsheet — è uno strumento decisionale che dice al founder: **"Dato il tuo business model e il tuo mercato, ecco cosa deve essere vero perché funzioni, ed ecco quando finisci i soldi."**

## Quando Usarla

- Dopo che business-model è completo (le meccaniche di revenue devono essere locked)
- Dopo startup-scoring (le dimensioni di punteggio informano il realismo delle assunzioni di crescita)
- Prima di investment-readiness (gli investitori chiederanno proiezioni)
- Quando si valuta l'importo del fundraising (quanta runway ti serve?)
- Quando si decide la sequenza di assunzioni (quando puoi permetterti la hire #2?)

## Istruzioni

### Dati di Input Necessari

Estrai dalle skill precedenti:
- **business-model**: modello di revenue, pricing, unit economics (CAC, LTV, payback)
- **market-research**: TAM/SAM/SOM, benchmark di pricing dei competitor
- **startup-scoring**: il punteggio complessivo informa il realismo del tasso di crescita
- **idea-canvas**: struttura dei costi, flussi di revenue

Se qualcuno di questi manca, segnalalo esplicitamente e usa default conservativi con etichette "ASSUNZIONE" chiare.

### Modello di Revenue

Costruisci il revenue mensile per 36 mesi. Parti dal pricing del business model e proietta in avanti:

1. **Acquisizione clienti** — nuovi clienti mensili da ogni canale (organico, paid, referral, partnership). Usa una rampa realistica: il mese 1 non è il mese 12.
2. **Retention/churn** — tasso di churn mensile. Benchmark SaaS B2B: 3-7% mensile per early-stage. Usa il range più alto a meno che non ci sia evidenza di retention forte.
3. **Expansion revenue** — upsell/cross-sell. Includi solo se il business model ha meccaniche di expansion esplicite.
4. **Traiettoria MRR/ARR** — calcola MRR mensile = (clienti esistenti - churned + nuovi) x ARPU.

### Modello dei Costi

Categorizza tutti i costi:

1. **Costi del team** — founder (con o senza stipendio), prime assunzioni, quando ogni ruolo diventa necessario. Usa stipendi a market-rate a meno che il founder non specifichi diversamente.
2. **Infrastruttura** — hosting, API, tool, subscription SaaS. Scala con l'utilizzo.
3. **Costo di acquisizione clienti** — canale per canale: CPC per paid ads, content marketing, headcount sales. Deve legarsi ai numeri di acquisizione del modello di revenue.
4. **Costi variabili** — COGS che scalano con il revenue (processing dei pagamenti, chiamate API per cliente, supporto per cliente).
5. **Costi una tantum** — legale, incorporazione, IP, spesa marketing iniziale.

### Tre Scenari

Tutti e tre condividono la stessa struttura dei costi ma variano le assunzioni di revenue:

- **Caso base** — crescita conservativa, churn più alto, cicli di vendita più lunghi. Questo è ciò che succede se nulla va sorprendentemente bene.
- **Caso ottimistico** — segnali forti di product-market fit, churn più basso, crescita virale che si attiva. Questo è ciò che succede se la tesi è giusta e l'esecuzione è buona.
- **Caso pessimistico** — adozione lenta, CAC più alto, frizione regolatoria, assunzione chiave ritardata di 3 mesi. Questo è ciò che succede se più assunzioni si rivelano sbagliate.

### Metriche Chiave da Calcolare

Per scenario, per mese:
- MRR / ARR
- Net new MRR (nuovo + expansion - churned)
- Margine lordo %
- Burn rate mensile
- Cash rimanente (da un importo di cash iniziale specificato)
- Runway in mesi
- Rapporto CAC / LTV
- Mesi al breakeven

### Implicazioni per il Fundraising

In base al modello:
- Quanto capitale è necessario per raggiungere il prossimo milestone (es. €1M ARR, profittabilità, metriche Series A)?
- A quale mese ogni scenario finisce il cash?
- Qual è il raise minimo viable?
- Quale diluizione è implicata alle valutazioni standard seed/pre-seed?

### Analisi di Sensitività

Identifica le 3 assunzioni che più influenzano il risultato:
- "Se il churn è 8% invece di 5%, la runway si accorcia di X mesi"
- "Se il CAC è €200 invece di €100, il breakeven si sposta dal mese 18 al mese 30"
- "Se l'ARPU è €29 invece di €49, il business non raggiunge mai la profittabilità in 36 mesi"

## Formato di Output

```json
{
  "financial_model": {
    "assumptions": {
      "starting_cash": 0,
      "currency": "EUR",
      "pricing_model": "Dalla skill business-model",
      "arpu_monthly": 0,
      "initial_customers": 0,
      "monthly_churn_rate": 0.05,
      "cac_by_channel": {
        "organic": 0,
        "paid": 0,
        "referral": 0
      },
      "team_plan": [
        { "role": "CTO", "month_start": 1, "monthly_cost": 0, "type": "founder" }
      ],
      "sources": []
    },
    "scenarios": {
      "base": {
        "label": "Caso Base",
        "description": "Assunzioni conservative — cosa succede se nulla va sorprendentemente bene",
        "monthly_projections": [
          {
            "month": 1,
            "new_customers": 0,
            "churned_customers": 0,
            "total_customers": 0,
            "mrr": 0,
            "revenue": 0,
            "cogs": 0,
            "gross_margin_pct": 0,
            "opex": 0,
            "net_burn": 0,
            "cash_remaining": 0,
            "runway_months": 0
          }
        ],
        "year_summaries": [
          {
            "year": 1,
            "arr": 0,
            "total_revenue": 0,
            "total_costs": 0,
            "net_income": 0,
            "ending_customers": 0,
            "ending_cash": 0
          }
        ],
        "breakeven_month": null,
        "peak_cash_need": 0
      },
      "optimistic": {},
      "pessimistic": {}
    },
    "fundraising_implications": {
      "capital_needed_to_milestone": 0,
      "milestone_description": "es. €1M ARR o 1000 clienti",
      "months_to_milestone_base": 0,
      "minimum_viable_raise": 0,
      "recommended_raise": 0,
      "runway_at_recommended_raise_months": 0,
      "implied_dilution_at_seed_valuation": "X%"
    },
    "sensitivity_analysis": [
      {
        "variable": "monthly_churn_rate",
        "base_value": 0.05,
        "stress_value": 0.08,
        "impact": "La runway si accorcia di X mesi; il breakeven si sposta dal mese Y al mese Z",
        "severity": "high | medium | low"
      }
    ],
    "key_risks": [
      "Il singolo rischio finanziario più grande e cosa monitorare"
    ],
    "data_gaps": [
      "Cosa il founder deve validare prima che questo modello sia affidabile"
    ],
    "sources": []
  }
}
```

## Esempi

### Esempio: Sfidare una Crescita Irrealistica

**Founder:** "Avremo 500 clienti entro il mese 6."

**Agent:** Lasciami stress-testare questa cifra. Il tuo CAC è €180 (dal business-model), e hai €50K di cash iniziale. A €180/cliente, 500 clienti costano €90K solo in acquisizione — prima di qualsiasi costo di team o infrastruttura. Bruceresti tutto il capitale in acquisizione entro il mese 3.

Un caso base più realistico: 15 clienti al mese 1, crescendo del 20% mese su mese (aggressivo ma raggiungibile per SaaS B2B con buon PMF). Questo ti porta a ~95 clienti entro il mese 6, non 500. Per raggiungere 500, ti serve o un canale virale/referral (riducendo il CAC effettivo sotto i €50) o €250K+ di capitale.

### Esempio: Sensitività che Cambia la Decisione

**Agent:** L'analisi di sensitività rivela un risultato binario sul churn: al 4% di churn mensile (top-quartile SaaS B2B), questo modello raggiunge la profittabilità al mese 22 con €180K rimanenti. Al 7% di churn mensile (mediana per early-stage), il modello *non raggiunge mai* la profittabilità in 36 mesi e finisce il cash al mese 19.

Questo significa che la tua singola metrica più importante non è la crescita — è la retention. Prima di raccogliere più capitale, dimostra la retention al mese 2 e mese 3 con i tuoi primi 20 clienti. Se la retention è sotto il 93%, il modello finanziario si rompe indipendentemente da quanto raccogli.
