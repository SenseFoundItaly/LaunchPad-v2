import {
  type Artifact,
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
  | { type: 'artifact-error'; raw: string; reason: string; artifact_type?: string };

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

export function parseMessageContent(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];

  const parts = content.split(/(:::artifact[\s\S]*?:::)/g);

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
    const openIdx = content.lastIndexOf(':::artifact');
    if (openIdx !== -1) {
      const after = content.slice(openIdx);
      const hasClose = after.includes('\n:::') || (after.endsWith(':::') && after.length > 15);
      if (!hasClose) {
        const textBefore = content.slice(0, openIdx).trim();
        const result: MessageSegment[] = [];
        if (textBefore) result.push({ type: 'text', content: textBefore });
        result.push({ type: 'artifact-pending', raw: after });
        return result;
      }
    }
  }

  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', content: content.trim() });
  }

  return segments;
}
