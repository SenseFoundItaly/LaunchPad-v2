'use client';

/**
 * First-login product tour (changelog #1: "guide the user through the first steps
 * with a quick tutorial — structured onboarding comes later"). A driver.js
 * spotlight walkthrough that runs ONCE for genuinely-new users (gated on
 * users.onboarded via /api/user/preferences), then marks them onboarded so it
 * never nags again (cross-device, unlike the localStorage OnboardingCard).
 *
 * Steps anchor to the persistent NavRail (href-suffix selectors), so it runs on
 * any project page. Covers: platform objective → sections overview → knowledge →
 * watchers → financials → kick off the Co-pilot. Step 7 (post-Idea-Canvas
 * reminder) is a SEPARATE trigger — see CanvasWatcherReminder.
 */

import { useEffect, useRef } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './product-tour.css';
import api from '@/api';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';

export default function ProductTour({ projectId }: { projectId: string }) {
  const t = useT();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let drv: Driver | null = null;

    (async () => {
      // Gate: only genuinely-new users (onboarded === false).
      let onboarded = true;
      try {
        const { data } = await api.get<{ onboarded?: boolean }>('/api/user/preferences');
        onboarded = data?.onboarded !== false;
      } catch {
        return; // can't determine → don't surprise the user with a tour
      }
      if (onboarded) return;

      const markDone = () => {
        api.patch('/api/user/preferences', { onboarded: true }).catch(() => {});
      };

      const navStep = (seg: string, titleKey: MessageKey, descKey: MessageKey) => ({
        element: `a[href$="/${seg}"]`,
        popover: {
          title: t(titleKey),
          description: t(descKey),
          side: 'right' as const,
          align: 'start' as const,
        },
      });

      drv = driver({
        showProgress: true,
        allowClose: true,
        nextBtnText: t('tour.next'),
        prevBtnText: t('tour.prev'),
        doneBtnText: t('tour.done-btn'),
        popoverClass: 'lp-tour',
        onDestroyed: markDone, // fires on finish AND on close/skip
        steps: [
          { popover: { title: t('tour.welcome.title'), description: t('tour.welcome.desc') } },
          navStep('today', 'tour.home.title', 'tour.home.desc'),
          navStep('knowledge', 'tour.knowledge.title', 'tour.knowledge.desc'),
          navStep('actions', 'tour.watchers.title', 'tour.watchers.desc'),
          navStep('financial', 'tour.financial.title', 'tour.financial.desc'),
          navStep('chat', 'tour.copilot.title', 'tour.copilot.desc'),
          { popover: { title: t('tour.finish.title'), description: t('tour.finish.desc') } },
        ],
      });
      // let the NavRail paint before spotlighting it
      setTimeout(() => { try { drv?.drive(); } catch { /* ignore */ } }, 600);
    })();

    return () => { try { drv?.destroy(); } catch { /* ignore */ } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return null;
}
