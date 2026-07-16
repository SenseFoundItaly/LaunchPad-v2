/**
 * /demo — static mock data for the vision demo. DEMO PURPOSES ONLY.
 *
 * MatchLens is the house example project (same startup used by every
 * e2e-loop1-* script: AI video analysis for amateur sports clubs, competitors
 * Veo/Pixellot/Trace, TAM €40M/SAM €16M, the weak-WTP Loop-1 story). Here it
 * is extended FORWARD through the parts of the L2 vision that are not built
 * yet (Loops 2-4, growth engine, build hub) so the page shows the full
 * end-state a founder reaches after ~9 months on the platform.
 *
 * Everything on this page is hardcoded — no API calls, no DB reads. The
 * numbers below are the product-vision "what success looks like" defaults;
 * tune them freely, nothing else depends on them.
 */

export const PROJECT = {
  name: 'MatchLens',
  tagline: 'Analisi video AI per club sportivi dilettantistici',
  stagePill: 'Operate · attivo',
  irl: 'IRL 7/7',
  age: '9 mesi',
};

export const HEADLINE_METRICS = [
  { label: 'Project Score', value: '87/100', delta: '+6 vs Loop 4', spark: [52, 58, 55, 63, 61, 70, 74, 79, 83, 87], kind: 'ok' as const },
  { label: 'MRR', value: '€4.2k', delta: '+18% m/m', spark: [0, 0, 0, 0.3, 0.8, 1.4, 2.1, 2.9, 3.6, 4.2], kind: 'ok' as const },
  { label: 'Club attivi', value: '38', delta: '+7 questo mese', spark: [0, 0, 2, 5, 9, 14, 21, 27, 33, 38], kind: 'ok' as const },
  { label: 'Runway', value: '14 mesi', delta: 'pre-seed €350k', spark: [], kind: 'n' as const },
];

// The 7 canonical stages (labels verbatim from src/lib/journey/canonical.ts).
export const STAGES = [
  { n: 1, label: 'Idea Canvas', done: true },
  { n: 2, label: 'Validation Gate', done: true, expanded: true },
  { n: 3, label: 'Persona', done: true },
  { n: 4, label: 'Business Model', done: true },
  { n: 5, label: 'Build & Launch', done: true },
  { n: 6, label: 'Fundraise', done: true },
  { n: 7, label: 'Operate', done: false, active: true },
];

// Expanded evidence checks for the Validation Gate stage (1A ∥ 1B → 1C).
export const GATE_TRACKS = [
  {
    id: '1A',
    label: '1A · Mercato',
    checks: [
      { text: '3 competitor mappati', proof: 'Veo · Pixellot · Trace' },
      { text: 'Dimensione del mercato approvata', proof: 'TAM €40M · SAM €16M · SOM €2.4M' },
      { text: 'Differenziazione con evidenza', proof: '"A differenza di Veo siamo chiavi in mano"' },
    ],
  },
  {
    id: '1B',
    label: '1B · Tecnica',
    checks: [
      { text: 'Fattibilità tecnica', proof: 'computer vision possibile con gli strumenti di oggi' },
      { text: 'Dipendenze mappate', proof: 'fornitori camere + modelli di visione' },
      { text: 'Vincoli normativi', proof: 'GDPR per i minori ripresi — consenso federazione' },
    ],
  },
  {
    id: '1C',
    label: '1C · Problem-Solution Fit',
    checks: [
      { text: '14 interviste registrate', proof: 'pain: "perdono ore ogni settimana con la revisione video manuale"' },
      { text: 'Urgenza confermata', proof: '11/14 urgenza alta' },
      { text: 'Segnale WTP', proof: '63% disposti a pagare €79/mese (dopo Loop 1)' },
    ],
  },
];

// The validation-loop history — the vision centerpiece. Loop 1 is live in the
// product today; Loops 2-4 are the L2-walkthrough roadmap, mocked here.
export type Verdict = 'GO' | 'PIVOT' | 'STOP' | 'LAUNCH READY';

export const LOOPS: Array<{
  id: string;
  title: string;
  subtitle: string;
  trigger: string;
  verdict: Verdict;
  body: string[];
  evidenceMatrix?: Array<{ signal: string; before: string; after: string }>;
  live: boolean;
}> = [
  {
    id: 'loop1',
    title: 'Loop 1 · PSF Review',
    subtitle: 'attivazione automatica — mese 2',
    trigger: 'WTP 17% < soglia 30% dopo 6 interviste',
    verdict: 'GO',
    body: [
      'Iterazione 1 → PIVOT: ICP troppo ampio. Ristretto a club di calcio giovanile con budget federazione; value prop riscritta intorno al risparmio di tempo dell’allenatore.',
      'Iterazione 2 → GO: 8 nuove interviste sull’ICP ristretto, WTP salita al 63% a €79/mese. Fase 2 sbloccata.',
    ],
    evidenceMatrix: [
      { signal: 'WTP', before: '17% (1/6)', after: '63% (9/14)' },
      { signal: 'Interviste', before: '6', after: '14' },
      { signal: 'Prezzo dichiarato', before: '€50/mese', after: '€79/mese' },
      { signal: 'Urgenza alta', before: '3/6', after: '11/14' },
    ],
    live: true,
  },
  {
    id: 'loop2',
    title: 'Loop 2 · BM Stress Test',
    subtitle: 'attivazione automatica — mese 3',
    trigger: 'business model + pricing compilati',
    verdict: 'GO',
    body: [
      'LTV/CAC 3.2× (soglia 2×). Prezzo ancora €79/mese, ancorato alla WTP misurata in Loop 1 — nessuna micro-iterazione necessaria.',
      'Unit economics: CAC €180 via federazioni · LTV €580 · churn stimato 3.5%/mese.',
    ],
    live: false,
  },
  {
    id: 'loop3',
    title: 'Loop 3 · Market Response Review',
    subtitle: 'attivazione automatica — mese 5',
    trigger: 'landing page live da 14 giorni',
    verdict: 'GO',
    body: [
      'Conversione landing 6.8% su 2.4k visitatori (utenti warm via federazioni). Bounce 41%, tempo medio 2:10.',
      'Feedback auto-classificato: 9 superficiali (copy/UX, risolti) · 2 intermedi (positioning prezzo, aggiornato) · 0 profondi — nessuna riapertura di Loop 1.',
    ],
    live: false,
  },
  {
    id: 'loop4',
    title: 'Loop 4 · MVP Test Verdict',
    subtitle: 'verdetto finale del ciclo — mese 7',
    trigger: '30 giorni di test con utenti cold + warm',
    verdict: 'LAUNCH READY',
    body: [
      'Attivazione 74% · retention 7gg 58% · NPS post-uso 46 · WTP confermata (29 club paganti su 38 attivi).',
      'Nessun vincolo: go-to-market esteso oltre le federazioni pilota.',
    ],
    live: false,
  },
];

// Modulo Trasversale — financial & pitch assets, completed before Phase 4.
export const DATA_ROOM = [
  { name: 'Pitch deck', version: 'v3', meta: '12 slide · aggiornato 4 giorni fa', icon: 'file' as const },
  { name: 'One-pager', version: 'v2', meta: 'EN + IT', icon: 'file' as const },
  { name: 'Modello finanziario', version: 'v4', meta: 'runway 14 mesi · need €350k pre-seed', icon: 'fund' as const },
  { name: 'Evidence Matrix — Loop 1', version: 'v1', meta: 'allegata al verdetto GO', icon: 'layers' as const },
  { name: 'Interviste PSF (14)', version: '—', meta: 'trascrizioni + verbatim pain', icon: 'book' as const },
];
export const DATA_ROOM_FOOT = 'Data room condivisa con 2 investitori · ultimo accesso ieri';

// Growth engine — the W0-W5 launch pipeline (publish → campaigns → ads/social
// → measure → growth loops), fully wired: cron proposes, founder approves,
// executor sends, measure cron reads the results back.
export const GROWTH_FUNNEL = [
  { label: 'Visitatori 30gg', value: '2.4k', delta: '+12%', kind: 'ok' as const },
  { label: 'Signup', value: '164', delta: '6.8% conv.', kind: 'ok' as const },
  { label: 'Attivati', value: '121', delta: '74%', kind: 'ok' as const },
  { label: 'Email inviate', value: '1.2k', delta: 'open 41% · click 12%', kind: 'ok' as const },
];
export const GROWTH_ITEMS = [
  { week: 'W0', title: 'Landing pubblicata — matchlens.app', meta: 'deploy Netlify · form signup attivo, letto dal cron di misurazione', state: 'live', kind: 'ok' as const },
  { week: 'W1', title: 'Sequenza email "Onboarding club"', meta: '5 step via Resend · 3 inviati · step 4 proposto in Inbox', state: 'attiva', kind: 'ok' as const },
  { week: 'W2', title: 'Broadcast "Stagione primaverile"', meta: '412 destinatari · inviato dopo approvazione · 38 risposte', state: 'inviato', kind: 'ok' as const },
  { week: 'W3', title: 'Ads — Google CSV + Meta JSON', meta: '3 ad group esportati · €14 CPA misurato', state: 'attiva', kind: 'ok' as const },
  { week: 'W3', title: 'Social — 8 post programmati', meta: 'LinkedIn + Instagram via Ayrshare · calendario 2 settimane', state: 'in coda', kind: 'info' as const },
  { week: 'W4', title: 'Misurazione notturna', meta: 'cron legge i Forms → metrica signups aggiornata ogni notte', state: 'attiva', kind: 'ok' as const },
  { week: 'W5', title: 'Growth loop — referral allenatori', meta: 'dispatch per area · 1 club porta 0.4 club/mese', state: 'in test', kind: 'info' as const },
];

// Build hub — the MVP is built and iterated BY AGENTS (v0 + E2B drivers):
// watcher feedback → cron proposes an iteration → founder approves → the
// agent builds in sandbox → deploy → runtime monitored → next proposal.
export const BUILD_APP = {
  url: 'app.matchlens.it',
  meta: 'build #12 live · driver v0 + sandbox E2B · monitoraggio runtime attivo',
};
export const BUILD_ITERATIONS = [
  { n: 13, title: 'Highlights condivisibili su WhatsApp', meta: 'proposta dal watcher feedback allenatori · in attesa di approvazione', state: 'in Inbox', kind: 'warn' as const },
  { n: 12, title: 'Clip automatiche per allenamento', meta: 'da feedback Loop 4 · build in sandbox E2B · deploy 2 giorni fa', state: 'live', kind: 'ok' as const },
  { n: 11, title: 'Condivisione video con i genitori', meta: 'approvata → costruita dall’agente → deploy 9 giorni fa', state: 'live', kind: 'ok' as const },
  { n: 10, title: 'Tagging eventi in tempo reale', meta: 'proposta dal monitoraggio errori runtime', state: 'live', kind: 'ok' as const },
];

// Agent activity — the last 48h of the machine working on its own (cron,
// watchers, executors). Everything outbound went through founder approval.
export const ACTIVITY = [
  { when: 'oggi 06:00', what: 'Scansione watcher — 2 segnali competitor, 1 proposta in Inbox', type: 'cron' },
  { when: 'oggi 06:02', what: 'Misurazione — +9 signup dai Forms, metrica aggiornata', type: 'cron' },
  { when: 'oggi 06:05', what: 'Proposto invio step 4/5 della sequenza email (in Inbox)', type: 'proposta' },
  { when: 'ieri 18:40', what: 'Broadcast "Stagione primaverile" inviato — dopo la tua approvazione', type: 'eseguito' },
  { when: 'ieri 09:15', what: 'Proposta iterazione MVP #13 da feedback allenatori', type: 'proposta' },
  { when: 'lun 07:00', what: 'Monday Brief generato — 3 mosse consigliate per la settimana', type: 'cron' },
];

// Intelligence — watchers + ecosystem.
export const WATCHERS = [
  { title: 'Competitor — prodotto e pricing', meta: 'Veo · Pixellot · Trace · scansione settimanale', state: 'attivo' },
  { title: 'Normativa — GDPR minori', meta: 'garante privacy + linee guida federazioni', state: 'attivo' },
  { title: 'Feedback utenti — app store + email', meta: 'classificazione automatica su 3 livelli', state: 'attivo' },
];
export const INTEL_ALERT = {
  title: 'Veo lancia un piano entry a €89/mese',
  body: 'Sopra il nostro anchor di €79 — la differenziazione "chiavi in mano" regge. Proposta in Inbox: aggiornare la battlecard competitor.',
};
export const ECOSYSTEM = [
  { label: 'Competitor', count: 3 },
  { label: 'Personas', count: 2 },
  { label: 'Partner', count: 4 },
  { label: 'Investitori', count: 2 },
];

// Inbox preview — pending proposals awaiting founder approval.
export const INBOX = [
  { title: 'Approva campagna email — "Stagione primaverile"', lane: 'Approvazione', kind: 'live' as const },
  { title: 'Weekly metrics — report settimana 38 pronto', lane: 'Skill', kind: 'info' as const },
  { title: 'Alert competitor — piano entry Veo €89/mese', lane: 'Segnale', kind: 'warn' as const },
];

export const FOOTER_NOTE =
  'Questa è una demo statica della visione completa di LaunchPad su un progetto di esempio. ' +
  'In produzione: la spina a 7 stage con 35 controlli di evidenza, le 19 skill e il Loop 1 (PSF Review). ' +
  'In staging: Build Hub (agenti che iterano l’MVP) e Launch Pipeline (campagne, email, ads, misurazione). ' +
  'Loop 2-4 completano la roadmap. Naviga la barra a sinistra per esplorare tutte le pagine.';

// =============================================================================
// SCORE — Project Score + IRL (mirrors src/components/home/ScorePanel.tsx)
// =============================================================================

export const SCORE = {
  total: 87,
  band: 'forte',
  bandKind: 'ok' as const,
  dimensions: [
    { label: 'Problema & mercato', value: 92 },
    { label: 'Soluzione & prodotto', value: 88 },
    { label: 'Modello di business', value: 84 },
    { label: 'Trazione & metriche', value: 86 },
    { label: 'Team & execution', value: 83 },
  ],
  recommendation:
    'Trazione solida e unit economics sane. Prossima leva: allargare i canali oltre le federazioni per ridurre il rischio di concentrazione.',
  irl: { level: 7, of: 7, stage: 'Operate' },
};

// =============================================================================
// INBOX — Osservatori (watchers) + Da rivedere (pending proposals)
// mirrors actions/page.tsx + MonitorListPanel + action-lanes.ts
// =============================================================================

export const INBOX_SUBHEAD = {
  title: 'Applica all’intelligence del tuo progetto.',
  desc: 'Risultati degli osservatori e proposte di conoscenza. Applica o ignora — ogni elemento applicato finisce in Knowledge.',
};

export type InboxItem = {
  id: string;
  typeChip: string;
  title: string;
  brief: string;
  lane: string;
  laneKind: 'live' | 'info' | 'warn' | 'ok' | 'n';
  producer: string;
  age: string;
  applyLabel: string;
  detail: Array<{ label: string; value: string }>;
  adds: string;
};

export const INBOX_ITEMS: InboxItem[] = [
  {
    id: 'a1f3',
    typeChip: 'Segnale',
    title: 'Veo lancia un piano entry a €89/mese',
    brief: 'Nuovo listino sul sito di Veo: piano "Club" a €89/mese, sopra il nostro anchor di €79. La differenziazione "chiavi in mano" regge.',
    lane: 'Segnale',
    laneKind: 'live',
    producer: 'osservatore · competitor',
    age: '2 ore fa',
    applyLabel: 'Accetta nella knowledge',
    detail: [
      { label: 'Fonte', value: 'veo.co/pricing' },
      { label: 'Rilevato da', value: 'Osservatore competitor (settimanale)' },
      { label: 'Delta prezzo', value: '€89 vs nostro €79' },
      { label: 'Impatto', value: 'Aggiornare la battlecard competitor' },
    ],
    adds: 'Aggiunge un fatto "pricing competitor" al grafo Knowledge e aggiorna il profilo di Veo.',
  },
  {
    id: 'b7c2',
    typeChip: 'Analisi',
    title: 'Weekly metrics — report settimana 38 pronto',
    brief: 'La skill weekly-metrics ha compilato il report: MRR €4.2k (+18%), 38 club attivi (+7), churn 3.1%. Nessuna anomalia.',
    lane: 'Approvazione',
    laneKind: 'info',
    producer: 'skill · weekly-metrics',
    age: '5 ore fa',
    applyLabel: 'Applica alla knowledge',
    detail: [
      { label: 'Analisi', value: 'Weekly metrics' },
      { label: 'Cosa ottieni', value: 'Snapshot MRR/churn/attivazione della settimana' },
      { label: 'Durata', value: 'eseguita — pronta da applicare' },
    ],
    adds: 'Registra le metriche della settimana come fatti datati e aggiorna la sparkline sul dashboard.',
  },
  {
    id: 'c9d4',
    typeChip: 'Bozza email',
    title: 'Approva invio — step 4/5 sequenza "Onboarding club"',
    brief: 'Il cron di campagna propone l’invio del 4° step ai 38 club onboardati. Oggetto: "3 clip che i tuoi allenatori adoreranno".',
    lane: 'Approvazione',
    laneKind: 'warn',
    producer: 'cron · campagne',
    age: '6 ore fa',
    applyLabel: 'Approva invio',
    detail: [
      { label: 'Campagna', value: 'Onboarding club (5 step)' },
      { label: 'Destinatari', value: '38 club attivi' },
      { label: 'Canale', value: 'Resend' },
      { label: 'Oggetto', value: '3 clip che i tuoi allenatori adoreranno' },
    ],
    adds: 'Invia lo step 4 via Resend e registra il risultato per il cron di misurazione.',
  },
  {
    id: 'd2e8',
    typeChip: 'Nuovo osservatore',
    title: 'Proponi osservatore — normativa AI Act sport',
    brief: 'Dopo il segnale GDPR minori, il sistema propone un osservatore sull’AI Act applicato alle riprese sportive giovanili.',
    lane: 'Approvazione',
    laneKind: 'info',
    producer: 'correlatore',
    age: 'ieri',
    applyLabel: 'Applica',
    detail: [
      { label: 'Titolo', value: 'AI Act — riprese sportive minori' },
      { label: 'Tipo', value: 'Argomento' },
      { label: 'Pianificazione', value: 'Settimanale' },
      { label: 'Avvisa quando', value: 'nuove linee guida o obblighi di consenso' },
    ],
    adds: 'Crea un osservatore attivo che alimenta la knowledge con segnali normativi.',
  },
];

export type Watcher = {
  name: string;
  kind: 'URL' | 'Argomento';
  status: string;
  statusKind: 'ok' | 'n' | 'live' | 'warn';
  cadence: string;
  lastRun: string;
  whatChecks: string;
  sources: string[];
  alertsWhen: string;
  lastVerdict: string;
  alerts: number;
};

export const WATCHERS_FULL: Watcher[] = [
  {
    name: 'Competitor — prodotto e pricing',
    kind: 'URL',
    status: 'attivo',
    statusKind: 'ok',
    cadence: 'settimanale',
    lastRun: '2 ore fa',
    whatChecks: 'Listini e note di rilascio di Veo, Pixellot e Trace.',
    sources: ['veo.co/pricing', 'pixellot.tv', 'traceup.com'],
    alertsWhen: 'un competitor cambia prezzo o lancia un piano nuovo',
    lastVerdict: '1 segnale: Veo piano entry €89/mese',
    alerts: 1,
  },
  {
    name: 'Normativa — GDPR minori',
    kind: 'Argomento',
    status: 'attivo',
    statusKind: 'ok',
    cadence: 'settimanale',
    lastRun: 'ieri',
    whatChecks: 'Provvedimenti del Garante privacy e linee guida delle federazioni sulle riprese di minori.',
    sources: ['garanteprivacy.it', 'figc.it'],
    alertsWhen: 'nuovi obblighi di consenso o restrizioni sulle riprese',
    lastVerdict: 'nessun nuovo segnale',
    alerts: 0,
  },
  {
    name: 'Feedback utenti — app store + email',
    kind: 'Argomento',
    status: 'attivo',
    statusKind: 'ok',
    cadence: 'giornaliera',
    lastRun: '3 ore fa',
    whatChecks: 'Recensioni store e risposte email, classificate su 3 livelli (superficiale/intermedio/profondo).',
    sources: ['App Store', 'Google Play', 'support inbox'],
    alertsWhen: 'un cluster di feedback profondo mette in discussione l’ICP',
    lastVerdict: '2 feedback intermedi → iterazione MVP #13 proposta',
    alerts: 2,
  },
];

// =============================================================================
// KNOWLEDGE — competitor matryoshka + knowledge list + moves + data room
// mirrors AllKnowledgePanel / CompetitorMatryoshka / RecentMovesFeed
// =============================================================================

export const KNOWLEDGE_SUMMARY = {
  total: 24,
  kinds: [
    { label: 'entità', count: 5 },
    { label: 'concorrenti', count: 3 },
    { label: 'fatti', count: 8 },
    { label: 'segnali', count: 4 },
    { label: 'brief', count: 2 },
    { label: 'interviste', count: 2 },
  ],
  provenance: [
    { label: 'dichiarato dal founder', kind: 'n' as const },
    { label: 'derivato', kind: 'info' as const },
    { label: 'verificato', kind: 'ok' as const },
  ],
};

export type KnowledgeRow = { title: string; summary: string; prov: 'founder' | 'derived' | 'verified'; age: string };
export const KNOWLEDGE_GROUPS: Array<{ kind: string; label: string; edge: string; rows: KnowledgeRow[] }> = [
  {
    kind: 'competitor', label: 'Concorrenti', edge: 'var(--clay)',
    rows: [
      { title: 'Veo', summary: 'Camera AI per riprese sportive. Forte nel calcio, modello a noleccio hardware + abbonamento. Piano entry €89/mese (nuovo).', prov: 'verified', age: '2 ore fa' },
      { title: 'Pixellot', summary: 'Sistema di produzione automatizzata, orientato a broadcaster e club professionistici. Prezzo alto.', prov: 'verified', age: '5 giorni fa' },
      { title: 'Trace', summary: 'Focalizzato su USA e calcio giovanile. Hardware proprietario, community forte.', prov: 'derived', age: '5 giorni fa' },
    ],
  },
  {
    kind: 'fact', label: 'Fatti', edge: 'var(--moss)',
    rows: [
      { title: 'TAM €40M · SAM €16M · SOM €2.4M', summary: 'Dimensionamento del mercato dei club dilettantistici EU, approvato dal founder in Validation Gate.', prov: 'verified', age: '3 mesi fa' },
      { title: 'WTP 63% a €79/mese', summary: '9 club su 14 disposti a pagare €79/mese dopo la ristrutturazione dell’ICP in Loop 1.', prov: 'verified', age: '2 mesi fa' },
      { title: 'LTV/CAC 3.2×', summary: 'CAC €180 via federazioni, LTV €580, churn 3.5%/mese. Confermato in Loop 2.', prov: 'derived', age: '1 mese fa' },
      { title: 'GDPR minori — consenso federazione', summary: 'Le riprese di minori richiedono consenso raccolto tramite la federazione, non il singolo club.', prov: 'verified', age: '3 mesi fa' },
    ],
  },
  {
    kind: 'signal', label: 'Segnali', edge: 'var(--cat-gold)',
    rows: [
      { title: 'Veo piano entry €89/mese', summary: 'Nuovo listino competitor sopra il nostro anchor. In attesa di applicazione in Inbox.', prov: 'derived', age: '2 ore fa' },
      { title: 'Feedback: condivisione con i genitori', summary: 'Cluster di richieste per condividere le clip con le famiglie → iterazione MVP #11.', prov: 'derived', age: '10 giorni fa' },
    ],
  },
  {
    kind: 'interview', label: 'Interviste', edge: 'var(--cat-teal)',
    rows: [
      { title: 'Allenatore U15 — ASD Rivoli', summary: 'Pain: "perdo ore ogni settimana a tagliare i video a mano". Urgenza alta. WTP €79/mese.', prov: 'founder', age: '2 mesi fa' },
      { title: 'Direttore sportivo — Pol. Chieri', summary: 'Interessato al budget federazione. Vuole condivisione con le famiglie e clip per allenamento.', prov: 'founder', age: '2 mesi fa' },
    ],
  },
];

export const COMPETITORS_MATRYOSHKA = [
  {
    name: 'Veo', categories: [
      { label: 'Prodotto', detail: 'Camera AI 180°, tracking automatico del pallone, editing cloud.' },
      { label: 'Prezzo', detail: 'Noleggio camera + abbonamento. Nuovo piano entry €89/mese.' },
      { label: 'Distribuzione', detail: 'Vendita diretta + partnership con federazioni nazionali.' },
      { label: 'Vantaggio competitivo', detail: 'Brand consolidato, ampia base installata nel calcio.' },
    ],
  },
  {
    name: 'Pixellot', categories: [
      { label: 'Prodotto', detail: 'Produzione broadcast automatizzata multi-sport.' },
      { label: 'Prezzo', detail: 'Enterprise, contratti annuali con club professionistici.' },
    ],
  },
  {
    name: 'Trace', categories: [
      { label: 'Prodotto', detail: 'Hardware proprietario + app per il calcio giovanile.' },
      { label: 'Distribuzione', detail: 'Forte penetrazione USA, community di allenatori.' },
    ],
  },
];

export const MOVES = [
  { type: 'competitor', name: 'Veo', date: '2 ore fa', headline: 'Ha lanciato un piano entry a €89/mese', host: 'veo.co' },
  { type: 'fact', name: 'Metriche settimana 38', date: '5 ore fa', headline: 'MRR €4.2k (+18%), 38 club attivi', host: 'weekly-metrics' },
  { type: 'signal', name: 'Feedback allenatori', date: 'ieri', headline: '2 richieste di highlights su WhatsApp → iterazione #13', host: 'app store' },
  { type: 'interview', name: 'ASD Rivoli', date: '3 giorni fa', headline: 'Nuova intervista PSF caricata e digerita', host: 'data room' },
];

// =============================================================================
// FINANCIAL — deterministic 36-month projection (mirrors FinancialModelPanel)
// =============================================================================

const FIN_START_CASH = 350000, FIN_OPEX = 24000, FIN_ARPU = 79, FIN_MARGIN = 0.82, FIN_CHURN = 0.035, FIN_GROWTH = 1.11;

export const FIN_ASSUMPTIONS = [
  { label: 'Cassa iniziale (€)', value: '350.000' },
  { label: 'Opex mensile (€/mese)', value: '24.000' },
  { label: 'ARPU (€/mese)', value: '79' },
  { label: 'Margine lordo (%)', value: '82' },
  { label: 'Club iniziali', value: '38' },
  { label: 'Nuovi club/mese (mese 1)', value: '7' },
  { label: 'Crescita acquisizione (%/mese)', value: '11' },
  { label: 'Churn mensile (%)', value: '3,5' },
  { label: 'Orizzonte (mesi)', value: '36' },
];

type MonthRow = {
  mo: number; add: number; churn: number; customers: number; mrr: number;
  revenue: number; cogs: number; opex: number; netBurn: number; cash: number; runway: string;
};
type Scenario = { label: string; arr: string; breakeven: string; peakCash: string; endCash: string; endCustomers: string };

function eurK(n: number): string {
  const abs = Math.abs(n);
  return abs >= 1_000_000 ? `€${(abs / 1_000_000).toFixed(1)}M` : `€${Math.round(abs / 1000)}k`;
}

// One deterministic run of the model. Returns the monthly rows plus a base
// scenario summary DERIVED from those rows, so the table and the summary
// card can never disagree.
function computeProjection(): { rows: MonthRow[]; base: Scenario } {
  let customers = 38, cash = FIN_START_CASH, adds = 7;
  const rows: MonthRow[] = [];
  let minCash = cash, breakeven = 0;
  for (let mo = 1; mo <= 36; mo++) {
    const churned = Math.round(customers * FIN_CHURN);
    customers = customers - churned + adds;
    const mrr = Math.round(customers * FIN_ARPU);
    const revenue = mrr;
    const cogs = Math.round(revenue * (1 - FIN_MARGIN));
    const netBurn = FIN_OPEX + cogs - revenue; // positive = burning
    cash = cash - netBurn;
    if (netBurn <= 0 && !breakeven) breakeven = mo;
    if (cash < minCash) minCash = cash;
    const runway = netBurn > 0 && cash > 0 ? `${Math.max(0, Math.round(cash / netBurn))}mo` : netBurn <= 0 ? '∞' : '0mo';
    rows.push({ mo, add: adds, churn: churned, customers, mrr, revenue, cogs, opex: FIN_OPEX, netBurn, cash, runway });
    adds = Math.round(adds * FIN_GROWTH);
  }
  const last = rows[rows.length - 1];
  const base: Scenario = {
    label: 'Base',
    arr: eurK(last.mrr * 12),
    breakeven: breakeven ? `mese ${breakeven}` : 'oltre l’orizzonte',
    peakCash: eurK(FIN_START_CASH - minCash),
    endCash: eurK(last.cash),
    endCustomers: `${last.customers}`,
  };
  return { rows, base };
}

const PROJECTION = computeProjection();

// Optimistic / conservative are illustrative multiples of the derived base.
export const FIN_SCENARIOS: Scenario[] = [
  PROJECTION.base,
  { label: 'Ottimistico', arr: '€1.2M', breakeven: 'mese 12', peakCash: '€120k', endCash: '€2.4M', endCustomers: '790' },
  { label: 'Conservativo', arr: '€520k', breakeven: 'mese 21', peakCash: '€260k', endCash: '€640k', endCustomers: '340' },
];

export const FIN_MONTHLY = PROJECTION.rows.slice(0, 24);

// =============================================================================
// CO-PILOT — scripted chat + canvas + build tab + growth tab
// mirrors chat/page.tsx, Canvas, BuildHub, LaunchPanel (staging)
// =============================================================================

export type ChatMsg =
  | { role: 'user'; body: string }
  | { role: 'ai'; agent: string; body: string; tools?: string[] };

export const CHAT_MESSAGES: ChatMsg[] = [
  { role: 'ai', agent: 'CH', body: 'Bentornato. Loop 4 ha dato **LAUNCH READY** — attivazione 74%, retention 58%, WTP confermata. Il go-to-market è aperto oltre le federazioni pilota. Vuoi che prepari il prossimo esperimento di crescita?' },
  { role: 'user', body: 'Sì, e intanto guarda il feedback degli allenatori dell’ultima settimana.' },
  { role: 'ai', agent: 'AN', body: 'Ho classificato 11 feedback: 9 superficiali, 2 intermedi. I due intermedi convergono su una richiesta: **condividere gli highlights su WhatsApp**. L’ho proposto come iterazione MVP #13 nel tab Build.', tools: ['read-feedback', 'classify'] },
  { role: 'ai', agent: 'BU', body: 'Nel tab **Build & Launch** trovi la build #12 live su app.matchlens.it. L’iterazione #13 è pronta da approvare: appena la confermi la costruisco in sandbox e la vedi in anteprima qui.' },
  { role: 'user', body: 'Perfetto. E la sequenza email di onboarding a che punto è?' },
  { role: 'ai', agent: 'MK', body: 'Sequenza "Onboarding club": 3 step inviati, step 4 proposto nel tuo Inbox (parte dopo la tua approvazione). Open 41%, click 12%. Nel tab **Growth** vedi tutte le campagne e i growth loop attivi.', tools: ['campaigns'] },
];

export const AGENT_META: Record<string, { name: string; color: string }> = {
  CH: { name: 'Chief', color: 'var(--sky)' },
  AN: { name: 'Analyst', color: 'var(--cat-teal)' },
  BU: { name: 'Builder', color: 'var(--accent)' },
  MK: { name: 'Marketer', color: 'var(--cat-gold)' },
};

export const CANVAS_FIELDS = [
  { label: 'Problema', value: 'I club dilettantistici perdono ore ogni settimana con la revisione video manuale e non possono permettersi strumenti pro.' },
  { label: 'Soluzione', value: 'Telecamere AI chiavi in mano che registrano, taggano e montano le clip automaticamente.' },
  { label: 'Mercato target', value: 'Club di calcio giovanile con budget federazione (ICP ristretto dopo Loop 1).' },
  { label: 'Value proposition', value: 'Analisi pro a prezzo amatoriale — €79/mese, zero montaggio manuale.' },
  { label: 'Modello di business', value: 'SaaS mensile per club, acquisizione via federazioni regionali.' },
];

export const CANVAS_DEPTS: Array<{ dept: string; artifacts: Array<{ title: string; kind: string }> }> = [
  { dept: 'Mercato', artifacts: [
    { title: 'Market sizing (TAM/SAM/SOM)', kind: 'ricerca' },
    { title: 'Battlecard Veo / Pixellot / Trace', kind: 'analisi' },
    { title: 'Interviste PSF (14)', kind: 'evidenza' },
  ] },
  { dept: 'Prodotto', artifacts: [
    { title: 'Spec MVP — build #12', kind: 'prototipo' },
    { title: 'Roadmap iterazioni #10-13', kind: 'piano' },
  ] },
  { dept: 'Prezzi', artifacts: [
    { title: 'Anchor €79 + 2 tier', kind: 'pricing' },
    { title: 'WTP research (63%)', kind: 'evidenza' },
  ] },
  { dept: 'Finanza', artifacts: [
    { title: 'Modello finanziario v4', kind: 'modello' },
    { title: 'Runway 14 mesi · need €350k', kind: 'fatto' },
  ] },
  { dept: 'Crescita', artifacts: [
    { title: 'Launch pipeline W0-W5', kind: 'piano' },
    { title: 'Growth loop referral', kind: 'esperimento' },
  ] },
];

// Build tab — current build + iteration thread (mirrors CurrentBuildCard/IterationTimeline)
export const BUILD_CURRENT = {
  iteration: 12,
  status: 'live',
  statusKind: 'ok' as const,
  liveUrl: 'app.matchlens.it',
  changes: [
    { path: 'src/routines/AutoClips.tsx', change: 'nuovo' },
    { path: 'src/lib/highlights.ts', change: 'modificato' },
    { path: 'src/components/ClipCard.tsx', change: 'modificato' },
  ],
};
export const BUILD_THREAD = [
  { n: 1, label: 'Build iniziale — dashboard club + upload video', status: 'live' },
  { n: 10, label: 'Tagging eventi in tempo reale', status: 'live' },
  { n: 11, label: 'Condivisione video con i genitori', status: 'live' },
  { n: 12, label: 'Clip automatiche per allenamento', status: 'live' },
  { n: 13, label: 'Highlights condivisibili su WhatsApp', status: 'proposto' },
];

// Growth tab — LaunchPanel shape: assets, campaigns, loops
export const LAUNCH_ASSETS = [
  { title: 'Landing — MatchLens per club', signups: 164, watched: true, publisher: 'netlify', live: true },
  { title: 'Pagina pricing €79/mese', signups: 0, watched: false, publisher: 'netlify', live: true },
];
export const LAUNCH_CAMPAIGNS = [
  { kind: 'email', title: 'Onboarding club', sent: 3, total: 5, status: 'attiva', statusKind: 'ok' as const, action: 'Pausa' },
  { kind: 'email', title: 'Stagione primaverile (broadcast)', sent: 412, total: 412, status: 'inviato', statusKind: 'ok' as const, action: null },
  { kind: 'social', title: 'Calendario LinkedIn + Instagram', sent: 4, total: 8, status: 'attiva', statusKind: 'ok' as const, action: 'Pausa' },
  { kind: 'ads', title: 'Pack Google + Meta', sent: 0, total: 3, status: 'bozza', statusKind: 'n' as const, action: 'Attiva' },
];
export const LAUNCH_LOOPS = [
  { metric: 'Conversione landing', from: '4,1%', to: '6,8%', status: 'attiva', statusKind: 'ok' as const },
  { metric: 'Referral allenatori', from: '0,2', to: '0,4 club/club', status: 'attiva', statusKind: 'ok' as const },
  { metric: 'Attivazione onboarding', from: '61%', to: '74%', status: 'completata', statusKind: 'n' as const },
];
