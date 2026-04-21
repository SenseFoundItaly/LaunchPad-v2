---
name: startup-scoring
description: Assegna un punteggio a un'idea di startup su 6 dimensioni con metodologia pesata e rationale azionabile
---

# Startup Scoring

Valuta un'idea di startup su sei dimensioni critiche, producendo un punteggio rigoroso e trasparente con rationale chiaro. Questo non è un esercizio di cheerleading. Il punteggio deve aiutare i founder a vedere la loro idea onestamente e prioritizzare cosa sistemare.

## Quando Usarla

- Dopo che idea-shaping è completo (richiede un Idea Canvas strutturato o contesto equivalente)
- Il founder richiede una valutazione della sua idea attuale
- Prima di market-research per identificare quali dimensioni richiedono investigazione più profonda
- Quando si confrontano opzioni di pivot o varianti di idea
- Periodicamente per ri-valutare dopo nuovi dati o iterazioni

## Istruzioni

### Filosofia di Scoring

1. **Sii onesto, non duro.** Un punteggio basso è un'informazione utile. Addolcire non aiuta nessuno. Ma accoppia sempre la critica a un percorso in avanti.

2. **Fonda ogni punteggio sull'evidenza.** Se il founder ha fornito metriche, ricerca o dati cliente, fai riferimento. Se non l'ha fatto, nota l'assenza di dati come fattore del punteggio.

3. **Valuta ciò che esiste, non ciò che è promesso.** "Abbiamo intenzione di costruire un network effect" ha punteggio minore di "Abbiamo 500 utenti che hanno invitato 3 amici ciascuno." Le aspirazioni sono annotate ma non gonfiano i punteggi.

4. **Usa tutto il range.** Un punteggio di 50 significa mediocre, non buono. La maggior parte delle idee early-stage dovrebbero finire tra 30-70 sulla maggior parte delle dimensioni. Punteggi sopra 80 richiedono evidenza forte. Punteggi sotto 20 indicano problemi fondamentali.

### Le Sei Dimensioni

#### 1. Market Opportunity (Peso: 20%)

Valuta la dimensione e l'accessibilità del mercato.

- **80-100:** Mercato addressable grande (TAM >$1B) con entry point chiaro, in rapida crescita
- **60-79:** Mercato solido ($100M-$1B TAM), crescita moderata, beachhead accessibile
- **40-59:** Mercato di nicchia o sizing poco chiaro, alcuni indicatori di crescita
- **20-39:** Mercato piccolo, piatto o in declino, difficile da accedere
- **0-19:** Nessun mercato identificabile o categoria fondamentalmente in contrazione

Considera: stime TAM/SAM/SOM, tasso di crescita del mercato, timing (perché ora?), tailwind o headwind regolatori.

#### 2. Competitive Landscape (Peso: 15%)

Valuta il posizionamento rispetto ai competitor esistenti e potenziali.

- **80-100:** Differenziazione chiara con moat difendibile, competizione debole o frammentata
- **60-79:** Differenziazione significativa, qualche competizione ma nessun incumbent dominante
- **40-59:** Differenziazione moderata, competitor consolidati esistono
- **20-39:** Mercato affollato, differenziazione debole, incumbent forti
- **0-19:** Dominato da incumbent ben finanziati, nessun angolo d'attacco chiaro

Considera: numero e forza dei competitor, switching cost, network effect, vantaggi proprietari, moat di brand.

#### 3. Feasibility (Peso: 15%)

Valuta se questo team può davvero costruire e consegnare questo prodotto.

- **80-100:** Il team ha expertise di dominio profonda, MVP fattibile in settimane, percorso tecnico chiaro
- **60-79:** Il team ha skill rilevanti, MVP fattibile in 1-3 mesi, qualche incognita tecnica
- **40-59:** Ci sono gap di skill ma affrontabili, timeline MVP 3-6 mesi, rischio tecnico moderato
- **20-39:** Gap significativi di skill, requisiti tecnici complessi, ostacoli regolatori
- **0-19:** Richiede breakthrough in tecnologia, regolamentazione o composizione del team

Considera: complessità tecnica, capacità del team, requisiti regolatori, requisiti di capitale per MVP, tempo al primo prodotto usabile.

#### 4. Business Model Viability (Peso: 20%)

Valuta se l'economia può funzionare.

- **80-100:** Modello di revenue provato nella categoria, unit economics forti, percorso chiaro a profittabilità
- **60-79:** Modello di revenue logico, assunzioni di unit economics ragionevoli, qualche validazione
- **40-59:** Modello di revenue identificato ma non validato, unit economics incerti
- **20-39:** Modello di revenue poco chiaro, WTP dubbio, CAC alto probabile
- **0-19:** Nessun modello di revenue o economia fondamentalmente rotta

Considera: chiarezza del modello di revenue, validazione del pricing, potenziale rapporto CAC/LTV, margini lordi, percorso a break-even.

#### 5. Customer Demand (Peso: 20%)

Valuta l'evidenza che i clienti vogliano davvero questo.

- **80-100:** Clienti paganti o pre-order forti, pull misurabile dal mercato
- **60-79:** Interesse validato (waitlist, LOI, test di landing page riusciti)
- **40-59:** Interesse aneddotico da conversazioni, survey mostrano intent
- **20-39:** Domanda assunta basata sull'intuizione del founder, nessuna validazione
- **0-19:** Evidenza suggerisce che i clienti non vogliano questo o abbiano già alternative soddisfacenti

Considera: customer interview condotte, iscrizioni o pre-order, segnali di WTP, dati NPS o soddisfazione da prototipi.

#### 6. Execution Risk (Peso: 10%)

Valuta cosa potrebbe andare storto e quanto sarebbe catastrofico. NOTA: questa dimensione è inversa — punteggi più alti significano rischio PIÙ BASSO.

- **80-100:** Rischio di esecuzione basso, percorso lineare, il team l'ha già fatto
- **60-79:** Rischio moderato, sfide identificabili con soluzioni note
- **40-59:** Rischio significativo, diverse cose devono andar bene simultaneamente
- **20-39:** Rischio alto, dipende da fattori esterni fuori dal controllo del founder
- **0-19:** Rischio estremo, minacce esistenziali multiple senza percorso di mitigazione

Considera: dipendenze da persone chiave, rischio regolatorio, rischio tecnologico, rischio di market timing, dipendenze di funding.

### Processo di Scoring

1. Valuta ogni dimensione indipendentemente. Non lasciare che un punteggio forte in un'area gonfi un'altra.
2. Scrivi il rationale prima di assegnare il numero. Questo previene l'anchoring.
3. Elenca punti di forza e rischi specifici per ogni dimensione.
4. Calcola il punteggio complessivo pesato.
5. Identifica le top 2-3 priorità che il founder dovrebbe affrontare per migliorare il punteggio.

## Formato di Output

```json
{
  "startup_score": {
    "overall_score": 0,
    "overall_grade": "A+ | A | B+ | B | C+ | C | D | F",
    "summary": "Valutazione complessiva in 2-3 frasi",
    "dimensions": {
      "market_opportunity": {
        "score": 0,
        "weight": 0.20,
        "rationale": "Perché questo punteggio",
        "strengths": ["Punto di forza specifico"],
        "risks": ["Rischio specifico"]
      },
      "competitive_landscape": { /* stessa struttura, weight 0.15 */ },
      "feasibility":           { /* stessa struttura, weight 0.15 */ },
      "business_model_viability": { /* stessa struttura, weight 0.20 */ },
      "customer_demand":       { /* stessa struttura, weight 0.20 */ },
      "execution_risk":        { /* stessa struttura, weight 0.10 */ }
    },
    "grade_scale": {
      "A+": "90-100: Eccezionale su tutte le dimensioni",
      "A":  "80-89: Forte con lacune minori",
      "B+": "70-79: Promettente con aree di miglioramento chiare",
      "B":  "60-69: Viable ma richiede lavoro significativo",
      "C+": "50-59: Dubbia, lacune maggiori da affrontare",
      "C":  "40-49: Debole, issue fondamentali presenti",
      "D":  "25-39: Improbabile riuscire senza un pivot maggiore",
      "F":  "0-24: Concetto fondamentalmente viziato"
    },
    "top_priorities": [
      {
        "dimension": "Nome della dimensione più debole",
        "action": "Azione specifica per migliorare il punteggio",
        "expected_impact": "Di quanto questo potrebbe guidare il miglioramento"
      }
    ],
    "data_gaps": [
      "Informazioni che il founder dovrebbe raccogliere per abilitare scoring più accurato"
    ]
  }
}
```

## Esempi

### Esempio: Scoring con Dati Limitati

**Founder:** "Valuta la mia idea. Voglio costruire un CRM per freelancer."

**Agent:** Posso valutarla, ma voglio segnalare che diverse dimensioni avranno punteggio più basso per mancanza di dati più che per una cattiva idea. Lasciami percorrere ogni dimensione.

**Market Opportunity: 52/100** — Il mercato dei tool per freelancer sta crescendo ma è frammentato. CRM è una categoria ben compresa, il che aiuta, ma "freelancer" è un segmento ampio. Hai identificato quale tipo di freelancer? Un graphic designer e un idraulico hanno workflow molto diversi. Senza un TAM sizing specifico del tuo segmento, sto stimando in modo conservativo.

### Esempio: Punteggio Basso Onesto

**Agent:** **Competitive Landscape: 28/100** — Questa è la dimensione più dura per la tua idea. HubSpot offre un CRM gratuito. Notion e Airtable servono come CRM leggeri per molti freelancer. Non hai menzionato differenziazione specifica oltre a "più semplice". Più semplice di HubSpot gratuito è una vendita difficile. Il rischio qui non è che il tuo prodotto sarebbe cattivo, ma che lo switching cost da tool gratuiti è essenzialmente zero mentre il beneficio dello switch è poco chiaro.

**Punti di forza:** capisci il workflow del freelancer da esperienza personale.
**Rischi:** competere contro prodotti gratuiti di aziende ben finanziate. Nessun moat identificato.
