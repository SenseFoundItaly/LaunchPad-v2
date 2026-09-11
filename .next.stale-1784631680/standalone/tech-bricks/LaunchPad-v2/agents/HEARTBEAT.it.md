# Heartbeat LaunchPad — Task Autonomi Settimanali

## Panoramica della Pianificazione

L'heartbeat viene eseguito settimanalmente, attivato ogni lunedì alle 9:00 UTC. Esegue controlli proattivi su tutti i progetti attivi, mette in coda bozze per l'approvazione del founder e assembla il Monday Brief — senza aspettare input dal founder.

Il ciclo ha sei step ordinati:

1. **Controllo inserimento metriche** — analisi di salute sui KPI tracciati
2. **Controllo growth loop** — follow-up sugli esperimenti in testing
3. **Controllo pipeline di fundraising** — segnalare follow-up agli investitori in ritardo
4. **Generazione del riassunto settimanale** — digest di stato cross-progetto
5. **Scan dell'ecosistema (Layer 1)** — competitor, IP, trend, partnership → `ecosystem_alerts` + `pending_actions` auto-accodate
6. **Digest della inbox di approvazione** — assemblare il Monday Brief e inviare la notifica di consegna

Gli step 1-4 sono la cadenza operativa (salute metriche, crescita, fundraising). Gli step 5-6 sono il layer autonomo di co-founder (intelligence di ecosistema + digest per il founder). Il cap di budget in `project_budgets.cap_llm_usd` limita quanti scan di ecosistema partono davvero — gli step critici (1-4) vengono sempre eseguiti.

## Ciclo del Lunedì Mattina

### Step 1: Controllo Inserimento Metriche

**Per ogni progetto attivo, controlla se esistono inserimenti metriche negli ultimi 7 giorni.**

#### Progetti CON Metriche Recenti

Esegui l'analisi di salute weekly-metrics:

1. Calcola i tassi di crescita WoW per tutti i KPI tracciati
2. Confronta con i target specifici del progetto (default: 5-10% WoW)
3. Calcola il burn rate attuale e il runway
4. Esegui il rilevamento alert (critico, warning, positivo)
5. Genera un riassunto di salute

**Output:** Report settimanale di salute consegnato al progetto. Se vengono rilevati alert critici, mettili in evidenza.

**Template per la notifica di riassunto salute:**

```
Controllo Salute Settimanale -- [Nome Progetto] -- Settimana del [Data]

Crescita: [Metrica primaria] è [X% WoW] ([sopra/sotto] il tuo target [Y%])
Runway: [X mesi] all'attuale burn di [$X/mese]
Alert: [Numero] critici, [Numero] warning, [Numero] positivi

[Se esistono alert critici:]
ATTENZIONE RICHIESTA:
- [Descrizione alert e azione raccomandata]

[Una nota del consulente di un paragrafo su su cosa concentrarsi questa settimana]
```

#### Progetti SENZA Metriche Recenti

Invia un promemoria metriche:

**Template per promemoria metriche:**

```
Promemoria Metriche -- [Nome Progetto]

Sono passati [X giorni] dal tuo ultimo inserimento metriche. Il tracking settimanale costante è essenziale per individuare i trend presto e prendere decisioni informate.

I tuoi KPI tracciati:
- [KPI 1]: Ultimo valore [X] il [data]
- [KPI 2]: Ultimo valore [X] il [data]

Aggiornamento veloce: quali sono i numeri di questa settimana?

Se la raccolta delle metriche è difficile o i KPI attuali non ti sembrano giusti, fammelo sapere e possiamo semplificare o aggiustare cosa stai tracciando.
```

**Escalation:** Se un progetto non ha inserito metriche per 3+ settimane consecutive, alza il tono:

```
Alert Gap Metriche -- [Nome Progetto]

Nessuna metrica inserita in [X settimane]. Senza dati non posso fornire una guida significativa su crescita, runway o salute.

Non si tratta di lavoro di routine. Le startup che ho visto riuscire tracciano i loro numeri ogni settimana, anche quando i numeri sono brutti. Soprattutto quando i numeri sono brutti.

Due opzioni:
1. Inserisci i numeri di questa settimana (anche stime approssimative sono meglio di niente)
2. Dimmi cosa blocca la raccolta delle metriche e lo sistemiamo

Quale preferisci?
```

### Step 2: Controllo Growth Loop

**Per ogni progetto con growth optimization loop attivi:**

Controlla se qualche loop è in stato "testing" da più di 7 giorni senza una valutazione.

**Se vengono trovati loop in ritardo, chiedi i risultati:**

```
Follow-Up Growth Loop -- [Nome Progetto]

Il Loop #[X] ([target]: "[ipotesi]") è in testing da [X giorni].

Hai già risultati? Anche risultati parziali sono utili:
- Cosa mostra la metrica finora?
- Sono stati raccolti dati sufficienti perché il test sia significativo?
- È successo qualcosa di inaspettato durante il test?

Se il test ha bisogno di più tempo, fammelo sapere e ricontrollerò tra [timeframe suggerito]. Se hai deciso di abbandonare questo test, va bene anche — dimmi perché e progetteremo il prossimo.
```

### Step 3: Controllo Pipeline di Fundraising

**Per ogni progetto con una pipeline di fundraising attiva:**

Controlla gli investitori con next_steps in ritardo (la data next_action_due è passata).

**Se vengono trovati follow-up in ritardo, invia un promemoria:**

```
Promemoria Follow-Up Fundraising -- [Nome Progetto]

[X] follow-up con investitori sono in ritardo:

[Per ogni investitore in ritardo:]
- [Nome Investitore] ([Fondo]) -- [Stage]
  Ultima interazione: [data] ([X giorni fa])
  Azione in ritardo: [descrizione next_action]
  Messaggio suggerito: "[Bozza di messaggio follow-up basato sul contesto]"

Il momentum conta nel fundraising. Follow-up ritardati segnalano basso interesse o disorganizzazione. Raccomando di affrontarli oggi.

[Se qualche investitore è in "reached_out" senza risposta da 14+ giorni:]
Nota: [Nome Investitore] non ha risposto all'outreach in [X giorni]. Valuta se esiste un percorso di intro diverso o se spostarlo a "passed" e concentrare l'energia altrove.
```

### Step 4: Generazione del Riassunto Settimanale

**Dopo che tutti i controlli sono completi, genera un riassunto settimanale cross-progetto.**

```
Riassunto Settimanale LaunchPad -- Settimana del [Data]

PROGETTI ATTIVI: [X]

[Per ogni progetto, stato in una riga:]
- [Nome Progetto]: [Metrica primaria] a [valore] ([X% WoW]) | Runway: [X mesi] | [Alert o stato principale]

ATTENZIONE RICHIESTA:
- [Elenca eventuali alert critici tra tutti i progetti]
- [Elenca i progetti con 3+ settimane di metriche mancanti]
- [Elenca i follow-up di fundraising in ritardo di 7+ giorni]

VITTORIE DI QUESTA SETTIMANA:
- [Elenca gli alert positivi: crescita forte, buona retention, runway in estensione]

IN ARRIVO:
- [Progetti vicini agli avvisi di runway]
- [Growth loop che necessitano valutazione]
- [Milestone di fundraising in avvicinamento]
```

### Step 5: Scan dell'Ecosistema (intelligence autonoma Layer 1)

**Per ogni progetto attivo, esegui i 4 monitor di ecosistema e arricchisci il knowledge graph.**

I monitor di ecosistema (`ecosystem.competitors`, `ecosystem.ip`, `ecosystem.trends`, `ecosystem.partnerships`) sono seminati per-progetto alla creazione (vedi `src/lib/ecosystem-monitors.ts`). Ognuno emette blocchi strutturati `:::artifact{"type":"ecosystem_alert"}` che il cron parsa in righe sulla tabella `ecosystem_alerts`.

#### 5a. Esegui gli scan

Per ogni progetto:
1. Carica il contesto via `loadMonitorContext(projectId)` — tira idea, ricerca, locale e liste di competitor/keyword nel prompt.
2. Esegui tutti e 4 i monitor di ecosistema. Limita la spesa LLM per-scan via `project_budgets.cap_llm_usd`; salta i monitor che violerebbero il cap e logga un alert di warning.
3. Parsa l'output strutturato in righe `ecosystem_alerts`. Ogni alert porta `relevance_score` (0-1), `confidence` (0-1), e un `dedupe_hash` così le ri-esecuzioni non possono creare duplicati.
4. Per gli alert con `relevance_score >= 0.8` E `suggested_action != null`, auto-crea una `pending_action` nella inbox di approvazione. Il founder approva prima che qualsiasi azione esterna venga eseguita.

#### 5b. Arricchisci il knowledge graph

Per ogni nuovo ecosystem alert sopra la soglia di rilevanza (0.6):
- Crea o aggiorna un `graph_node` corrispondente (node_type: `competitor`, `trend`, `technology`, `partner`, o `ip_alert`).
- Collega `ecosystem_alerts.graph_node_id` per chiudere il loop.
- Il graph cresce *tra le sessioni del founder* — questo è il moat di repository cumulativo di SenseFound.

#### 5c. Cap alle azioni proposte per settimana

**Limite rigido: 5 nuove `pending_actions` per progetto per run settimanale.**

Se più di 5 alert si qualificano per l'auto-coda, ordina per `relevance_score × confidence × estimated_impact` e accoda solo i top 5. Gli altri vengono loggati in `ecosystem_alerts` ma non diventano pending action. Questo limita la fatica di approvazione — il rischio #1 identificato nel piano Phase 0.

### Step 6: Digest della Inbox di Approvazione

**Dopo che gli scan di ecosistema sono completi, assembla il Monday Brief per ogni progetto.**

Il Brief è generato dalla route esistente `/api/projects/{id}/brief`, non rigenerato qui. Il lavoro dello Step 6 è:

1. **Inviare la notifica di consegna** via il canale scelto dal founder (email, in-app, WhatsApp, Telegram). Il corpo della notifica è il `personality_intro` dal Brief più i conteggi delle sezioni; il Brief completo si apre nella web app.
2. **Escalare gli item inbox in ritardo**: qualsiasi `pending_actions` che è rimasta in `pending` o `edited` per >14 giorni senza transizione viene segnalata nella sezione "Decisioni necessarie" del Brief con severità warning. Oltre 21 giorni → critico, in cima al Brief.
3. **Generare il riassunto "Cosa ho fatto per te"**: elenca le `pending_actions` con `status='sent'` ed `executed_at >= ultimo lunedì`. Questa è la prova visibile al founder che il co-founder si sta guadagnando il suo posto.

**Template per la notifica di consegna del Brief:**

```
Il tuo lunedì su [Nome Progetto] — Settimana del [Data]

[personality_intro — 1 paragrafo breve]

[X] segnali dall'ecosistema sopra la soglia di rilevanza (0.6)
[X] decisioni richiedono la tua review
[X] azioni eseguite dopo la tua approvazione questa settimana

Apri il tuo Brief → [link]
```

**Pattern di escalation per inbox ignorata:**

Se un founder ha ricevuto 3 Brief consecutivi senza aprire la inbox, scendi di marcia: auto-metti in pausa *nuove* azioni auto-accodate per quel progetto e invia un messaggio di una riga: *"La tua coda co-founder ha [X] bozze non riviste. Vuoi darci un'occhiata, o dovrei mettere in pausa l'auto-coda fino a tuo segnale?"* Rispettare l'attenzione del founder è più importante che mantenere la cadenza.

## Configurazione Heartbeat

### Timing
- **Run primario:** lunedì 9:00 UTC
- **Controllo follow-up:** giovedì 9:00 UTC (solo per alert critici e item in ritardo del lunedì)

### Soglie

| Controllo | Trigger | Severità |
|-----------|---------|----------|
| Nessuna metrica in 7 giorni | Invia promemoria | Info |
| Nessuna metrica in 21 giorni | Invia promemoria escalato | Warning |
| Nessuna metrica in 35 giorni | Segnala progetto come potenzialmente inattivo | Critical |
| Growth loop in testing > 7 giorni | Chiedi risultati | Info |
| Growth loop in testing > 21 giorni | Suggerisci abbandonare o riprogettare | Warning |
| Follow-up investitore in ritardo 1-3 giorni | Includi nella lista promemoria | Info |
| Follow-up investitore in ritardo 7+ giorni | Escala urgenza | Warning |
| Follow-up investitore in ritardo 14+ giorni | Suggerisci spostare a passed | Critical |
| Runway sotto 6 mesi | Alert di warning | Warning |
| Runway sotto 3 mesi | Alert critico | Critical |
| Stallo crescita (3+ settimane sotto target) | Prompt di diagnosi | Warning |
| Calo revenue 3+ settimane consecutive | Alert critico | Critical |
| Ecosystem alert con rilevanza ≥ 0.8 | Auto-coda pending_action | Info |
| Ecosystem alert con rilevanza ≥ 0.9 e alert_type critico | Mostra in sezione top del Brief | Warning |
| Pending action in `pending`/`edited` > 14 giorni | Segnala come in ritardo nel Brief | Warning |
| Pending action in `pending`/`edited` > 21 giorni | Escalation in cima al Brief | Critical |
| 3 Brief consecutivi non aperti | Auto-pausa nuova coda, invia check-in | Warning |
| Spesa LLM mensile > 80% di cap_llm_usd | Metti in pausa il monitor più costoso | Warning |
| Spesa LLM mensile > 100% di cap_llm_usd | Metti in pausa tutti i monitor di ecosistema, notifica founder | Critical |

### Priorità delle Notifiche

1. **Alert critici** sono sempre mostrati per primi e in evidenza
2. **Warning** sono inclusi nel riassunto con azioni raccomandate
3. **Item informativi** sono raggruppati nel riassunto settimanale
4. **Alert positivi** sono messi in evidenza per mantenere la motivazione del founder

### Modalità Silenziosa

Se un founder richiede esplicitamente notifiche ridotte per un progetto (es. "sono in vacanza per 2 settimane"), rispetta la richiesta:
- Metti in pausa promemoria metriche e prompt di growth loop
- Continua a eseguire l'analisi di salute in background
- Riprendi le notifiche dopo il periodo silenzioso
- Se un alert critico si attiva durante la modalità silenziosa (runway sotto 3 mesi), invialo comunque con una nota che supera la modalità silenziosa per severità
