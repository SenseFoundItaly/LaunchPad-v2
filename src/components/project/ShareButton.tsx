'use client';

/**
 * ShareButton — TopBar entry-point for ShareDialog.
 *
 * Renders the `users` icon as an IconBtn. Click opens the dialog. Kept as a
 * thin component so the dialog (and its fetches) stay lazy — nothing loads
 * until the user actually opens sharing.
 */

import { useState } from 'react';
import { IconBtn } from '@/components/design/primitives';
import { I } from '@/components/design/icons';
import { useT } from '@/components/providers/LocaleProvider';
import { ShareDialog } from './ShareDialog';

export function ShareButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <>
      <IconBtn
        d={I.users}
        title={t('share.title')}
        aria-label={t('share.title')}
        onClick={() => setOpen(true)}
      />
      {open && <ShareDialog projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  );
}
