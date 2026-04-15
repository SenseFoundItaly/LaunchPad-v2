import { Type } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

/** Web search via DuckDuckGo HTML (no API key needed) */
const webSearchTool: AgentTool = {
  name: 'web_search',
  label: 'Web Search',
  description: 'Search the web for current information about markets, competitors, trends, companies, and technologies. Returns relevant search results.',
  parameters: Type.Object({
    query: Type.String({ description: 'Search query' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const query = (params as { query: string }).query;
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LaunchPad/1.0)' },
      });
      const html = await res.text();

      // Extract result snippets from DuckDuckGo HTML
      const results: { title: string; snippet: string; url: string }[] = [];
      const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < 8) {
        results.push({
          url: match[1].replace(/&amp;/g, '&'),
          title: match[2].replace(/<[^>]+>/g, '').trim(),
          snippet: match[3].replace(/<[^>]+>/g, '').trim(),
        });
      }

      // Fallback: simpler extraction
      if (results.length === 0) {
        const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        let sMatch;
        while ((sMatch = snippetRegex.exec(html)) !== null && results.length < 8) {
          results.push({
            url: '',
            title: `Result ${results.length + 1}`,
            snippet: sMatch[1].replace(/<[^>]+>/g, '').trim(),
          });
        }
      }

      const text = results.length > 0
        ? results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}${r.url ? `\n   ${r.url}` : ''}`).join('\n\n')
        : 'No results found. Try a different query.';

      return {
        content: [{ type: 'text', text: `Search results for "${query}":\n\n${text}` }],
        details: { query, resultCount: results.length },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
        details: { query, error: true },
      };
    }
  },
};

/** Fetch and read a URL */
const urlFetchTool: AgentTool = {
  name: 'read_url',
  label: 'Read URL',
  description: 'Fetch and read the content of a web page. Use this to read articles, company pages, documentation, or any publicly accessible URL.',
  parameters: Type.Object({
    url: Type.String({ description: 'URL to fetch' }),
  }),
  async execute(_id, params): Promise<AgentToolResult<unknown>> {
    const url = (params as { url: string }).url;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LaunchPad/1.0)',
          'Accept': 'text/html,application/json,text/plain',
        },
        signal: AbortSignal.timeout(15000),
      });
      const contentType = res.headers.get('content-type') || '';
      let text: string;

      if (contentType.includes('json')) {
        const json = await res.json();
        text = JSON.stringify(json, null, 2).slice(0, 8000);
      } else {
        const html = await res.text();
        // Strip HTML tags, scripts, styles for readable text
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
          .trim()
          .slice(0, 8000);
      }

      return {
        content: [{ type: 'text', text: `Content from ${url}:\n\n${text}` }],
        details: { url, length: text.length },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}` }],
        details: { url, error: true },
      };
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
