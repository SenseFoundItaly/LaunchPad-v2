'use client';

import type { GraphNode } from '@/types/graph';
import { NODE_COLORS, type GraphNodeType } from '@/types/graph';

interface NodeDetailPanelProps {
  node: GraphNode | null;
  onClose: () => void;
}

export default function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  if (!node) {return null;}

  const typeColor = NODE_COLORS[node.node_type] || '#71717a';
  const attributes = node.attributes || {};
  const attrEntries = Object.entries(attributes).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );

  return (
    <div
      className="absolute top-0 right-0 w-80 h-full bg-zinc-900 border-l border-zinc-800 p-4 overflow-y-auto z-10 animate-in slide-in-from-right duration-200"
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 text-zinc-500 hover:text-zinc-300 transition-colors"
        aria-label="Close panel"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="4" x2="4" y2="12" />
          <line x1="4" y1="4" x2="12" y2="12" />
        </svg>
      </button>

      {/* Node name */}
      <h3 className="text-lg font-semibold text-zinc-100 pr-6 mb-2">
        {node.name}
      </h3>

      {/* Type badge */}
      <span
        className="inline-block px-2 py-0.5 text-xs font-medium rounded-full mb-4"
        style={{
          backgroundColor: `${typeColor}20`,
          color: typeColor,
          border: `1px solid ${typeColor}40`,
        }}
      >
        {node.node_type.replace(/_/g, ' ')}
      </span>

      {/* Summary */}
      {node.summary && (
        <div className="mb-4">
          <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">
            Summary
          </h4>
          <p className="text-sm text-zinc-300 leading-relaxed">
            {node.summary}
          </p>
        </div>
      )}

      {/* Attributes */}
      {attrEntries.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-2">
            Attributes
          </h4>
          <div className="space-y-2">
            {attrEntries.map(([key, value]) => (
              <div key={key} className="flex flex-col">
                <span className="text-xs text-zinc-500">{key}</span>
                <span className="text-sm text-zinc-300">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
