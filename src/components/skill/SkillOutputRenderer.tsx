'use client';

import { parseMessageContent } from '@/lib/artifact-parser';
import type { Artifact, EntityCard, WorkflowCard } from '@/types/artifacts';
import ArtifactRenderer from '@/components/chat/artifacts/ArtifactRenderer';

const noop = () => {};
const noopEntity = (_e: EntityCard) => {};

/** Read-only artifact wrapper */
function ReadOnlyArtifact({ artifact }: { artifact: Artifact }) {
  return (
    <ArtifactRenderer
      artifact={artifact}
      onAction={noop}
      onEntityDiscovered={noopEntity}
    />
  );
}

/** Render markdown text block */
function TextBlock({ content }: { content: string }) {
  return (
    <div className="space-y-1.5">
      {content.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        if (line.startsWith('# ')) return <h2 key={i} className="text-base font-bold text-white mt-3 mb-1">{line.slice(2)}</h2>;
        if (line.startsWith('## ')) return <h3 key={i} className="text-sm font-semibold text-zinc-200 mt-2 mb-0.5">{line.slice(3)}</h3>;
        if (line.startsWith('### ')) return <h4 key={i} className="text-sm font-medium text-zinc-300 mt-1.5">{line.slice(4)}</h4>;
        if (line.startsWith('---') || line.match(/^[━═─]{3,}/)) return <hr key={i} className="border-zinc-800 my-2" />;
        if (line.match(/^[━═─]+\s*.+\s*[━═─]+$/)) {
          const title = line.replace(/[━═─]/g, '').trim();
          return (
            <div key={i} className="mt-3 mb-1.5 py-1.5 px-3 bg-zinc-800/50 rounded-md">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">{title}</span>
            </div>
          );
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={i} className="flex gap-2 text-sm text-zinc-400">
              <span className="text-zinc-600 shrink-0">&bull;</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          );
        }
        if (line.trimStart().startsWith('\u2192 ') || line.trimStart().startsWith('-> ')) {
          const text = line.trimStart().replace(/^(\u2192|->)\s*/, '');
          return (
            <div key={i} className="flex gap-2 text-sm text-zinc-400 pl-1">
              <span className="text-blue-400 shrink-0">&rarr;</span>
              <span>{renderInline(text)}</span>
            </div>
          );
        }
        if (line.match(/^[①②③④⑤⑥⑦⑧⑨⑩]\s/)) {
          return (
            <div key={i} className="flex gap-2 text-sm text-zinc-400 mt-1">
              <span className="text-blue-400 font-bold shrink-0">{line[0]}</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          );
        }
        return <p key={i} className="text-sm text-zinc-400 leading-relaxed">{renderInline(line)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-zinc-200">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

interface SkillOutputRendererProps {
  content: string;
}

export default function SkillOutputRenderer({ content }: SkillOutputRendererProps) {
  const segments = parseMessageContent(content);

  return (
    <div className="space-y-2">
      {segments.map((segment, i) => {
        if (segment.type === 'artifact') {
          // Skip action suggestions and option sets — the detail panel has its own next steps
          if (segment.artifact.type === 'option-set' || segment.artifact.type === 'action-suggestion') return null;
          return <ReadOnlyArtifact key={i} artifact={segment.artifact} />;
        }
        if (segment.type === 'text') {
          return <TextBlock key={i} content={segment.content} />;
        }
        return null;
      })}
    </div>
  );
}
