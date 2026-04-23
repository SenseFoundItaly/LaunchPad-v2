import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { Source } from '@/types/artifacts';

/**
 * Web search + URL read tools.
 *
 * Primary: Jina (s.jina.ai / r.jina.ai). Returns clean markdown rather than
 * raw HTML — ~4× fewer tokens per result vs DDG scrape + raw fetch.
 * Fallback: DuckDuckGo HTML + naked fetch. Triggered on any Jina non-2xx
 * or timeout. Same return shape so callers don't care which path served.
 *
 * With JINA_API_KEY: higher rate limits + priority. Without: basic per-IP
 * limits, still works for dev.
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
          text: `Search results for "${query}" (via Jina, ${resultCount} results):\n\n${truncate(text, MAX_TOTAL_CHARS)}\n\nSOURCES (cite verbatim when using these results in artifacts):\n${hits.map((h, i) => `[${i + 1}] ${h.title ?? h.url} — ${h.url}`).join('\n')}`,
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
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LaunchPad/1.0)' },
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
          text: `Search results for "${query}" (fallback, Jina unavailable: ${reason}):\n\n${text}\n\nSOURCES (cite verbatim when using these results in artifacts):\n${results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}`).join('\n')}`,
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
    try {
      const result = await jinaSearch(query);
      if (result.ok) return result.out;
      return await ddgSearchFallback(query, result.error);
    } catch (err) {
      return await ddgSearchFallback(query, err instanceof Error ? err.message : String(err));
    }
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
          text: `${title}\n${target}\n\n${truncated}\n\nSOURCE (cite verbatim when quoting this page):\n[1] ${title?.trim() || target} — ${target}`,
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
        'User-Agent': 'Mozilla/5.0 (compatible; LaunchPad/1.0)',
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
          text: `Content from ${target} (fallback, Jina unavailable: ${reason}):\n\n${trimmed}\n\nSOURCE (cite verbatim when quoting this page):\n[1] ${target} — ${target}`,
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
    try {
      const result = await jinaRead(target);
      if (result.ok) return result.out;
      return await rawFetchFallback(target, result.error);
    } catch (err) {
      return await rawFetchFallback(target, err instanceof Error ? err.message : String(err));
    }
  },
};

/** Calculator for financial projections */
const calculatorTool: AgentTool = {
  name: 'calculate',
  label: 'Calculator',
  description: 'Evaluate a mathematical expression. Use for financial calculations, unit economics, runway projections, market sizing, etc.',
  parameters: Type.Object({
    expression: Type.String({ description: 'Mathematical expression to evaluate (e.g., "1000000 * 0.15 / 12")' }),
    label: Type.Optional(Type.String({ description: 'What this calculation represents (e.g., "Monthly revenue at 15% take rate")' })),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const { expression, label } = params as { expression: string; label?: string };
    try {
      // Safe math evaluation — only allows numbers, operators, parens
      const sanitized = expression.replace(/[^0-9+\-*/.()%, ]/g, '');
      if (sanitized !== expression.replace(/\s/g, '')) {
        throw new Error('Expression contains invalid characters');
      }
      // eslint-disable-next-line no-eval
      const result = Function(`"use strict"; return (${sanitized})`)();
      const formatted = typeof result === 'number'
        ? result.toLocaleString('en-US', { maximumFractionDigits: 2 })
        : String(result);

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
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Calculation error: ${err instanceof Error ? err.message : String(err)}` }],
        details: { expression, error: true },
      };
    }
  },
};

/** Get all available tools */
export function getTools(): AgentTool[] {
  return [webSearchTool, urlFetchTool, calculatorTool];
}
