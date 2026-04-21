---
name: growth-optimization
description: Esegue loop iterativi di growth optimization usando il ciclo Ipotesi-Test-Valutazione-Ratchet
---

# Growth Optimization

Esegui loop di ottimizzazione strutturati ispirati al pattern AutoResearch (Karpathy). Ogni loop segue un ciclo disciplinato: formula un'ipotesi, progetta un test, valuta i risultati, e fai ratchet in avanti bloccando ciò che funziona. Questo skill traccia apprendimenti accumulati attraverso le iterazioni e rileva quando un dato target di ottimizzazione ha raggiunto rendimenti decrescenti.

## Quando Usarla

- Il founder ha un prodotto live e vuole migliorare una metrica specifica
- Dopo traction iniziale, quando la crescita è stallata o in plateau
- Quando si testa messaging, pricing, positioning, step del funnel o outreach
- Quando il founder sta facendo cambiamenti senza un framework strutturato
- Periodicamente per rivedere gli apprendimenti accumulati e pianificare il prossimo ciclo di ottimizzazione

## Istruzioni

### Il Ciclo di Ottimizzazione

Ogni iterazione segue quattro step:

#### Step 1: Ipotesi

Formula un'ipotesi chiara e falsificabile:

- **Formato:** "Se [cambiamo X], allora [metrica Y] [migliorerà/cambierà] di [quantità stimata] perché [ragionamento]."
- L'ipotesi deve essere abbastanza specifica da testare. "Se miglioriamo la landing page" non è un'ipotesi. "Se cambiamo la headline da feature-focused a pain-focused, il conversion rate aumenterà del 15% perché le nostre customer interview hanno mostrato che il pain è il motivatore primario" è un'ipotesi.
- Ogni ipotesi dovrebbe puntare a esattamente una variabile. Se il founder vuole cambiare tre cose, sono tre test separati.
- Valuta la confidenza dell'ipotesi (low/medium/high) prima di testare.

#### Step 2: Test

Progetta un test minimum viable:

- **Cosa cambiare:** cambiamento specifico e concreto da implementare
- **Come misurare:** quale metrica, misurata come, su quale timeframe
- **Sample size necessaria:** data point minimi per un risultato significativo (evita di trarre conclusioni da 12 visitatori)
- **Durata:** quanto deve durare il test
- **Soglia di successo:** quale risultato confermerebbe l'ipotesi? Quale la rigetterebbe?
- **Controllo:** qual è la baseline a cui si confronta?

Mantieni i test piccoli e veloci. Un A/B test di due settimane batte una revisione prodotto di sei mesi ogni volta.

#### Step 3: Valutazione

Analizza i risultati onestamente:

- **La metrica si è mossa?** Di quanto? Il cambiamento è statisticamente significativo data la sample size?
- **L'ipotesi è stata confermata, rigettata o inconcludente?**
- **Cosa ti ha sorpreso?** I risultati inattesi spesso contengono gli insight più preziosi.
- **Fattori confondenti:** è cambiato qualcos'altro durante il periodo di test che potrebbe spiegare i risultati?
- **Se inconcludente:** il test è stato troppo breve? Sample troppo piccolo? Variabile troppo sottile? Decidi se estendere, riprogettare o abbandonare.

#### Step 4: Ratchet

Blocca gli apprendimenti e decidi i prossimi passi:

- **Se confermato:** implementa il cambiamento permanentemente. Documenta cosa ha funzionato e perché. Questo diventa un "ratchet" — non si torna mai indietro.
- **Se rigettato:** annulla il cambiamento. Documenta cosa non ha funzionato e l'ipotesi sul perché. Questo è un dato ugualmente prezioso.
- **Se inconcludente:** decidi se il test merita estensione o se muovere a un'ipotesi a impatto più alto.
- **Aggiorna il learning log** con il risultato, indipendentemente dall'esito.
- **Identifica la prossima ipotesi** sulla base di ciò che si è imparato.

### Target di Ottimizzazione

Lo skill può ottimizzare su questi domini:

1. **Messaging** — Headline, copy, oggetti email, creative degli ad, value proposition
2. **Pricing** — Price point, packaging, sconti, lunghezza trial, limiti freemium
3. **Positioning** — Categoria di mercato, framing competitivo, enfasi sull'use case
4. **Funnel** — Flusso di sign-up, step di onboarding, trigger di attivazione, hook di retention
5. **Outreach** — Cold email, content strategy, selezione del canale, approcci di partnership

### Tracking degli Apprendimenti Accumulati

Mantieni un learning log su tutte le iterazioni:

```
Loop #: [numero sequenziale]
Target: [messaging | pricing | positioning | funnel | outreach]
Ipotesi: [enunciato]
Confidenza: [low | medium | high]
Risultato: [confirmed | rejected | inconclusive]
Learning chiave: [una frase]
Impatto sulla metrica: [cambiamento quantificato o "no significant change"]
Data: [quando completato]
```

Dopo ogni 5 loop, genera una sintesi degli apprendimenti accumulati. Cerca pattern:
- Quali target di ottimizzazione rendono i rendimenti più alti?
- Ci sono temi in ciò che funziona (es. il messaging pain-focused batte sempre il feature-focused)?
- Quali assunzioni sono state invalidate?

### Rilevamento dei Rendimenti Decrescenti

Monitora questi segnali che un target di ottimizzazione è esaurito:

- **Gli ultimi 3 test sulla stessa area target hanno mostrato miglioramenti <5% ciascuno**
- **La qualità delle ipotesi sta calando** (le idee sembrano incrementali invece che insightful)
- **La metrica è entro il 10% di un ceiling teorico o benchmark**
- **Il costo opportunità sta salendo** (il tempo speso qui potrebbe rendere di più altrove)

Quando vengono rilevati rendimenti decrescenti, raccomanda di spostare il focus su un target di ottimizzazione diverso e spiega perché.

### Guardrail

- Non raccomandare mai un test che potrebbe danneggiare permanentemente il brand o le relazioni con i clienti
- Segnala quando un test richiede più traffico o utenti di quelli che la startup ha attualmente
- Raccomanda ricerca qualitativa (customer interview) quando i test quantitativi non sono fattibili per basso volume
- Avvisa contro l'over-optimization di vanity metric a scapito delle metriche di business core

## Formato di Output

### Per un Nuovo Loop di Ottimizzazione

```json
{
  "optimization_loop": {
    "loop_number": 1,
    "target": "messaging | pricing | positioning | funnel | outreach",
    "hypothesis": {
      "statement": "Se [X], allora [Y] [Z] perché [ragionamento]",
      "confidence": "low | medium | high",
      "variable": "La singola cosa che viene cambiata",
      "target_metric": "La metrica misurata"
    },
    "test_design": {
      "change": "Cambiamento specifico da implementare",
      "measurement": "Come misurare il risultato",
      "sample_size_needed": "Data point minimi",
      "duration": "Durata test raccomandata",
      "success_threshold": "Cosa conferma l'ipotesi",
      "failure_threshold": "Cosa rigetta l'ipotesi",
      "control": "Baseline per il confronto"
    },
    "status": "planned | testing | evaluating | complete"
  }
}
```

### Per i Risultati di Valutazione

```json
{
  "evaluation": {
    "loop_number": 1,
    "result": "confirmed | rejected | inconclusive",
    "metric_before": "Valore baseline",
    "metric_after": "Valore risultato",
    "change_percent": "X%",
    "sample_size_actual": "Quanti data point raccolti",
    "confidence_level": "Confidenza statistica se applicabile",
    "surprises": "Finding inaspettati",
    "confounding_factors": "Qualcosa che potrebbe aver influito sui risultati",
    "learning": "Takeaway chiave in una frase",
    "next_action": "implement | revert | extend test | new hypothesis",
    "ratchet": "Cosa viene bloccato permanentemente (se confermato)"
  }
}
```

### Per Sintesi degli Apprendimenti

```json
{
  "learning_synthesis": {
    "loops_completed": 0,
    "by_target": {
      "messaging": {"loops": 0, "avg_impact": "X%", "best_learning": "..."},
      "pricing": {"loops": 0, "avg_impact": "X%", "best_learning": "..."}
    },
    "top_learnings": ["Learning 1", "Learning 2"],
    "invalidated_assumptions": ["Assunzione 1"],
    "diminishing_returns_detected": ["area target se presente"],
    "recommended_next_target": "Dove concentrarsi prossimamente e perché"
  }
}
```

## Esempi

### Esempio: Avviare un Loop di Messaging

**Founder:** "La nostra landing page converte al 2,1%. Voglio migliorarla."

**Agent:** Un conversion rate di landing page del 2,1% è sotto la media per la maggior parte delle B2B SaaS (range tipico 3-8%). C'è spazio per migliorare. Lasciami progettare il primo loop di ottimizzazione.

**Loop 1 — Messaging — Test della Headline**

**Ipotesi:** Se cambiamo la headline da "AI-Powered Project Management" (feature-focused) a "Smetti di Perdere 5 Ore a Settimana in Update di Progetto" (pain-focused), il conversion rate aumenterà di almeno il 30% (a ~2,7%) perché le tue customer interview indicano che lo spreco di tempo è il pain point primario.

**Confidenza:** media — le headline pain-focused generalmente battono quelle feature-focused, ma la claim specifica richiede validazione.

**Design del test:**
- Split traffic 50/50 tra headline corrente e nuova
- Misura il conversion rate a sign-up
- Servono minimo 500 visitatori per variante (1.000 totali)
- Durata 2 settimane o fino a raggiungere la sample size
- Successo: conversion rate della nuova headline >2,5% con >90% confidenza statistica
- Fallimento: nessuna differenza significativa o nuova headline performa peggio

Sulla base del tuo traffico attuale di ~200 visitatori/giorno, questo test impiegherà circa 5 giorni per raggiungere significatività statistica. Puoi implementare questo split test?

### Esempio: Rilevare Rendimenti Decrescenti

**Agent:** Abbiamo ora eseguito 4 test consecutivi di messaging sulla headline della landing page. Risultati:

- Loop 3: +22% (headline pain-focused — ratchet)
- Loop 5: +11% (aggiunto numero di social proof)
- Loop 8: +4% (raffinata scelta delle parole)
- Loop 11: +2% (variante con emoji)

Il pattern è chiaro: ogni test successivo di headline rende guadagni più piccoli. Il tuo conversion rate è migliorato dal 2,1% al 3,4%, che è ora dentro il range normale B2B SaaS. Raccomando di spostare il focus di ottimizzazione dal messaging al funnel (specificamente il tuo flusso di sign-up, che ha un drop-off del 60% tra landing page e completamento dell'onboarding). L'impatto potenziale lì è molto più alto che spremere un altro 1-2% dalle headline.
