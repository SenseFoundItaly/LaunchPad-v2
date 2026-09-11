---
name: pitch-coaching
description: Aiuta i founder a costruire e iterare pitch deck con storytelling e dati pronti per gli investitori
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


# Pitch Coaching

Aiuta i founder a creare pitch deck convincenti attraverso feedback iterativo. Questo skill si concentra su chiarezza, struttura narrativa, affermazioni data-driven e psicologia dell'investitore. Copre sia pitch deck completi che il formato Demo Day (pitch da 1 minuto).

## Quando Usarla

- Il founder sta preparando un pitch deck per fundraising
- Il founder ha un Demo Day o pitch competition in arrivo
- Dopo aver ricevuto feedback da investitori che deve essere incorporato
- Quando si transita tra stage di fundraising (pre-seed a seed, seed a Series A)
- Quando la storia è cambiata (pivot, nuovi dati di traction, cambi di team)

## Istruzioni

### Filosofia del Pitch

1. **Storia prima, slide dopo.** Un grande pitch è una narrativa, non uno slideshow. Il founder dovrebbe essere in grado di raccontare la storia senza slide. Le slide rinforzano la storia; non la sostituiscono.

2. **Ogni affermazione richiede evidenza.** "Mercato enorme" non significa nulla. "Mercato da $4,2B in crescita del 23% annuo" significa qualcosa. "I clienti ci amano" non significa nulla. "NPS di 72 con 40% di utilizzo mensile attivo" significa qualcosa.

3. **Gli investitori finanziano traiettorie, non snapshot.** Mostra momentum. Crescita settimana su settimana, metriche in accelerazione, use case in espansione. I numeri statici sono meno convincenti dei trend.

4. **Conosci l'audience.** Un pitch a un angel pre-seed è diverso da un pitch a un fondo Series A. Aggiusta enfasi, profondità e ask di conseguenza.

5. **L'onestà costruisce fiducia.** Non nascondere le debolezze. Riconoscile e spiega come prevedi di affrontarle. Gli investitori troveranno i buchi comunque — meglio mostrare che sei consapevole e hai un piano.

### Struttura Completa del Pitch Deck (10-12 slide)

Guida il founder attraverso ogni sezione:

#### Slide 1: Titolo
- Nome azienda, descrizione in una riga, nome founder
- L'one-liner deve comunicare cosa fa l'azienda, non cosa aspira a essere

#### Slide 2: Problema
- Pain point specifico e relatable
- Quantifica il costo del problema (tempo, soldi, frustrazione)
- Mostra che è un problema reale vissuto da persone reali, non un fastidio teorico
- Usa una storia concreta o un data point per renderlo viscerale

#### Slide 3: Soluzione
- Cosa fa il prodotto in linguaggio semplice
- Mostra il prodotto (screenshot, demo o diagramma)
- Collegati direttamente al problema — come risolve specificamente?
- Evita il gergo tecnico a meno di un pitch a investitori tecnici

#### Slide 4: Dimensione del Mercato
- TAM/SAM/SOM con math bottom-up (fai riferimento all'output dello skill market-research)
- Mostra i calcoli, non limitarti a indicare numeri
- "Perché ora?" — cosa è cambiato che rende questo il momento giusto

#### Slide 5: Business Model
- Come l'azienda fa soldi
- Pricing e unit economics
- Se pre-revenue, spiega l'ipotesi di monetizzazione e qualsiasi validazione

#### Slide 6: Traction
- La slide più importante per seed e oltre
- Metriche che contano: revenue, utenti, tasso di crescita, retention, engagement
- Mostra traiettoria, non solo stato attuale
- Se pre-traction, mostra segnali di validazione (waitlist, LOI, risultati pilot)

#### Slide 7: Prodotto / Come Funziona
- Deep dive nell'esperienza prodotto
- Walkthrough del workflow cliente o use case
- Differenziazione chiave visibile nel prodotto stesso

#### Slide 8: Competizione
- Panorama competitivo (matrice 2x2 o visualizzazione simile)
- Valutazione onesta dei competitor
- Articolazione chiara della differenziazione
- Non dire mai "non abbiamo competitor" — segnala o ingenuità o mancanza di mercato

#### Slide 9: Team
- Esperienza rilevante ed expertise di dominio
- Perché questo team è posizionato in modo unico per vincere
- Assunzioni chiave pianificate (mostra che sai cosa ti serve)
- Advisor se degni di nota

#### Slide 10: Finanziari
- Proiezioni di revenue (18-36 mesi per early stage)
- Assunzioni chiave dichiarate chiaramente
- Burn rate e runway
- Percorso a profittabilità o alla milestone successiva

#### Slide 11: L'Ask
- Quanto stai raccogliendo?
- Per cosa verranno usati i fondi? (assunzioni, prodotto, crescita — sii specifico)
- Quali milestone abiliterà questo funding?
- Qual è la timeline target per il round?

#### Slide 12: Appendice (opzionale)
- Financial model dettagliato
- Metriche aggiuntive
- Architettura tecnica (se rilevante)
- Testimonianze di clienti

### Formato Demo Day (Pitch da 1 Minuto)

Struttura per un pitch da 60 secondi:

1. **Hook (5 secondi):** una frase che fa prestare attenzione all'audience. Una statistica sorprendente, un problema relatable, o una claim audace.
2. **Problema (10 secondi):** il pain point, conciso. Una frase.
3. **Soluzione (10 secondi):** cosa hai costruito. Una frase.
4. **Traction (15 secondi):** il tuo proof point più forte. Revenue, crescita, utenti, cliente notevole.
5. **Mercato (5 secondi):** dimensione dell'opportunità. Un numero.
6. **Ask (10 secondi):** cosa stai raccogliendo e cosa abilita.
7. **Chiusura (5 secondi):** frase finale memorabile che rinforza il messaggio core.

Totale: ~60 secondi. Ogni parola deve guadagnarsi il suo posto.

### Processo di Feedback e Iterazione

Nel rivedere una bozza di pitch:

1. **Leggi/ascolta il pitch completo prima** di dare feedback.
2. **Inizia con ciò che funziona.** Identifica i momenti più forti.
3. **Identifica la singola debolezza maggiore.** Non dare 15 pezzi di feedback. Concentrati sul singolo cambiamento che avrebbe l'impatto maggiore.
4. **Sii specifico.** Non "la slide di traction è debole" ma "la slide di traction mostra i sign-up totali ma non il tasso di crescita o retention. Aggiungi un grafico che mostri gli utenti attivi settimanali negli ultimi 12 settimane."
5. **Offri un'opzione di riscrittura.** Non dire solo cosa è sbagliato — mostra come appare una versione più forte.
6. **Dopo che il feedback principale è stato affrontato, passa alla rifinitura.** Scelta delle parole, principi di design delle slide, timing.

### Incorporare Feedback dagli Investitori

Quando un founder riporta feedback da un incontro reale con un investitore:

1. **Separa il segnale dal rumore.** Non tutto il feedback degli investitori è utile. Parte riflette il thesis mismatch dell'investitore, non una debolezza reale.
2. **Cerca pattern.** Se tre investitori sollevano la stessa preoccupazione, è un'issue reale. Se un investitore ha un'obiezione unica, potrebbe essere solo la sua prospettiva.
3. **Categorizza il feedback:** da risolvere (errori fattuali, dati mancanti), da considerare (preoccupazioni legittime sulla narrativa), e considerare-ma-potenzialmente-ignorare (preferenze stilistiche, thesis mismatch).
4. **Aggiorna il deck** e spiega cosa è cambiato e perché.

## Formato di Output

### Review del Pitch

```json
{
  "pitch_review": {
    "overall_assessment": "Strong | Needs Work | Major Revision Needed",
    "narrative_score": "1-10: il pitch racconta una storia convincente?",
    "data_score": "1-10: le claim sono supportate dall'evidenza?",
    "clarity_score": "1-10: un non-esperto capirebbe?",
    "strongest_moment": "La parte più convincente del pitch",
    "biggest_weakness": "La singola cosa con più impatto da sistemare",
    "slide_feedback": [
      {
        "slide": "Nome slide",
        "status": "strong | needs_improvement | missing | cut",
        "feedback": "Feedback specifico",
        "suggested_revision": "Come appare una versione più forte"
      }
    ],
    "investor_readiness": "ready | almost | not_yet",
    "next_steps": ["Action item prioritizzati"]
  }
}
```

### Bozza del Pitch Demo Day

```json
{
  "demo_day_pitch": {
    "hook": "Frase di apertura",
    "problem": "Problem statement",
    "solution": "Solution statement",
    "traction": "Proof point chiave",
    "market": "Dimensione mercato",
    "ask": "Ask di fundraising",
    "close": "Frase di chiusura",
    "total_word_count": 0,
    "estimated_duration_seconds": 0,
    "coaching_notes": "Tip di delivery"
  }
}
```

## Esempi

### Esempio: Slide di Traction Debole

**Founder:** "Ecco la nostra slide di traction. Abbiamo 1.200 sign-up."

**Agent:** I sign-up da soli non dicono molto agli investitori. 1.200 sign-up potrebbero essere impressionanti o preoccupanti a seconda del contesto. Ecco cosa manca e cosa renderebbe questa slide convincente:

**Slide attuale (debole):** "1.200 sign-up"

**Slide rivista (forte):**
- 1.200 sign-up, 340 utenti attivi settimanali (tasso di attivazione 28%)
- In crescita del 12% settimana su settimana per le ultime 8 settimane
- 45% di retention a 30 giorni (sopra il benchmark SaaS del 35%)
- 3 clienti paganti a $200/mese (organici, senza team di sales)
- Grafico che mostra la traiettoria di crescita WAU

I numeri non devono essere enormi a pre-seed. Devono mostrare un pattern: le persone si iscrivono, lo usano davvero, tornano, e alcuni sono disposti a pagare. Quella è la storia del product-market fit iniziale.

Se non hai ancora dati di attivazione o retention, sii onesto: "1.200 sign-up in 6 settimane con zero spesa di marketing. Ora siamo concentrati sulle metriche di attivazione e retention." Mostra consapevolezza.

### Esempio: Coaching per il Demo Day

**Agent:** Ecco il tuo pitch da 60 secondi. Leggilo a voce alta e cronometra:

"Ogni settimana, 200.000 studi dentistici in America sprecano 4 ore giocando al telefono per fissare appuntamenti. Sono $8 miliardi di produttività persa all'anno.

DentSchedule usa l'AI per gestire automaticamente il 90% delle chiamate di scheduling. Nessun download di app, nessun cambio di comportamento per i pazienti — chiamano lo stesso numero e la nostra AI gestisce il resto.

In 4 mesi abbiamo 23 studi dentistici live, che processano 1.400 chiamate a settimana. Lo studio medio risparmia 6 ore a settimana e il nostro tasso di churn è zero.

Il mercato del software per studi dentistici è da $4 miliardi e lo scheduling è il punto di ingresso a una suite completa di practice management.

Stiamo raccogliendo $1,5 milioni per espanderci a 500 studi e lanciare il nostro secondo modulo di prodotto.

Se vuoi supportare l'azienda che sta sostituendo il lavoro più odiato in ogni ufficio dentistico d'America, parliamoci."

**Word count:** 142. **Durata stimata:** 58 secondi. Pratica finché non riesci a consegnarlo in esattamente 60 secondi con un pacing naturale. Pausa leggera dopo l'hook e prima della chiusura.
