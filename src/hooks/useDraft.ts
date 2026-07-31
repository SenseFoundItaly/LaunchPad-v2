'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * Composer draft persistence — typed-but-unsent text survives refresh, tab
 * close, and navigation (ephemerality audit 2026-07-21: the composer was the
 * most-used surface losing founder input). localStorage by design: a draft is
 * device-local scratch, not knowledge; it never needs cross-device sync.
 *
 * Pass null to disable (e.g. before the projectId is known) — behaves as plain
 * useState('').
 */
export function useDraft(key: string | null): [string, Dispatch<SetStateAction<string>>, () => void] {
  const [value, setValue] = useState('');

  // Restore once per key, after mount (SSR has no localStorage). Never
  // clobber text the user already typed before hydration completed.
  useEffect(() => {
    if (!key) return;
    try {
      const saved = window.localStorage.getItem(key);
      if (saved) setValue((prev) => (prev ? prev : saved));
    } catch {
      // storage unavailable (private mode / blocked) — degrade to plain state
    }
  }, [key]);

  // Debounced save; empty value removes the entry so drafts don't linger.
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => {
      try {
        if (value) window.localStorage.setItem(key, value);
        else window.localStorage.removeItem(key);
      } catch {
        // quota/blocked — draft just won't survive, same as before this hook
      }
    }, 300);
    return () => clearTimeout(t);
  }, [key, value]);

  const clear = () => {
    setValue('');
    if (key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  };

  return [value, setValue, clear];
}
