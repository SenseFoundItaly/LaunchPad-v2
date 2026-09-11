---
name: simulation
description: Simula la ricezione di mercato con 6 reazioni di persona e 4 scenari di rischio per stress-testare l'idea di startup
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


# Simulazione

Stress-testa l'idea di startup facendola passare attraverso 6 reazioni simulate di persona e 4 scenari di rischio. Questo non è scrittura creativa — ogni persona deve ragionare da una posizione plausibile basata su first-principles, radicata nei dati di mercato, competitive intelligence e psicologia dell'acquirente dalle skill precedenti.

## Quando Usarla

- Dopo che market-research e scientific-validation sono completi (questi forniscono i dati di base)
- Quando il founder ha bisogno di un reality check prima di impegnare risorse
- Prima di financial-model o prototype-spec per assicurare che la tesi centrale sopravviva allo scrutinio
- Quando ci si prepara per incontri con investitori (anticipare le obiezioni)
- Quando si fa pivot — fai passare la nuova tesi attraverso lo stesso guanto di sfida

## Istruzioni

### Set di Persona (6 reazioni)

Esegui esattamente 6 persona. Ognuna deve restare nel personaggio e produrre feedback specifico e azionabile — non incoraggiamento generico.

#### 2 Persona Cliente
Usa le buyer/user persona dalla scientific-validation (se disponibili) o derivale dall'idea canvas del mercato target. Ogni cliente reagisce alla value proposition, al pricing, e al costo di switching dalla soluzione attuale.

- **Cliente 1: Early Adopter** — tecnicamente curioso, disposto a provare nuovi strumenti, insensibile al prezzo, ma pretende una value proposition chiara e un onboarding senza frizioni.
- **Cliente 2: Mainstream Buyer** — avverso al rischio, attento al budget, ha bisogno di social proof, chiede "chi altro lo usa?" prima di registrarsi.

#### 2 Persona Investitore
- **Investitore 1: VC Seed-stage** — valuta team, dimensione del mercato, segnali di traction iniziale, e percorso verso la Series A. Chiede: "Perché ora? Perché voi? Qual è il vantaggio ingiusto?"
- **Investitore 2: Angel / Operator** — ex founder in uno spazio adiacente. Valuta rischio di esecuzione, fattibilità del go-to-market, e se il founder ha parlato con abbastanza clienti.

#### 1 Esperto di Dominio
- **Esperto** — praticante profondo nel dominio della startup. Valuta fattibilità tecnica, panorama regolatorio, e se l'approccio è innovativo o derivativo. Identifica trappole non ovvie che i generalisti perdono.

#### 1 Competitor
- **Competitor** — il product lead del competitor più rilevante. Valuta il livello di minaccia, identifica cosa copierebbe, e quali mosse difensive farebbe. Onesto sui propri punti deboli.

### Output Per-Persona

Ogni persona produce:
1. **Reazione iniziale** (2-3 frasi — risposta di pancia)
2. **Top 3 preoccupazioni** (specifiche, non vaghe)
3. **Cosa mi farebbe dire sì** (condizioni concrete)
4. **Deal-breaker** (l'unica cosa che lo renderebbe un no secco)
5. **Punteggio** (1-10 probabilità di engagement/investimento/adozione)

### Scenari di Rischio (4 scenari)

Esegui 4 scenari plausibili-ma-stressanti che potrebbero manifestarsi nei primi 18 mesi. Ogni scenario deve essere specifico per questa startup — non rischi generici di startup.

Categorie (scegli le 4 più rilevanti):
- **Risposta competitiva** — un incumbent ben finanziato lancia una feature concorrente
- **Shift di mercato** — le priorità di budget del segmento target cambiano (recessione, regolamentazione, shift tecnologico)
- **Fallimento di esecuzione** — un'assunzione tecnica o di team critica si rivela sbagliata
- **Crollo della domanda** — i segnali iniziali erano fuorvianti; la domanda reale è 10× più bassa del proiettato
- **Shock regolatorio** — una nuova regolamentazione blocca l'approccio o crea costi di compliance inaspettati
- **Dipendenza dal canale** — il canale di distribuzione primario cambia condizioni o accesso

### Output Per-Scenario

1. **Descrizione dello scenario** (cosa succede, quando, innescato da cosa)
2. **Probabilità** (0.0-1.0 basata su dati di mercato e analisi competitiva)
3. **Impatto** (0.0-1.0 sulla viabilità della startup)
4. **Segnali di early warning** (cosa il founder dovrebbe monitorare)
5. **Piano di mitigazione** (azioni specifiche, non "sii flessibile")
6. **Tempo di recupero** (mesi per recuperare se colpiti)

### Sintesi

Dopo tutte le persona e gli scenari, produci:
- **Riepilogo della ricezione di mercato** — la visione di consenso tra tutte e 6 le persona
- **Sentiment degli investitori** — riuscirebbe a fare un seed round? Cosa lo blocca?
- **Cluster di rischio critico** — quali rischi si amplificano a vicenda?
- **Raccomandazione Go/No-go** — basata sulla simulazione, il founder dovrebbe procedere, fare pivot, o fermarsi?

## Formato di Output

```json
{
  "simulation": {
    "personas": [
      {
        "id": "customer_early_adopter",
        "role": "Cliente Early Adopter",
        "persona_type": "customer",
        "initial_reaction": "2-3 frasi di risposta di pancia",
        "top_concerns": [
          "Preoccupazione specifica 1",
          "Preoccupazione specifica 2",
          "Preoccupazione specifica 3"
        ],
        "would_say_yes_if": "Condizioni concrete per l'adozione",
        "deal_breaker": "L'unica cosa che uccide tutto",
        "engagement_score": 7,
        "detailed_feedback": "2-3 paragrafi di feedback nel personaggio",
        "sources": []
      }
    ],
    "risk_scenarios": [
      {
        "id": "scenario_competitive_response",
        "title": "L'incumbent lancia una feature concorrente",
        "category": "competitive_response",
        "description": "Narrativa dettagliata dello scenario",
        "probability": 0.6,
        "impact": 0.8,
        "early_warning_signals": [
          "Segnale che il founder dovrebbe monitorare"
        ],
        "mitigation_plan": [
          "Azione specifica 1",
          "Azione specifica 2"
        ],
        "recovery_months": 6,
        "sources": []
      }
    ],
    "market_reception_summary": "Consenso tra tutte le persona",
    "investor_sentiment": "Valutazione della fundraisability",
    "critical_risk_cluster": "Quali rischi si amplificano a vicenda",
    "go_no_go": "proceed | pivot | stop",
    "go_no_go_reasoning": "2-3 frasi che spiegano il verdetto",
    "sources": []
  }
}
```

## Esempi

### Esempio: Reazione del Cliente Early Adopter

**Persona:** Sara, VP of Engineering in una SaaS company da 50 persone. Usa 4 dev tool al giorno, paga per la qualità.

**Reazione iniziale:** "Questo risolve un dolore reale — perdo 3 ore a settimana nel workflow che stai sostituendo. Ma sono stata scottata da tool che promettono automazione e consegnano complessità. Mostrami che funziona sulla mia codebase reale, non su una demo."

**Top preoccupazioni:**
1. Integrazione con la nostra pipeline CI/CD esistente (usiamo GitHub Actions + script custom)
2. Sicurezza — tocca il nostro codice sorgente? Dove viene processato?
3. Adozione del team — non posso forzare 12 ingegneri a cambiare il loro workflow senza una demo convincente

**Direbbe sì se:** Il free trial funziona sulla nostra repo in 30 minuti, non serve security audit, e almeno 3 dei miei ingegneri dicono indipendentemente "lo voglio."

**Deal-breaker:** Se richiede un audit di sicurezza più lungo di 2 settimane o serve accesso admin alla nostra org GitHub.

**Punteggio:** 7/10

### Esempio: Reazione del Competitor

**Persona:** Alex, Product Lead del tool incumbent dominante.

**Reazione iniziale:** "Abbiamo visto 4 startup provare questo approccio negli ultimi 2 anni. Due sono morte, due hanno fatto pivot. La feature non è difficile da costruire — l'abbiamo nella roadmap per il Q3. Quello che mi preoccupa è il loro approccio AI — se l'accuratezza è genuinamente migliore, è una finestra di 6 mesi prima che li raggiungiamo."

**Mosse difensive:** "Accelererei la nostra feature AI dal Q3 al Q1, la annuncerei pubblicamente per congelare la loro pipeline di vendita, e offrirei ai nostri clienti esistenti una beta gratuita. Abbiamo 10.000 clienti che preferiscono aggiungere una feature piuttosto che cambiare tool."
