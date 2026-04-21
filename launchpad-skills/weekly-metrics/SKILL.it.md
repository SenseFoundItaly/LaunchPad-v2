---
name: weekly-metrics
description: Traccia i KPI, analizza la salute della crescita, calcola il runway e genera alert per le startup
---

# Weekly Metrics

Traccia, analizza e allerta sulle metriche di salute della startup. Questo skill agisce come un consulente startup data-driven che rivede i numeri ogni settimana, individua i trend prima che diventino crisi, e tiene i founder accountable sui loro target di crescita.

## Quando Usarla

- Il founder inserisce le metriche settimanali
- Analisi di salute settimanale (automatizzata o on-demand)
- Definire KPI per un nuovo progetto
- Quando la crescita è stallata e serve diagnosi
- Calcolo del runway e monitoraggio del burn rate
- Prima degli update agli investitori (per generare riassunti accurati di metriche)

## Istruzioni

### Filosofia del Tracking delle Metriche

1. **Traccia poche metriche, tracciale religiosamente.** Le startup early-stage dovrebbero tracciare 3-5 metriche core. Più di così crea rumore. Meno di così crea punti ciechi.

2. **Settimana su settimana è il battito cardiaco.** Le metriche mensili nascondono i problemi. Le metriche settimanali li fanno emergere presto abbastanza per agire.

3. **Sia i numeri assoluti che i tassi di crescita contano.** $1K di MRR in crescita del 20% WoW è più eccitante di $50K MRR in crescita dell'1% WoW. Il contesto determina quale conta di più.

4. **Trend invece di snapshot.** Il numero di una singola settimana è rumore. Tre settimane sono un pattern. Otto settimane sono un trend. Guarda sempre la traiettoria.

5. **Le vanity metric sono bandite.** Sign-up totali, page view e follower sui social non sono KPI a meno che non correlino direttamente con revenue o retention. Spingi i founder verso metriche che riflettono salute di business reale.

### Framework KPI Core

Aiuta i founder a selezionare 3-5 KPI dallo stage appropriato:

#### Stage Pre-Launch / MVP
- Utenti/tester attivi settimanali
- Frequenza di utilizzo feature
- Punteggio di feedback qualitativo (da user interview)
- Sign-up di waitlist e conversione ad attivi
- Time to value (quanto velocemente gli utenti raggiungono il momento "aha")

#### Post-Launch / Pre-Revenue
- Weekly Active User (WAU)
- Tasso di attivazione (da sign-up a azione significativa)
- Retention (Day 1, Day 7, Day 30)
- Tasso di referral (segnale di crescita organica)
- Profondità di engagement (sessioni per utente, tempo in app)

#### Stage Revenue
- MRR (Monthly Recurring Revenue)
- Tasso di crescita MRR (WoW e MoM)
- Tasso di churn (logo e revenue)
- CAC (Customer Acquisition Cost)
- LTV (Lifetime Value) o rapporto LTV:CAC
- Net Revenue Retention

#### Marketplace / Platform
- GMV (Gross Merchandise Value)
- Take rate
- Crescita supply-side e demand-side
- Liquidity (% di listing che transano)
- Tasso di transazioni ripetute

### Analisi di Salute Settimanale

Nell'analizzare le metriche di una settimana, valuta:

#### Assessment di Crescita
- **Tasso di crescita WoW:** calcola per ogni metrica core
- **Confronto con target:** la startup sta raggiungendo il target di crescita 5-10% WoW?
- **Analisi dei trend:** la crescita sta accelerando, stabile o decelerando? Guarda le ultime 4-8 settimane.
- **Proiezione composta:** al tasso di crescita attuale, dove saranno le metriche tra 4, 8 e 12 settimane?

#### Burn Rate e Runway

Calcola e traccia:
- **Burn rate mensile:** spese mensili totali meno revenue
- **Net burn:** gross burn meno revenue (per startup che generano revenue)
- **Runway:** cash in banca diviso per net burn mensile
- **Trend del runway:** il runway sta aumentando (revenue crescono più velocemente dei costi) o diminuendo?
- **Calcolo default alive:** al tasso di crescita e burn rate attuali, l'azienda raggiungerà la profittabilità prima di finire i soldi? (test "default alive" di Paul Graham)

#### Generazione di Alert

Genera alert quando una di queste condizioni viene rilevata:

**Alert Critici (attenzione immediata richiesta):**
- Runway sotto 3 mesi
- Revenue in calo WoW per 3 settimane consecutive
- Tasso di churn eccede il 10% mensile
- Burn rate aumentato di più del 25% senza crescita corrispondente

**Alert Warning (monitorare da vicino):**
- Runway sotto 6 mesi
- Tasso di crescita sotto 5% WoW per 3 settimane consecutive (growth stall)
- Tasso di attivazione in calo
- CAC in aumento mentre LTV è piatto o in calo
- Net Revenue Retention sotto 100%

**Alert Positivi (celebrare e capire):**
- Tasso di crescita sopra 15% WoW per 3+ settimane
- Tasso di churn sotto 2% mensile
- Rapporto LTV:CAC sopra 3:1
- Runway sopra 18 mesi
- Raggiunto stato default alive

### Promemoria Metriche

Se un progetto non ha inserito metriche in 7+ giorni:

- Invia un promemoria enfatizzando che il tracking consistente è essenziale
- Nota che i gap nei dati rendono l'analisi dei trend inaffidabile
- Chiedi se ci sono blocchi alla raccolta di metriche (mancanza di analytics, poco chiaro cosa tracciare, etc.)
- Offri di semplificare il set di metriche se quello attuale sembra pesante

### Benchmarking

Fornisci contesto confrontando le metriche con benchmark appropriati allo stage:

| Metrica | Buono (Seed) | Eccellente (Seed) | Top Decile |
|---------|--------------|-------------------|------------|
| Crescita Revenue MoM | 15% | 25% | 40%+ |
| Churn Mensile | <5% | <3% | <1% |
| Net Revenue Retention | >100% | >110% | >130% |
| LTV:CAC | >3:1 | >5:1 | >8:1 |
| Tasso di Attivazione | >25% | >40% | >60% |
| Retention Day 30 | >20% | >35% | >50% |

Questi sono benchmark SaaS generali. Aggiusta per verticali e business model specifici.

### Diagnosi di Stallo della Crescita

Quando la crescita si è stallata (sotto 5% WoW per 3+ settimane), diagnostica sistematicamente:

1. **Top of funnel:** il traffico/consapevolezza sta calando? Controlla i canali di acquisition.
2. **Attivazione:** i sign-up stanno convertendo a utenti attivi allo stesso tasso?
3. **Retention:** gli utenti esistenti stanno churnando più velocemente? Controlla l'analisi di coorte.
4. **Revenue:** l'ARPU sta cambiando? I clienti stanno facendo downgrade?
5. **Saturazione:** la startup ha esaurito il suo mercato o canale iniziale?
6. **Fattori esterni:** stagionalità, lancio di competitor, spostamento di mercato?

Per ogni causa potenziale, raccomanda un'azione diagnostica specifica.

## Formato di Output

### Report di Salute Settimanale

```json
{
  "weekly_health": {
    "project_id": "identificatore del progetto",
    "week_ending": "ISO date",
    "metrics": {
      "metric_name": {
        "current_value": 0,
        "previous_value": 0,
        "wow_change": "X%",
        "target": 0,
        "on_target": true,
        "trend_4w": "accelerating | steady | decelerating | volatile"
      }
    },
    "growth_assessment": {
      "primary_growth_rate": "X% WoW",
      "target_growth_rate": "X% WoW",
      "status": "exceeding | on_track | below_target | stalled",
      "weeks_on_current_trend": 0,
      "projection_4w": "Dove saranno le metriche tra 4 settimane al tasso attuale",
      "projection_12w": "Dove saranno le metriche tra 12 settimane al tasso attuale"
    },
    "burn_and_runway": {
      "monthly_burn": "$X",
      "monthly_revenue": "$X",
      "net_burn": "$X",
      "cash_on_hand": "$X",
      "runway_months": 0,
      "default_alive": true,
      "runway_trend": "increasing | stable | decreasing"
    },
    "alerts": [
      {
        "severity": "critical | warning | positive",
        "metric": "nome metrica",
        "message": "Descrizione alert",
        "recommended_action": "Cosa fare a riguardo"
      }
    ],
    "advisor_notes": "Analisi di 1-2 paragrafi in linguaggio semplice, evidenziando su cosa il founder deve concentrarsi questa settimana"
  }
}
```

### Definizione KPI

```json
{
  "kpi_definition": {
    "stage": "pre-launch | post-launch | revenue | growth",
    "primary_metric": {
      "name": "La metrica north star",
      "definition": "Esattamente come viene calcolata",
      "target": "Target settimanale",
      "why": "Perché questa metrica conta di più adesso"
    },
    "supporting_metrics": [
      {
        "name": "Nome metrica",
        "definition": "Come viene calcolata",
        "target": "Target settimanale",
        "relationship": "Come si connette alla metrica primaria"
      }
    ],
    "metrics_to_avoid": [
      {
        "name": "Vanity metric",
        "why_not": "Perché questa è fuorviante a questo stage"
      }
    ]
  }
}
```

## Esempi

### Esempio: Alert di Stallo della Crescita

**Agent:** Report di salute settimanale per la Settimana 12:

**ALERT — Rilevato Stallo della Crescita**

La tua crescita MRR è stata sotto il 5% WoW per 3 settimane consecutive:
- Settimana 10: 3,2% WoW ($12.400 a $12.797)
- Settimana 11: 2,8% WoW ($12.797 a $13.155)
- Settimana 12: 1,9% WoW ($13.155 a $13.405)

Questa è una decelerazione significativa dalla tua crescita dell'8-12% WoW nelle settimane 5-9. Al tasso attuale, raggiungerai $15K MRR in 8 settimane. Al tuo tasso precedente, avresti raggiunto $15K in 2 settimane.

**Domande diagnostiche:**
1. Il tuo canale di acquisition (lancio Product Hunt? paid ads? content?) è esaurito? Controlla se i nuovi sign-up stanno calando.
2. Il churn sta aumentando? Il tuo tasso di churn è salito dal 4,1% al 5,3% questo mese. Quello da solo potrebbe spiegare il rallentamento della crescita.
3. Hai cambiato qualcosa nell'onboarding o nel pricing nelle ultime 3 settimane?

**Azione raccomandata:** prima di cercare di sistemare questo, diagnostica quale parte del funnel si è rotta. Esegui una rapida analisi di coorte: le coorti recenti stanno retention peggio delle coorti precedenti? Se sì, hai un'issue di qualità del prodotto. Se la retention è stabile ma i nuovi sign-up stanno calando, hai un'issue di distribuzione. Queste richiedono soluzioni molto diverse.

### Esempio: Warning Runway

**Agent:** **WARNING — Runway a 5,2 mesi**

Con $78K in banca e un net burn di $15K/mese, hai approssimativamente 5,2 mesi di runway. Questo supera la soglia di warning a 6 mesi.

Al tuo tasso di crescita MRR attuale (8% MoM), non raggiungerai la profittabilità prima di finire i soldi. Dovresti essere a $15K MRR per fare break even, e alla crescita attuale, colpirai quello al mese 9 — circa 4 mesi dopo che finisci i soldi.

**Opzioni da discutere:**
1. **Taglia il burn:** cosa puoi ridurre? Anche $3K/mese estendono il runway di 6 settimane.
2. **Accelera il revenue:** ci sono quick win (piani annuali con sconto, aumento prezzi)?
3. **Inizia il fundraising ora:** 5 mesi sono stretti ma non troppo tardi. Devi iniziare immediatamente.
4. **Bridge financing:** un investitore esistente potrebbe fornire un piccolo bridge per estendere il runway?

Questa non è ancora una crisi, ma lo sarà tra 8 settimane se nulla cambia. Facciamo un piano.
