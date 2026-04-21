---
name: risk-scoring
description: Esegue un audit dei rischi completo su dimensioni tecniche, di mercato, regolatorie, team e finanziarie
---

# Risk Scoring

Produci un audit dei rischi strutturato che fa emergere le 5-10 cose con più probabilità di uccidere la startup, ordinate per probabilità × impatto, ognuna abbinata a una mitigazione concreta. A differenza di una SWOT generica, questo audit è pronto per decidere: ogni rischio ha un trigger falsificabile e un owner nominato.

## Quando Usarla

- Dopo startup-scoring, prima di financial-model o investment-readiness
- Quando un founder sta impegnando capitale (assunzione, ufficio, grande decisione di build)
- Quando si prepara il Q&A con gli investitori — i rischi verranno chiesti
- Dopo un evento esterno rilevante (annuncio di un regolatore, funding di un competitor, breakthrough tecnologico)
- Ogni 90 giorni come parte della cadenza operativa

## Istruzioni

### Dimensioni di Rischio

Valuta ogni dimensione. Per ogni rischio che fai emergere, deve appartenere a esattamente una dimensione — evita il doppio conteggio.

#### 1. Rischio Tecnico
- Tecnologia non provata nello stack
- Rischio di integrazione con API/piattaforme di terze parti
- Assunzioni di scalabilità non testate
- Postura di sicurezza vs. sensibilità dei dati trattati
- Dipendenza da un singolo provider LLM, payment processor o vendor infrastrutturale

#### 2. Rischio di Mercato
- Timing: il mercato è pronto? Troppo presto uccide più startup di troppo tardi.
- Sostituti: soluzioni free o incumbent "abbastanza buone"
- Rischio di categoria: è una categoria reale o un'aggregazione di feature?
- Durabilità della domanda: i tailwind sono permanenti o un'onda di hype?
- Rischio geografico: il prodotto funziona fuori dal tuo mercato di lancio?

#### 3. Rischio Regolatorio / Compliance
- Regolamentazioni esistenti che impattano la categoria (GDPR, HIPAA, SOC2, DSA, EU AI Act)
- Legislazione in arrivo che potrebbe spostare le regole del gioco
- Requisiti di licenza o accreditamento
- Vincoli di data residency e trasferimento cross-border
- Certificazioni specifiche di settore (es. ISO 27001 per B2B enterprise)

#### 4. Rischio di Team / Esecuzione
- Rischio persona-chiave: cosa si rompe se un singolo founder se ne va?
- Gap di skill: ruoli critici mancanti nel team fondatore
- Rischio burnout: timeline irrealistica, nessun backup
- Dinamiche di equity: vesting, cliff, equità della distribuzione
- Lacune advisor/board per lo stage attuale

#### 5. Rischio Finanziario
- Runway: mesi a zero al burn attuale
- Concentrazione del burn: spesa in una singola categoria che non può essere tagliata rapidamente
- Concentrazione revenue: % di revenue dai primi 3 clienti
- Rischio di collection: DSO, churn, tasso di fallimento pagamenti
- Dipendenza da funding: hai identificato le prossime 3 fonti di capitale realistiche?

#### 6. Rischio di Dipendenza / Piattaforma
- Dipendenza di distribuzione: >30% utenti da un singolo canale
- Dipendenza di partner: integrazione critica che potrebbe cambiare termini
- Rischio licenza open-source: componenti AGPL / non-commerciali nel prodotto
- Mercato del talento: puoi assumere le skill che ti servono a questo prezzo?

### Metodologia di Scoring

Per ogni rischio:

- **Probabilità** (1-5): 1 = improbabile in 2 anni, 5 = atteso entro 6 mesi
- **Impatto** (1-5): 1 = fastidio, 5 = fine della startup
- **RiskScore** = Probabilità × Impatto (1-25)
- **Fascia di severità**:
  - 20-25 = Critico (richiede piano di mitigazione questo trimestre)
  - 12-19 = Alto (richiede monitoraggio + contingenza entro 6 mesi)
  - 6-11 = Medio (accetta con consapevolezza)
  - 1-5 = Basso (accetta, rivedi in 6 mesi)

### Requisiti di Mitigazione

Ogni rischio Critico o Alto DEVE avere:

- **Azione di mitigazione**: specifica, con owner, time-bound
- **Owner**: persona nominata
- **Segnale di allarme precoce**: una metrica o cambiamento osservabile che si attiva prima che il rischio si materializzi
- **Soglia di trigger**: il valore al quale la mitigazione escala

## Formato di Output

```json
{
  "risk_audit": {
    "audit_date": "ISO date",
    "top_risks": [
      {
        "id": "risk_001",
        "dimension": "market | technical | regulatory | team | financial | dependency",
        "risk": "descrizione in 1 riga",
        "probability": 1-5,
        "impact": 1-5,
        "risk_score": 1-25,
        "severity": "critical | high | medium | low",
        "narrative": "2-3 frasi: cosa va storto esattamente e perché questo è il modo di fallire probabile",
        "early_warning_signal": "Metrica o evento osservabile che precede questo rischio",
        "trigger_threshold": "Valore specifico che escala la mitigazione",
        "mitigation": "Azione concreta con owner nominato, scadenza entro N settimane",
        "mitigation_owner": "Nome",
        "mitigation_due": "ISO date",
        "status": "new | in_progress | mitigated | accepted"
      }
    ],
    "dimension_summary": {
      "market": { "risk_count": 0, "max_score": 0 },
      "technical": { "risk_count": 0, "max_score": 0 },
      "regulatory": { "risk_count": 0, "max_score": 0 },
      "team": { "risk_count": 0, "max_score": 0 },
      "financial": { "risk_count": 0, "max_score": 0 },
      "dependency": { "risk_count": 0, "max_score": 0 }
    },
    "critical_count": 0,
    "high_count": 0,
    "overall_assessment": "2-3 frasi sulla postura di rischio aggregata e se è compatibile con lo stage attuale e il piano di funding",
    "watch_list": [
      "Segnale esterno da monitorare mensilmente che potrebbe spostare uno o più rischi"
    ],
    "next_review_date": "ISO date — default 90 giorni dopo"
  }
}
```

## Esempi

### Esempio: Forzare la Specificità

**Founder:** "Sono preoccupato per la concorrenza."

**Agent:** "Concorrenza" non è un rischio che posso valutare. Quale competitor, quale mossa specifica, che impatta quale delle tue metriche? Se HubSpot lancia un tier gratuito domani, è una voce di rischio di mercato specifica con un impatto CAC e churn che posso quantificare. Se sei preoccupato per un futuro competitor sconosciuto, è un'ipotesi, non un rischio — appuntala sulla watch list e rivedi quando c'è un segnale.

### Esempio: Forzare la Mitigazione

**Agent:** "Runway a 4 mesi" è valutato Critico (P=5, I=5). Una mitigazione di "raccogliere più soldi" non è una mitigazione — è la cosa che stai cercando di fare. Lasciami riscrivere: *Mitigazione: tagliare $8k/mese di spesa tool non essenziali entro il 31 marzo (Owner: Marco), accelerare 2 fatture in sospeso per €12k totali (Owner: CFO), aprire una conversazione di bridge da €50k con Angel #3 entro il 15 marzo.* Ora abbiamo mitigazioni azionabili con owner e date. Questo è quello che Critico richiede.

### Esempio: Rischio Accettato

**Agent:** Il tuo rischio "Aumento prezzo API OpenAI": P=3, I=2, score 6 → Medio. La mitigazione "astrazione multi-provider" costerebbe ~3 settimane di ingegneria. Al tuo burn attuale sono €15k di tempo ingegneristico per proteggerti da un rischio che potrebbe non materializzarsi mai. La mia raccomandazione: **accetta**, imposta un allarme precoce (rivaluta se OpenAI annuncia un aumento prezzi >30% o un'interruzione maggiore >6 ore), e rivaluta in 6 mesi. Il tempo ingegneristico è meglio speso sui rischi Critici sopra.
