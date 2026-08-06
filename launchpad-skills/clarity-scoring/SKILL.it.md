---
name: clarity-scoring
description: Misura quanto è CHIARA l'idea — solo canvas, pre-validazione. Il primo punteggio onesto, prima che esista qualsiasi evidenza di mercato.
---

# Clarity Score

Rispondi a una sola domanda: **quanto è chiara questa idea, sulla carta?**

Questo è il PRIMO punteggio che un founder vede, subito dopo aver compilato
l'Idea Canvas — prima di qualsiasi ricerca di mercato, mappa dei concorrenti o
intervista. Il tempismo è tutto il design (decisione del founder, changelog
4/08): lo Startup Scoring completo giudica mercato, concorrenza, fattibilità e
domanda — dimensioni che a questo stadio non sono deboli, sono **inconoscibili**.
Valutarle ora punisce l'ignoranza come se fosse debolezza e consegna a ogni
founder un numero basso che suona come una bocciatura. Lo Startup Scoring gira
dopo, quando il Validation Gate ha prodotto evidenza reale per quelle
dimensioni.

Quindi: giudica SOLO ciò che sta sul canvas. Chiarezza, specificità, coerenza
interna. Non se il mercato è grande — se il founder sa cosa sta affermando.

## Regole

- **Solo canvas. NON usare la ricerca web né alcuno strumento esterno.** Tutto
  ciò che ti serve è nel contesto progetto (i campi dell'Idea Canvas). Se un
  campo è vuoto, dai un punteggio basso alla sua variabile e dillo: il campo
  vuoto È il risultato.
- Giudica la scrittura che hai davanti, non il potenziale dell'idea. "AI per i
  ristoranti" come problem statement prende un punteggio basso di specificità
  anche se l'opportunità sottostante è reale.
- Sii concreto in ogni rationale: cita le parole del founder e nomina cosa
  manca ("'le PMI italiane' — quali PMI? dimensione, settore, trigger?").
- Fonti: cita `type: 'internal'` (i campi del canvas) o `type: 'user'`. Nessuna
  fonte web — non c'è nulla di esterno da citare.

## Le sei variabili

| Variabile | Peso | Cosa valuta |
| --- | --- | --- |
| `problem_specificity` | 20% | Il problema è concreto, ha un trigger identificabile, non è generico |
| `solution_problem_coherence` | 20% | La soluzione indirizza logicamente il problema dichiarato |
| `icp_specificity` | 20% | Il target è definito abbastanza stretto da essere testabile (non "tutte le PMI") |
| `value_prop_articulation` | 15% | La value prop è chiara e distinguibile, anche solo sulla carta |
| `differentiation_logic` | 15% | C'è un ragionamento (non prova) sul perché questa soluzione batte le alternative |
| `revenue_cost_coherence` | 10% | Il modello economico abbozzato è internamente sensato |

Ogni variabile: 0-100. Totale = somma pesata, 0-100.

## Verdetto

| Verdetto | Soglia | Significato |
| --- | --- | --- |
| `GO` | ≥ 70 e nessuna variabile critica sotto 40 | Idea ben strutturata — procedi al Validation Gate |
| `PIVOT PARZIALE` | 40-69, o una singola variabile critica sotto 40 | Idea interessante, criticità puntuale — nominala con precisione |
| `NO GO` | < 40, o incoerenza fondamentale (problema non reale, soluzione scollegata) | Il canvas va rivisto con una revisione guidata prima di ogni altro step |

Le variabili critiche sono `problem_specificity`, `solution_problem_coherence`
e `icp_specificity` — un buco in una di queste mina tutto ciò che viene dopo.

Il verdetto NON blocca mai il founder. Questa piattaforma è AI-assisted, non
AI-dictated: su PIVOT PARZIALE o NO GO nomina la criticità specifica e
consiglia di risolverla prima, ma di' chiaramente che può procedere comunque.

## Output Format

Emetti PRIMA il blocco json compatto qui sotto, prima di qualsiasi narrativa.
Deve essere completo e chiuso. Tutto ciò che il prodotto salva è qui dentro —
tienilo stretto. NON includere pesi, tabelle di soglie o piani di miglioramento
dentro il json; scrivili come prosa DOPO il blocco. (Se la run viene troncata,
un blocco piccolo già chiuso è l'unica cosa che si riesce ancora a leggere —
senza, il punteggio del founder va perso in silenzio anche se la run sembra
riuscita.)

```json
{
  "startup_score": {
    "overall_score": 0,
    "overall_grade": "A+ | A | B+ | B | C+ | C | D | F",
    "recommendation": "GO | PIVOT PARZIALE | NO GO",
    "summary": "2-3 frasi: quanto è chiara l'idea, e la SINGOLA cosa da affilare per prima",
    "dimensions": {
      "problem_specificity": { "score": 0, "rationale": "una frase, citando il canvas" },
      "solution_problem_coherence": { "score": 0, "rationale": "una frase" },
      "icp_specificity": { "score": 0, "rationale": "una frase" },
      "value_prop_articulation": { "score": 0, "rationale": "una frase" },
      "differentiation_logic": { "score": 0, "rationale": "una frase" },
      "revenue_cost_coherence": { "score": 0, "rationale": "una frase" }
    }
  }
}
```

Dopo il blocco, in prosa: il verdetto spiegato, la cosa più importante da
affilare, e — su PIVOT PARZIALE / NO GO — un suggerimento concreto per rivedere
il campo debole (ricordando che procedere comunque è una scelta del founder).
