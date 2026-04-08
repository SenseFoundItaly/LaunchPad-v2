import type { Artifact } from '@/types/artifacts';

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'artifact'; artifact: Artifact; raw: string }
  | { type: 'artifact-pending'; raw: string };

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

export function parseMessageContent(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];

  // Split on :::artifact boundaries
  const parts = content.split(/(:::artifact[\s\S]*?:::)/g);

  for (const part of parts) {
    if (part.startsWith(':::artifact')) {
      const artifact = tryParseArtifact(part);
      if (artifact) {
        segments.push({ type: 'artifact', artifact, raw: part });
      } else {
        // Might be incomplete (streaming) or malformed
        if (part.endsWith(':::') || part.includes('\n:::')) {
          // Has closing but failed to parse — hide malformed artifacts
          // Don't show raw JSON/artifact syntax to user
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
  // The split regex might not catch it — check if content ends with an open block
  if (segments.length === 0 || (segments.length === 1 && segments[0].type === 'text')) {
    const openIdx = content.lastIndexOf(':::artifact');
    if (openIdx !== -1) {
      const after = content.slice(openIdx);
      const hasClose = after.includes('\n:::') || (after.endsWith(':::') && after.length > 15);
      if (!hasClose) {
        // Split text before the pending artifact
        const textBefore = content.slice(0, openIdx).trim();
        const result: MessageSegment[] = [];
        if (textBefore) {result.push({ type: 'text', content: textBefore });}
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
