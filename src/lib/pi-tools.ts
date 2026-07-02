import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Source } from '@/types/artifacts';
import { wrapUntrusted } from '@/lib/untrusted-content';
import { recordToolSpend, type ToolSpendCtx, type ToolKind } from '@/lib/tool-spend';

/**
 * Web search + URL read tools.
 *
 * Provider chain (each link returns the SAME shape, so callers never care which
 * served the result):
 *   1. Exa (api.exa.ai) — PRIMARY when EXA_API_KEY is set. Neural+keyword search
 *      with index-served contents, so it returns text even for Cloudflare/JS-
 *      gated sites (Crunchbase/TechCrunch/Product Hunt) that defeat live scraping
 *      — the exact case that produced ~0 watcher signals when Jina was the only
 *      provider. Set SEARCH_PROVIDER=jina to pin Jina first without removing the key.
 *   2. Jina (s.jina.ai / r.jina.ai) — clean markdown, ~4× fewer tokens than a
 *      raw DDG scrape. Works keyless (per-IP limits) or with JINA_API_KEY.
 *   3. DuckDuckGo HTML + naked fetch — last-resort, no key.
 *
 * WHY a chain and not a single vendor: a single paid provider with no balance
 * monitoring silently 402'd and blinded ~48% of watcher scans for a week. No
 * one link can take the pipeline down now; failures fall through and are
 * recorded in details.source / details.providerErrors.
 *
 * SOURCE PROVENANCE (Phase B of mandatory-sources):
 * Every tool result also carries a structured `sources: Source[]` array in
 * `details`. The agent already sees URLs + titles in the text body for
 * reasoning, but the structured array is the authoritative form it should
 * quote verbatim into artifact `sources` fields. This closes the "agent
 * paraphrased the URL wrong" failure mode.
 */

const JINA_API_KEY = process.env.JINA_API_KEY;
const JINA_TIMEOUT_MS = 20_000;
const EXA_API_KEY = process.env.EXA_API_KEY;
const EXA_TIMEOUT_MS = 20_000;
// Ops kill-switch: SEARCH_PROVIDER=jina pins Jina first even when an Exa key
// exists (e.g. to dodge an Exa incident without touching env keys).
const PREFER_EXA = !!EXA_API_KEY && process.env.SEARCH_PROVIDER !== 'jina';
const MAX_CHARS_PER_RESULT = 8_000;  // ≈ 2K tokens per search-result chunk
const MAX_TOTAL_CHARS = 16_000;       // ≈ 4K tokens hard cap per tool call

function jinaHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'X-Return-Format': 'markdown',
    'X-With-Generated-Alt': 'false',
    'X-With-Links-Summary': 'false',
    'X-With-Images-Summary': 'false',
  };
  if (JINA_API_KEY) h.Authorization = `Bearer ${JINA_API_KEY}`;
  return h;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n\n[…truncated, ${s.length - max} chars omitted]` : s;
}

// A4 (copilot-sota): fetched web/page bodies are wrapped via wrapUntrusted (see
// import at top) so the model treats them as DATA, never instructions
// (prompt-injection defense). Our framing (query/SOURCES/titles) stays OUTSIDE.

/**
 * Build a Source[] from a list of search hits. Kept separate so both the
 * Jina and DDG paths produce the same shape — the agent doesn't need to
 * know which backend served the result to cite it.
 */
function buildWebSources(
  hits: Array<{ title?: string; url: string; snippet?: string }>,
): Source[] {
  const now = new Date().toISOString();
  return hits.map((h) => ({
    type: 'web' as const,
    title: h.title?.trim() || h.url,
    url: h.url,
    accessed_at: now,
    ...(h.snippet ? { quote: h.snippet.slice(0, 300) } : {}),
  }));
}

/**
 * Exa search (api.exa.ai/search). type:'auto' lets Exa pick neural vs keyword.
 * `contents.text` returns page text inline, so one call covers BOTH "search"
 * and "scrape the top hits" — and the text is served from Exa's index, which is
 * why it succeeds on sites that block live scrapers (Jina's failure mode).
 */
async function exaSearch(query: string): Promise<
  { ok: true; out: AgentToolResult<unknown> } | { ok: false; error: string }
> {
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': EXA_API_KEY as string },
    body: JSON.stringify({
      query,
      numResults: 5,
      type: 'auto',
      contents: { text: { maxCharacters: MAX_CHARS_PER_RESULT } },
    }),
    signal: AbortSignal.timeout(EXA_TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, error: `Exa search HTTP ${res.status}` };

  const body = (await res.json()) as {
    results?: Array<{ title?: string; url: string; text?: string; publishedDate?: string }>;
  };
  const items = (body.results || []).slice(0, 5);
  if (items.length === 0) return { ok: false, error: 'Exa search returned 0 results' };

  const hits = items.map((r) => ({ title: r.title, url: r.url, snippet: r.text }));
  const text = items
    .map((r, i) => {
      const header = `${i + 1}. ${r.title || r.url}\n   ${r.url}`;
      const bodyText = truncate((r.text || '').trim(), MAX_CHARS_PER_RESULT);
      return bodyText ? `${header}\n\n${bodyText}` : header;
    })
    .join('\n\n---\n\n');

  return {
    ok: true,
    out: {
      content: [
        {
          type: 'text',
          text: `Search results for "${query}" (via Exa, ${items.length} results):\n\n${wrapUntrusted(truncate(text, MAX_TOTAL_CHARS))}\n\nSOURCES (cite verbatim when using these results in artifacts):\n${items.map((r, i) => `[${i + 1}] ${r.title || r.url} — ${r.url}`).join('\n')}`,
        },
      ],
      details: { query, resultCount: items.length, source: 'exa', sources: buildWebSources(hits) },
    },
  };
}

/**
 * Exa contents (api.exa.ai/contents). livecrawl:'preferred' fetches fresh but
 * falls back to the cached index — fresh enough for watchers (new events), yet
 * resilient on sites that block a live hit.
 */
async function exaRead(target: string): Promise<
  { ok: true; out: AgentToolResult<unknown> } | { ok: false; error: string }
> {
  const res = await fetch('https://api.exa.ai/contents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': EXA_API_KEY as string },
    body: JSON.stringify({
      urls: [target],
      text: { maxCharacters: MAX_TOTAL_CHARS },
      livecrawl: 'preferred',
    }),
    signal: AbortSignal.timeout(EXA_TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, error: `Exa contents HTTP ${res.status}` };

  const body = (await res.json()) as {
    results?: Array<{ url: string; title?: string; text?: string }>;
  };
  const hit = body.results?.[0];
  const content = (hit?.text || '').trim();
  if (!content) return { ok: false, error: 'Exa contents returned empty text' };

  const title = hit?.title?.trim() || target;
  const source: Source = {
    type: 'web',
    title,
    url: target,
    accessed_at: new Date().toISOString(),
    quote: content.slice(0, 300),
  };
  return {
    ok: true,
    out: {
      content: [
        {
          type: 'text',
          text: `${title}\n${target}\n\n${wrapUntrusted(truncate(content, MAX_TOTAL_CHARS))}\n\nSOURCE (cite verbatim when quoting this page):\n[1] ${title} — ${target}`,
        },
      ],
      details: {
        url: target,
        length: content.length,
        truncated: content.length > MAX_TOTAL_CHARS,
        source: 'exa',
        sources: [source] satisfies Source[],
      },
    },
  };
}

async function jinaSearch(query: string): Promise<
  { ok: true; out: AgentToolResult<unknown> } | { ok: false; error: string }
> {
  const url = `https://s.jina.ai/${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: jinaHeaders(),
    signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, error: `Jina search HTTP ${res.status}` };

  const ct = res.headers.get('content-type') || '';
  let text: string;
  let resultCount = 0;
  // Collect structured hits for the sources array. JSON path populates
  // directly; text-path parses URLs back out of the markdown (best-effort).
  let hits: Array<{ title?: string; url: string; snippet?: string }> = [];

  if (ct.includes('json')) {
    const body = (await res.json()) as {
      data?: Array<{ title: string; url: string; description?: string; content?: string }>;
    };
    const items = body.data || [];
    resultCount = items.length;
    hits = items.slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content || r.description,
    }));
    text = items
      .slice(0, 5)
      .map((r, i) => {
        const header = `${i + 1}. ${r.title}\n   ${r.url}`;
        const bodyText = r.content || r.description || '';
        const trimmed = truncate(bodyText.trim(), MAX_CHARS_PER_RESULT);
        return trimmed ? `${header}\n\n${trimmed}` : header;
      })
      .join('\n\n---\n\n');
  } else {
    text = await res.text();
    resultCount = (text.match(/^\[\d+\]/gm) || []).length;
    // Best-effort URL extraction from the text body so even the non-JSON
    // path contributes to the structured sources array.
    const urlRegex = /\bhttps?:\/\/[^\s)\]]+/g;
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = urlRegex.exec(text)) !== null && found.size < 5) {
      found.add(m[0]);
    }
    hits = Array.from(found).map((u) => ({ url: u }));
  }

  return {
    ok: true,
    out: {
      content: [
        {
          type: 'text',
          text: `Search results for "${query}" (via Jina, ${resultCount} results):\n\n${wrapUntrusted(truncate(text, MAX_TOTAL_CHARS))}\n\nSOURCES (cite verbatim when using these results in artifacts):\n${hits.map((h, i) => `[${i + 1}] ${h.title ?? h.url} — ${h.url}`).join('\n')}`,
        },
      ],
      details: {
        query,
        resultCount,
        source: 'jina',
        sources: buildWebSources(hits),
      },
    },
  };
}

async function ddgSearchFallback(query: string, reason: string): Promise<AgentToolResult<unknown>> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SenseFound/1.0)' },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    const results: { title: string; snippet: string; url: string }[] = [];
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < 4) {
      results.push({
        url: match[1].replace(/&amp;/g, '&'),
        title: match[2].replace(/<[^>]+>/g, '').trim(),
        snippet: match[3].replace(/<[^>]+>/g, '').trim(),
      });
    }
    const text = results.length
      ? results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`).join('\n\n')
      : 'No results found. Try a different query.';
    return {
      content: [
        {
          type: 'text',
          text: `Search results for "${query}" (fallback, Jina unavailable: ${reason}):\n\n${wrapUntrusted(text)}\n\nSOURCES (cite verbatim when using these results in artifacts):\n${results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}`).join('\n')}`,
        },
      ],
      details: {
        query,
        resultCount: results.length,
        source: 'ddg-fallback',
        jinaError: reason,
        sources: buildWebSources(results),
      },
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Search failed. Jina: ${reason}. Fallback: ${err instanceof Error ? err.message : String(err)}` }],
      details: { query, error: true, jinaError: reason, sources: [] satisfies Source[] },
    };
  }
}

const webSearchTool: AgentTool = {
  name: 'web_search',
  label: 'Web Search',
  description:
    'Search the web for current information about markets, competitors, trends, companies, and technologies. Returns top results pre-scraped as markdown PLUS a structured sources list. When citing these results in an artifact or inline [N] marker, copy the URL verbatim from the SOURCES section — do not paraphrase.',
  parameters: Type.Object({
    query: Type.String({ description: 'Search query' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const query = (params as { query: string }).query;
    const providerErrors: string[] = [];
    // Provider chain. Exa first when keyed (best coverage incl. blocked sites);
    // Jina second (cheap, keyless-capable); DDG last. A link that throws or
    // returns !ok falls through with its reason captured for the final fallback.
    if (PREFER_EXA) {
      try {
        const r = await exaSearch(query);
        if (r.ok) return r.out;
        providerErrors.push(`Exa: ${r.error}`);
      } catch (err) {
        providerErrors.push(`Exa: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      const r = await jinaSearch(query);
      if (r.ok) return r.out;
      providerErrors.push(`Jina: ${r.error}`);
    } catch (err) {
      providerErrors.push(`Jina: ${err instanceof Error ? err.message : String(err)}`);
    }
    return await ddgSearchFallback(query, providerErrors.join(' | ') || 'no primary provider');
  },
};

async function jinaRead(target: string): Promise<
  { ok: true; out: AgentToolResult<unknown> } | { ok: false; error: string }
> {
  const url = `https://r.jina.ai/${encodeURIComponent(target)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: jinaHeaders(),
    signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, error: `Jina read HTTP ${res.status}` };

  const ct = res.headers.get('content-type') || '';
  let body: string;
  let title = target;
  if (ct.includes('json')) {
    const json = (await res.json()) as { data?: { content?: string; title?: string } };
    body = json.data?.content ?? '';
    title = json.data?.title ?? target;
  } else {
    body = await res.text();
  }

  const truncated = truncate(body.trim(), MAX_TOTAL_CHARS);
  // First ~300 chars of the page as the source "quote" — lets the agent
  // cite a short verbatim snippet without re-parsing the full body.
  const quote = body.trim().slice(0, 300);
  const source: Source = {
    type: 'web',
    title: title?.trim() || target,
    url: target,
    accessed_at: new Date().toISOString(),
    ...(quote ? { quote } : {}),
  };
  return {
    ok: true,
    out: {
      content: [
        {
          type: 'text',
          text: `${title}\n${target}\n\n${wrapUntrusted(truncated)}\n\nSOURCE (cite verbatim when quoting this page):\n[1] ${title?.trim() || target} — ${target}`,
        },
      ],
      details: {
        url: target,
        length: body.length,
        truncated: body.length > MAX_TOTAL_CHARS,
        source: 'jina',
        sources: [source] satisfies Source[],
      },
    },
  };
}

async function rawFetchFallback(target: string, reason: string): Promise<AgentToolResult<unknown>> {
  try {
    const res = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SenseFound/1.0)',
        Accept: 'text/html,application/json,text/plain',
      },
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = res.headers.get('content-type') || '';
    let text: string;
    if (contentType.includes('json')) {
      const json = await res.json();
      text = JSON.stringify(json, null, 2);
    } else {
      const html = await res.text();
      text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
    }
    const trimmed = truncate(text, MAX_TOTAL_CHARS);
    const source: Source = {
      type: 'web',
      title: target,
      url: target,
      accessed_at: new Date().toISOString(),
      ...(text ? { quote: text.slice(0, 300) } : {}),
    };
    return {
      content: [
        {
          type: 'text',
          text: `Content from ${target} (fallback, Jina unavailable: ${reason}):\n\n${wrapUntrusted(trimmed)}\n\nSOURCE (cite verbatim when quoting this page):\n[1] ${target} — ${target}`,
        },
      ],
      details: {
        url: target,
        length: text.length,
        source: 'raw-fallback',
        jinaError: reason,
        sources: [source] satisfies Source[],
      },
    };
  } catch (err) {
    return {
      content: [
        { type: 'text', text: `Failed to fetch ${target}. Jina: ${reason}. Fallback: ${err instanceof Error ? err.message : String(err)}` },
      ],
      details: { url: target, error: true, jinaError: reason, sources: [] satisfies Source[] },
    };
  }
}

const urlFetchTool: AgentTool = {
  name: 'read_url',
  label: 'Read URL',
  description:
    'Fetch and read a web page as clean markdown. Chrome-stripped (no nav/footer/ads), truncated to ~4K tokens. Returns the page content PLUS a structured source entry. Cite the URL verbatim from the SOURCE section when referencing this page.',
  parameters: Type.Object({
    url: Type.String({ description: 'URL to fetch' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const target = (params as { url: string }).url;
    const providerErrors: string[] = [];
    // Same chain as web_search: Exa contents → Jina reader → naked fetch.
    if (PREFER_EXA) {
      try {
        const r = await exaRead(target);
        if (r.ok) return r.out;
        providerErrors.push(`Exa: ${r.error}`);
      } catch (err) {
        providerErrors.push(`Exa: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    try {
      const r = await jinaRead(target);
      if (r.ok) return r.out;
      providerErrors.push(`Jina: ${r.error}`);
    } catch (err) {
      providerErrors.push(`Jina: ${err instanceof Error ? err.message : String(err)}`);
    }
    return await rawFetchFallback(target, providerErrors.join(' | ') || 'no primary provider');
  },
};

/**
 * Safe arithmetic evaluator — a small recursive-descent parser that supports
 * + - * / and parentheses over decimal/scientific numbers, plus a couple of
 * founder-friendly conveniences (`X% of Y`, trailing `%` literals, `,`
 * thousands separators, `×`/`÷` unicode operators). It builds the result by
 * walking a token stream directly, so no dynamic code generation is involved
 * and arbitrary input can never run as code. Throws on malformed input.
 */
function evalArithmetic(input: string): number {
  // Normalize founder-y syntax before tokenizing:
  //  - "15% of 2000" -> "(15/100)*2000"  (also "15 % of 2,000")
  //  - bare unicode operators -> ascii
  //  - thousands separators inside numbers (1,000,000) -> 1000000
  //  - trailing "%" on a number -> "/100"
  let s = input.trim();
  if (!s) throw new Error('empty expression');
  s = s.replace(/[×✕✖]/g, '*').replace(/[÷]/g, '/').replace(/[–—−]/g, '-');
  // "N% of M" -> "(N/100)*(M)"  (M parsed normally afterwards)
  s = s.replace(/(\d[\d,]*(?:\.\d+)?)\s*%\s*of\s+/gi, '($1/100)*');
  // remove thousands separators that sit between digits: 1,000,000 -> 1000000
  s = s.replace(/(\d),(?=\d{3}\b)/g, '$1');
  // remaining "%" => "/100" (modulo is not what founders mean here)
  s = s.replace(/%/g, '/100');

  // Tokenizer
  type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'lp' } | { t: 'rp' };
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '(') { toks.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { toks.push({ t: 'rp' }); i++; continue; }
    if (c === '+' || c === '-' || c === '*' || c === '/') { toks.push({ t: 'op', v: c }); i++; continue; }
    // number: digits, decimal point, optional scientific exponent
    const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(i));
    if (m && m[0]) {
      toks.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    throw new Error(`unexpected character "${c}"`);
  }
  if (toks.length === 0) throw new Error('no numbers to evaluate');

  // Recursive-descent: expr = term (('+'|'-') term)*; term = factor (('*'|'/') factor)*;
  // factor = number | '(' expr ')' | ('+'|'-') factor
  let p = 0;
  const peek = () => toks[p];
  const parseExpr = (): number => {
    let val = parseTerm();
    for (;;) {
      const tk = peek();
      if (tk && tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
        p++;
        const rhs = parseTerm();
        val = tk.v === '+' ? val + rhs : val - rhs;
      } else break;
    }
    return val;
  };
  const parseTerm = (): number => {
    let val = parseFactor();
    for (;;) {
      const tk = peek();
      if (tk && tk.t === 'op' && (tk.v === '*' || tk.v === '/')) {
        p++;
        const rhs = parseFactor();
        if (tk.v === '/') {
          if (rhs === 0) throw new Error('division by zero');
          val = val / rhs;
        } else {
          val = val * rhs;
        }
      } else break;
    }
    return val;
  };
  const parseFactor = (): number => {
    const tk = peek();
    if (!tk) throw new Error('unexpected end of expression');
    if (tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
      p++;
      const f = parseFactor();
      return tk.v === '-' ? -f : f;
    }
    if (tk.t === 'num') { p++; return tk.v; }
    if (tk.t === 'lp') {
      p++;
      const v = parseExpr();
      const close = peek();
      if (!close || close.t !== 'rp') throw new Error('missing closing parenthesis');
      p++;
      return v;
    }
    throw new Error('expected a number or "("');
  };

  const result = parseExpr();
  if (p !== toks.length) throw new Error('unexpected trailing input');
  if (!Number.isFinite(result)) throw new Error('result is not a finite number');
  return result;
}

/** Calculator for financial projections */
const calculatorTool: AgentTool = {
  name: 'calculate',
  label: 'Calculator',
  description: 'Evaluate a mathematical expression. Use for financial calculations, unit economics, runway projections, market sizing, etc. Supports + - * / decimals parentheses and "15% of 2000".',
  parameters: Type.Object({
    expression: Type.String({ description: 'Mathematical expression to evaluate (e.g., "1000000 * 0.15 / 12", "(49 + 199) / 2", "15% of 2000")' }),
    label: Type.Optional(Type.String({ description: 'What this calculation represents (e.g., "Monthly revenue at 15% take rate")' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const raw = (params as { expression?: unknown; label?: unknown }).expression;
    const label = typeof (params as { label?: unknown }).label === 'string'
      ? (params as { label: string }).label
      : undefined;
    const expression = typeof raw === 'string' ? raw : String(raw ?? '');

    let result: number;
    try {
      result = evalArithmetic(expression);
    } catch (err) {
      // Return a helpful message rather than a hard throw the agent reads as
      // "the calculator is broken". The agent can then fall back or retry.
      const reason = err instanceof Error ? err.message : String(err);
      return {
        content: [{
          type: 'text',
          text: `Could not evaluate "${expression}" (${reason}). I can only do plain arithmetic: + - * / ( ) decimals, and "X% of Y". Re-send it in that form (e.g. "0.15 * 2000").`,
        }],
        details: { expression, error: true, reason },
      };
    }

    const formatted = result.toLocaleString('en-US', { maximumFractionDigits: 4 });
    const text = label
      ? `${label}: ${formatted}\n(${expression} = ${result})`
      : `${expression} = ${formatted}`;

    return {
      content: [{ type: 'text', text }],
      // Math is self-evidenced — no web URL to cite. When the agent uses
      // a calc result in an artifact, the source should be an `inference`
      // citing the inputs (which themselves came from web/internal sources).
      details: { expression, result, label },
    };
  },
};

/**
 * Wrap a search/read tool so each billable provider call (Exa, or keyed Jina)
 * is metered to llm_usage_logs + Langfuse. Reads details.source from the result
 * to know which provider actually served it (free DDG/raw-fetch fallbacks and
 * keyless Jina are no-ops). Fire-and-forget so metering never adds latency to
 * the agent's tool call. Identity-preserving otherwise (name/label/params/desc).
 */
function meterTool(tool: AgentTool, ctx: ToolSpendCtx, kind: ToolKind): AgentTool {
  return {
    ...tool,
    async execute(id, params) {
      const out = await tool.execute(id, params);
      const source = (out?.details as { source?: string } | undefined)?.source;
      void recordToolSpend(ctx, kind, source);
      return out;
    },
  };
}

/**
 * Get all available tools. Pass a ToolSpendCtx (projectId + step) to enable
 * cost metering of the paid web_search / read_url providers; without a
 * projectId the tools are returned unwrapped (no attribution → no metering).
 */
export function getTools(ctx?: ToolSpendCtx): AgentTool[] {
  if (!ctx?.projectId) return [webSearchTool, urlFetchTool, calculatorTool];
  return [
    meterTool(webSearchTool, ctx, 'web_search'),
    meterTool(urlFetchTool, ctx, 'read_url'),
    calculatorTool,
  ];
}
