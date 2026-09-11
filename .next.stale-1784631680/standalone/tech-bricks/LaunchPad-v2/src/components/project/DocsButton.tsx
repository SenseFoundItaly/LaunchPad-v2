'use client';

/**
 * DocsButton — TopBar entry-point for the project Data Room.
 *
 * Renders the `file` icon as an IconBtn; click opens a full-height drawer
 * mounting DataRoomPanel (every generated deliverable + uploaded file for
 * the project). Kept thin like ShareButton so the panel — and its data-room
 * queries — stay lazy: nothing fetches until the founder actually opens it.
 */

import { useEffect, useState } from 'react';
import { IconBtn } from '@/components/design/primitives';
import { I } from '@/components/design/icons';
import { useT } from '@/components/providers/LocaleProvider';
import DataRoomPanel from '@/components/knowledge/DataRoomPanel';

export function DocsButton({ projectId }: { projectId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  // Esc to close — registered only while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <>
      <IconBtn
        d={I.file}
        title={t('kb.docs-tooltip')}
        aria-label={t('kb.docs-tooltip')}
        onClick={() => setOpen(true)}
      />
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.35)',
            zIndex: 200,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <div
            role="dialog"
            aria-label={t('kb.data-room')}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(960px, 94vw)',
              height: '100%',
              background: 'var(--paper)',
              borderLeft: '1px solid var(--line)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <div
              style={{
                height: 38,
                flexShrink: 0,
                borderBottom: '1px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                gap: 8,
              }}
            >
              <span
                className="lp-mono"
                style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, color: 'var(--ink-2)', flex: 1, textTransform: 'uppercase' }}
              >
                {t('kb.data-room')}
              </span>
              <IconBtn d={I.x} title={t('common.close')} onClick={() => setOpen(false)} />
            </div>
            <DataRoomPanel projectId={projectId} />
          </div>
        </div>
      )}
    </>
  );
}
