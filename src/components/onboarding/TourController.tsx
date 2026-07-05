'use client';

/**
 * TourController — cross-page guided onboarding walkthrough. Supersedes the
 * NavRail-only ProductTour (changelog #1): same users.onboarded gate and
 * driver.js theming, but the tour now STARTS on the workspace dashboard (/),
 * walks its surfaces, then navigates into the first project and tours every
 * NavRail section (Home → Intel → Knowledge → Financials → Co-pilot) with
 * in-page highlights.
 *
 * Mounted ONCE in the root layout so it covers `/` and `/project/*` alike.
 * driver.js cannot span routes (the next page's targets don't exist yet), so
 * the flat manifest (tour-steps.ts) is driven one page "chapter" at a time:
 * each page gets a fresh driver instance holding the FULL manifest (element
 * selectors resolve lazily at step activation, and the full list keeps the
 * progress counter + Done button correct) but only drives its own steps.
 * Crossing a chapter boundary persists the global index to sessionStorage
 * (tour-state.ts), destroys the instance, router.push()es, and the pathname
 * effect below resumes on arrival.
 *
 * Start conditions:
 *   - auto: first visit to `/` with users.onboarded === false;
 *   - manual: relaunchTour() (Settings → Replay tour) + navigate to `/`.
 * Finish, close (X/Esc) and abandon (navigating elsewhere mid-tour) all
 * PATCH { onboarded: true } — the tour never nags, replay stays available.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import './product-tour.css';
import api from '@/api';
import { useT } from '@/components/providers/LocaleProvider';
import { buildManifest, routeFor, type TourStep } from './tour-steps';
import {
  TOUR_START_EVENT,
  clearTourState,
  readTourState,
  waitForElement,
  writeTourState,
  type TourState,
} from './tour-state';

// Wait budgets for step targets. Optional steps skip after the short wait
// (empty Intel list, empty graph); required ones (NavRail anchors, dashboard
// chrome) get longer, then fall back to driver's centered popover.
const OPTIONAL_WAIT_MS = 3000;
const REQUIRED_WAIT_MS = 6000;

interface DashboardResp {
  success?: boolean;
  data?: { projects?: Array<{ project_id?: string }> };
}

export default function TourController() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname() || '';
  const drvRef = useRef<Driver | null>(null);
  // Set before a programmatic destroy that must NOT finish the tour
  // (chapter hand-off, rebuild); onDestroyed checks-and-resets it.
  const suppressFinish = useRef(false);
  const autoChecked = useRef(false);
  const [tick, setTick] = useState(0);

  // relaunchTour() pings this so an already-mounted controller re-evaluates
  // without a navigation (covers "Replay tour" clicked while already on /).
  useEffect(() => {
    const onStart = () => setTick((n) => n + 1);
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // A live instance on route change means the user wandered off mid-tour
    // (hand-offs destroy BEFORE pushing): tear down → onDestroyed marks done.
    if (drvRef.current) {
      drvRef.current.destroy();
      drvRef.current = null;
    }

    if (pathname !== '/' && !pathname.startsWith('/project/')) return;

    const markDone = () => {
      clearTourState();
      api.patch('/api/user/preferences', { onboarded: true }).catch(() => {});
    };

    const buildAndDrive = (manifest: TourStep[], startIdx: number, pid: string | null) => {
      const steps: DriveStep[] = manifest.map((s, i) => {
        // Chapter openers hide Prev: cross-page "back" would double the
        // navigation state machine for marginal value.
        const chapterFirst = i === 0 || manifest[i - 1].page !== s.page;
        return {
          element: s.target,
          popover: {
            title: t(s.titleKey),
            description: t(s.descKey),
            side: s.side,
            align: s.align ?? 'start',
            ...(chapterFirst ? { showButtons: ['next', 'close'] as ('next' | 'close')[] } : {}),
          },
        };
      });

      const advance = async (drv: Driver, next: number) => {
        if (next >= manifest.length) {
          drv.destroy(); // finish — onDestroyed clears state + marks onboarded
          return;
        }
        const nextStep = manifest[next];
        if (nextStep.page !== manifest[next - 1].page) {
          // Chapter boundary: persist, tear down silently, navigate. The
          // pathname effect resumes the next chapter on arrival.
          writeTourState({ stepIndex: next, projectId: pid });
          suppressFinish.current = true;
          drv.destroy();
          drvRef.current = null;
          router.push(routeFor(nextStep.page, pid));
          return;
        }
        if (nextStep.target) {
          const el = await waitForElement(nextStep.target, nextStep.optional ? OPTIONAL_WAIT_MS : REQUIRED_WAIT_MS);
          if (drvRef.current !== drv) return; // closed/navigated while waiting
          if (!el && nextStep.optional) {
            void advance(drv, next + 1);
            return;
          }
        }
        writeTourState({ stepIndex: next, projectId: pid });
        drv.moveTo(next);
      };

      // Next-clicks during a pending waitForElement (slow page data) must not
      // stack concurrent advances — a double-timeout would double-skip.
      let advancing = false;

      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const drv = driver({
        showProgress: true,
        progressText: t('tour.progress'),
        allowClose: true,
        disableActiveInteraction: true, // a mid-tour click on a highlighted link would desync route vs step
        animate: !reducedMotion,
        nextBtnText: t('tour.next'),
        prevBtnText: t('tour.prev'),
        doneBtnText: t('tour.done-btn'),
        popoverClass: 'lp-tour',
        steps,
        // Config-level overrides disable driver's auto-advance for ALL steps —
        // every path below must move/destroy explicitly.
        onNextClick: () => {
          if (advancing) return;
          advancing = true;
          void advance(drv, (drv.getActiveIndex() ?? startIdx) + 1).finally(() => {
            advancing = false;
          });
        },
        onPrevClick: () => {
          const cur = drv.getActiveIndex() ?? 0;
          if (cur <= 0) return;
          // Prev is hidden on chapter openers, so cur-1 is always same-page.
          writeTourState({ stepIndex: cur - 1, projectId: pid });
          drv.moveTo(cur - 1);
        },
        onDestroyed: () => {
          if (drvRef.current === drv) drvRef.current = null;
          if (suppressFinish.current) {
            suppressFinish.current = false;
            return;
          }
          markDone(); // finish AND close/skip — same contract as the old tour
        },
      });
      drvRef.current = drv;
      drv.drive(startIdx);
    };

    const resumeAt = async (state: TourState) => {
      let pid = state.projectId;
      // Step 0 on the dashboard with no project yet resolved (fresh start or
      // Settings replay): pick the first project so the tour has somewhere to
      // go; none → the manifest swaps to the create-a-project finale.
      if (state.stepIndex === 0 && pid === null && pathname === '/') {
        try {
          const { data } = await api.get<DashboardResp>('/api/dashboard');
          pid = data?.data?.projects?.[0]?.project_id ?? null;
        } catch {
          pid = null;
        }
        if (cancelled) return;
        if (pid) writeTourState({ stepIndex: 0, projectId: pid });
      }

      const manifest = buildManifest({ hasProjects: !!pid });
      const step = manifest[state.stepIndex];
      if (!step) {
        markDone();
        return;
      }
      if (pathname !== routeFor(step.page, pid)) {
        // Deep link / browser back mid-tour: treat as an explicit exit rather
        // than dragging the user back to the expected page.
        markDone();
        return;
      }

      // Entry step: wait for its target, skipping forward over missing
      // optionals (required-but-missing still renders — centered popover).
      let idx = state.stepIndex;
      while (idx < manifest.length && manifest[idx].page === step.page) {
        const s = manifest[idx];
        if (!s.target) break;
        const el = await waitForElement(s.target, s.optional ? OPTIONAL_WAIT_MS : REQUIRED_WAIT_MS);
        if (cancelled) return;
        if (el || !s.optional) break;
        idx++;
      }
      if (cancelled) return;
      if (idx >= manifest.length) {
        markDone();
        return;
      }
      if (manifest[idx].page !== step.page) {
        // Every remaining in-page step skipped → straight to the next chapter.
        writeTourState({ stepIndex: idx, projectId: pid });
        router.push(routeFor(manifest[idx].page, pid));
        return;
      }
      if (idx !== state.stepIndex || pid !== state.projectId) {
        writeTourState({ stepIndex: idx, projectId: pid });
      }
      buildAndDrive(manifest, idx, pid);
    };

    const state = readTourState();
    if (state) {
      void resumeAt(state);
    } else if (pathname === '/' && !autoChecked.current) {
      // First-login auto-start: once per mount, dashboard only.
      autoChecked.current = true;
      void (async () => {
        try {
          const { data } = await api.get<{ onboarded?: boolean }>('/api/user/preferences');
          if (data?.onboarded !== false) return;
        } catch {
          return; // can't determine → don't surprise the user with a tour
        }
        if (cancelled) return;
        const fresh: TourState = { stepIndex: 0, projectId: null };
        writeTourState(fresh);
        void resumeAt(fresh);
      })();
    }

    return () => {
      cancelled = true;
    };
    // t is stable per page load (locale switch reloads the app); pathname+tick
    // are the real triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, tick]);

  return null;
}
