import { NextRequest } from 'next/server';
import { json, error, generateId } from '@/lib/api-helpers';
import { run, get } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth/require-user';
import { debitCredits, DOCUMENT_AUDIT_CREDITS } from '@/lib/credits';
import { runAgent } from '@/lib/pi-agent';
import { recordAgentUsage } from '@/lib/cost-meter';
import { validationTargetsFor, validationLabel } from '@/lib/journey/validation-targets';

const MAX_FILE_BYTES = 10_485_760; // 10 MiB per file — real PDFs/decks are bigger than a text note
const MAX_FILES_PER_REQUEST = 10;

// Mime types we accept as text-content uploads. We deliberately stay narrow:
// binary office/PDF formats would need a parser dep (pdf-parse, mammoth) which
// the project does not ship. Rejected files surface a 415 with a clear message
// so the user knows what to convert.
const TEXT_MIME_ALLOW: ReadonlySet<string> = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/javascript',
  'application/typescript',
  'application/sql',
  'application/csv',
]);

// Some browsers/OSes hand off plain-text files with a blank or generic mime —
// fall back to extension sniffing so the common cases (`.md`, `.txt`, `.csv`)
// still work.
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'txt', 'md', 'markdown', 'rst', 'csv', 'tsv', 'json', 'yaml', 'yml',
  'xml', 'html', 'htm', 'log', 'ini', 'conf', 'env',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java',
  'sh', 'bash', 'zsh', 'sql', 'css', 'scss', 'toml',
]);

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isTextlike(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  if (TEXT_MIME_ALLOW.has(file.type)) return true;
  if (!file.type) return TEXT_EXTENSIONS.has(fileExtension(file.name));
  return TEXT_EXTENSIONS.has(fileExtension(file.name));
}

// ─── document text extraction ────────────────────────────────────────────────
//
// Pulls plain text out of a file regardless of format. PDF (unpdf, pdfjs-based,
// serverless-friendly) and Word .docx (mammoth) are parsed; everything textlike
// is UTF-8 decoded. The parsers are dynamically imported so a text-only upload
// never loads them (smaller cold-start). Scanned/image-only PDFs have no text
// layer and decode to '' → the caller skips them with a clear reason (no OCR).
//
// Stored fact text is capped — a 200-page PDF would otherwise bloat every chat
// turn's memory context. The entity extractor samples the head separately.
const MAX_STORED_TEXT = 50_000;

type ExtractKind = 'text' | 'pdf' | 'docx';
async function extractFileText(
  file: File,
): Promise<{ text: string; kind: ExtractKind } | { text: ''; kind: null; reason: string }> {
  const ext = fileExtension(file.name);
  const buf = Buffer.from(await file.arrayBuffer());

  if (file.type === 'application/pdf' || ext === 'pdf') {
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      const joined = (Array.isArray(text) ? text.join('\n') : text || '').trim();
      return { text: joined, kind: 'pdf' };
    } catch (e) {
      return { text: '', kind: null, reason: `Could not read PDF: ${(e as Error).message}` };
    }
  }

  if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    try {
      const mod = await import('mammoth');
      // mammoth is CJS — the namespace carries extractRawText (verified in Node
      // and per its types); fall back to `.default` only if a bundler interop
      // moves it there. Cast through unknown so tsc accepts the dual shape.
      const extractRawText =
        mod.extractRawText ??
        (mod as unknown as { default?: { extractRawText?: typeof mod.extractRawText } }).default?.extractRawText;
      if (!extractRawText) throw new Error('mammoth.extractRawText unavailable');
      const { value } = await extractRawText({ buffer: buf });
      return { text: (value || '').trim(), kind: 'docx' };
    } catch (e) {
      return { text: '', kind: null, reason: `Could not read Word doc: ${(e as Error).message}` };
    }
  }

  // Legacy binary .doc isn't OOXML — mammoth can't read it.
  if (ext === 'doc' || file.type === 'application/msword') {
    return { text: '', kind: null, reason: 'Legacy .doc isn’t supported — save as .docx or PDF.' };
  }

  if (isTextlike(file)) {
    return { text: new TextDecoder('utf-8', { fatal: false }).decode(buf).trim(), kind: 'text' };
  }

  return { text: '', kind: null, reason: `Unsupported type (${file.type || ext || 'unknown'}). Upload PDF, Word (.docx), or text/markdown.` };
}

// ─── entity extractor ────────────────────────────────────────────────────────
//
// Optional extra pass run when the request includes ?extract=1. For each
// uploaded file we ask Haiku to surface up to 8 entities (companies, people,
// products, regulations, segments, technologies) and persist them as `pending`
// graph_nodes. The user then reviews them in the Knowledge tab — approved
// ones flow into the right-pane graph.
//
// Off by default so legacy callers (and the in-app dropzone before opt-in)
// pay zero extra latency / token cost.

const ALLOWED_NODE_TYPES = new Set([
  'competitor', 'company', 'persona', 'market_segment', 'technology',
  'trend', 'regulation', 'compliance', 'partner', 'risk', 'feature', 'metric',
  'funding_source',
]);

interface ExtractedEntity {
  name: string;
  node_type: string;
  summary: string;
}

const EXTRACT_PROMPT = `From the text below, extract up to 12 distinct real-world entities (companies, products, regulations, market segments, personas, technologies, partners, risks, trends).

Return a JSON array. Each object: { "name": string, "node_type": string, "summary": one-sentence string }.

node_type MUST be one of: competitor, company, persona, market_segment, technology, trend, regulation, compliance, partner, risk, feature, metric, funding_source.

Skip generic concepts ("coffee", "the market"). Prefer named, specific entities ("Starbucks", "NYC DCWP"). If the text is too short, vague, or has no extractable entities, return [].

Output ONLY the JSON array — no markdown, no preamble.

TEXT:
"""
{TEXT}
"""`;

/**
 * Best-effort entity extraction. Never throws — extraction failures degrade
 * silently to zero proposed entities so the upload still succeeds.
 */
async function extractEntities(text: string, projectId: string): Promise<ExtractedEntity[]> {
  // Cap input — Haiku context isn't the bottleneck but cost/latency are.
  // 16k chars covers most decks / one-pagers in full; longer docs sample the head.
  const truncated = text.length > 16000 ? text.slice(0, 16000) : text;
  try {
    const startedAt = Date.now();
    const { text: raw, usage } = await runAgent(EXTRACT_PROMPT.replace('{TEXT}', truncated), {
      task: 'classify', // routes to Haiku (cheap)
      tools: false,
      timeout: 25_000,
    });
    await recordAgentUsage({
      project_id: projectId,
      step: 'knowledge-upload-extract',
      task: 'classify',
      usage,
      latency_ms: Date.now() - startedAt,
    });

    // Strip common LLM wrappers: ```json ... ``` fences, trailing prose.
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];

    const out: ExtractedEntity[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      const name = typeof e.name === 'string' ? e.name.trim() : '';
      const node_type = typeof e.node_type === 'string' ? e.node_type.toLowerCase() : '';
      const summary = typeof e.summary === 'string' ? e.summary.trim() : '';
      if (!name || !ALLOWED_NODE_TYPES.has(node_type)) continue;
      out.push({ name, node_type, summary });
      if (out.length >= 12) break;
    }
    return out;
  } catch (err) {
    console.warn('[upload/extract] entity extraction failed:', (err as Error).message);
    return [];
  }
}

// ─── canvas extractor ────────────────────────────────────────────────────────
//
// Drafts the lean-canvas fields (Stage 1's evidence) from the founder's own
// uploaded docs. Unlike entities, the canvas is the founder's OWN idea
// structure — but we still PROPOSE it (return it) rather than writing
// idea_canvas here, so the founder confirms it on the populating screen before
// it lands. That confirmation = POST /idea-canvas (the apply path).

interface ProposedCanvas {
  problem: string;
  solution: string;
  target_market: string;
  value_proposition: string;
  business_model: string;
  competitive_advantage: string;
}

const CANVAS_PROMPT = `From the founder's document(s) below, draft a lean startup canvas. Use ONLY what the text actually supports — leave a field as "" when the document doesn't address it. NEVER invent.

Return ONE JSON object with these string fields:
{ "problem": "...", "solution": "...", "target_market": "...", "value_proposition": "...", "business_model": "...", "competitive_advantage": "..." }

Each field: one or two concise sentences in the founder's voice. Output ONLY the JSON object — no markdown, no preamble.

DOCUMENT:
"""
{TEXT}
"""`;

async function extractCanvas(text: string, projectId: string): Promise<ProposedCanvas | null> {
  const truncated = text.length > 16000 ? text.slice(0, 16000) : text;
  try {
    const startedAt = Date.now();
    const { text: raw, usage } = await runAgent(CANVAS_PROMPT.replace('{TEXT}', truncated), {
      task: 'classify',
      tools: false,
      timeout: 25_000,
    });
    await recordAgentUsage({
      project_id: projectId,
      step: 'knowledge-upload-canvas',
      task: 'classify',
      usage,
      latency_ms: Date.now() - startedAt,
    });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 1200) : '');
    const canvas: ProposedCanvas = {
      problem: str(parsed.problem),
      solution: str(parsed.solution),
      target_market: str(parsed.target_market),
      value_proposition: str(parsed.value_proposition),
      business_model: str(parsed.business_model),
      competitive_advantage: str(parsed.competitive_advantage),
    };
    return Object.values(canvas).some((v) => v.length > 0) ? canvas : null;
  } catch (err) {
    console.warn('[upload/canvas] canvas extraction failed:', (err as Error).message);
    return null;
  }
}

// ─── monitor (watcher) suggester ─────────────────────────────────────────────
//
// Suggests recurring watchers the founder might want, based on the doc — each a
// single nameable thing to track. PROPOSED only (returned, never written): the
// founder opts in on the populating screen, and the chosen ones are created via
// POST /monitors. Mirrors extractEntities/extractCanvas (Haiku, best-effort).

interface ProposedMonitor {
  name: string;
  aim: string;
  cadence: 'daily' | 'weekly';
}

const MONITORS_PROMPT = `From the founder's document(s) below, suggest up to 4 recurring "watchers" — background scans worth running on a schedule to catch external moves that matter to THIS startup (e.g. a named competitor's launches, a specific regulation, a pricing page, a market trend).

Return a JSON array. Each object: { "name": one short label (<=60 chars), "aim": one sentence describing what it watches for and why (<=160 chars), "cadence": "daily" | "weekly" }.

Rules: only suggest watchers grounded in what the document ACTUALLY mentions — NEVER invent a competitor, regulation, or trend the founder didn't write. Use "daily" only for genuinely fast-moving things; default "weekly". If the text is thin or has nothing worth watching, return [].

Output ONLY the JSON array — no markdown, no preamble.

DOCUMENT:
"""
{TEXT}
"""`;

async function extractMonitors(text: string, projectId: string): Promise<ProposedMonitor[]> {
  const truncated = text.length > 16000 ? text.slice(0, 16000) : text;
  try {
    const startedAt = Date.now();
    const { text: raw, usage } = await runAgent(MONITORS_PROMPT.replace('{TEXT}', truncated), {
      task: 'classify',
      tools: false,
      timeout: 25_000,
    });
    await recordAgentUsage({
      project_id: projectId,
      step: 'knowledge-upload-monitors',
      task: 'classify',
      usage,
      latency_ms: Date.now() - startedAt,
    });
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ProposedMonitor[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const e = item as Record<string, unknown>;
      const name = typeof e.name === 'string' ? e.name.trim().slice(0, 60) : '';
      const aim = typeof e.aim === 'string' ? e.aim.trim().slice(0, 160) : '';
      if (!name || !aim) continue;
      out.push({ name, aim, cadence: e.cadence === 'daily' ? 'daily' : 'weekly' });
      if (out.length >= 4) break;
    }
    return out;
  } catch (err) {
    console.warn('[upload/monitors] monitor extraction failed:', (err as Error).message);
    return [];
  }
}

// Map a node_type to the relation verb used on the edge from your_startup
// to that entity. Mirrors src/lib/artifact-persistence.ts:relationForEntityType
// so the graph has consistent semantics whether the entity arrived via chat
// or upload extraction.
function relationForNodeType(t: string): string {
  switch (t) {
    case 'competitor':              return 'competes_with';
    case 'persona':                 return 'targets';
    case 'market_segment':          return 'operates_in';
    case 'technology':              return 'uses';
    case 'partner':                 return 'partners_with';
    case 'regulation': case 'compliance': return 'regulated_by';
    case 'funding_source':          return 'funded_by';
    case 'risk':                    return 'exposed_to';
    case 'trend':                   return 'influenced_by';
    case 'company':                 return 'related_to';
    case 'feature': case 'metric':  return 'tracks';
    default:                        return 'related_to';
  }
}

/**
 * Inserts each extracted entity as a pending graph_node + a graph_edge from
 * the project's your_startup root → new node. Dedups nodes by case-insensitive
 * name match so re-running over similar files doesn't multiply the same entity.
 *
 * The edge has no reviewed_state field in the schema, but the graph API
 * (src/app/api/graph/[projectId]/route.ts:33) filters edges to those where
 * both endpoints are applied. So edges to pending nodes are implicitly
 * hidden — they materialize the moment the founder approves the node.
 */
async function persistExtracted(
  projectId: string,
  entities: ExtractedEntity[],
  factId: string,
  filename: string,
): Promise<{ inserted: number; ids: Array<{ name: string; id: string }> }> {
  const ids: Array<{ name: string; id: string }> = [];
  const sources = [
    { type: 'internal', title: `Extracted from ${filename}`, ref: 'memory_fact', ref_id: factId },
  ];

  // Cache the root lookup — one query per upload regardless of entity count.
  const root = await get<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE project_id = ? AND node_type = 'your_startup' LIMIT 1",
    projectId,
  );

  for (const e of entities) {
    const existing = await get<{ id: string }>(
      'SELECT id FROM graph_nodes WHERE project_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
      projectId,
      e.name,
    );
    if (existing) continue; // deduped — owns no NEW pending row, so no node_id to return
    const id = generateId('node');
    await run(
      `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
       VALUES (?, ?, ?, ?, ?, '{}', ?, 'pending')`,
      id, projectId, e.name, e.node_type, e.summary, sources,
    );
    if (root) {
      await run(
        `INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation, sources)
         VALUES (?, ?, ?, ?, ?, ?)`,
        generateId('edge'), projectId, root.id, id, relationForNodeType(e.node_type), sources,
      );
    }
    // Return the id so the client can batch-apply this freshly-inserted pending
    // node (and the credit count reflects only chargeable, non-deduped rows).
    ids.push({ name: e.name, id });
  }
  return { inserted: ids.length, ids };
}

interface IngestResult {
  filename: string;
  status: 'ingested' | 'skipped';
  reason?: string;
  fact_id?: string;
  /** Count of entities proposed from this file when ?extract=1 was set.
   *  Undefined when extraction wasn't requested. 0 when nothing parseable. */
  entities_proposed?: number;
  bytes?: number;
}

/**
 * POST /api/projects/{projectId}/knowledge/upload
 *
 * Accepts multipart/form-data with one or more `file` fields. Each accepted
 * file is decoded as UTF-8 and inserted into memory_facts with
 * kind='file_upload' and reviewed_state='applied' (the user explicitly
 * uploaded it, so it goes straight into context). The filename, size, and
 * mime are persisted in the `sources` JSONB so the UI / chat can attribute
 * the fact later.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const { projectId } = await params;

  // Opt-in entity extraction. Off by default so existing callers don't pay
  // the extra Haiku latency. The in-app KnowledgeUpload dropzone passes
  // ?extract=1 so user uploads auto-propose graph entities.
  const url = new URL(request.url);
  const shouldExtract = url.searchParams.get('extract') === '1';
  // ?audit_charge=1 → bill a flat DOCUMENT_AUDIT_CREDITS per INGESTED document
  // (founder decision 2026-06-14). Off by default so onboarding's first-run
  // upload stays free; the Knowledge-page "Add documents" popup opts in. When
  // charged, applying the surfaced entities is free (apply-batch ?skip_charge).
  const chargeAudit = url.searchParams.get('audit_charge') === '1';

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error('Expected multipart/form-data with one or more `file` fields', 400);
  }

  const rawFiles = form.getAll('file');
  const files = rawFiles.filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return error('No files provided. Attach files as `file` form fields.', 400);
  }
  if (files.length > MAX_FILES_PER_REQUEST) {
    return error(`Too many files in one request (max ${MAX_FILES_PER_REQUEST}).`, 400);
  }

  const results: IngestResult[] = [];
  // Collected across files for the UI's "knowledge populating" view — the
  // actual entities the upload surfaced, so onboarding can show them as cards.
  const extractedEntities: Array<{ name: string; node_type: string; summary: string; filename: string; node_id?: string }> = [];
  // Combined ingested text → ONE canvas-extraction pass after the loop (the
  // canvas is project-level, not per-file).
  const ingestedTexts: string[] = [];

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      results.push({
        filename: file.name,
        status: 'skipped',
        reason: `File exceeds ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB limit (${file.size} bytes).`,
      });
      continue;
    }
    if (file.size === 0) {
      results.push({ filename: file.name, status: 'skipped', reason: 'File is empty.' });
      continue;
    }

    // Format-aware extraction: PDF (unpdf) / Word .docx (mammoth) / text.
    const extracted = await extractFileText(file);
    if (extracted.kind === null) {
      results.push({ filename: file.name, status: 'skipped', reason: extracted.reason });
      continue;
    }
    let text = extracted.text;
    if (!text) {
      results.push({
        filename: file.name,
        status: 'skipped',
        reason: extracted.kind === 'pdf'
          ? 'No text layer found (scanned/image PDF?) — nothing to extract.'
          : 'File has no readable text.',
      });
      continue;
    }
    const fullChars = text.length;
    if (text.length > MAX_STORED_TEXT) {
      text = `${text.slice(0, MAX_STORED_TEXT)}\n\n[document truncated for context — ${fullChars} chars total]`;
    }

    // Prepend the filename so the LLM sees provenance inline even without
    // following the `sources` link. Keeps fact self-describing.
    const fact = `Uploaded file: ${file.name}\n\n${text}`;
    const sources = [{
      type: 'file',
      filename: file.name,
      size: file.size,
      mime: file.type || null,
    }];

    const id = generateId('fact');
    await run(
      `INSERT INTO memory_facts
         (id, project_id, user_id, fact, kind, source_type, reviewed_state, sources, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'file_upload', 'file', 'applied', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id, projectId, userId, fact, sources,
    );
    const result: IngestResult = { filename: file.name, status: 'ingested', fact_id: id, bytes: file.size };
    ingestedTexts.push(text);

    // Entity extraction — opt-in, best-effort, latency-isolated per file so
    // one slow Haiku call doesn't block the next file. A failure here never
    // unwinds the memory_facts INSERT above (the fact is already the user's).
    if (shouldExtract) {
      const entities = await extractEntities(text, projectId);
      if (entities.length > 0) {
        const { inserted, ids } = await persistExtracted(projectId, entities, id, file.name);
        result.entities_proposed = inserted;
        // Name-match the returned ids back to entities (persistExtracted skips
        // dedup hits, so ids[] is SHORTER than entities[] — positional indexing
        // would mis-map). Deduped entities get no node_id → not chargeable.
        const idByName = new Map(ids.map((x) => [x.name.toLowerCase(), x.id]));
        for (const e of entities) {
          extractedEntities.push({ ...e, filename: file.name, node_id: idByName.get(e.name.toLowerCase()) });
        }
      } else {
        result.entities_proposed = 0;
      }
    }

    results.push(result);
  }

  const ingestedCount = results.filter((r) => r.status === 'ingested').length;
  const skippedCount = results.length - ingestedCount;
  const totalEntitiesProposed = results.reduce(
    (sum, r) => sum + (r.entities_proposed ?? 0),
    0,
  );

  // All-or-nothing failure → 415 so the client can surface a single error.
  if (ingestedCount === 0) {
    return error(
      results[0]?.reason ?? 'No files could be ingested.',
      415,
    );
  }

  // Flat per-document audit fee (opt-in via ?audit_charge=1). Charged on what
  // ACTUALLY ingested, so skipped files cost nothing. Best-effort like every
  // other debit — a failed charge never unwinds the ingested documents.
  let auditCreditsDebited = 0;
  if (chargeAudit) {
    const owed = ingestedCount * DOCUMENT_AUDIT_CREDITS;
    try {
      await debitCredits(projectId, owed, 'document_audit');
      auditCreditsDebited = owed;
    } catch (e) {
      console.warn('[knowledge/upload] audit debitCredits failed:', (e as Error).message);
    }
  }

  // Canvas draft (Stage 1 evidence) + suggested watchers from the combined doc
  // text — PROPOSED, not written. The founder applies/opts-in on the populating
  // screen. Run both passes concurrently (independent, same input) so we add
  // ~one Haiku call of wall-time, not two.
  const [proposedCanvas, proposedMonitors] =
    shouldExtract && ingestedTexts.length > 0
      ? await Promise.all([
          extractCanvas(ingestedTexts.join('\n\n---\n\n'), projectId),
          extractMonitors(ingestedTexts.join('\n\n---\n\n'), projectId),
        ])
      : [null, [] as ProposedMonitor[]];

  // Spine framing (founder directive 2026-06-12): label each extracted item
  // with the validation substep it would turn green, computed from the REAL
  // check definitions. The upload draft frames approval around the spine
  // ("this document can validate N steps") instead of a generic entity dump.
  const entitiesWithTargets = extractedEntities.map((e) => ({
    ...e,
    validates: e.node_type === 'competitor'
      ? validationLabel(validationTargetsFor('competitor'))
      : null,
  }));
  const canvasValidates: Record<string, string> = {};
  if (proposedCanvas) {
    const canvasRow = proposedCanvas as unknown as Record<string, unknown>;
    for (const f of ['problem', 'solution', 'target_market', 'value_proposition', 'competitive_advantage'] as const) {
      const v = canvasRow[f];
      if (typeof v === 'string' && v.trim()) {
        const label = validationLabel(validationTargetsFor('canvas_field', f));
        if (label) canvasValidates[f] = label;
      }
    }
  }
  // Count of distinct spine steps this document can light up — the draft's headline.
  const spineSteps = new Set<string>([
    ...Object.values(canvasValidates),
    ...entitiesWithTargets.map((e) => e.validates).filter((v): v is string => !!v),
  ]).size;

  return json({
    ingested: ingestedCount,
    skipped: skippedCount,
    entities_proposed: totalEntitiesProposed,
    extracted: shouldExtract,
    // The actual entities surfaced — drives the onboarding "knowledge
    // populating" view so the founder sees what was pulled from their docs.
    // Each carries `validates`: the spine substep it would turn green (or null).
    extracted_entities: entitiesWithTargets,
    // Lean-canvas draft (or null) for the founder to confirm → Stage 1.
    proposed_canvas: proposedCanvas,
    // Per-field map: which canvas field validates which substep.
    canvas_validates: canvasValidates,
    // How many distinct spine steps this document can validate.
    spine_steps: spineSteps,
    // Suggested watchers (or []) for the founder to opt into.
    proposed_monitors: proposedMonitors,
    // Flat audit fee actually charged (0 unless ?audit_charge=1). Per-document.
    audit_credits_debited: auditCreditsDebited,
    results,
  }, 201);
}
