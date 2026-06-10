import { NextRequest } from 'next/server';
import { json, error, generateId } from '@/lib/api-helpers';
import { run, get } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth/require-user';
import { runAgent } from '@/lib/pi-agent';
import { recordAgentUsage } from '@/lib/cost-meter';

const MAX_FILE_BYTES = 1_048_576; // 1 MiB per file — anything larger is rarely useful as a single fact
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

const EXTRACT_PROMPT = `From the text below, extract up to 8 distinct real-world entities (companies, products, regulations, market segments, personas, technologies, partners, risks, trends).

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
  // 6k chars is plenty for entity extraction; longer docs sample the head.
  const truncated = text.length > 6000 ? text.slice(0, 6000) : text;
  try {
    const startedAt = Date.now();
    const { text: raw, usage } = await runAgent(EXTRACT_PROMPT.replace('{TEXT}', truncated), {
      task: 'classify', // routes to Haiku (cheap)
      tools: false,
      timeout: 25_000,
    });
    recordAgentUsage({
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
      if (out.length >= 8) break;
    }
    return out;
  } catch (err) {
    console.warn('[upload/extract] entity extraction failed:', (err as Error).message);
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
): Promise<number> {
  let inserted = 0;
  const sources = JSON.stringify([
    { type: 'internal', title: `Extracted from ${filename}`, ref: 'memory_fact', ref_id: factId },
  ]);

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
    if (existing) continue;
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
    inserted++;
  }
  return inserted;
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

  for (const file of files) {
    if (!isTextlike(file)) {
      results.push({
        filename: file.name,
        status: 'skipped',
        reason: `Unsupported type (${file.type || 'unknown'}). Convert to text/markdown first.`,
      });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      results.push({
        filename: file.name,
        status: 'skipped',
        reason: `File exceeds ${MAX_FILE_BYTES / 1024} KiB limit (${file.size} bytes).`,
      });
      continue;
    }
    if (file.size === 0) {
      results.push({ filename: file.name, status: 'skipped', reason: 'File is empty.' });
      continue;
    }

    const bytes = await file.arrayBuffer();
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).trim();
    if (!text) {
      results.push({ filename: file.name, status: 'skipped', reason: 'File decoded to empty text.' });
      continue;
    }

    // Prepend the filename so the LLM sees provenance inline even without
    // following the `sources` link. Keeps fact self-describing.
    const fact = `Uploaded file: ${file.name}\n\n${text}`;
    const sources = JSON.stringify([{
      type: 'file',
      filename: file.name,
      size: file.size,
      mime: file.type || null,
    }]);

    const id = generateId('fact');
    await run(
      `INSERT INTO memory_facts
         (id, project_id, user_id, fact, kind, source_type, reviewed_state, sources, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'file_upload', 'file', 'applied', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id, projectId, userId, fact, sources,
    );
    const result: IngestResult = { filename: file.name, status: 'ingested', fact_id: id, bytes: file.size };

    // Entity extraction — opt-in, best-effort, latency-isolated per file so
    // one slow Haiku call doesn't block the next file. A failure here never
    // unwinds the memory_facts INSERT above (the fact is already the user's).
    if (shouldExtract) {
      const entities = await extractEntities(text, projectId);
      if (entities.length > 0) {
        const inserted = await persistExtracted(projectId, entities, id, file.name);
        result.entities_proposed = inserted;
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

  return json({
    ingested: ingestedCount,
    skipped: skippedCount,
    entities_proposed: totalEntitiesProposed,
    extracted: shouldExtract,
    results,
  }, 201);
}
