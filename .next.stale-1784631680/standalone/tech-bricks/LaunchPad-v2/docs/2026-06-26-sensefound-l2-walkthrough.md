# SenseFound L2: Iteration Cycle

**Walkthrough concettuale del documento di specifica**

> Una guida al ragionamento dietro ogni scelta progettuale. Da leggere in parallelo al documento principale.

---

## 1. Perche' esiste L2 e cosa risolve

Il problema che L2 risolve non e' tecnico. E' comportamentale.

La maggior parte dei founders che fallisce non fallisce perche' non sa programmare o non capisce il mercato. Fallisce perche' costruisce nella sequenza sbagliata: passa troppo presto da "ho un'idea" a "sto costruendo il prodotto", salta la validazione perche' e' scomoda, e quando i feedback arrivano (spesso mesi dopo il lancio) non sa dove intervenire ne' come gestire il caos delle revisioni.

L2 e' il workflow che impedisce tutto questo. E' una macchina end-to-end che guida il founder attraverso ogni fase critica nell'ordine corretto, con criteri oggettivi per decidere quando andare avanti e quando tornare indietro.

L2 non e' un checklist. E' un sistema che sa riconoscere quando qualcosa non funziona e sa indicare esattamente cosa rivedere, senza buttare via tutto.

Il riferimento concettuale e' quello dei migliori studio di venture building: un processo strutturato, opinionated, con gate espliciti tra le fasi. La differenza e' che SenseFound lo rende accessibile a qualsiasi founder, non solo a chi ha accesso a un team di advisor senior.

## 2. La struttura generale: fasi, loop e modulo trasversale

Il documento definisce 4 fasi macro piu' un modulo opzionale-ma-obbligatorio. Le fasi sono sequenziali nel senso che ognuna presuppone la precedente. Tra alcune fasi critiche ci sono i Loop, che sono il vero differenziale del sistema.

| # | Fase / Loop | Descrizione |
| --- | --- | --- |
| 0 | Idea Canvas | Struttura l'idea grezza in un Lean Canvas con scoring iniziale |
| 1 | Validation Gate | Valida mercato, tech e PSF prima di spendere un euro |
| L1 | Loop 1: PSF Review | Primo momento di revisione strutturata |
| 2 | Business Essentials | Business model, pricing, unit economics |
| L2 | Loop 2: BM Stress Test | Seconda revisione su sostenibilita' finanziaria |
| MOD | Modulo Trasversale: Financial & Pitch Assets | Attivabile quando il founder e' pronto |
| 3 | Build & Test Sandbox | Landing page, demo, test con warm users |
| L3 | Loop 3: Market Response Review | Prima validazione con segnali reali |
| 4 | MVP Release | Build, launch, testing con cold e warm users |
| L4 | Loop 4: MVP Test Verdict | Verdict finale dell'intero ciclo |

> **Nota importante sulla lettura del documento:** le fasi descrivono *cosa il founder deve fare*. I loop descrivono *cosa succede quando i risultati di una fase non raggiungono la soglia minima*. Sono due livelli distinti e vanno letti separatamente.

## 3. Perche' le fasi sono in quell'ordine

L'ordine non e' arbitrario. Segue una logica di "costo crescente dell'errore": ogni fase successiva e' piu' costosa da correggere, quindi si valida prima tutto cio' che e' piu' economico da validare.

### Phase 0 — Idea Canvas

E' l'entry point. Il founder struttura l'idea in un Lean Canvas e ottiene uno score iniziale. Non c'e' ancora intelligenza esterna attiva. Il punto e' forzare il founder a esplicitare le assunzioni prima che diventino certezze implicite. Molti founders saltano questo step e si ritrovano a litigare su cosa e' effettivamente il prodotto sei mesi dopo. Il Canvas e' il contratto interno del team con se stesso.

### Phase 1 — Validation Gate (1A + 1B + 1C)

E' divisa in tre track: Market Validation (1A), Technical Validation (1B) e Problem-Solution Fit (1C). Le prime due girano in parallelo e alimentano la terza.

La logica e': prima di parlare con utenti reali (1C), devi gia' sapere quanto e' grande il mercato, chi sono i competitor e se ci sono blocchi tecnici o normativi. Altrimenti le interviste del PSF sono decontestualizzate e produrranno insight che non sai dove collocare.

I watcher L1 si attivano qui per la prima volta — questo e' importante per il collegamento con L1 che viene dopo.

### Phase 2 — Business Essentials

Arriva dopo che hai evidenza di PSF, non prima. Questo e' un errore classico dei founders: definire il pricing prima di aver capito se qualcuno vuole davvero il prodotto. In Phase 2 il founder definisce il Business Model con dati reali in mano, non ipotesi. Il pricing anchor, i tier, il LTV/CAC — tutto si basa sugli insight raccolti nelle interviste del Loop 1.

### Phase 3 — Build & Test Sandbox

La landing page arriva qui, non prima. Troppi founders costruiscono la landing page nel weekend dopo aver avuto l'idea, prima di aver parlato con un solo utente. In questo flow, quando arrivi alla landing page hai gia' PSF evidence, un business model validato e un pricing coerente con la WTP. Il risultato e' una landing page che converte, non un esercizio di design prematuro.

### Phase 4 — MVP Release

Il build fisico del prodotto arriva per ultimo — dopo che hai validato il problema, la soluzione, il business model e la domanda di mercato. A questo punto costruire e' quasi meccanico: sai cosa costruire, per chi, a che prezzo, con quale messaggio. Il rischio di scope creep e' minimo perche' ogni feature ha un'evidenza che la supporta.

## 4. Il concetto di Loop: cosa sono e perche' esistono

Questa e' la parte piu' critica da capire. I loop sono il motivo per cui L2 esiste come sistema e non come semplice checklist.

Un loop non e' un fallimento. E' il momento in cui il sistema riconosce che i dati raccolti non supportano l'avanzamento e prescrive una revisione mirata. La differenza tra un founder che usa L2 e uno che non lo usa e' che il primo sa esattamente cosa rivedere, il secondo non lo sa.

Senza i loop, il workflow sarebbe lineare: completi una fase, vai alla successiva. Il problema e' che nella realta' i founders spesso si trovano a dover tornare indietro — ma non sanno dove, non sanno quanto, e non sanno quando smettere di iterare. Questo e' uno dei principali motivi di stress e perdita di tempo che SenseFound vuole eliminare.

Ogni loop ha tre caratteristiche fondamentali:

1. **Trigger oggettivo** — Il loop si attiva quando uno o piu' segnali misurabili scendono sotto una soglia definita. Non e' una decisione soggettiva del founder. Il sistema calcola il loop score e lo presenta con evidenza. Questo elimina il bias di conferma tipico dei founders ("sono sicuro che funziona, proviamo ancora").
2. **Scope chirurgico** — Il loop non riporta all'inizio di tutto. Riporta esattamente agli step che i dati hanno invalidato. Se il problema e' il messaggio, si rivede il messaggio — non il prodotto. Se il problema e' il target, si rivede il target — non il business model. Questo e' il risparmio di tempo concreto che L2 deve garantire.
3. **Escalation cap** — Ogni loop ha un numero massimo di iterazioni (tipicamente 2). Al raggiungimento del cap, il sistema forza un verdict strutturato: GO, PIVOT, o STOP. Questo e' fondamentale perche' impedisce il loop infinito — la situazione in cui il founder continua a iterare senza mai decidere. Il verdict e' sempre accompagnato da un evidence summary che spiega il razionale.

> **Nota sul principio Founder-first:** il trigger automatico dice "questo loop dovrebbe attivarsi". Ma il founder puo' sempre attivare manualmente un loop anche se il trigger non scatta, e puo' scegliere di ignorare un trigger automatico (con motivazione registrata in Knowledge). Il sistema guida, non decide.

## 5. I 4 loop: cosa fa ciascuno e perche' e' li'

### Loop 1 — PSF Review

E' il loop piu' critico dell'intero ciclo. Si attiva dopo le interviste del Problem-Solution Fit e risponde a una domanda semplice: *le persone che abbiamo intervistato confermano davvero il problema e sono disposte a pagare per la nostra soluzione?*

Se la risposta e' no (o debole), non ha senso costruire un business model sopra quell'assunzione. Il Loop 1 permette di rivedere ICP, value proposition e problem statement prima di investire settimane in pricing, financial model e tutto cio' che segue.

Il segnale di blocco assoluto e' la **WTP sotto il 30%**: se meno di 3 persone su 10 tra quelle intervistate sarebbero disposti a pagare per la soluzione, il loop si attiva indipendentemente dagli altri segnali. Questo e' un dato che non si puo' ignorare.

### Loop 2 — BM Stress Test

Si attiva dopo la definizione del Business Model e risponde a: *questo modello e' finanziariamente sostenibile?* Il segnale di blocco assoluto e' **LTV/CAC sotto 2x** — sotto quella soglia non esiste un percorso verso la profittabilita', indipendentemente dalla crescita.

C'e' una connessione esplicita con il Loop 1: se il pricing deve cambiare in modo significativo rispetto alla WTP rilevata nelle interviste, il sistema segnala che il Loop 1 e' parzialmente invalidato e richiede una micro-iterazione PSF. Questo collegamento e' importante perche' impedisce di fixare il BM in isolamento senza verificare che la nuova ipotesi di prezzo regga con gli utenti reali.

### Loop 3 — Market Response Review

E' il primo loop con dati quantitativi da utenti reali. Si attiva dopo il testing della landing page con warm users e usa metriche analitiche (conversion rate, bounce rate, tempo sulla pagina) insieme ai feedback qualitativi.

La caratteristica distintiva di questo loop e' la **classificazione automatica dei feedback in 3 livelli di gravita'**: superficiale (solo copy/UX da rivedere), intermedio (posizionamento da rivedere) o profondo (ICP shift — riapertura del Loop 1 necessaria). Questo e' il meccanismo che impedisce di perdere settimane a ottimizzare la landing page quando il problema reale e' che stai parlando al segmento sbagliato.

### Loop 4 — MVP Test Verdict

E' l'unico loop che produce un verdict finale sull'intero ciclo. Si attiva dopo il testing MVP con cold e warm users. Usa 4 segnali: activation rate, retention a 7 giorni, NPS post-uso e WTP confermata su prodotto reale.

Ha 4 livelli di revisione (UX, feature, GTM, strategico) e 4 possibili esiti finali: **LAUNCH READY, LAUNCH WITH CONSTRAINTS, PIVOT GUIDED, STOP**. Questi 4 esiti non sono valutativi in senso morale — STOP non e' un fallimento, e' una decisione informata basata su evidenza accumulata. Il sistema genera sempre un Evidence Summary che il founder puo' usare per imparare e ripartire con una nuova idea.

## 6. Il Modulo Trasversale: perche' non e' una fase

Il Modulo Financial & Pitch Assets (runway, capital need, investor pitch, sales pitch, data room) e' obbligatorio ma non ha una posizione fissa nel flow. Questo e' una scelta deliberata.

Il motivo: diversi founders hanno esigenze diverse su quando costruire questi asset. Un founder che non cerca funding nell'immediato non ha bisogno del pitch deck dopo il Loop 1. Un founder che sta parlando con investitori vuole il data room prima possibile. Forzare una posizione fissa creerebbe attrito per chi non ne ha bisogno in quel momento.

Il vincolo e' uno solo: il modulo deve essere completato **prima del lancio MVP (Phase 4)**. Il timing ottimale suggerito e' dopo il Loop 1 (quando hai la WTP disponibile e puoi costruire il pricing in modo credibile) e prima del Loop 3 (perche' la landing page deve riflettere il pricing validato).

## 7. Come L1 e L2 si parlano

L1 e L2 non sono prodotti separati che coesistono. Sono due layer dello stesso sistema con un flusso di dati bidirezionale.

**L1 alimenta L2 (Feed in):** i dati dei watcher (competitor moves, trend di mercato, nuovi brevetti, evoluzioni tech) vengono iniettati come contesto nei prompt delle skill L2. Quando il founder fa market research in Phase 1, l'agente ha gia' i segnali degli ultimi 7 giorni disponibili.

**L2 alimenta L1 (Feed out):** ogni artefatto prodotto in L2 (Lean Canvas, ICP, BM, PSF evidence, landing page data) viene persistito nel Knowledge Graph di L1. I watcher vengono ricalibrati automaticamente se ICP o mercato cambiano a seguito di un Loop. Il Knowledge Graph cresce ad ogni iterazione.

In pratica: un founder che usa L2 trova L1 sempre piu' utile nel tempo, perche' i watcher diventano via via piu' contestualizzati sulla sua specifica startup. E L2 diventa piu' preciso perche' ha piu' contesto disponibile. **Il flywheel e' questo.**

## 8. I tre principi di design: cosa implicano in pratica

### AI-assisted, Founder-first

Significa che il sistema non puo' bloccare il founder. Puo' segnalare, raccomandare, forzare un verdict — ma il founder puo' sempre attivare un loop manualmente, ignorare un trigger automatico (con nota registrata), o scegliere di procedere contro la raccomandazione del sistema.

L'implicazione tecnica e' che ogni loop ha due path di attivazione: automatica (trigger obiettivo) e manuale (founder override). Entrambe devono essere supportate.

### Scope chirurgico

Significa che il sistema deve essere in grado di mappare ogni segnale negativo agli step specifici che lo hanno prodotto. Non e' sufficiente dire "il Loop 1 e' fallito" — il sistema deve dire "il problema e' l'ICP, non il problem statement, quindi si rivede l'ICP e si rilanciano le interviste su un nuovo segmento".

L'implicazione tecnica e' che ogni artefatto prodotto in L2 ha un tag che lo collega allo step che lo ha generato e al loop che eventualmente lo ha invalidato. La revisione e' sempre delta, non reset.

### Escalation cap

Significa che il sistema non puo' lasciare un founder in loop per sempre. Dopo il numero massimo di iterazioni definito per ogni loop, il sistema forza un verdict e lo documenta con evidenza.

L'implicazione tecnica e' che ogni loop ha un contatore di iterazioni persistito e una logica di verdict generation automatica al raggiungimento del cap. Il verdict non e' una frase generica — e' un documento strutturato (Evidence Matrix o Pivot Readiness Brief) che sintetizza tutto cio' che e' stato appreso nelle iterazioni precedenti.

---

*SenseFound — Walkthrough concettuale L2 Iteration Cycle v2.0 — Companion al documento di specifica*
