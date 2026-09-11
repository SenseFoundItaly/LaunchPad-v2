---
name: prototype-spec
description: Crea un blueprint MVP con tech stack, feature core, brand identity e timeline di sviluppo
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


# MVP Spec (Specifica del Prototipo)

Produci un blueprint MVP pronto per essere costruito che risponde a: **Qual è la cosa più piccola che possiamo costruire che prova la tesi centrale, e come la costruiamo?** Questa non è una wishlist di feature — è un bisturi che taglia dritto al singolo workflow che la startup deve azzeccare.

## Quando Usarla

- Dopo che idea-shaping e business-model sono completi
- Quando il founder è pronto a iniziare a costruire
- Prima di build-landing-page (la landing page dovrebbe riflettere lo scope dell'MVP)
- Quando si valutano decisioni build vs. buy vs. partner
- Quando si definisce lo scope del lavoro per un co-founder tecnico o una dev agency

## Istruzioni

### Principio Core: Minimo Viable, Massimo Apprendimento

L'MVP esiste per imparare, non per impressionare. Ogni feature deve rispondere a una domanda specifica sul business:

- **Feature must-have** rispondono a: "L'utente può completare il workflow core?"
- **Feature should-have** rispondono a: "L'utente torna?"
- **Feature could-have** vengono tagliate. Rispondono a domande che non contano ancora.

### Definizione dello Scope MVP

#### 1. Workflow Core

Identifica il singolo workflow che, se funziona, prova il business. Descrivilo passo per passo:
- Cosa innesca il workflow (azione utente, evento, schedule)?
- Cosa succede a ogni step?
- Qual è l'output/valore che l'utente riceve?
- Quanto dovrebbe durare il workflow (target: sotto 2 minuti per il primo valore)?

#### 2. Set di Feature (MoSCoW)

- **Must-have** (blockers per il lancio): massimo 3-5 feature. Ognuna deve servire direttamente il workflow core.
- **Should-have** (aggiunte settimana 2-4): feature che migliorano la retention ma non servono per il primo utilizzo.
- **Won't-have** (tagliate esplicitamente): nomina le feature che il founder sarà tentato di costruire ma non dovrebbe. Spiega perché ognuna viene tagliata.

#### 3. Requisiti Non-Funzionali

- **Performance**: target di tempo di risposta per il workflow core
- **Sicurezza**: autenticazione, gestione dati, requisiti di compliance
- **Scala**: quanti utenti concorrenti deve supportare l'MVP? (Di solito: 100 è sufficiente)

### Raccomandazione Tech Stack

Raccomanda un tech stack specifico basato su:
1. **Competenze esistenti del founder** (se note dal contesto della chat)
2. **Velocità al mercato** — ottimizza per velocità di sviluppo, non per eleganza
3. **Costo a scala MVP** — i free tier dovrebbero coprire i primi 6 mesi
4. **Ecosistema** — ecosistema forte di librerie/plugin per il dominio core

Per ogni scelta tecnologica, spiega il tradeoff specifico: perché questa e non le alternative.

Categorie:
- Framework frontend
- Backend/API
- Database
- Autenticazione
- Hosting/deployment
- API o servizi terzi chiave
- Monitoring/analytics

### Brand Identity (Leggera)

Non una brand guide completa — solo abbastanza per costruire un MVP consistente:
- **Nome** (se non già scelto): 2-3 opzioni con nota sulla disponibilità del dominio
- **Tagline**: una frase che comunica la value proposition core
- **Direzione visiva**: palette colori (2-3 colori con codici hex), raccomandazione tipografica, estetica complessiva (minimale, bold, giocosa, professionale)
- **Voce**: 3 aggettivi che descrivono come il prodotto parla agli utenti

### Timeline di Sviluppo

Una timeline a fasi con milestone concreti:
- **Fase 1: Fondamenta** (settimana 1-2) — auth, shell UI base, schema database, pipeline di deploy
- **Fase 2: Core** (settimana 2-4) — il workflow core, end to end
- **Fase 3: Rifinitura** (settimana 4-6) — flusso di onboarding, gestione errori, analytics base
- **Fase 4: Lancio** (settimana 6-8) — landing page, sistema inviti beta, loop di feedback

Ogni fase ha deliverable specifici e un criterio "fatto quando".

### Matrice Build vs. Buy

Per ogni componente significativo, valuta:
- **Build**: quando è IP core o non esiste come servizio
- **Buy/usa SaaS**: quando un tool a €20/mese risparmia 2 settimane di sviluppo
- **Open source**: quando esiste una libreria matura e il peso della manutenzione è basso

## Formato di Output

```json
{
  "prototype_spec": {
    "core_workflow": {
      "trigger": "Cosa inizia il workflow",
      "steps": [
        { "step": 1, "action": "L'utente fa X", "system_response": "Il sistema fa Y", "time_target": "< 5 secondi" }
      ],
      "value_delivered": "Cosa l'utente riceve alla fine",
      "time_to_value": "Sotto 2 minuti"
    },
    "features": {
      "must_have": [
        { "name": "Nome feature", "description": "Cosa fa", "validates": "Quale domanda di business questo risponde" }
      ],
      "should_have": [
        { "name": "Nome feature", "description": "Cosa fa", "add_in_week": 3 }
      ],
      "wont_have": [
        { "name": "Nome feature", "reason": "Perché è tagliata per l'MVP" }
      ]
    },
    "non_functional": {
      "performance_target": "Il workflow core si completa in < X secondi",
      "security_requirements": ["Metodo di auth", "Gestione dati"],
      "scale_target": "Supporta X utenti concorrenti"
    },
    "tech_stack": {
      "frontend": { "choice": "Framework", "rationale": "Perché questo" },
      "backend": { "choice": "Framework/linguaggio", "rationale": "Perché" },
      "database": { "choice": "DB", "rationale": "Perché" },
      "auth": { "choice": "Servizio/approccio", "rationale": "Perché" },
      "hosting": { "choice": "Piattaforma", "rationale": "Perché", "estimated_monthly_cost": "€X" },
      "key_services": [
        { "service": "Nome", "purpose": "Cosa fa", "cost": "€X/mese" }
      ]
    },
    "brand_identity": {
      "tagline": "Value proposition in una frase",
      "colors": { "primary": "#hex", "secondary": "#hex", "accent": "#hex" },
      "typography": "Raccomandazione font",
      "aesthetic": "minimal | bold | playful | professional",
      "voice_adjectives": ["agg1", "agg2", "agg3"]
    },
    "build_timeline": [
      {
        "phase": 1,
        "name": "Fondamenta",
        "weeks": "1-2",
        "deliverables": ["Sistema di auth", "Schema DB", "Pipeline deploy"],
        "done_when": "L'utente può registrarsi e vedere la dashboard vuota"
      }
    ],
    "build_vs_buy": [
      { "component": "Nome componente", "decision": "build | buy | open-source", "rationale": "Perché", "cost_if_buy": "€X/mese" }
    ],
    "total_estimated_cost_6mo": "€X",
    "biggest_technical_risk": "L'unica cosa che con più probabilità farà saltare la timeline",
    "sources": []
  }
}
```

## Esempi

### Esempio: Tagliare lo Scope Aggressivamente

**Founder:** "Abbiamo bisogno di profili utente, feature social, messaggistica, un marketplace, dashboard analytics e un motore di raccomandazione AI."

**Agent:** Sono 6 feature. La tua tesi core dall'idea-shaping è "aiutare i freelancer a trovare clienti tramite skill-matching." L'unica feature che testa questa tesi è l'algoritmo di matching. Tutto il resto è infrastruttura che rende il matching *più piacevole* ma non prova che *funziona*.

Scope MVP: Un form dove i freelancer descrivono le loro competenze. Un form dove i clienti descrivono le loro necessità. Una funzione di matching che produce risultati ordinati. Una notifica email. Fine. Niente profili, niente messaggistica, niente marketplace, niente dashboard. Se i match sono buoni, le persone risponderanno all'email. Se non rispondono, nessuna feature social al mondo risolverà un cattivo algoritmo di matching.

### Esempio: Tech Stack per Velocità

**Agent:** Dato che sei un founder solo con esperienza Python e devi lanciare in 6 settimane:

- **Frontend:** Next.js — non perché è trendy, ma perché Vercel ti dà hosting gratuito, deploy istantanei, e puoi scrivere l'API nello stesso repo. L'alternativa (React separato + Flask API) raddoppia la complessità del deploy per zero beneficio all'utente a scala MVP.
- **Database:** Supabase (Postgres) — il free tier copre 500MB e 50K utenti attivi mensili. È 10× quello che ti serve per 6 mesi. L'auth integrata ti fa risparmiare 1 settimana di sviluppo.
- **AI:** API OpenAI direttamente — non costruire un modello custom. Alla tua scala (< 1000 richieste/giorno), il costo dell'API è sotto €30/mese. Fine-tune più avanti quando avrai dati.

Costo totale di hosting per l'MVP: €0/mese (tutto nei free tier).
