---
name: scientific-validation
description: Genera buyer persona dettagliate e mappe di empatia fondate sull'ICP del founder e sulla ricerca
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


# Scientific Validation

Produci buyer persona strutturate e mappe di empatia fondate sull'evidenza che il founder può davvero usare per decidere posizionamento, copy e outreach. "Scientifico" qui significa testabile: ogni attributo della persona deve essere falsificabile da almeno una conversazione con un cliente.

## Quando Usarla

- Dopo idea-shaping e market-research, prima di scrivere GTM o copy della landing
- Quando startup-scoring segnala Customer Demand sotto 60
- Quando il founder non sa rispondere in una frase a "per chi è questo?"
- Prima delle sequenze di outreach — ogni persona sblocca una variante di messaggio
- Quando si fa pivot — lavoro su nuove persona precede sempre nuovo copy

## Istruzioni

### Principi di Validazione

1. **Tre persona, non dieci.** Le startup early-stage muoiono per ampiezza, non per profondità. Produci una primaria, una secondaria e un'anti-persona (il cliente che intenzionalmente non servirai). Più di tre diluisce il focus.

2. **Fondate sui dati, oppure etichettate come ipotesi.** Se il founder ha fatto interviste, fai riferimento a citazioni e comportamenti specifici. Altrimenti, marca ogni affermazione come ipotesi ed elenca la domanda di intervista che la falsificherebbe.

3. **Specifico anziché demografico.** "Marketing manager 35enne" è inutile. "Marketing manager in una B2B SaaS da 20-50 persone, riporta al founder, ha una board su Linear, due review annuali di distanza dal titolo VP" è una persona. Il dettaglio della persona deve guidare una decisione concreta di canale o messaggio.

4. **Mappa di empatia prima delle feature.** Per ogni persona, compila la mappa di empatia (dice / pensa / fa / sente / dolori / guadagni) prima di discutere cosa costruire. La mappa previene il pensiero feature-first.

5. **Un day-in-the-life per persona.** Una narrativa ("lunedì alle 8 apre Slack, vede...") batte una lista demografica. Costringe alla concretezza e fa emergere il momento reale di intervento.

6. **L'anti-persona non è opzionale.** Chi non è adatto? Chi consumerebbe tempo di supporto senza pagare? Chi richiederebbe lavoro custom? Dire di no è lo strumento di posizionamento più forte a pre-seed.

### Struttura della Mappa di Empatia

Per ogni persona, produci:

- **Dice** — 2-3 frasi letterali che usa davvero (da interviste se disponibili, marcate ⚠ se ipotizzate)
- **Pensa** — monologo interno sul problema, 2-3 elementi
- **Fa** — workaround e strumenti attuali
- **Sente** — texture emotiva: frustrato, ansioso, competitivo, intrappolato
- **Dolori** — 3-5 dolori concreti ordinati per frequenza × intensità
- **Guadagni** — come appare il "buono" per lui/lei — non feature, outcome

### Requisiti di Falsificabilità

Ogni persona DEVE includere:

- **Target di intervista**: criteri concreti che il founder può usare per trovare questa persona su LinkedIn, community Slack, eventi
- **3 domande di intervista disconfermanti**: domande le cui risposte proverebbero la persona sbagliata
- **Watering-hole list**: 5+ luoghi specifici (Subreddit, server Discord, newsletter, conferenze) dove questa persona passa davvero tempo

## Formato di Output

```json
{
  "scientific_validation": {
    "icp_statement": "Una frase: per chi è questo prodotto e quale job-to-be-done lo assume",
    "primary_persona": {
      "name": "Handle descrittivo, es. 'Seed-Stage SDR Lead'",
      "role_and_context": "Ruolo, stage azienda, dimensione team, riporto gerarchico",
      "seniority_and_tenure": "Anni di esperienza, traiettoria attesa",
      "empathy_map": {
        "says": ["..."],
        "thinks": ["..."],
        "does": ["..."],
        "feels": ["..."],
        "pains": [{"pain": "...", "frequency": "daily|weekly|monthly", "intensity": 1-5}],
        "gains": ["..."]
      },
      "day_in_the_life": "Paragrafo narrativo, lunedì 8am fino a fine giornata",
      "current_stack": ["tool1", "tool2"],
      "current_workaround": "Cosa fa oggi al posto del prodotto del founder",
      "willingness_to_pay_signal": "Citazione o comportamento che suggerisce autorità di budget + intenzione",
      "disqualifying_signals": ["Cosa ti direbbe che non è davvero questa persona"],
      "interview_target": "Come trovarne 10 su LinkedIn/Slack/etc",
      "falsification_questions": ["..."],
      "watering_holes": ["..."],
      "confidence": 0.0
    },
    "secondary_persona": { /* stessa struttura */ },
    "anti_persona": {
      "name": "Il cliente che non servirai",
      "why_not": "Perché questo segmento è una trappola — costo supporto, lavoro custom, misallineamento",
      "how_to_recognize": ["Segnale 1", "Segnale 2"]
    },
    "data_gaps": [
      "Cosa il founder deve imparare tramite interviste prima di fidarsi di queste persona"
    ],
    "next_actions": [
      "Pianifica 5 interviste con la persona primaria, mirando al watering-hole X",
      "..."
    ]
  }
}
```

## Esempi

### Esempio: Fondare Quando Ci Sono Dati

**Founder:** "Ho parlato con 12 founder di B2B SaaS da 5-20 persone. Tutti si lamentano del tracking metriche."

**Agent:** Bene — 12 conversazioni sono sufficienti per fondare una persona primaria. Cosa è saltato fuori in almeno 8 delle 12? Prima di scrivere la persona, tiriamo fuori il pattern di dolore comune da ciò che hai condiviso. Hai note in cui descrivono il workaround attuale con parole loro? Una frase letterale da almeno tre di loro va in `says`. Senza quella stiamo inventando la persona.

### Esempio: Marcare Ipotesi vs. Dati

**Agent:** Le voci `says` della tua persona primaria sono marcate ⚠ — sono ipotesi, non citazioni da interviste. Prima di scrivere copy GTM su questa persona, fai 5 interviste dalla watering-hole list e sostituisci le citazioni ⚠ con citazioni reali, oppure riscrivi la persona. Un GTM costruito su persona ipotizzate fallisce in silenzio: il tuo copy suonerà come se potesse essere per chiunque, perché lo è.

### Esempio: L'Anti-Persona Fa Risparmiare Tempo

**Agent:** Sto aggiungendo "Proprietario di agenzia" come anti-persona. Si iscriveranno, chiederanno white-label + dashboard custom + SSO subito, e abbandoneranno in 60 giorni quando dici no. Tre founder che ho visto bruciare 2-3 mesi inseguendo logo di agenzie prima di arrivare a questa conclusione. Se un proprietario di agenzia ti contatta, rifiuta con gentilezza e indirizzalo verso uno strumento più ampio. Questo ti salva roadmap.
