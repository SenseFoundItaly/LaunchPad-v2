import type { Artifact } from '@/types/artifacts';

export interface CitationSource {
  type: string;
  title: string;
  url?: string;
}

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'artifact'; artifact: Artifact; raw: string }
  | { type: 'artifact-pending'; raw: string }
  | { type: 'citations'; sources: CitationSource[] };

/**
 * Try to parse a single artifact block from raw text.
 * Format: :::artifact{"type":"...","id":"..."}\nJSON_BODY\n:::
 */
function tryParseArtifact(raw: string): Artifact | null {
  // Extract header: everything between first { and the } before newline
  const headerMatch = raw.match(/:::artifact\s*(\{.*?\})\s*\n/);
  if (!headerMatch) {return null;}

  // Extract body: everything between first newline after header and closing :::
  const afterHeader = raw.slice(headerMatch.index! + headerMatch[0].length);
  const closingIdx = afterHeader.lastIndexOf('\n:::');
  if (closingIdx === -1) {
    // Try without newline before :::
    const altClosing = afterHeader.lastIndexOf(':::');
    if (altClosing <= 0) {return null;}
    const bodyStr = afterHeader.slice(0, altClosing).trim();
    try {
      const header = JSON.parse(headerMatch[1]);
      const body = JSON.parse(bodyStr);
      return { ...header, ...body } as Artifact;
    } catch { return null; }
  }

  const bodyStr = afterHeader.slice(0, closingIdx).trim();
  try {
    const header = JSON.parse(headerMatch[1]);
    const body = JSON.parse(bodyStr);
    return { ...header, ...body } as Artifact;
  } catch { return null; }
}

/**
 * Extract a <CITATIONS> JSON block from the response.
 * Returns parsed sources or null if absent / malformed.
 */
function tryParseCitations(text: string): CitationSource[] | null {
  const match = text.match(/<CITATIONS>\s*([\s\S]*?)\s*<\/CITATIONS>/);
  if (!match) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(match[1]); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const valid: CitationSource[] = [];
  for (const s of parsed) {
    if (s && typeof s === 'object' && typeof s.title === 'string' && s.title.length > 0) {
      valid.push(s as CitationSource);
    }
  }
  return valid.length > 0 ? valid : null;
}

function stripCitationsBlock(text: string): string {
  return text.replace(/<CITATIONS>\s*[\s\S]*?\s*<\/CITATIONS>/, '').trim();
}

export function parseMessageContent(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];

  // Extract prose-level citations before splitting on artifacts.
  const proseCitations = tryParseCitations(content);
  const cleaned = proseCitations ? stripCitationsBlock(content) : content;

  // Split on :::artifact boundaries
  const parts = cleaned.split(/(:::artifact[\s\S]*?:::)/g);

  for (const part of parts) {
    if (part.startsWith(':::artifact')) {
      const artifact = tryParseArtifact(part);
      if (artifact) {
        segments.push({ type: 'artifact', artifact, raw: part });
      } else {
        // Might be incomplete (streaming) or malformed
        if (part.endsWith(':::') || part.includes('\n:::')) {
          // Has closing but failed to parse — show as text
          segments.push({ type: 'text', content: part });
        } else {
          // No closing — still streaming
          segments.push({ type: 'artifact-pending', raw: part });
        }
      }
    } else {
      const text = part.trim();
      if (text) {segments.push({ type: 'text', content: text });}
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
        if (textBefore) {result.push({ type: 'text', content: textBefore });}
        result.push({ type: 'artifact-pending', raw: after });
        if (proseCitations) result.push({ type: 'citations', sources: proseCitations });
        return result;
      }
    }
  }

  if (segments.length === 0 && cleaned.trim()) {
    segments.push({ type: 'text', content: cleaned.trim() });
  }

  if (proseCitations) {
    segments.push({ type: 'citations', sources: proseCitations });
  }

  return segments;
}
