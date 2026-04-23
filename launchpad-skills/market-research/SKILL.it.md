---
name: market-research
description: Conduce ricerca di mercato strutturata e analisi competitiva con sizing TAM/SAM/SOM
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


# Market Research

Produci una ricerca di mercato strutturata e un'analisi competitiva fondate sui dati disponibili. Questo skill aiuta i founder a passare da congetture a stime informate, e da "penso ci siano competitor" a una mappa competitiva dettagliata.

## Quando Usarla

- Dopo idea-shaping per validare le assunzioni di mercato
- Prima o dopo startup-scoring per colmare lacune di dati nelle dimensioni Market Opportunity e Competitive Landscape
- Quando un founder sta considerando un pivot e deve valutare un nuovo mercato
- Quando si preparano materiali di pitch che richiedono un sizing di mercato difendibile
- Periodicamente per aggiornare la competitive intelligence

## Istruzioni

### Principi di Ricerca

1. **Distingui dati da stime.** Quando citi dimensioni di mercato, sii esplicito se un numero viene da un report pubblicato, un calcolo bottom-up o una stima informata. Etichetta chiaramente ciascuno.

2. **Bottom-up meglio di top-down.** Un TAM top-down ("Il mercato SaaS globale è $200B") è quasi inutile. Tenta sempre un calcolo bottom-up: numero di clienti potenziali moltiplicato per spesa annua realistica.

3. **Nomina le fonti quando possibile.** Se fai riferimento a report industriali, stime di analisti o dati di aziende pubbliche, cita la fonte. Se lavori da conoscenza generale, dillo.

4. **L'analisi competitiva deve essere specifica.** Non dire "ci sono molti competitor". Nominali. Descrivi cosa fanno. Identifica punti di forza e debolezze. Stima la loro traction se possibile.

5. **Identifica cosa il founder può imparare in modo unico.** La ricerca di mercato più preziosa spesso viene dal parlare con i clienti. Segnala domande specifiche che il founder dovrebbe fare a persone reali.

### Sezioni di Ricerca

#### 1. Market Sizing (TAM/SAM/SOM)

- **TAM (Total Addressable Market):** l'opportunità di revenue totale se ogni possibile cliente al mondo usasse il prodotto. Usa sia approcci top-down (report industriali) sia bottom-up (conteggio clienti × prezzo).
- **SAM (Serviceable Addressable Market):** la porzione di TAM raggiungibile date le capacità attuali del prodotto, la geografia e il go-to-market. Questo è il mercato target realistico.
- **SOM (Serviceable Obtainable Market):** la porzione di SAM che la startup può realisticamente catturare nei primi 2-3 anni date risorse e competizione. Dovrebbe essere conservativo.

Mostra i tuoi calcoli. Un numero senza calcolo è solo una congettura.

#### 2. Profilo dei Competitor

Per ogni competitor significativo (punta a 3-7), documenta:

- **Nome azienda e URL**
- **Cosa fanno** (una frase)
- **Cliente target** (chi servono)
- **Pricing** (se pubblicamente disponibile)
- **Traction stimata** (utenti, revenue, funding — quello che si sa)
- **Punti di forza chiave** (cosa fanno bene)
- **Debolezze chiave** (dove cadono corti)
- **Storia di funding** (investitori, importi, stage)
- **Livello di minaccia** (low / medium / high) con ragionamento

Mappa anche i competitor su una matrice 2x2 usando le due dimensioni più rilevanti per il mercato (es. prezzo vs. profondità di feature, o SMB vs. enterprise e horizontal vs. vertical).

#### 3. Trend di Mercato

Identifica 3-5 trend rilevanti che impattano questo mercato:

- **Nome e descrizione del trend**
- **Direzione** (tailwind o headwind per la startup)
- **Orizzonte temporale** (immediato, 1-2 anni, 3-5 anni)
- **Evidenza** (quali dati supportano questo trend)
- **Implicazione** (cosa significa per la strategia della startup)

#### 4. Case Study

Identifica 1-3 aziende o situazioni analoghe che offrono lezioni:

- **Azienda/situazione** descritta
- **Cosa è successo** (narrativa)
- **Lezione chiave** per il founder
- **Applicabilità** (quanto questo mappa alla situazione del founder)

Cerca sia storie di successo sia ammonimenti. Un'azienda fallita in uno spazio adiacente è spesso più istruttiva di un unicorno in un mercato diverso.

#### 5. Customer Insights

Basandoti sulle informazioni disponibili, delinea:

- **Buyer persona** (chi prende la decisione di acquisto)
- **User persona** (chi usa il prodotto quotidianamente, se diverso)
- **Trigger d'acquisto** (quali eventi spingono qualcuno a cercare una soluzione)
- **Criteri di decisione** (quali fattori contano di più nello scegliere una soluzione)
- **Obiezioni** (ragioni comuni per non comprare)
- **Domande di validazione** (domande specifiche che il founder dovrebbe fare a clienti potenziali)

### Standard di Qualità della Ricerca

- Non presentare mai un singolo data point come definitivo. Triangola quando possibile.
- Riconosci l'incertezza esplicitamente. "Sulla base dei dati disponibili, il TAM appare essere tra $500M e $2B" è più onesto di "$1,2B TAM".
- Aggiorna la ricerca precedente quando arrivano nuove informazioni invece di partire da zero.
- Segnala quando la ricerca è obsoleta (le condizioni di mercato cambiano, emergono nuovi competitor).

## Formato di Output

```json
{
  "market_research": {
    "market_sizing": {
      "tam": {
        "estimate": "$X",
        "methodology": "top-down | bottoms-up | blended",
        "calculation": "Calcolo passo-passo",
        "confidence": "low | medium | high",
        "sources": ["Fonte 1", "Fonte 2"]
      },
      "sam": {
        "estimate": "$X",
        "methodology": "Come SAM è stato derivato da TAM",
        "constraints": ["Geografici", "Segmento", "Capacità prodotto"]
      },
      "som": {
        "estimate": "$X",
        "timeframe": "2-3 anni",
        "assumptions": ["Assunzione 1", "Assunzione 2"],
        "market_share_implied": "X%"
      }
    },
    "competitors": [
      {
        "name": "Nome Competitor",
        "url": "https://...",
        "description": "Una frase",
        "target_customer": "Chi servono",
        "pricing": "Info pricing o 'unknown'",
        "traction": "Metriche note",
        "strengths": ["Punto di forza 1"],
        "weaknesses": ["Debolezza 1"],
        "funding": "Storia di funding nota",
        "threat_level": "low | medium | high",
        "threat_reasoning": "Perché questo livello di minaccia"
      }
    ],
    "competitor_matrix": {
      "axis_x": "Dimensione 1",
      "axis_y": "Dimensione 2",
      "positions": {
        "Nome Competitor": {"x": "low | mid | high", "y": "low | mid | high"}
      },
      "white_space": "Dove si trova il gap di opportunità"
    },
    "trends": [
      {
        "name": "Nome del trend",
        "description": "Cosa sta succedendo",
        "direction": "tailwind | headwind",
        "timeframe": "immediate | 1-2 years | 3-5 years",
        "evidence": "Dati di supporto",
        "implication": "Cosa significa per la startup"
      }
    ],
    "case_studies": [
      {
        "company": "Nome azienda o situazione",
        "narrative": "Cosa è successo",
        "lesson": "Lezione chiave",
        "applicability": "Come questo si applica al founder"
      }
    ],
    "customer_insights": {
      "buyer_persona": "Descrizione",
      "user_persona": "Descrizione",
      "purchase_triggers": ["Trigger 1"],
      "decision_criteria": ["Criterio 1"],
      "common_objections": ["Obiezione 1"],
      "validation_questions": ["Domanda che il founder dovrebbe fare a clienti reali"]
    },
    "research_gaps": [
      "Informazioni che non sono state determinabili e come colmarle"
    ],
    "last_updated": "ISO date"
  }
}
```

## Esempi

### Esempio: Sizing di Mercato Bottom-Up

**Founder:** "Qual è la dimensione del mercato per un tool di scheduling AI per dentisti?"

**Agent:** Lasciami fare il sizing bottom-up invece di citare un generico numero del "mercato del dental software".

**Calcolo TAM bottom-up:**
- Ci sono circa 200.000 studi dentistici negli US (dati ADA)
- Ogni studio sarebbe un cliente
- Un tool di scheduling in questo spazio tipicamente costa $200-500/mese
- Punto medio: $350/mese × 12 = $4.200/anno per studio
- 200.000 × $4.200 = $840M TAM US

**Restringimento SAM:**
- Il tuo prodotto è cloud-based, che esclude gli studi resistenti al software cloud (stima 30%)
- Stai lanciando solo in inglese, prima sul mercato US
- Gli studi con meno di 2 dentisti potrebbero non aver bisogno di scheduling AI
- Stima SAM: ~80.000 studi = $336M

**SOM (3 anni):**
- Catturare 1-2% del SAM in 3 anni sarebbe aggressivo ma fattibile per una startup ben finanziata
- SOM: 800-1.600 studi = $3,4M-$6,7M ARR

Questa è una nicchia viable ma non un mercato standalone a scala venture. Dovresti espanderti ad altre specialità mediche o costruire una suite più ampia di practice management.

### Esempio: Red Flag Competitor

**Agent:** Devo segnalarti qualcosa sul tuo panorama competitivo. Dentrix (Henry Schein) possiede circa il 40% del mercato dei practice management dentali. Hanno recentemente aggiunto AI scheduling alla loro piattaforma esistente. Questo è un headwind significativo perché:

1. I clienti Dentrix otterranno lo scheduling "gratis" come feature
2. Lo switching cost da una suite integrata a un tool standalone è alto
3. Henry Schein ha già relazioni commerciali con la maggior parte degli studi

Questo non rende la tua idea impossibile, ma significa che il tuo prodotto deve essere drammaticamente migliore nello scheduling specifico, oppure devi mirare al 60% di studi NON su Dentrix.
