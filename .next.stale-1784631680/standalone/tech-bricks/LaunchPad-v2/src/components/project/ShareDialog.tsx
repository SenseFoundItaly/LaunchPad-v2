'use client';

/**
 * ShareDialog — per-project sharing UI.
 *
 * Hits /api/projects/{id}/members. Renders the owner (read-only chip) and
 * the list of shared users with revoke buttons. The add-form rejects locally
 * for obviously-bad input and surfaces server errors (including the 404
 * "user must sign up first" case) inline.
 *
 * Mounted by ShareButton on click. Closes on overlay click, Esc, or after
 * a successful add (toast-like inline confirmation, then list refresh).
 */

import { useEffect, useState, useCallback } from 'react';
import { IconBtn, Pill } from '@/components/design/primitives';
import { Icon, I } from '@/components/design/icons';

interface OwnerInfo {
  user_id: string;
  email: string | null;
  role: 'owner';
}
interface MemberInfo {
  id: string;
  user_id: string;
  email: string;
  role: string;
  added_by: string;
  created_at: string;
}
interface MembersResponse {
  owner: OwnerInfo | null;
  members: MemberInfo[];
}

export function ShareDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<MembersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedJustNow, setAddedJustNow] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`);
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      // The route uses the standard json() helper which wraps the payload as
      // { success, data }. The actual { owner, members } live under .data.
      const payload = body?.data ?? body;
      setData({
        owner: payload?.owner ?? null,
        members: Array.isArray(payload?.members) ? payload.members : [],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Esc to close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value || !value.includes('@')) {
      setAddError('Enter a valid email.');
      return;
    }
    setSubmitting(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setEmail('');
      setAddedJustNow(value);
      await refresh();
      setTimeout(() => setAddedJustNow(null), 3500);
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(memberId: string) {
    if (!confirm('Remove this person from the project?')) return;
    try {
      const res = await fetch(
        `/api/projects/${projectId}/members/${memberId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (e) {
      alert(`Could not remove member: ${(e as Error).message}`);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 18, 16, 0.42)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-l)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          fontFamily: 'var(--f-sans)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon d={I.users} size={14} style={{ color: 'var(--ink-3)' }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Share project</span>
          </div>
          <IconBtn d={I.x} title="Close" size={24} onClick={onClose} />
        </div>

        {/* Body */}
        <div style={{ padding: '14px 18px 18px' }}>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>
            Add anyone with a SenseFound account by email. They&rsquo;ll get
            full read-write access to this project only &mdash; not the rest
            of your workspace. Owner-only actions (delete project, manage
            sharing) stay yours.
          </p>

          {/* Add form */}
          <form
            onSubmit={handleAdd}
            style={{ display: 'flex', gap: 6, marginBottom: 14 }}
          >
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (addError) setAddError(null);
              }}
              placeholder="teammate@example.com"
              disabled={submitting}
              style={{
                flex: 1,
                padding: '8px 10px',
                fontSize: 13,
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r-m)',
                background: 'var(--paper)',
                color: 'var(--ink)',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              style={{
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 500,
                background: 'var(--ink)',
                color: 'var(--paper)',
                border: 'none',
                borderRadius: 'var(--r-m)',
                cursor: submitting || !email.trim() ? 'not-allowed' : 'pointer',
                opacity: submitting || !email.trim() ? 0.5 : 1,
                fontFamily: 'inherit',
              }}
            >
              {submitting ? 'Sharing…' : 'Share'}
            </button>
          </form>

          {addError && (
            <div
              style={{
                margin: '0 0 12px',
                padding: '8px 10px',
                fontSize: 12,
                color: 'var(--clay)',
                background: 'oklch(0.96 0.04 30)',
                border: '1px solid oklch(0.88 0.08 30)',
                borderRadius: 'var(--r-m)',
                lineHeight: 1.4,
              }}
            >
              {addError}
            </div>
          )}
          {addedJustNow && (
            <div
              style={{
                margin: '0 0 12px',
                padding: '8px 10px',
                fontSize: 12,
                color: 'var(--moss)',
                background: 'var(--moss-wash)',
                border: '1px solid color-mix(in srgb, var(--moss) 35%, transparent)',
                borderRadius: 'var(--r-m)',
              }}
            >
              ✓ Shared with {addedJustNow}
            </div>
          )}

          {/* Member list */}
          <div style={{ fontSize: 11, color: 'var(--ink-5)', marginBottom: 6, fontFamily: 'var(--f-mono)', letterSpacing: 0.5 }}>
            WHO HAS ACCESS
          </div>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: '10px 0' }}>
              Loading…
            </div>
          ) : error ? (
            <div style={{ fontSize: 12, color: 'var(--clay)', padding: '10px 0' }}>
              {error}
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {data?.owner && (
                <MemberRow
                  email={data.owner.email || '(unknown)'}
                  badge={<Pill kind="ok" dot>Owner</Pill>}
                />
              )}
              {data?.members.map((m) => (
                <MemberRow
                  key={m.id}
                  email={m.email}
                  badge={<Pill kind="info">Member</Pill>}
                  onRemove={() => handleRevoke(m.id)}
                />
              ))}
              {data?.members.length === 0 && (
                <li style={{ fontSize: 12, color: 'var(--ink-5)', padding: '8px 0' }}>
                  No one else has access yet.
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function MemberRow({
  email,
  badge,
  onRemove,
}: {
  email: string;
  badge: React.ReactNode;
  onRemove?: () => void;
}) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 0',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {email}
        </div>
      </div>
      {badge}
      {onRemove && (
        <IconBtn d={I.x} title="Remove access" size={24} onClick={onRemove} />
      )}
    </li>
  );
}
