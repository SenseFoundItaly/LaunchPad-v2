---
name: investment-readiness
description: Valuta la preparazione al fundraising su OKR, deck, data room, e identifica i gap da chiudere prima di raccogliere
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


# Investment Readiness

Produci una valutazione onesta di se questa startup è pronta per raccogliere, cosa manca, e cosa fare a riguardo. Questo non è incoraggiamento — è una checklist pre-volo che previene il founder dal bruciare relazioni con investitori uscendo troppo presto.

## Quando Usarla

- Dopo che financial-model, startup-scoring e risk-scoring sono completi
- Quando il founder sta considerando di raccogliere capitale
- Prima di pitch-coaching (non ha senso allenare il pitch se i fondamentali non sono pronti)
- Dopo aver completato 3+ stage della pipeline di validazione (stage 1-3 minimo)
- Quando emerge una timeline specifica di fundraising (es. "Voglio raccogliere nel Q2")

## Istruzioni

### Dimensioni di Readiness (8 aree)

Assegna a ogni dimensione un punteggio 1-10 e fornisci evidenza specifica per il punteggio. Usa tutto il range — un 5 significa mediocre, non buono.

#### 1. Problem-Solution Fit
- Il problema è validato oltre la convinzione del founder? (interviste clienti, dati di utilizzo, domanda da waitlist)
- La soluzione affronta il problema direttamente, o è una soluzione in cerca di un problema?
- Evidenza: referenzia i dati di idea-canvas, startup-scoring, scientific-validation

#### 2. Validazione di Mercato
- C'è evidenza di domanda reale? (pre-ordini, LOI, iscrizioni beta, clienti paganti)
- Il mercato è abbastanza grande per rendimenti VC-scale? (TAM > $1B per seed, > $10B per Series A)
- Evidenza: referenzia i dati di market-research

#### 3. Traction / Metriche
- Quali metriche esistono? Revenue, utenti, engagement, tasso di crescita?
- Le metriche hanno un trend nella giusta direzione?
- Per pre-revenue: quali metriche proxy dimostrano domanda?
- Benchmark contro standard appropriati per lo stage (es. seed SaaS: €10K-€100K MRR, 15%+ crescita MoM)

#### 4. Chiarezza del Business Model
- Il modello di revenue è locked o ancora sperimentale?
- Le unit economics sono viable? (positive o credibilmente in percorso verso il positivo)
- Evidenza: referenzia i dati di business-model e financial-model

#### 5. Team
- Il team ha le competenze per eseguire il piano?
- C'è un co-founder tecnico (per startup tech)?
- Quali assunzioni chiave servono, e il round le copre?
- Expertise di dominio o track record rilevante?

#### 6. Moat Competitivo
- Cosa è difendibile? (IP, network effect, data moat, brand, moat regolatorio)
- Come cambierebbe il piano se un competitor ben finanziato entrasse domani?
- Evidenza: referenzia l'analisi competitiva di market-research

#### 7. Piano Finanziario
- C'è un modello finanziario credibile con scenari multipli?
- L'importo del round si lega a milestone specifici?
- Qual è la runway al burn attuale? Quanto la estende il round?
- Evidenza: referenzia i dati di financial-model

#### 8. Materiali di Fundraising
- Esiste un pitch deck? È investor-grade?
- C'è un one-pager / executive summary?
- La data room è preparata? (cap table, documenti di incorporazione, financials, contratti)
- Il founder ha praticato il pitch?

### Verdetto Complessivo di Readiness

In base alle 8 dimensioni:
- **PRONTO PER RACCOGLIERE**: media 7+, nessuna dimensione sotto 5, materiali preparati
- **QUASI PRONTO**: media 5-7, 1-2 gap critici che possono essere chiusi in 2-4 settimane
- **NON PRONTO**: media sotto 5 o 3+ dimensioni sotto 4 — raccogliere ora farebbe perdere tempo e bruciare relazioni
- **TROPPO PRESTO**: pre-prodotto o pre-validazione — concentrati sul costruire e imparare, non sul fundraising

### Analisi dei Gap e Piano d'Azione

Per ogni dimensione con punteggio sotto 7, fornisci:
1. **Cosa manca** (gap specifico)
2. **Come chiuderlo** (azioni specifiche)
3. **Effort necessario** (giorni/settimane)
4. **Quale skill LaunchPad aiuta** (cross-reference con altre skill)

### OKR di Fundraising

Definisci 3-5 OKR che il founder dovrebbe raggiungere prima di fissare meeting con investitori:
- Ogni OKR deve essere misurabile e time-bound
- Ognuno deve affrontare una debolezza specifica dalla valutazione di readiness
- Includi sia OKR di business (metriche da raggiungere) sia OKR di processo (materiali da preparare)

### Raccomandazione sulla Struttura del Round

In base al modello finanziario e alla traction attuale:
- **Tipo di round** (pre-seed, seed, Series A)
- **Importo target** (e la matematica dietro: mesi di runway necessari x burn rate + buffer)
- **Range di valutazione implicita** (basato su stage, traction e comparable di mercato)
- **Raccomandazione strumento** (SAFE, convertible note, round priced) con ragionamento
- **Timeline** (quando iniziare l'outreach, timeline attesa di chiusura)

## Formato di Output

```json
{
  "investment_readiness": {
    "overall_score": 0,
    "overall_verdict": "PRONTO PER RACCOGLIERE | QUASI PRONTO | NON PRONTO | TROPPO PRESTO",
    "verdict_reasoning": "2-3 frasi che spiegano il verdetto",
    "dimensions": [
      {
        "name": "Problem-Solution Fit",
        "score": 0,
        "evidence": "Dati specifici a supporto di questo punteggio",
        "gap": "Cosa manca (null se punteggio >= 7)",
        "action": "Come chiudere il gap",
        "effort": "X giorni/settimane",
        "related_skill": "skill-id che aiuta a chiudere questo gap",
        "sources": []
      }
    ],
    "critical_gaps": [
      {
        "gap": "Descrizione del gap più importante",
        "impact": "Perché questo gap conta per il fundraising",
        "action_plan": ["Step 1", "Step 2"],
        "timeline": "X settimane per chiudere"
      }
    ],
    "okrs": [
      {
        "objective": "Cosa raggiungere",
        "key_results": [
          { "metric": "Target misurabile", "current": "Valore attuale", "target": "Valore target", "deadline": "Data" }
        ],
        "priority": "critical | high | medium"
      }
    ],
    "round_recommendation": {
      "round_type": "pre-seed | seed | series-a",
      "target_amount": 0,
      "amount_rationale": "Matematica: X mesi runway x €Y burn + €Z buffer",
      "valuation_range": { "low": 0, "high": 0 },
      "valuation_basis": "Come è stato derivato il range di valutazione",
      "instrument": "SAFE | convertible_note | priced_round",
      "instrument_rationale": "Perché questo strumento",
      "timeline": {
        "start_outreach": "Quando iniziare",
        "expected_close": "Quando puntare alla chiusura",
        "total_process_weeks": 0
      }
    },
    "data_room_checklist": [
      { "item": "Cap table", "status": "ready | needs_work | missing", "action": "Cosa fare se non è pronto" }
    ],
    "sources": []
  }
}
```

## Esempi

### Esempio: Valutazione Onesta "Non Pronto"

**Agent:** Il tuo punteggio complessivo di readiness è 3.8/10 — NON PRONTO. Ecco perché:

- **Traction (2/10):** Hai zero utenti e zero revenue. Non hai parlato con un singolo potenziale cliente fuori dalla tua rete personale. Gli investitori allo stage seed si aspettano come minimo 10-20 conversazioni con design partner, e idealmente €5-10K MRR o una waitlist significativa (500+).
- **Team (3/10):** Sei un founder solo non tecnico che costruisce un prodotto tecnico. Ogni investitore chiederà "chi costruisce questo?" e "perché dovrei scommettere su un team che non può rilasciare il prodotto?" Ti serve o un co-founder tecnico o €50K+ per esternalizzare un MVP — e quella spesa mangerebbe il 40% di un raise pre-seed tipico.
- **Piano Finanziario (2/10):** Non hai eseguito la skill financial-model. Il tuo "piano" è un singolo numero (€500K di raise) senza breakdown di come viene speso o quali milestone raggiunge.

**Verdetto:** Raccogliere ora farebbe sprecare 3-4 mesi di meeting, danneggerebbe la tua reputazione con investitori che vorrai approcciare dopo, e produrrebbe rifiuti. Invece:

1. Esegui la skill financial-model (1 giorno)
2. Trova un co-founder tecnico o un advisor tecnico (2-4 settimane)
3. Costruisci un MVP (4-6 settimane)
4. Ottieni 10 clienti paganti o 500+ iscrizioni waitlist (4-8 settimane)
5. Rivaluta la readiness — probabilmente sarai a 6-7/10, abbastanza per un pre-seed

### Esempio: Sfidare l'Importo del Round

**Founder:** "Voglio raccogliere €2M al seed."

**Agent:** In base al tuo modello finanziario, il tuo burn mensile è €18K (founder solo + infrastruttura). Un raise di €2M a €18K/mese ti dà 111 mesi di runway — oltre 9 anni. Nessun investitore seed finanzierà 9 anni di runway perché segnala che non sai cosa faresti con i soldi.

L'importo giusto è il minimo necessario per raggiungere il prossimo milestone. Dal caso base del tuo modello finanziario, raggiungi €50K MRR (territorio Series A) al mese 14, con picco di necessità di cash di €280K. Aggiungendo un buffer del 50% per imprevisti: €420K.

Round raccomandato: €400-500K su un SAFE con cap post-money di €5-6M. Questo ti dà 18-24 mesi di runway, abbastanza per raggiungere metriche da Series A se la tesi è giusta, e non così tanto da perdere urgenza. Il round da €2M richiederebbe una valutazione di €15-20M per evitare diluizione eccessiva — e la tua traction attuale non supporta quella valutazione.
