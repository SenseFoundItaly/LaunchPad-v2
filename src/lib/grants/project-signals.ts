/**
 * Project → grant signals, derived with ZERO model calls.
 *
 * Everything the founder has already written while validating with the Co-pilot
 * (project description, Idea Canvas) is matched against the SAME controlled
 * vocabulary incentivi.gov.it tags its calls with. That vocabulary is the whole
 * reason this can be deterministic: `scopes`, `subject_types` and region names
 * are closed sets, measured live on 2026-09-02 over the 1,199 open calls, so
 * matching is a dictionary lookup rather than a judgement.
 *
 * Pure and synchronous: same text in, same signals out, no I/O, no network.
 */

import { ITALIAN_REGIONS } from './view';

export interface ProjectSignals {
  /** Regions inferred from place names in the founder's own words. */
  regions: string[];
  /** incentivi `scopes` the project's text maps onto. */
  scopes: string[];
  /** incentivi `subject_types` the venture plausibly is. */
  subjectTypes: string[];
  /** Content words for the text-overlap term, already normalised. */
  terms: string[];
  /** False when there was too little text to say anything — callers must not rank on noise. */
  usable: boolean;
}

/** Lowercase, strip accents, collapse punctuation to single spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Places → region. Cities are what founders actually write ("uffici a Milano"),
 * region names almost never. Only unambiguous, reasonably large places: a wrong
 * region is worse than no region, because region is the strongest ranking term.
 */
const PLACES: Record<string, string> = {
  milano: 'Lombardia', bergamo: 'Lombardia', brescia: 'Lombardia', monza: 'Lombardia',
  como: 'Lombardia', pavia: 'Lombardia', varese: 'Lombardia', mantova: 'Lombardia',
  cremona: 'Lombardia', lecco: 'Lombardia', lodi: 'Lombardia', sondrio: 'Lombardia',
  torino: 'Piemonte', novara: 'Piemonte', cuneo: 'Piemonte', asti: 'Piemonte', alessandria: 'Piemonte',
  genova: 'Liguria', savona: 'Liguria', imperia: 'Liguria', spezia: 'Liguria',
  venezia: 'Veneto', verona: 'Veneto', padova: 'Veneto', vicenza: 'Veneto', treviso: 'Veneto',
  rovigo: 'Veneto', belluno: 'Veneto',
  trieste: 'Friuli-Venezia Giulia', udine: 'Friuli-Venezia Giulia', pordenone: 'Friuli-Venezia Giulia',
  gorizia: 'Friuli-Venezia Giulia',
  trento: 'Trentino-Alto Adige/Südtirol', bolzano: 'Trentino-Alto Adige/Südtirol',
  bologna: 'Emilia-Romagna', modena: 'Emilia-Romagna', parma: 'Emilia-Romagna',
  reggio_emilia: 'Emilia-Romagna', ferrara: 'Emilia-Romagna', ravenna: 'Emilia-Romagna',
  rimini: 'Emilia-Romagna', forli: 'Emilia-Romagna', cesena: 'Emilia-Romagna', piacenza: 'Emilia-Romagna',
  firenze: 'Toscana', pisa: 'Toscana', siena: 'Toscana', livorno: 'Toscana', lucca: 'Toscana',
  arezzo: 'Toscana', prato: 'Toscana', grosseto: 'Toscana', pistoia: 'Toscana',
  perugia: 'Umbria', terni: 'Umbria',
  ancona: 'Marche', pesaro: 'Marche', macerata: 'Marche', ascoli: 'Marche',
  roma: 'Lazio', latina: 'Lazio', frosinone: 'Lazio', viterbo: 'Lazio', rieti: 'Lazio',
  laquila: 'Abruzzo', pescara: 'Abruzzo', chieti: 'Abruzzo', teramo: 'Abruzzo',
  campobasso: 'Molise', isernia: 'Molise',
  napoli: 'Campania', salerno: 'Campania', caserta: 'Campania', avellino: 'Campania', benevento: 'Campania',
  bari: 'Puglia', lecce: 'Puglia', taranto: 'Puglia', foggia: 'Puglia', brindisi: 'Puglia', andria: 'Puglia',
  potenza: 'Basilicata', matera: 'Basilicata',
  catanzaro: 'Calabria', cosenza: 'Calabria', crotone: 'Calabria', vibo: 'Calabria',
  palermo: 'Sicilia', catania: 'Sicilia', messina: 'Sicilia', siracusa: 'Sicilia', trapani: 'Sicilia',
  agrigento: 'Sicilia', ragusa: 'Sicilia', caltanissetta: 'Sicilia', enna: 'Sicilia',
  cagliari: 'Sardegna', sassari: 'Sardegna', nuoro: 'Sardegna', oristano: 'Sardegna',
  aosta: "Valle d'Aosta/Vallée d'Aoste",
};

/**
 * incentivi `scopes` → the words founders use for them, Italian and English.
 * Terms are matched on normalised word boundaries, so short ones must be safe
 * as whole words ('ai' and 'iot' are deliberately absent — too many false hits).
 */
const SCOPE_TERMS: Record<string, string[]> = {
  Digitalizzazione: [
    'saas', 'software', 'piattaforma', 'platform', 'app', 'digitale', 'digital', 'cloud',
    'automatico', 'automatici', 'automazione', 'dati', 'data', 'algoritmo', 'intelligenza artificiale',
    'machine learning', 'gestionale', 'gestionali', 'web', 'marketplace', 'ecommerce', 'api',
  ],
  'Innovazione e ricerca': [
    'innovazione', 'innovativa', 'innovativo', 'ricerca', 'research', 'brevetto', 'brevetti',
    'patent', 'prototipo', 'prototype', 'sperimentazione', 'laboratorio', 'deep tech', 'r&s',
  ],
  'Transizione ecologica': [
    'sostenibile', 'sostenibilita', 'green', 'carbon', 'co2', 'emissioni', 'esg', 'csrd',
    'ambientale', 'ambiente', 'energia', 'rinnovabile', 'rinnovabili', 'circolare', 'riciclo',
    'efficienza energetica', 'climate',
  ],
  Internazionalizzazione: [
    'export', 'esportazione', 'internazionale', 'internazionalizzazione', 'estero', 'global',
    'mercati esteri', 'cross border',
  ],
  "Start up/Sviluppo d'impresa": [
    'startup', 'start up', 'nuova impresa', 'scaleup', 'scale up', 'mvp', 'lancio', 'fondatori',
    'founder', 'crescita', 'go to market',
  ],
  'Inclusione sociale': [
    'inclusione', 'sociale', 'disabilita', 'volontariato', 'terzo settore', 'non profit',
    'no profit', 'comunita', 'welfare', 'fragili',
  ],
  'Imprenditoria femminile': ['femminile', 'donne', 'women', 'imprenditrice', 'imprenditrici'],
  'Imprenditoria giovanile': ['giovani', 'giovanile', 'under 35', 'youth', 'studenti'],
  'Sostegno investimenti': [
    'macchinari', 'impianto', 'impianti', 'attrezzature', 'capex', 'investimento', 'investimenti',
    'stabilimento', 'produzione',
  ],
  'Sostegno liquidita': ['liquidita', 'capitale circolante', 'cash flow', 'circolante'],
  Formazione: ['formazione', 'training', 'corsi', 'apprendistato', 'riqualificazione', 'competenze'],
};

/** Words that say what KIND of applicant this is. */
const SUBJECT_TERMS: Record<string, string[]> = {
  'Impresa - SU/PMI innovativa': ['startup innovativa', 'pmi innovativa', 'deep tech', 'brevetto', 'spin off'],
  Impresa: ['impresa', 'azienda', 'societa', 'srl', 'spa', 'pmi', 'business', 'company'],
  'Cooperative/Associazioni Non Profit': [
    'cooperativa', 'associazione', 'non profit', 'no profit', 'terzo settore', 'aps', 'onlus', 'ets',
  ],
  Professionista: ['freelance', 'professionista', 'partita iva', 'studio professionale'],
  'Università/Ente di Ricerca': ['universita', 'ateneo', 'ente di ricerca', 'spin off universitario'],
  'Impresa - prevalenza femminile': ['imprenditoria femminile', 'fondatrice', 'fondatrici', 'women led'],
  'Impresa - prevalenza giovanile': ['under 35', 'giovani imprenditori', 'imprenditoria giovanile'],
};

const STOPWORDS = new Set(
  ('il lo la i gli le un uno una di a da in con su per tra fra e o ma se che chi cui non piu quale quali '
    + 'come dove quando anche solo gia ancora molto poco tutto tutti ogni al del della dei delle nel nella '
    + 'sul sulla dal dalla the a an of to for and or in on with by is are be this that it as at from we our '
    + 'you your their its can will has have was were been')
    .split(' '),
);

/** Whole-word presence of a possibly multi-word term inside normalised text. */
function hasTerm(haystack: string, term: string): boolean {
  const t = normalize(term);
  if (!t) return false;
  return haystack.includes(` ${t} `);
}

export interface ProjectProfileInput {
  name?: string | null;
  description?: string | null;
  /** Idea Canvas fields, in whatever state the founder has left them. */
  canvas?: {
    problem?: string | null;
    solution?: string | null;
    target_market?: string | null;
    business_model?: string | null;
    value_proposition?: string | null;
    competitive_advantage?: string | null;
    channels?: string | null;
  } | null;
  /** Pipeline position; step 1-2 reads as "company probably not formed yet". */
  current_step?: number | null;
}

/** Minimum content words before ranking is meaningful rather than noise. */
export const MIN_TERMS_FOR_RANKING = 6;

export function extractProjectSignals(input: ProjectProfileInput): ProjectSignals {
  const c = input.canvas ?? {};
  const raw = [
    input.name, input.description,
    c.problem, c.solution, c.target_market, c.business_model,
    c.value_proposition, c.competitive_advantage, c.channels,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' . ');

  // Pad with spaces so ` term ` boundary matching works at both ends.
  const text = ` ${normalize(raw)} `;

  const regions = new Set<string>();
  for (const [place, region] of Object.entries(PLACES)) {
    if (hasTerm(text, place.replace(/_/g, ' '))) regions.add(region);
  }
  for (const region of ITALIAN_REGIONS) {
    // Region names are multi-part ("Emilia-Romagna"); match the first token too,
    // but only when it is distinctive enough to stand alone.
    if (hasTerm(text, region)) regions.add(region);
    const head = region.split(/[-/\s]/)[0];
    if (head.length >= 6 && hasTerm(text, head)) regions.add(region);
  }

  const scopes = Object.entries(SCOPE_TERMS)
    .filter(([, terms]) => terms.some((t) => hasTerm(text, t)))
    .map(([scope]) => scope);

  const subjectTypes = Object.entries(SUBJECT_TERMS)
    .filter(([, terms]) => terms.some((t) => hasTerm(text, t)))
    .map(([subject]) => subject);

  // NOT inferred: "company not formed yet" from the pipeline step. It fired for
  // every early project, matched 42 calls, and measurably pushed noise to the
  // top on the first live run. A guess that applies to everyone discriminates
  // nothing — this needs the founder to actually say so.

  const terms = [...new Set(text.split(' ').filter((w) => w.length > 3 && !STOPWORDS.has(w)))];

  return {
    regions: [...regions].sort(),
    scopes: scopes.sort(),
    subjectTypes: [...new Set(subjectTypes)].sort(),
    terms,
    usable: terms.length >= MIN_TERMS_FOR_RANKING,
  };
}
