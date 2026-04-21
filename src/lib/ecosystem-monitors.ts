/**
 * Ecosystem Intelligence Monitors — the Layer 1 autonomous scan engine.
 *
 * These four templates are seeded per-project and run on the weekly cron.
 * Each produces ecosystem_alerts (and often pending_actions) that feed the
 * Monday Brief.
 *
 * Kept independent of the LLM runtime (Pi Agent SDK vs. OpenClaw CLI) —
 * the cron route is responsible for invoking the agent with these prompts.
 */

import { createHash } from 'crypto';
import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';

export type EcosystemMonitorType =
  | 'ecosystem.competitors'
  | 'ecosystem.ip'
  | 'ecosystem.trends'
  | 'ecosystem.partnerships';

export interface EcosystemMonitorTemplate {
  type: EcosystemMonitorType;
  name: string;
  nameIt: string;
  schedule: 'daily' | 'weekly' | 'monthly' | 'manual';
  defaultConfig: Record<string, unknown>;
  buildPrompt: (ctx: MonitorPromptContext) => string;
}

export interface MonitorPromptContext {
  projectId: string;
  projectName: string;
  projectDescription: string | null;
  locale: 'en' | 'it';
  idea: {
    problem?: string;
    solution?: string;
    target_market?: string;
    value_proposition?: string;
  } | null;
  research: {
    competitors?: Array<{ name: string; description?: string }>;
    trends?: Array<{ title: string }>;
  } | null;
  knownCompetitors: string[];
  keywords: string[];
}

// =============================================================================
// Prompt templates (EN + IT)
// The prompt asks the agent to emit a :::artifact{type=ecosystem_alert json}
// block per finding, so the cron route can parse structured output into
// ecosystem_alerts rows. The free-text section feeds the Brief narrative.
// =============================================================================

const OUTPUT_INSTRUCTIONS_EN = `
OUTPUT CONTRACT — do not deviate:
1. Start with a 2-3 sentence narrative summary of what moved this week.
2. Then emit one :::artifact{type=ecosystem_alert} block per distinct finding.
   Each block MUST be valid JSON with these fields:
   - alert_type: one of "competitor_activity" | "ip_filing" | "trend_signal" | "partnership_opportunity" | "regulatory_change" | "funding_event"
   - headline: 1 line, <=120 chars
   - body: 2-4 sentences, factual
   - source_url: direct URL (not a search page)
   - relevance_score: float 0.0-1.0 — how relevant to THIS founder's problem/solution/ICP
   - confidence: float 0.0-1.0 — how confident you are in the finding
   - suggested_action: one of "draft_email" | "draft_linkedin_post" | "proposed_hypothesis" | "proposed_graph_update" | null
3. If nothing materially moved, say so explicitly and emit zero artifacts. Do not pad.
4. Never fabricate URLs. If you cannot verify, omit the finding.
`.trim();

const OUTPUT_INSTRUCTIONS_IT = `
CONTRATTO DI OUTPUT — non deviare:
1. Inizia con un riassunto narrativo di 2-3 frasi su cosa si è mosso questa settimana.
2. Poi emetti un blocco :::artifact{type=ecosystem_alert} per ogni finding distinto.
   Ogni blocco DEVE essere JSON valido con questi campi:
   - alert_type: uno tra "competitor_activity" | "ip_filing" | "trend_signal" | "partnership_opportunity" | "regulatory_change" | "funding_event"
   - headline: 1 riga, <=120 caratteri
   - body: 2-4 frasi, fattuale
   - source_url: URL diretto (non una pagina di ricerca)
   - relevance_score: float 0.0-1.0 — quanto rilevante per problema/soluzione/ICP di QUESTO founder
   - confidence: float 0.0-1.0 — quanto sei confidente nel finding
   - suggested_action: uno tra "draft_email" | "draft_linkedin_post" | "proposed_hypothesis" | "proposed_graph_update" | null
3. Se nulla si è mosso in modo rilevante, dillo esplicitamente ed emetti zero artifact. Non riempire.
4. Non inventare mai URL. Se non puoi verificare, ometti il finding.
`.trim();

function outputInstructions(locale: 'en' | 'it'): string {
  return locale === 'it' ? OUTPUT_INSTRUCTIONS_IT : OUTPUT_INSTRUCTIONS_EN;
}

function projectContext(ctx: MonitorPromptContext): string {
  const lines: string[] = [];
  lines.push(`Project: ${ctx.projectName}`);
  if (ctx.projectDescription) lines.push(`Description: ${ctx.projectDescription}`);
  if (ctx.idea?.problem) lines.push(`Problem: ${ctx.idea.problem}`);
  if (ctx.idea?.solution) lines.push(`Solution: ${ctx.idea.solution}`);
  if (ctx.idea?.target_market) lines.push(`Target market: ${ctx.idea.target_market}`);
  if (ctx.idea?.value_proposition) lines.push(`Value proposition: ${ctx.idea.value_proposition}`);
  return lines.join('\n');
}

// =============================================================================
// Template 1 — Competitors
// =============================================================================

export const COMPETITORS_TEMPLATE: EcosystemMonitorTemplate = {
  type: 'ecosystem.competitors',
  name: 'Ecosystem — Competitors',
  nameIt: 'Ecosistema — Competitor',
  schedule: 'weekly',
  defaultConfig: { competitors: [], keywords: [], threshold: 'all' },
  buildPrompt: (ctx) => {
    const competitors = ctx.knownCompetitors.length > 0
      ? ctx.knownCompetitors.join(', ')
      : '(none tracked yet — use project context to infer the competitive set)';
    const header = ctx.locale === 'it'
      ? 'SCAN SETTIMANALE — COMPETITOR ECOSISTEMA'
      : 'WEEKLY SCAN — COMPETITOR ECOSYSTEM';
    const body = ctx.locale === 'it'
      ? `Monitora questi competitor per cambiamenti materiali nell'ultima settimana: lanci prodotto,
cambi di pricing, rebranding, nuovi investimenti, assunzioni strategiche, chiusura di funzionalità.
Competitor tracciati: ${competitors}

Per ogni cambiamento significativo, emetti un ecosystem_alert con alert_type="competitor_activity".`
      : `Monitor these competitors for material changes this past week: product launches, pricing
shifts, rebrands, new funding, strategic hires, feature deprecations.
Tracked competitors: ${competitors}

For each significant change, emit one ecosystem_alert with alert_type="competitor_activity".`;
    return `${header}\n\n${projectContext(ctx)}\n\n${body}\n\n${outputInstructions(ctx.locale)}`;
  },
};

// =============================================================================
// Template 2 — IP / Patents
// =============================================================================

export const IP_TEMPLATE: EcosystemMonitorTemplate = {
  type: 'ecosystem.ip',
  name: 'Ecosystem — IP & Patents',
  nameIt: 'Ecosistema — IP & Brevetti',
  schedule: 'weekly',
  defaultConfig: { keywords: [], ipc_classes: [], threshold: 'warning' },
  buildPrompt: (ctx) => {
    const keywords = ctx.keywords.length > 0 ? ctx.keywords.join(', ') : ctx.idea?.solution || ctx.projectName;
    const header = ctx.locale === 'it'
      ? 'SCAN SETTIMANALE — BREVETTI & IP'
      : 'WEEKLY SCAN — PATENTS & IP';
    const body = ctx.locale === 'it'
      ? `Cerca nuovi depositi di brevetti, marchi o diritti d'autore nell'ultima settimana
relativi a: ${keywords}

Database suggeriti: EPO Espacenet, USPTO, WIPO PatentScope. Per ogni deposito rilevante per questo
founder (soluzione simile, mercato target simile, potenziale blocco), emetti un ecosystem_alert con
alert_type="ip_filing". Prioritizza filing che potrebbero bloccare l'approccio del founder.`
      : `Search for new patent, trademark, or copyright filings in the past week related to: ${keywords}

Suggested databases: EPO Espacenet, USPTO, WIPO PatentScope. For each filing relevant to this
founder (similar solution, similar target market, potential blocker), emit one ecosystem_alert with
alert_type="ip_filing". Prioritize filings that could block the founder's approach.`;
    return `${header}\n\n${projectContext(ctx)}\n\n${body}\n\n${outputInstructions(ctx.locale)}`;
  },
};

// =============================================================================
// Template 3 — Trends
// =============================================================================

export const TRENDS_TEMPLATE: EcosystemMonitorTemplate = {
  type: 'ecosystem.trends',
  name: 'Ecosystem — Market Trends',
  nameIt: 'Ecosistema — Trend di Mercato',
  schedule: 'weekly',
  defaultConfig: { keywords: [], sources: ['industry_reports', 'news', 'analyst'], threshold: 'all' },
  buildPrompt: (ctx) => {
    const keywords = ctx.keywords.length > 0 ? ctx.keywords.join(', ') : ctx.idea?.target_market || ctx.projectName;
    const header = ctx.locale === 'it'
      ? 'SCAN SETTIMANALE — TREND DI MERCATO'
      : 'WEEKLY SCAN — MARKET TRENDS';
    const body = ctx.locale === 'it'
      ? `Identifica trend di mercato emergenti della settimana rilevanti per: ${keywords}

Cerca in: report industriali, news analyst, Gartner/Forrester, Crunchbase, HackerNews, ProductHunt.
Filtra segnali vs. rumore — un singolo articolo non è un trend. Per ogni trend con più segnali
indipendenti, emetti un ecosystem_alert con alert_type="trend_signal". Includi nel body il numero
di fonti indipendenti che confermano il trend.`
      : `Identify emerging market trends from this week relevant to: ${keywords}

Search: industry reports, analyst news, Gartner/Forrester, Crunchbase, HackerNews, ProductHunt.
Filter signal from noise — a single article is not a trend. For each trend with multiple
independent signals, emit one ecosystem_alert with alert_type="trend_signal". Include in the body
the number of independent sources confirming the trend.`;
    return `${header}\n\n${projectContext(ctx)}\n\n${body}\n\n${outputInstructions(ctx.locale)}`;
  },
};

// =============================================================================
// Template 4 — Partnerships
// =============================================================================

export const PARTNERSHIPS_TEMPLATE: EcosystemMonitorTemplate = {
  type: 'ecosystem.partnerships',
  name: 'Ecosystem — Partnership Opportunities',
  nameIt: 'Ecosistema — Opportunità di Partnership',
  schedule: 'weekly',
  defaultConfig: { keywords: [], categories: [], threshold: 'all' },
  buildPrompt: (ctx) => {
    const keywords = ctx.keywords.length > 0 ? ctx.keywords.join(', ') : ctx.idea?.solution || ctx.projectName;
    const header = ctx.locale === 'it'
      ? 'SCAN SETTIMANALE — PARTNERSHIP'
      : 'WEEKLY SCAN — PARTNERSHIPS';
    const body = ctx.locale === 'it'
      ? `Trova potenziali opportunità di partnership, integrazione o distribuzione emerse questa
settimana, rilevanti per: ${keywords}

Cerca: nuove API pubbliche, annunci di integrazioni, programmi di partnership, marketplace
adiacenti, canali di distribuzione non presidiati. Per ogni opportunità concreta, emetti un
ecosystem_alert con alert_type="partnership_opportunity". Suggerisci una suggested_action solo
quando c'è un punto di contatto realistico (form aperto, BD email pubblica).`
      : `Find potential partnership, integration, or distribution opportunities emerged this week
relevant to: ${keywords}

Search: new public APIs, integration announcements, partnership programs, adjacent marketplaces,
unserved distribution channels. For each concrete opportunity, emit one ecosystem_alert with
alert_type="partnership_opportunity". Only suggest a suggested_action when there is a realistic
contact point (open form, public BD email).`;
    return `${header}\n\n${projectContext(ctx)}\n\n${body}\n\n${outputInstructions(ctx.locale)}`;
  },
};

// =============================================================================
// Registry
// =============================================================================

export const ECOSYSTEM_MONITOR_TEMPLATES: EcosystemMonitorTemplate[] = [
  COMPETITORS_TEMPLATE,
  IP_TEMPLATE,
  TRENDS_TEMPLATE,
  PARTNERSHIPS_TEMPLATE,
];

export function getEcosystemTemplate(type: EcosystemMonitorType): EcosystemMonitorTemplate | undefined {
  return ECOSYSTEM_MONITOR_TEMPLATES.find(t => t.type === type);
}

// =============================================================================
// Context loader — pulls project data into the prompt context
// =============================================================================

export function loadMonitorContext(projectId: string): MonitorPromptContext {
  const project = query<{ id: string; name: string; description: string | null; locale: string | null }>(
    'SELECT id, name, description, locale FROM projects WHERE id = ?',
    projectId,
  )[0];
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const idea = query<Record<string, string | null>>(
    'SELECT problem, solution, target_market, value_proposition FROM idea_canvas WHERE project_id = ?',
    projectId,
  )[0] || null;

  const researchRow = query<{ competitors: string | null; trends: string | null }>(
    'SELECT competitors, trends FROM research WHERE project_id = ?',
    projectId,
  )[0];

  let research: MonitorPromptContext['research'] = null;
  const knownCompetitors: string[] = [];
  if (researchRow) {
    research = {};
    if (researchRow.competitors) {
      try {
        const parsed = JSON.parse(researchRow.competitors) as Array<{ name: string; description?: string }>;
        research.competitors = parsed;
        knownCompetitors.push(...parsed.map(c => c.name).filter(Boolean));
      } catch { /* ignore malformed JSON */ }
    }
    if (researchRow.trends) {
      try {
        research.trends = JSON.parse(researchRow.trends) as Array<{ title: string }>;
      } catch { /* ignore */ }
    }
  }

  const graphKeywords = query<{ name: string }>(
    `SELECT name FROM graph_nodes WHERE project_id = ?
     AND node_type IN ('market_segment', 'technology', 'trend') LIMIT 10`,
    projectId,
  ).map(r => r.name);

  const locale: 'en' | 'it' = project.locale === 'it' ? 'it' : 'en';

  return {
    projectId,
    projectName: project.name,
    projectDescription: project.description,
    locale,
    idea: idea as MonitorPromptContext['idea'],
    research,
    knownCompetitors,
    keywords: graphKeywords,
  };
}

// =============================================================================
// Seeder — called on project-create (or via /api/projects/{id}/ecosystem/seed)
// =============================================================================

export interface SeedResult {
  created: Array<{ monitor_id: string; type: EcosystemMonitorType; name: string }>;
  skipped: Array<{ type: EcosystemMonitorType; reason: string }>;
}

export function seedEcosystemMonitorsForProject(projectId: string): SeedResult {
  const result: SeedResult = { created: [], skipped: [] };

  const existing = query<{ type: string }>(
    `SELECT type FROM monitors WHERE project_id = ? AND type LIKE 'ecosystem.%'`,
    projectId,
  );
  const existingTypes = new Set(existing.map(r => r.type));

  const ctx = loadMonitorContext(projectId);

  for (const template of ECOSYSTEM_MONITOR_TEMPLATES) {
    if (existingTypes.has(template.type)) {
      result.skipped.push({ type: template.type, reason: 'already exists' });
      continue;
    }

    const id = generateId('mon');
    const now = new Date().toISOString();
    const nextRun = calculateNextRun(template.schedule);
    const name = ctx.locale === 'it' ? template.nameIt : template.name;
    const prompt = template.buildPrompt(ctx);

    run(
      `INSERT INTO monitors (id, project_id, type, name, schedule, config, prompt, status, next_run, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      id,
      projectId,
      template.type,
      name,
      template.schedule,
      JSON.stringify(template.defaultConfig),
      prompt,
      nextRun,
      now,
    );

    result.created.push({ monitor_id: id, type: template.type, name });
  }

  return result;
}

// =============================================================================
// Dedupe hash — prevents the same finding from being re-inserted across runs
// =============================================================================

export function computeDedupeHash(
  alertType: string,
  sourceUrl: string | null | undefined,
  headline: string,
): string {
  const normalized = [
    alertType.toLowerCase().trim(),
    (sourceUrl || '').toLowerCase().trim().replace(/[?#].*$/, ''),
    headline.toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 200),
  ].join('|');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}
