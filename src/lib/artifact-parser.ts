import {
  type Artifact,
  type Source,
  ARTIFACTS_REQUIRING_SOURCES,
  validateSource,
} from '@/types/artifacts';

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'artifact'; artifact: Artifact; raw: string }
  | { type: 'artifact-pending'; raw: string }
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
  | { ok: true; artifact: Artifact }
  | { ok: false; reason: string; artifact_type?: string };

/**
 * Try to parse a single artifact block from raw text.
 * Format: :::artifact{"type":"...","id":"..."}\nJSON_BODY\n:::
 *
 * Returns a tagged outcome so the caller can distinguish "not yet parseable"
 * (streaming, incomplete) from "parsed but invalid" (missing sources,
 * malformed Source entry).
 */
function tryParseArtifact(raw: string): ParseOutcome | null {
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
  const reason = validateArtifactSources(artifact);
  if (reason) {
    return {
      ok: false,
      reason,
      artifact_type: typeof artifact.type === 'string' ? artifact.type : undefined,
    };
  }
  return { ok: true, artifact };
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

export function parseMessageContent(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];

  // Extract prose-level citations before splitting on artifacts.
  const proseCitations = tryParseCitations(content);
  const cleaned = proseCitations ? stripCitationsBlock(content) : content;

  const parts = cleaned.split(/(:::artifact[\s\S]*?:::)/g);

  for (const part of parts) {
    if (part.startsWith(':::artifact')) {
      const outcome = tryParseArtifact(part);
      if (outcome === null) {
        // Not parseable yet (streaming) OR malformed JSON. Use same hueristic
        // as before to distinguish: has closing marker => discard (malformed),
        // no closing => pending.
        if (part.endsWith(':::') || part.includes('\n:::')) {
          // Malformed — hide to avoid showing raw JSON syntax.
        } else {
          segments.push({ type: 'artifact-pending', raw: part });
        }
      } else if (outcome.ok) {
        segments.push({ type: 'artifact', artifact: outcome.artifact, raw: part });
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
        result.push({ type: 'artifact-pending', raw: after });
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
