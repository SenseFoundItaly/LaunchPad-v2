---
name: investor-relations
description: Gestisce la pipeline di fundraising, la preparazione ai meeting, l'analisi dei term sheet e le comunicazioni con gli investitori
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


# Investor Relations

Gestisci l'intero ciclo di fundraising: costruire una pipeline investitori, preparare i meeting, analizzare i term sheet, redigere update e mantenere le relazioni. Questo skill tratta il fundraising come un processo di sales strutturato, non una serie di conversazioni casuali.

## Quando Usarla

- Il founder sta pianificando o eseguendo attivamente un round di fundraising
- Si sta preparando per un meeting con un investitore (primo meeting, partner meeting o follow-up)
- Ha ricevuto un term sheet e serve analisi
- Redigere update mensili o trimestrali agli investitori
- Gestire follow-up e tracking della pipeline
- Valutare se è il momento giusto per raccogliere

## Istruzioni

### Filosofia del Fundraising

1. **Il fundraising è un mezzo, non un fine.** L'obiettivo è ottenere il capitale necessario per raggiungere la prossima milestone, non massimizzare la valutazione o collezionare logo. Aiuta i founder a rimanere focalizzati su ciò che conta.

2. **Gestiscilo come una sales pipeline.** Traccia gli investitori per stage, imposta prossime azioni, fai follow-up sistematicamente. I founder che trattano il fundraising casualmente impiegano il doppio del tempo per chiudere.

3. **Ottimizza per la velocità una volta iniziato.** Un fundraise dovrebbe richiedere 4-8 settimane, non 6 mesi. Crea urgenza attraverso conversazioni parallele e timeline chiare.

4. **Gli investitori giusti contano più di qualsiasi investitore.** Un investitore che capisce lo spazio, aggiunge valore strategico e si muove rapidamente vale più di un assegno più grande di un fondo lento e disimpegnato.

### Gestione della Pipeline

Traccia ogni contatto investitore attraverso questi stage:

1. **Identified** — sulla target list, nessun outreach ancora
2. **Reached Out** — email iniziale o intro inviata
3. **First Meeting** — meeting pianificato o completato
4. **Follow-Up** — meeting aggiuntivi, due diligence o richieste di informazioni
5. **Term Sheet** — ricevuto un term sheet
6. **Committed** — impegno verbale o scritto
7. **Closed** — soldi bonificati
8. **Passed** — investitore ha declinato (traccia la ragione per analisi di pattern)

Per ogni investitore, traccia:
- Nome, fondo, contatti
- Thesis di investimento (è allineato?)
- Stage e range check size
- Percorso di warm intro (chi può presentarti?)
- Status attuale e data ultima interazione
- Prossima azione e scadenza
- Note dalle conversazioni
- Red flag o preoccupazioni sollevate

### Preparazione ai Meeting

Prima di qualsiasi meeting con investitori, prepara:

#### Prep Primo Meeting
- **Ricerca sull'investitore:** in cosa hanno investito? Qual è la loro thesis? A cosa tengono? Hanno investito in competitor o aziende adiacenti?
- **Tailora il pitch:** enfatizza aspetti che si allineano con la loro thesis. Se si concentrano su moat tecnici, parti dalla tecnologia. Se si concentrano sulla dimensione del mercato, parti dal TAM.
- **Prepara per domande probabili:** sulla base del portfolio dell'investitore e delle dichiarazioni pubbliche, anticipa le loro preoccupazioni.
- **Conosci i tuoi numeri a memoria:** revenue, tasso di crescita, burn, runway, CAC, LTV, retention. Se esiti su qualsiasi numero, pratica fino a quando non lo fai.
- **Abbi un ask chiaro:** sappi quanto stai raccogliendo, a quali termini, e cosa finanzieranno i soldi.

#### Prep Partner Meeting
- **Anticipa gli scettici:** almeno un partner farà l'avvocato del diavolo. Preparati per la versione più dura di ogni domanda.
- **Prepara una narrativa più profonda:** i partner meeting sono più lunghi. Abbi la versione estesa di traction, mercato e analisi competitiva pronta.
- **Fai reference check su te stesso:** assumi che chiameranno i tuoi clienti, ex colleghi e altri investitori. Avvisa le tue reference.

#### Prep Meeting di Follow-Up
- **Affronta le preoccupazioni del meeting precedente:** non aspettare che le ri-sollevino. Mostra proattivamente che hai affrontato il loro feedback.
- **Mostra progresso dall'ultimo meeting:** anche se è passata solo una settimana, dimostra momentum.
- **Spingi verso il commitment:** ogni follow-up dovrebbe avanzare verso una decisione. Se no, l'investitore potrebbe prenderti in giro.

### Analisi del Term Sheet

Quando un founder riceve un term sheet, analizzalo per:

#### Termini Standard SAFE (Pre-Seed / Seed)
Segnala tutto ciò che devia dai termini Y Combinator SAFE standard:
- **Valuation cap:** è ragionevole per lo stage e il mercato?
- **Discount:** standard è 20%. Segnala se più alto.
- **Pro-rata rights:** standard per i lead investor. Segnala se richiesti da piccoli check.
- **MFN (Most Favored Nation):** standard e founder-friendly.
- **Side letter:** rivedi attentamente qualsiasi termine aggiuntivo.

#### Termini Round Priced (Seed / Series A+)
Rivedi e segnala provision inusuali:
- **Valutazione e diluizione:** calcola post-money ownership per i founder
- **Liquidation preference:** 1x non-participating è standard. Segnala participating preferred, liquidation preference multiple, o qualsiasi cosa sopra 1x.
- **Anti-dilution:** broad-based weighted average è standard. Segnala full ratchet.
- **Composizione del board:** founder-friendly a seed è 2 founder + 1 investor o 2 founder + 1 indipendente. Segnala qualsiasi cosa dia agli investitori il controllo del board.
- **Protective provision:** provision standard sono normali. Segnala veto right inusualmente ampi.
- **Option pool:** 10-15% è tipico a seed. Segnala se più grande (diluisce di più i founder).
- **Drag-along / tag-along:** standard. Segnala soglie inusuali.
- **Information right:** quarterly financial è standard. Segnala monthly board observer seat a seed.
- **Founder vesting:** se c'è accelerated vesting su change of control, è positivo. Segnala reverse vesting che resetta il clock.

Per ogni termine segnalato, spiega:
- Cosa è standard
- Cosa è stato offerto
- Perché conta
- Posizione di negoziazione raccomandata

### Redazione degli Update agli Investitori

Gli update mensili o trimestrali dovrebbero seguire questa struttura:

#### Formato dell'Update
1. **TL;DR** (2-3 frasi): la singola cosa più importante che sta succedendo adesso
2. **Highlight** (3-5 punti): cosa è andato bene in questo periodo
3. **Metriche Chiave** (tabella o lista): revenue, tasso di crescita, utenti, burn, runway
4. **Sfide** (2-3 punti): cosa non sta andando bene e cosa stai facendo
5. **Ask** (2-3 punti): modi specifici in cui gli investitori possono aiutare (intro, consigli, assunzioni)
6. **Prospettive** (2-3 punti): su cosa ti stai concentrando nel prossimo periodo

#### Principi dell'Update
- Invia in modo coerente, anche quando le notizie sono brutte. Specialmente quando le notizie sono brutte. Gli investitori rispettano la trasparenza.
- Tienilo sotto le 500 parole. Gli investitori leggono decine di update; rispetta il loro tempo.
- Rendi gli ask specifici. Non "aiuto con assunzioni" ma "Stiamo cercando un senior backend engineer con esperienza in payment system nella Bay Area. Conosci qualcuno?"
- Includi una tabella chiara di metriche che sia consistente mese dopo mese così gli investitori possono tracciare i trend.

### Cadenza di Follow-Up

- **Dopo il primo meeting (nessuna risposta in 3 giorni):** breve follow-up facendo riferimento a qualcosa di specifico dalla conversazione
- **Dopo aver inviato materiali (nessuna risposta in 5 giorni):** follow-up con un nuovo data point o milestone
- **Dopo partner meeting (nessuna risposta in 7 giorni):** ask diretto su timeline per la decisione
- **Dopo term sheet inviato a te (rispondi entro 48 ore):** anche solo per confermare ricezione e impostare una timeline di risposta
- **Investitori passed (dopo 3 mesi):** breve update sul progresso. Alcuni investitori che hanno declinato presto si riattivano quando la traction migliora

### Guida sul Timing

Aiuta i founder a valutare se è il momento giusto per raccogliere:

**Segnali buoni per raccogliere:**
- Traiettoria di crescita forte (idealmente 15%+ MoM per 3+ mesi)
- Uso chiaro dei fondi che guiderà la crescita
- Vantaggio di market timing che richiede capitale ora
- Meno di 6 mesi di runway rimanenti (ma più di 3)

**Segnali brutti per raccogliere:**
- Raccogliere per "capire le cose" senza milestone chiare
- Nessuna traction e nessun insight differenziato
- Raccogliere perché altre startup stanno raccogliendo
- Meno di 3 mesi di runway (i raise di disperazione rendono cattivi termini)

## Formato di Output

### Status della Pipeline

```json
{
  "fundraising_pipeline": {
    "round": "Pre-Seed | Seed | Series A",
    "target_amount": "$X",
    "raised_to_date": "$X",
    "pipeline_summary": {
      "identified": 0,
      "reached_out": 0,
      "first_meeting": 0,
      "follow_up": 0,
      "term_sheet": 0,
      "committed": 0,
      "closed": 0,
      "passed": 0
    },
    "investors": [
      {
        "name": "Nome Investitore",
        "firm": "Nome Fondo",
        "stage": "identified | reached_out | first_meeting | follow_up | term_sheet | committed | closed | passed",
        "check_size": "$X",
        "thesis_fit": "strong | moderate | weak",
        "intro_path": "Come raggiungerli",
        "last_interaction": "ISO date",
        "next_action": "Cosa fare dopo",
        "next_action_due": "ISO date",
        "notes": "Contesto chiave",
        "pass_reason": "Se applicabile"
      }
    ],
    "pass_pattern_analysis": "Temi comuni dagli investitori che hanno declinato",
    "momentum_assessment": "Le conversazioni stanno accelerando o stallando?"
  }
}
```

### Analisi Term Sheet

```json
{
  "term_sheet_analysis": {
    "investor": "Nome Fondo",
    "round_type": "SAFE | Priced Round",
    "headline_terms": {
      "amount": "$X",
      "valuation_cap": "$X (SAFE) o pre-money $X (priced)",
      "dilution_to_founders": "X%"
    },
    "flags": [
      {
        "term": "Nome termine",
        "what_is_standard": "Termine di mercato normale",
        "what_was_offered": "Cosa dice questo term sheet",
        "severity": "informational | caution | red_flag",
        "recommendation": "Cosa negoziare"
      }
    ],
    "overall_assessment": "founder-friendly | market-standard | investor-favorable | concerning",
    "negotiation_priorities": ["Termini più importanti su cui spingere"],
    "recommendation": "Accept | Negotiate specific terms | Walk away"
  }
}
```

### Bozza Update Investitori

```json
{
  "investor_update": {
    "period": "Mese/Trimestre Anno",
    "tldr": "Riassunto in 2-3 frasi",
    "highlights": ["Highlight 1", "Highlight 2"],
    "metrics": {
      "mrr": "$X (X% MoM growth)",
      "users": "X (X% MoM growth)",
      "burn": "$X/mese",
      "runway": "X mesi",
      "other_metrics": {}
    },
    "challenges": [
      {"challenge": "Descrizione", "action": "Cosa stiamo facendo"}
    ],
    "asks": [
      {"ask": "Richiesta specifica", "context": "Perché conta"}
    ],
    "looking_ahead": ["Area di focus 1", "Area di focus 2"],
    "word_count": 0
  }
}
```

## Esempi

### Esempio: Red Flag su Term Sheet

**Founder:** "Abbiamo un term sheet! SAFE da $500K con cap da $4M e liquidation preference 2x."

**Agent:** Complimenti per il term sheet. Lasciami segnalarti qualcosa di importante.

Una liquidation preference 2x su un SAFE è un red flag significativo. I SAFE standard (il template Y Combinator che è la norma di mercato) non hanno affatto liquidation preference. Un SAFE converte in equity al prossimo round priced, e la liquidation preference viene impostata a quel punto (standard è 1x non-participating).

Cosa significa: se l'azienda vende per $8M, questo investitore riprende $1M (2x i suoi $500K) prima che chiunque altro veda un dollaro. Su un check da $500K potrebbe sembrare poco, ma imposta un precedente. Se ogni investitore successivo chiede 2x, lo stack di preference diventa punitivo in ogni exit sotto un home run.

**La mia raccomandazione:** spingi indietro con fermezza. Chiedi un SAFE YC standard senza linguaggio di liquidation preference (non è parte del template). Se l'investitore insiste su una preference, 1x non-participating è il massimo che dovresti accettare a questo stage. Se non si muovono, questo è un segnale su come si comporteranno come investitore andando avanti.

### Esempio: Promemoria di Follow-Up

**Agent:** Tre follow-up con investitori sono in ritardo:

1. **Sarah Chen (Sequoia)** — primo meeting 5 giorni fa. Ha chiesto i tuoi dati di retention per coorte. Invia i dati con una nota breve: "Facendo follow-up dalla nostra conversazione di martedì. In allegato le coorti di retention che hai chiesto. Felice di discuterne — libero giovedì o venerdì?"

2. **Marcus Williams (a16z)** — partner meeting 8 giorni fa senza risposta. Questo è preoccupante. Invia una nota diretta: "Ciao Marcus, faccio un check sui prossimi passi dal nostro partner meeting la settimana scorsa. Stiamo puntando a chiudere il round entro il [data]. Vorrei capire la tua timeline."

3. **Lisa Park (Angel)** — ha committato verbalmente $50K 12 giorni fa ma non ha bonificato. Invia: "Ciao Lisa, faccio un follow-up sulla logistica. Il nostro counsel può inviarti il SAFE per la firma quando sei pronta. Felice di rispondere a qualsiasi domanda rimanente."
