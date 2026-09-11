'use client';

import type { ToolActivity } from '@/types';

const TOOL_LABELS: Record<string, string> = {
  web_search: 'Searching',
  read_url: 'Reading',
  calculate: 'Calculating',
};

const TOOL_ICONS: Record<string, string> = {
  web_search: 'search',
  read_url: 'link',
  calculate: 'hash',
};

function ToolIcon({ name }: { name: string }) {
  const icon = TOOL_ICONS[name] || 'tool';
  return (
    <span className="w-3.5 h-3.5 flex items-center justify-center text-[10px] shrink-0">
      {icon === 'search' && (
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85zm-5.442.656a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/>
        </svg>
      )}
      {icon === 'link' && (
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
          <path d="M6.354 5.5H4a3 3 0 0 0 0 6h3a3 3 0 0 0 2.83-4H9a2 2 0 0 1 0 2H4a1 1 0 1 1 0-2h2.354M9.646 10.5H12a3 3 0 0 0 0-6H9a3 3 0 0 0-2.83 4H7a2 2 0 0 1 0-2h5a1 1 0 1 1 0 2H9.646"/>
        </svg>
      )}
      {icon === 'hash' && (
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
          <path d="M8.39 12.648a1.32 1.32 0 0 0-.015.18c0 .305.21.508.5.508.266 0 .492-.172.555-.477l.554-2.703h1.204c.421 0 .56-.164.56-.47 0-.32-.236-.505-.553-.505h-1.032l.45-2.203h1.291c.421 0 .56-.164.56-.47 0-.32-.236-.505-.553-.505h-1.123l.385-1.876a1.32 1.32 0 0 0 .015-.18c0-.305-.21-.508-.5-.508-.266 0-.492.172-.555.477L9.78 4.34H8.39l.384-1.876a1.32 1.32 0 0 0 .015-.18c0-.305-.21-.508-.5-.508-.266 0-.492.172-.555.477l-.398 1.94H6.11c-.421 0-.56.164-.56.47 0 .32.236.505.553.505h1.123l-.45 2.203H5.28c-.421 0-.56.164-.56.47 0 .32.236.505.553.505h1.123l-.385 1.876a1.32 1.32 0 0 0-.015.18c0 .305.21.508.5.508.266 0 .492-.172.555-.477l.398-1.94h1.39l-.384 1.876z"/>
        </svg>
      )}
    </span>
  );
}

function formatArgs(name: string, args?: Record<string, unknown>): string {
  if (!args) return '';
  if (name === 'web_search') return `"${args.query}"`;
  if (name === 'read_url') {
    const url = String(args.url || '');
    try {
      return new URL(url).hostname;
    } catch {
      return url.slice(0, 40);
    }
  }
  if (name === 'calculate') return String(args.label || args.expression || '');
  return '';
}

export default function ToolActivityBar({ tools }: { tools: ToolActivity[] }) {
  if (!tools || tools.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {tools.map((tool) => {
        const label = TOOL_LABELS[tool.name] || tool.name;
        const detail = formatArgs(tool.name, tool.args);
        const isRunning = tool.status === 'running';
        const isError = tool.status === 'error';

        return (
          <div
            key={tool.id}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-all ${
              isRunning
                ? 'bg-sky/10 border border-sky/20 text-sky'
                : isError
                  ? 'bg-clay/10 border border-clay/20 text-clay'
                  : 'bg-paper-2/50 border border-line-2 text-ink-5'
            }`}
          >
            {isRunning && (
              <span className="w-2 h-2 rounded-full bg-sky animate-pulse shrink-0" />
            )}
            {!isRunning && !isError && (
              <span className="w-2 h-2 rounded-full bg-moss shrink-0" />
            )}
            {isError && (
              <span className="w-2 h-2 rounded-full bg-clay shrink-0" />
            )}
            <ToolIcon name={tool.name} />
            <span className="font-medium">{label}</span>
            {detail && (
              <span className={`max-w-[200px] truncate ${isRunning ? 'text-sky/70' : 'text-ink-6'}`}>
                {detail}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
