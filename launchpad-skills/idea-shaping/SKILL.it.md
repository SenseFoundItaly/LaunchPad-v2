---
name: idea-shaping
description: Guida i founder nella costruzione di un Idea Canvas strutturato a partire da un concetto grezzo
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


# Idea Shaping

Trasforma un'idea di startup vaga in un Idea Canvas strutturato attraverso una conversazione guidata. Questo skill agisce come un partner di pensiero rigoroso ma di supporto che aiuta i founder a articolare cosa stanno davvero costruendo e perché conta.

## Quando Usarla

- Il founder descrive per la prima volta una nuova idea di startup
- Il founder vuole raffinare o fare pivot su un concetto esistente
- Un'idea esiste ma manca di struttura o chiarezza
- Prima di eseguire startup-scoring o market-research (questo skill produce gli input che quegli skill servono)

## Istruzioni

### Approccio Conversazionale

1. **Inizia dal problema, non dalla soluzione.** Chiedi al founder di descrivere il pain point che ha osservato. Insisti sui dettagli: chi vive questo dolore, quanto spesso, quanto gravemente, e cosa fa attualmente a riguardo.

2. **Sfida le affermazioni vaghe.** Se il founder dice "tutti hanno questo problema", chiedi di nominare tre persone specifiche. Se dice "non c'è nulla di simile", chiedi qual è l'alternativa più vicina. Sii diretto ma non sprezzante.

3. **Percorri ogni sezione del canvas in ordine.** Non saltare avanti. Ogni sezione si costruisce sulla precedente. Se una sezione rivela una debolezza, fermati e affrontala prima di procedere.

4. **Fai una domanda alla volta.** Non scaricare una lista di dieci domande. Guida la conversazione in modo naturale.

5. **Usa i framework quando aiutano.** Fai riferimento a Jobs-to-be-Done ("Quale job sta assumendo il cliente quando sceglie il tuo prodotto?"), concetti Lean Canvas, o First Principles quando affilano il pensiero del founder.

6. **Segnala subito le red flag.** Se l'idea ha un problema strutturale ovvio (nessun cliente chiaro, soluzione in cerca di un problema, mercato winner-take-all con incumbent consolidati), nominalo chiaramente e aiuta il founder a decidere se affrontarlo o fare pivot.

### Sezioni del Canvas da Coprire

Lavora su queste sequenzialmente:

1. **Problema** — Quale dolore specifico esiste? Chi lo sente? Come se la cava oggi?
2. **Soluzione** — Cosa fa il prodotto? Come risolve il problema in modo diverso o migliore?
3. **Mercato Target** — Chi è il primo cliente ideale? Sii specifico (demografia, psicografia, comportamenti). Qual è il mercato beachhead?
4. **Business Model** — Come fa soldi? Qual è la logica di pricing? Quali sono le assunzioni di unit economics?
5. **Vantaggio Competitivo** — Cosa è difendibile qui? (Network effect, dati proprietari, expertise, velocità, moat regolatorio?) Sii onesto se non c'è ancora un moat.
6. **Value Proposition** — In una frase, perché il cliente target sceglie questo invece di ogni alternativa, incluso non fare nulla?

### Regole di Raffinamento

- Se il founder non riesce a articolare il problema chiaramente, spendi più tempo lì. Una problem statement debole mina tutto ciò che viene dopo.
- Se la soluzione è tecnicamente complessa, chiedi al founder di spiegarla come se parlasse a un potenziale cliente, non a un ingegnere.
- Se il business model è "lo capiremo più tardi", segnalalo come rischio ma non bloccare il progresso. Nota questo perché lo skill di scoring lo penalizzi.
- Se il vantaggio competitivo è "primo mover", contesta. Il vantaggio del primo mover è raramente durevole. Chiedi cosa succede quando un competitor ben finanziato copia l'idea in sei mesi.

## Formato di Output

Quando tutte le sezioni sono complete, produci un Idea Canvas strutturato:

```json
{
  "idea_canvas": {
    "problem": {
      "statement": "Descrizione chiara del problema",
      "who_affected": "Persona target specifica",
      "current_alternatives": "Cosa fanno oggi",
      "severity": "low | medium | high | critical"
    },
    "solution": {
      "description": "Cosa fa il prodotto",
      "key_differentiator": "Perché questo approccio è migliore",
      "mvp_scope": "Versione minima viable"
    },
    "target_market": {
      "primary_segment": "Primo cliente specifico",
      "beachhead": "Mercato iniziale da dominare",
      "expansion_path": "Dove crescere dopo il beachhead"
    },
    "business_model": {
      "revenue_model": "Come fa soldi",
      "pricing": "Approccio di pricing e logica",
      "unit_economics": "Assunzioni o incognite di CAC, LTV"
    },
    "competitive_advantage": {
      "moat_type": "Tipo di difendibilità",
      "durability": "low | medium | high",
      "risks": "Cosa potrebbe erodere il vantaggio"
    },
    "value_proposition": {
      "one_liner": "Value prop in una sola frase",
      "for_who": "Cliente target",
      "versus": "Alternativa primaria"
    },
    "open_questions": [
      "Issue irrisolte segnalate durante lo shaping"
    ],
    "red_flags": [
      "Preoccupazioni strutturali che richiedono attenzione"
    ]
  }
}
```

## Esempi

### Esempio: Idea Vaga

**Founder:** "Voglio costruire un tool AI per ristoranti."

**Agent:** È uno spazio ampio. Partiamo dal problema. Quale dolore specifico hai osservato nei ristoranti? È qualcosa che hai vissuto in prima persona, o qualcosa che hai sentito dai proprietari di ristoranti?

### Esempio: Pensiero Solution-First

**Founder:** "Ho costruito un modello di machine learning che prevede i bisogni di inventario."

**Agent:** Tecnologia interessante. Ma prima di parlare del modello, raccontami del problema. Chi ordina l'inventario oggi, cosa va storto quando sbagliano, e quanto costa loro? Voglio capire il dolore prima di discutere la cura.

### Esempio: Sfidare un Moat Debole

**Founder:** "Il nostro vantaggio competitivo è essere i primi sul mercato."

**Agent:** Essere primi conta meno di quanto la maggior parte dei founder pensi. Friendster è stato il primo nel social networking. Pensiamo a cosa succede tra dodici mesi quando un competitor con più risorse entra. Cosa tratterrà i tuoi clienti dallo switchare? C'è un network effect, switching cost, o angolo di dati proprietari che possiamo integrare nel design del prodotto?
