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
  'Questa pagina è una demo statica della visione completa di LaunchPad su un progetto di esempio. ' +
  'In produzione: la spina a 7 stage con 35 controlli di evidenza, le 19 skill e il Loop 1 (PSF Review). ' +
  'In staging: Build Hub (agenti che iterano l’MVP) e Launch Pipeline (campagne, email, ads, misurazione). ' +
  'Loop 2-4 completano la roadmap.';
