'use client';

import { use, useEffect, useState, useCallback } from 'react';
import type { PendingAction, PendingActionStatus } from '@/types';

interface InboxSummary {
  pending: number;
  edited: number;
  approved_awaiting_send: number;
  sent_last_7d: number;
  rejected_last_7d: number;
}

interface InboxResponse {
  success: boolean;
  data: { actions: PendingAction[]; summary: InboxSummary };
  error?: string;
}

type Filter = 'all' | 'pending' | 'edited' | 'approved' | 'sent' | 'rejected';

const FILTER_TO_STATUS: Record<Filter, PendingActionStatus[] | null> = {
  all: null,
  pending: ['pending'],
  edited: ['edited'],
  approved: ['approved'],
  sent: ['sent'],
  rejected: ['rejected'],
};

const FILTER_LABELS: Record<Filter, string> = {
  all: 'Tutte',
  pending: 'Da decidere',
  edited: 'Modificate',
  approved: 'Approvate',
  sent: 'Inviate',
  rejected: 'Rifiutate',
};

export default function ApprovalInboxPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [summary, setSummary] = useState<InboxSummary | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statuses = FILTER_TO_STATUS[filter];
      const qs = statuses ? `?status=${statuses.join(',')}` : '';
      const res = await fetch(`/api/projects/${projectId}/actions${qs}`);
      const body: InboxResponse = await res.json();
      if (!body.success) throw new Error(body.error || 'Failed to load inbox');
      setActions(body.data.actions);
      setSummary(body.data.summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, filter]);

  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  async function transition(actionId: string, verb: 'approve' | 'edit' | 'reject', extras: Record<string, unknown> = {}) {
    try {
      const res = await fetch(`/api/projects/${projectId}/actions/${actionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: verb, ...extras }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || `${verb} failed`);
      await fetchInbox();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-zinc-950 text-zinc-100">
      <div className="max-w-4xl mx-auto px-8 py-10">
        <header className="mb-6">
          <div className="text-xs uppercase tracking-widest text-zinc-500 mb-1">
            Inbox di approvazione
          </div>
          <h1 className="text-2xl font-semibold text-zinc-100 mb-4">
            Bozze dal tuo co-founder
          </h1>
          {summary && <SummaryBar summary={summary} />}
        </header>

        <div className="flex gap-2 mb-6 border-b border-zinc-800 pb-3 overflow-x-auto">
          {(Object.keys(FILTER_LABELS) as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors shrink-0 ${
                filter === f
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              {FILTER_LABELS[f]}
              {summary && filterCount(f, summary) > 0 ? (
                <span className="ml-1.5 text-zinc-500">· {filterCount(f, summary)}</span>
              ) : null}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading && actions.length === 0 ? (
          <div className="text-zinc-500 text-sm">Caricamento…</div>
        ) : actions.length === 0 ? (
          <EmptyInbox filter={filter} />
        ) : (
          <div className="space-y-3">
            {actions.map(action => (
              <ActionRow key={action.id} action={action} onTransition={transition} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryBar({ summary }: { summary: InboxSummary }) {
  const items: Array<{ label: string; value: number; color: string }> = [
    { label: 'Da decidere', value: summary.pending, color: 'text-amber-400' },
    { label: 'Modificate', value: summary.edited, color: 'text-blue-400' },
    { label: 'In coda invio', value: summary.approved_awaiting_send, color: 'text-emerald-400' },
    { label: 'Inviate 7gg', value: summary.sent_last_7d, color: 'text-zinc-400' },
    { label: 'Rifiutate 7gg', value: summary.rejected_last_7d, color: 'text-zinc-500' },
  ];
  return (
    <div className="flex gap-6 text-xs">
      {items.map(item => (
        <div key={item.label}>
          <div className={`text-lg font-mono ${item.color}`}>{item.value}</div>
          <div className="text-zinc-500">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function filterCount(filter: Filter, summary: InboxSummary): number {
  switch (filter) {
    case 'pending': return summary.pending;
    case 'edited': return summary.edited;
    case 'approved': return summary.approved_awaiting_send;
    case 'sent': return summary.sent_last_7d;
    case 'rejected': return summary.rejected_last_7d;
    default: return 0;
  }
}

function ActionRow({
  action,
  onTransition,
}: {
  action: PendingAction;
  onTransition: (id: string, verb: 'approve' | 'edit' | 'reject', extras?: Record<string, unknown>) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedPayloadText, setEditedPayloadText] = useState(
    JSON.stringify(action.payload, null, 2),
  );

  const statusColor: Record<string, string> = {
    pending: 'text-amber-400',
    edited: 'text-blue-400',
    approved: 'text-emerald-400',
    rejected: 'text-zinc-500',
    sent: 'text-emerald-300',
    failed: 'text-red-400',
  };

  const canAct = action.status === 'pending' || action.status === 'edited';

  async function handleEdit() {
    try {
      const parsed = JSON.parse(editedPayloadText);
      await onTransition(action.id, 'edit', { edited_payload: parsed });
      setEditMode(false);
    } catch (e) {
      alert(`Payload JSON non valido: ${(e as Error).message}`);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              {action.action_type}
            </span>
            <span className={`text-xs ${statusColor[action.status] || 'text-zinc-400'}`}>
              · {action.status}
            </span>
            {action.estimated_impact && (
              <span className="text-xs text-zinc-500">· impatto {action.estimated_impact}</span>
            )}
            <span className="text-xs text-zinc-600">· {formatTs(action.created_at)}</span>
          </div>
          <div className="text-sm text-zinc-100 mb-1">{action.title}</div>
          {action.rationale && (
            <div className="text-xs text-zinc-400">{action.rationale}</div>
          )}
        </div>
        {canAct && !editMode && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => onTransition(action.id, 'approve')}
              className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
              aria-label={`Approva ${action.title}`}
            >
              Approva
            </button>
            <button
              onClick={() => setEditMode(true)}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
              aria-label={`Modifica ${action.title}`}
            >
              Modifica
            </button>
            <button
              onClick={() => onTransition(action.id, 'reject')}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-900 hover:bg-red-900/40 text-zinc-500 hover:text-red-300 border border-zinc-800"
              aria-label={`Rifiuta ${action.title}`}
            >
              Rifiuta
            </button>
          </div>
        )}
      </div>

      {editMode ? (
        <div className="mt-3">
          <textarea
            value={editedPayloadText}
            onChange={e => setEditedPayloadText(e.target.value)}
            rows={10}
            className="w-full px-3 py-2 text-xs font-mono bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 outline-none focus:border-zinc-600 resize-y"
          />
          <div className="flex gap-2 mt-2 justify-end">
            <button
              onClick={handleEdit}
              className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
            >
              Salva modifica
            </button>
            <button
              onClick={() => { setEditMode(false); setEditedPayloadText(JSON.stringify(action.payload, null, 2)); }}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            >
              Annulla
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-3 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {expanded ? '⌃ Nascondi payload' : '⌄ Mostra payload'}
        </button>
      )}

      {expanded && !editMode && (
        <pre className="mt-2 text-xs font-mono text-zinc-400 bg-zinc-950 rounded p-3 overflow-x-auto border border-zinc-800">
          {JSON.stringify(action.edited_payload || action.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

function EmptyInbox({ filter }: { filter: Filter }) {
  const messages: Record<Filter, string> = {
    all: 'Il tuo co-founder non ha ancora niente in coda. Torna dopo le 9 di lunedì.',
    pending: 'Nessuna decisione in attesa. Il tuo co-founder ha fatto un buon lavoro a restare silente.',
    edited: 'Nessuna bozza in modifica.',
    approved: 'Nessuna bozza in coda di invio.',
    sent: 'Nessuna azione inviata negli ultimi 7 giorni.',
    rejected: 'Nessuna bozza rifiutata recentemente.',
  };
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-10 text-center">
      <div className="text-zinc-400 text-sm">{messages[filter]}</div>
    </div>
  );
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const ageHours = (now - d.getTime()) / (1000 * 60 * 60);
    if (ageHours < 24) return `${Math.floor(ageHours)}h fa`;
    if (ageHours < 24 * 7) return `${Math.floor(ageHours / 24)}g fa`;
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}
