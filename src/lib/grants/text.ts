/**
 * HTML → plain text for eligibility excerpts. Both sources ship CMS HTML
 * (SEDIA topicConditions, Lombardia #partecipanti). Minimal, dependency-free.
 */

const NAMED: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', euro: '€',
  agrave: 'à', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  Agrave: 'À', Egrave: 'È', Eacute: 'É', Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù',
};

/**
 * String.fromCodePoint throws RangeError above 0x10FFFF (a malformed
 * `&#99999999999;` in CMS HTML). One bad entity must not take down a whole
 * connector run, so out-of-range references are left as-is.
 */
function codePointOrRaw(code: number, raw: string): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return raw;
  return String.fromCodePoint(code);
}

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, h: string) => codePointOrRaw(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d: string) => codePointOrRaw(Number(d), m))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED[name] ?? m);
}

/**
 * Attribute run inside a tag, quote-aware: a `>` inside a quoted attribute
 * value does not end the tag. Live SEDIA topicConditions HTML starts with
 * `<div class="eui-u-mt-l>">` (verified 2026-09-01) — a naive `[^>]*` cut the
 * tag at the inner `>` and leaked `">` into founder-facing eligibility text.
 */
const TAG_ATTRS = String.raw`(?:[^>"']|"[^"]*"|'[^']*')*`;
const RE_BLOCK_TAG = new RegExp(String.raw`<\s*(br|\/p|\/li|\/div|\/h[1-6]|\/tr)\b${TAG_ATTRS}>`, 'gi');
const RE_ANY_TAG = new RegExp(String.raw`<${TAG_ATTRS}>`, 'g');

/** Strip tags (block tags become newlines), decode entities, collapse whitespace. */
export function stripHtml(html: string): string {
  const withBreaks = html
    .replace(RE_BLOCK_TAG, '\n')
    .replace(RE_ANY_TAG, ' ')
    // Fallback for tags the quote-aware pattern rejects (an unbalanced quote):
    // the naive cut is still better than leaking markup.
    .replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(withBreaks)
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** First `max` chars of plain text, cut at a word boundary with an ellipsis. */
export function excerpt(text: string, max = 600): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
