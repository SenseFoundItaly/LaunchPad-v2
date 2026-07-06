import {
  type Artifact,
  type Source,
  ARTIFACTS_REQUIRING_SOURCES,
  validateSource,
} from '@/types/artifacts';

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'artifact'; artifact: Artifact; raw: string; used_fallback_sources?: boolean }
  // `header` is a best-effort parse of the leading `:::artifact{…}` JSON, which
  // streams BEFORE the body finishes. It lets the Canvas paint a dimmed
  // skeleton (item 9: progressive canvas paint) keyed by the artifact id while
  // the body is still arriving, then reconcile to the full card on completion.
  | { type: 'artifact-pending'; raw: string; header?: PendingHeader }
  // NEW — emitted when an artifact parses as JSON but fails source validation.
  // UI renders this as a visible red card; persistence layer skips it. This
  // replaces silently-dropping invalid artifacts, which used to hide agent
  // mistakes and create "why didn't my card show up" debugging dead-ends.
  | { type: 'artifact-error'; raw: string; reason: string; artifact_type?: string }
  // Prose-level citations — a <CITATIONS> JSON block at the end of a response.
  // Rendered as a standalone SourcesFooter below the prose text, so [N]
  // markers in prose have a target to scroll to even without artifact cards.
  | { type: 'citations'; sources: Source[] };

/**
 * Runs source-requirement validation on a parsed artifact. Returns a
 * human-readable reason string if the artifact is invalid, or null if it
 * passes. Called from tryParseArtifact after a successful JSON parse.
 *
 * Policy:
 *   - Types in ARTIFACTS_REQUIRING_SOURCES must have non-empty sources[].
 *   - Every source must pass validateSource().
 *   - option-set + sensitivity-slider: sources optional; if present, must
 *     still pass per-item validation.
 */
function validateArtifactSources(artifact: Artifact): string | null {
  const a = artifact as { type: string; sources?: unknown };
  const required = ARTIFACTS_REQUIRING_SOURCES.has(a.type as Artifact['type']);

  if (required) {
    if (!Array.isArray(a.sources) || a.sources.length === 0) {
      return `${a.type} requires non-empty sources[]`;
    }
  }

  // If sources is present (required OR optional), validate each entry.
  if (Array.isArray(a.sources)) {
    for (let i = 0; i < a.sources.length; i++) {
      const reason = validateSource(a.sources[i]);
      if (reason) return `sources[${i}] invalid: ${reason}`;
    }
  }

  return null;
}

type ParseOutcome =
  | { ok: true; artifact: Artifact; used_fallback_sources?: boolean }
  | { ok: false; reason: string; artifact_type?: string };

/** Minimal artifact header surfaced for in-flight (streaming) blocks. */
export type PendingHeader = { type?: string; id?: string; department?: string };

/**
 * Best-effort parse of the leading `:::artifact{…}` header from a raw block.
 * The header is a single-line JSON object that streams before the body, so it's
 * usually complete even while the body is still arriving. Returns undefined when
 * the header JSON hasn't fully streamed yet or carries no type/id.
 */
function parsePendingHeader(raw: string): PendingHeader | undefined {
  const m = raw.match(/:::artifact\s*(\{.*?\})/);
  if (!m) return undefined;
  try {
    const h = JSON.parse(m[1]) as Record<string, unknown>;
    const type = typeof h.type === 'string' ? h.type : undefined;
    const id = typeof h.id === 'string' ? h.id : undefined;
    const department = typeof h.department === 'string' ? h.department : undefined;
    if (!type && !id) return undefined;
    return { type, id, department };
  } catch {
    return undefined;
  }
}

/**
 * Try to parse a single artifact block from raw text.
 * Format: :::artifact{"type":"...","id":"..."}\nJSON_BODY\n:::
 *
 * Returns a tagged outcome so the caller can distinguish "not yet parseable"
 * (streaming, incomplete) from "parsed but invalid" (missing sources,
 * malformed Source entry).
 *
 * `fallbackSources` — response-level citations from a trailing <CITATIONS>
 * block. When the agent emits a factual artifact with empty sources[] but
 * provides citations at the end of the response, we attach those instead of
 * rejecting. This handles Sonnet 4.6's behavior of bundling all URLs in the
 * trailing block (see memory: finding-sonnet-4-6-omits-per-artifact-sources).
 * Over-attribution but never invention — the URLs came from the same response.
 */
function tryParseArtifact(raw: string, fallbackSources?: Source[] | null): ParseOutcome | null {
  const headerMatch = raw.match(/:::artifact\s*(\{.*?\})\s*\n/);
  if (!headerMatch) return null;

  const afterHeader = raw.slice(headerMatch.index! + headerMatch[0].length);
  const closingIdx = afterHeader.lastIndexOf('\n:::');

  let bodyStr: string;
  if (closingIdx === -1) {
    const altClosing = afterHeader.lastIndexOf(':::');
    if (altClosing <= 0) return null;
    bodyStr = afterHeader.slice(0, altClosing).trim();
  } else {
    bodyStr = afterHeader.slice(0, closingIdx).trim();
  }

  let header: Record<string, unknown>;
  let body: Record<string, unknown>;
  try {
    header = JSON.parse(headerMatch[1]);
    body = JSON.parse(bodyStr);
  } catch {
    // JSON itself is malformed — not an "invalid artifact" error we want to
    // surface, just a broken block. Return null so caller treats it as not
    // parseable (same as pre-source-enforcement behavior).
    return null;
  }

  // Cast via `unknown` — the merged header+body may be missing required
  // fields (e.g. `sources`) that the Artifact union declares. The whole
  // point of `validateArtifactSources` below is to catch that. We trust
  // validateArtifactSources as the runtime gate; TS just needs the cast.
  const artifact = { ...header, ...body } as unknown as Artifact;

  // Fallback path — if sources are missing/empty AND the response carried a
  // trailing <CITATIONS> block, attach those before validating. Sonnet 4.6
  // commonly bundles URLs trailing-only; this rescues otherwise-valid cards.
  let usedFallback = false;
  const aMut = artifact as { type: string; sources?: unknown };
  const sourcesIsEmpty =
    !Array.isArray(aMut.sources) || (aMut.sources as unknown[]).length === 0;
  const required = ARTIFACTS_REQUIRING_SOURCES.has(aMut.type as Artifact['type']);
  if (required && sourcesIsEmpty && fallbackSources && fallbackSources.length > 0) {
    aMut.sources = fallbackSources;
    (aMut as { provenance?: 'fallback' }).provenance = 'fallback';
    usedFallback = true;
  }

  const reason = validateArtifactSources(artifact);
  if (reason) {
    return {
      ok: false,
      reason,
      artifact_type: typeof artifact.type === 'string' ? artifact.type : undefined,
    };
  }

  // Department fallback — Canvas groups artifacts by department. If the agent
  // omitted the field, route by artifact type. Memory, option-set, task,
  // solve-progress don't render in the department grid so they're left null.
  const aDept = artifact as { department?: string };
  if (!aDept.department) {
    aDept.department = classifyDepartmentFromType(aMut.type as Artifact['type']);
  }

  return { ok: true, artifact, used_fallback_sources: usedFallback };
}

/**
 * Type→department fallback used when the agent omits the `department` field.
 * Returns undefined for inline / non-Canvas artifacts (option-set, task, fact,
 * solve-progress) — they're not grouped in the department grid.
 */
function classifyDepartmentFromType(t: Artifact['type']): 'market' | 'product' | 'pricing' | 'finance' | 'growth' | 'memory' | undefined {
  switch (t) {
    case 'tam-sam-som':
    case 'persona-card':
    case 'comparison-table':
    case 'idea-canvas':
      return 'market';
    case 'workflow-card':
    case 'risk-matrix':
      return 'product';
    case 'sensitivity-slider':
      return 'pricing';
    case 'investor-pipeline':
    case 'metric-grid':
    case 'gauge-chart':
    case 'score-card':
    case 'radar-chart':
      return 'finance';
    case 'weekly-update':
    case 'bar-chart':
    case 'pie-chart':
      return 'growth';
    case 'fact':
      return 'memory';
    case 'entity-card':
    case 'insight-card':
      return 'market'; // default for generic entities; agent should override
    default:
      return undefined; // option-set, task, monitor-proposal, budget-proposal, validation-proposal, html-preview, document, solve-progress, score-badge
  }
}

/**
 * Parse a `<CITATIONS>` JSON block from the end of a response.
 *
 * Format:
 *   <CITATIONS>
 *   [{"type":"web","title":"...","url":"..."},...]
 *   </CITATIONS>
 *
 * Returns validated Source[] or null if not present / malformed.
 * Invalid individual sources are silently dropped (the agent sometimes
 * includes a malformed entry alongside valid ones).
 */
function tryParseCitations(text: string): Source[] | null {
  const match = text.match(/<CITATIONS>\s*([\s\S]*?)\s*<\/CITATIONS>/);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const valid: Source[] = [];
  for (const src of parsed) {
    if (validateSource(src) === null) {
      valid.push(src as Source);
    }
  }

  return valid.length > 0 ? valid : null;
}

/**
 * Strip the `<CITATIONS>` block from raw text so it doesn't render as prose.
 */
function stripCitationsBlock(text: string): string {
  return text.replace(/<CITATIONS>\s*[\s\S]*?\s*<\/CITATIONS>/, '').trim();
}

// The core idea-canvas keys — a fenced JSON blob carrying ≥2 of these (or a
// single top-level `idea_canvas` wrapper) is a canvas the model leaked as raw
// ```json instead of an idea-canvas artifact (seen on reshape asks).
const CANVAS_CORE_KEYS = [
  'problem', 'solution', 'target_market', 'value_proposition', 'business_model', 'competitive_advantage',
] as const;

/** Stable non-crypto hash (djb2) so the normalized artifact keeps the SAME id
 *  across re-parses of the same content — render + persistence reconcile. */
function stableHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Pre-pass: rewrite COMPLETE ```json fences that carry an idea canvas into a
 * proper `:::artifact{"type":"idea-canvas"}` block, so the shared parser fixes
 * render + persistence + Canvas in one place. Unclosed fences are still
 * streaming — left alone. Fenced JSON that is NOT a canvas is untouched.
 */
export function normalizeCanvasJsonFences(content: string): string {
  if (!content.includes('```')) return content;
  // Match EVERY complete fence (any info string) so opening/closing backticks
  // pair correctly — a json-only pattern would pair an earlier ```ts block's
  // closer with the canvas block's opener and silently skip it. Non-JSON
  // fences match, then return unchanged.
  return content.replace(/```([^\n]*)\r?\n([\s\S]*?)\r?\n[ \t]*```/g, (match, info: string, body: string) => {
    const lang = info.trim().toLowerCase();
    if (lang !== '' && lang !== 'json') return match;
    const trimmed = body.trim();
    if (!trimmed.startsWith('{')) return match;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return match;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return match;
    let canvas = parsed as Record<string, unknown>;
    const keys = Object.keys(canvas);
    if (keys.length === 1 && keys[0] === 'idea_canvas') {
      const inner = canvas.idea_canvas;
      if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return match;
      canvas = inner as Record<string, unknown>;
    } else if (CANVAS_CORE_KEYS.filter((k) => k in canvas).length < 2) {
      return match;
    }
    const bodyStr = JSON.stringify(canvas);
    return `:::artifact{"type":"idea-canvas","id":"ic_json_${stableHash(bodyStr)}"}\n${bodyStr}\n:::`;
  });
}

export function parseMessageContent(rawContent: string): MessageSegment[] {
  const segments: MessageSegment[] = [];

  // Rescue canvas JSON the model leaked as a raw fence BEFORE any splitting —
  // downstream (render, persistence, Canvas) then sees a normal artifact.
  const content = normalizeCanvasJsonFences(rawContent);

  // Extract prose-level citations before splitting on artifacts.
  const proseCitations = tryParseCitations(content);
  const cleaned = proseCitations ? stripCitationsBlock(content) : content;

  const parts = cleaned.split(/(:::artifact[\s\S]*?:::)/g);

  for (const part of parts) {
    if (part.startsWith(':::artifact')) {
      const outcome = tryParseArtifact(part, proseCitations);
      if (outcome === null) {
        // Not parseable yet (streaming) OR malformed JSON. Use same hueristic
        // as before to distinguish: has closing marker => discard (malformed),
        // no closing => pending.
        if (part.endsWith(':::') || part.includes('\n:::')) {
          // Malformed — hide to avoid showing raw JSON syntax.
        } else {
          segments.push({ type: 'artifact-pending', raw: part, header: parsePendingHeader(part) });
        }
      } else if (outcome.ok) {
        segments.push({
          type: 'artifact',
          artifact: outcome.artifact,
          raw: part,
          used_fallback_sources: outcome.used_fallback_sources,
        });
      } else {
        // Parsed but invalid — surface to the UI so the user sees WHY the
        // card didn't render. This catches the common failure mode of
        // "LLM produced a card without sources" and makes it visible.
        segments.push({
          type: 'artifact-error',
          raw: part,
          reason: outcome.reason,
          artifact_type: outcome.artifact_type,
        });
      }
    } else {
      const text = part.trim();
      if (text) segments.push({ type: 'text', content: text });
    }
  }

  // Handle case where last segment is an unclosed artifact block
  if (segments.length === 0 || (segments.length === 1 && segments[0].type === 'text')) {
    const openIdx = cleaned.lastIndexOf(':::artifact');
    if (openIdx !== -1) {
      const after = cleaned.slice(openIdx);
      const hasClose = after.includes('\n:::') || (after.endsWith(':::') && after.length > 15);
      if (!hasClose) {
        const textBefore = cleaned.slice(0, openIdx).trim();
        const result: MessageSegment[] = [];
        if (textBefore) result.push({ type: 'text', content: textBefore });
        result.push({ type: 'artifact-pending', raw: after, header: parsePendingHeader(after) });
        return result;
      }
    }
  }

  if (segments.length === 0 && cleaned.trim()) {
    segments.push({ type: 'text', content: cleaned.trim() });
  }

  // Append prose citations as the final segment so the footer renders
  // below all text and artifact cards.
  if (proseCitations) {
    segments.push({ type: 'citations', sources: proseCitations });
  }

  return segments;
}

/**
 * Extract prose-level citations from a raw message for DB persistence.
 * Called by the chat route when saving an assistant message — the result
 * goes into `chat_messages.citations` as JSONB.
 */
export function extractCitations(content: string): Source[] | null {
  return tryParseCitations(content);
}
