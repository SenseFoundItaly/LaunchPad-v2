---
name: business-model
description: Valuta e assegna punteggio alle opzioni di business model su meccaniche di revenue, unit economics e difendibilità
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


# Business Model

Valuta e confronta le opzioni di business model per la startup, producendo una raccomandazione con punteggi. Non è un esercizio di brainstorming — è un confronto pronto per decidere che risponde a: **dato questo prodotto e questo ICP, quali meccaniche di revenue funzioneranno, quali falliranno, e perché.**

## Quando Usarla

- Dopo che market-research e scientific-validation sono completi
- Quando startup-scoring segnala Business Model Viability sotto 60
- Quando il founder sta scegliendo tra modelli di pricing (subscription vs. usage vs. transaction)
- Prima di financial-model — un financial model senza un business model locked è una finzione
- Quando si considera un hook freemium — attenzione specifica all'economia di conversione

## Istruzioni

### Dimensioni di Valutazione

Confronta ogni candidato di business model su sei dimensioni. Usa tutto il range 1-10; 5 è mediocre, non buono.

#### 1. Forza del Segnale Willingness to Pay (WTP)
- Quanto è forte l'evidenza che l'ICP pagherà questa cifra?
- Fonti: comportamento pregresso (pagano il Tool X oggi), pre-order, LOI, test di tolleranza all'aumento di prezzo
- Valutato rispetto a *questo* prezzo, non al concetto di pagare in generale

#### 2. Unit Economics a Scala Target
- Proiezione di margine lordo a 1.000 clienti paganti
- Rapporto CAC / LTV con mix di canali realistico
- Payback period in mesi
- Margine di contribuzione dopo i costi variabili

#### 3. Prevedibilità del Revenue
- Subscription > usage > transaction > project in prevedibilità
- Gli eventi di revenue accadono una volta, mensilmente, annualmente, all'uso?
- Curva di retention: l'MRR compone o churn?

#### 4. Fit con la Distribuzione
- Il business model combacia con l'economia del canale di acquisition?
- Esempio: SaaS a €49/mese con una motion di sales enterprise a 3 call è un buco di margine — il costo di sales eccede il revenue annualizzato.
- Il price point permette PLG, richiede inside sales, o serve field sales?

#### 5. Difendibilità & Switching Cost
- Il modello crea switching cost nel tempo (data moat, integrazioni, workflow lock-in)?
- Revenue da progetto one-off ha zero switching cost; SaaS con integrazioni ha switching cost alto
- La scala compone o commoditizza?

#### 6. Time to Revenue
- Quanto tempo da prodotto live al primo euro in banca?
- Per pre-seed, qualsiasi cosa > 6 mesi post-launch è un rischio
- Modelli con monetizzazione immediata (paid beta, design partner) hanno punteggio più alto qui

### Set di Candidati

Come minimo valuta:

1. **L'assunzione attuale del founder** (qualsiasi cosa abbia detto in idea-shaping)
2. **Almeno un'alternativa più semplice** (es. paid beta invece del tier gratuito)
3. **Almeno un upgrade di monetizzazione** (es. per-seat sopra il flat)
4. **La baseline "non fare nulla"** (free con ads, open-core)

Se il founder ha proposto freemium, produci una breakdown specifica dell'economia di conversione: tasso di conversione free → paid necessario per far funzionare il CAC, confrontato con benchmark di categoria (2-5% tipico per consumer, 5-15% per B2B productizzato).

### L'Output Deve Essere Opinionated

Una tabella di confronto con ogni modello a 6/10 è inutile. L'output DEVE includere una raccomandazione primaria e una ragione chiara per rifiutare ogni alternativa. "Tutti hanno tradeoff" non è una risposta.

## Formato di Output

```json
{
  "business_model": {
    "recommendation": {
      "model_id": "id_del_modello_raccomandato",
      "one_line": "es. Seat-based SaaS a €49/mese/seat con minimo 3 seat per la persona founder",
      "why_this_one": "2-3 frasi fondate sui punteggi sotto",
      "why_not_alternatives": [
        { "model_id": "altro_candidato", "reason": "Modo di fallire specifico" }
      ]
    },
    "candidates": [
      {
        "id": "candidate_1",
        "name": "Nome human-readable del modello",
        "pricing": "€49/mese/seat | €0 / €29 / €99 tier | 2% transaction fee | ...",
        "revenue_cadence": "monthly | annual | usage | one-time",
        "mechanic_description": "1-2 frasi che descrivono esattamente come fluiscono i soldi",
        "scores": {
          "wtp_signal": 1-10,
          "unit_economics": 1-10,
          "predictability": 1-10,
          "distribution_fit": 1-10,
          "defensibility": 1-10,
          "time_to_revenue": 1-10
        },
        "unit_economics_model": {
          "target_scale_customers": 1000,
          "gross_margin_pct": 0.0,
          "cac_estimate_eur": 0,
          "ltv_estimate_eur": 0,
          "ltv_cac_ratio": 0.0,
          "payback_months": 0
        },
        "strengths": ["..."],
        "risks": ["..."],
        "validation_plan": "Quale test specifico confermerebbe questo modello in 2 settimane"
      }
    ],
    "freemium_economics": {
      "applicable": true,
      "free_to_paid_conversion_needed_pct": 0.0,
      "category_benchmark_pct": 0.0,
      "verdict": "viable | risky | unviable"
    },
    "pricing_validation_next_steps": [
      "Azioni specifiche: es. 'Esegui un test di prezzo su landing page con tier €29/€49/€89 e misura il CTR'"
    ],
    "data_gaps": [
      "Cosa il founder deve imparare prima di finalizzare il pricing"
    ]
  }
}
```

## Esempi

### Esempio: Sfidare il Piano Freemium del Founder

**Founder:** "Faccio freemium. Tier gratuito illimitato, poi €29/mese per le feature premium."

**Agent:** Lasciami fare i conti prima di chiudere. A €29/mese, con un margine lordo B2B SaaS tipico dell'80%, hai circa €23/mese di contribuzione per utente pagante. Se il tuo CAC è €180 via paid ads (realistico per la tua categoria), il payback è 8 mesi — al limite del viable.

Ora il layer freemium: la regola è che il costo dell'utente free deve essere < 1% dell'LTV dell'utente paying. Se il tuo LTV paying è €29 × 80% × 24 mesi di retention = €557, puoi permetterti di spendere €5,57 per utente free. Al tuo costo di inferenza GPT-4 attuale di ~€0,08 per query complessa e 30 query/mese/utente, ogni utente free ti costa €2,40/mese. Significa che hai 2 mesi di tolleranza free-tier per utente prima che diventino net-negative — *se* non convertono mai.

Con una conversione free-to-paid del 3% (media di categoria), questo funziona appena. Al 1,5% (più probabile per la maturità del tuo prodotto), non funziona. La mia raccomandazione: inizia con una free trial di 14 giorni invece di freemium indefinito. Forza una decisione di conversione al giorno 14 e ammazza la coda di costo long-tail. Possiamo aggiungere il freemium più tardi, una volta che conosci il tasso di conversione reale da una coorte di trial.

### Esempio: Rifiutare un Modello Sexy ma Sbagliato

**Agent:** Sto rifiutando il modello "marketplace con fee del 15% sulla transazione" nonostante abbia punteggio 8/10 sulla difendibilità. Ecco perché: al tuo stage 0→1 senza supply side, hai il classico cold-start problem, e risolverlo richiede 6-12 mesi di acquisizione supply prima di vedere un euro. Questo uccide Time to Revenue (punteggio 2/10). Un percorso migliore: inizia come tool SaaS paying per il lato *supply* (€99/mese per fornitori per gestire la loro attività), risolvi un dolore reale, e layera la marketplace fee sopra una volta che hai 200+ fornitori che si fidano di te. Stesso endpoint, sequenziamento 10× meno rischioso.

### Esempio: Quando Mancano Dati

**Agent:** Non posso valutare con confidenza "WTP Signal" per il tuo modello B2B healthcare — non hai ancora zero conversazioni con i clienti. Sto marcando WTP Signal come 3/10 con una nota: *Questo punteggio riflette assenza di dati, non assenza di domanda.* Prima di impegnarci sul pricing, fai 8 discovery call con l'ICP che hai definito in scientific-validation, e chiedi specificamente: "Quanto budget dedichi oggi a [la cosa che sostituiamo]?" Quella risposta, da 8 conversazioni, ri-valuterà questa dimensione in 2 settimane e renderà il confronto dei modelli pronto per decidere.
