'use client';

/**
 * TourController — cross-page guided onboarding walkthrough. Supersedes the
 * NavRail-only ProductTour (changelog #1): same users.onboarded gate and
 * driver.js theming, but the tour now STARTS on the workspace dashboard (/),
 * walks its surfaces, then navigates into the first project and tours every
 * NavRail section (Home → Knowledge → Watchers → Financials → Co-pilot,
 * matching the changelog 4/08 mini-tour spec) with in-page highlights.
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
import type { Driver, DriveStep } from 'driver.js';
import './product-tour.css';

/**
 * driver.js and its stylesheet are fetched only when a run actually starts.
 *
 * They used to be static imports, so every visitor downloaded the library on
 * every page for a walkthrough that runs once per account (measured 2026-09-02:
 * 44 KB, 14 KB of it inside the root-layout chunk). Loading it here instead
 * means a founder who has already been onboarded never fetches it at all.
 * Cached after the first call, so a chapter hand-off does not re-import.
 */
let driverModule: typeof import('driver.js') | null = null;
async function loadDriver(): Promise<typeof import('driver.js')> {
  if (!driverModule) {
    const [mod] = await Promise.all([
      import('driver.js'),
      import('driver.js/dist/driver.css'),
    ]);
    driverModule = mod;
  }
  return driverModule;
}
import api from '@/api';
import { useT } from '@/components/providers/LocaleProvider';
import { translate, type MessageKey } from '@/lib/i18n/messages';
import {
  buildDemoManifest,
  buildManifest,
  routeForMode,
  type TourMode,
  type TourPage,
  type TourStep,
} from './tour-steps';
import {
  TOUR_START_EVENT,
  clearTourState,
  deferTourForSession,
  hasSeenDemoTour,
  isTourDeferred,
  markDemoTourSeen,
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
  // Set before the route-change teardown so onDestroyed can tell "the founder
  // pressed X / Esc" (a decision) from "the founder navigated away" (an
  // interruption). Only the former spends users.onboarded.
  const navAbandon = useRef(false);
  const autoChecked = useRef(false);
  const [tick, setTick] = useState(0);

  // relaunchTour() pings this so an already-mounted controller re-evaluates
  // without a navigation (covers "Replay tour" clicked while already on /).
  useEffect(() => {
    const onStart = () => setTick((n) => n + 1);
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, []);

  // The public /demo replica runs the same walkthrough over its own routes.
  // It has no account (no users.onboarded, no /api/dashboard) and no workspace
  // dashboard chapter — see buildDemoManifest().
  const isDemo = pathname === '/demo' || pathname.startsWith('/demo/');
  const mode: TourMode = isDemo ? 'demo' : 'app';
  // The /demo shell is hardcoded Italian by design (src/app/demo/*, exempt from
  // the i18n guard), so its tour speaks Italian too — otherwise a visitor with
  // an English cookie reads English popovers over an Italian screen.
  const tr = isDemo ? (key: MessageKey) => translate('it', key) : t;

  useEffect(() => {
    let cancelled = false;

    // A live instance on route change means the user wandered off mid-tour
    // (hand-offs destroy BEFORE pushing): tear down → onDestroyed ends the run
    // WITHOUT spending the flag, and defers re-offering until the next session.
    if (drvRef.current) {
      navAbandon.current = true;
      drvRef.current.destroy();
      drvRef.current = null;
    }

    if (!isDemo && pathname !== '/' && !pathname.startsWith('/project/')) return;

    /**
     * End the tour. `keepOffer: true` ends THIS run without spending the
     * durable users.onboarded flag.
     *
     * Why that distinction exists (2026-08-08 onboarding audit): a founder on
     * their very first login has zero projects, so buildManifest degrades to a
     * 2-step "welcome + create your first project" stub. Marking them onboarded
     * at the end of that stub meant the real 18-step walkthrough — Home,
     * Watchers, Knowledge, Financials, Co-pilot — could never auto-run for
     * ANYONE, because the only auto-start opportunity was consumed while the
     * account was still empty.
     */
    const markDone = ({ keepOffer = false } = {}) => {
      clearTourState();
      if (keepOffer) return;
      if (isDemo) {
        markDemoTourSeen(); // public page: a localStorage flag is the only gate
        return;
      }
      api.patch('/api/user/preferences', { onboarded: true }).catch(() => {});
    };

    /** Route for a step under whichever shell we're in. */
    const routeOf = (page: TourPage, pid: string | null) => routeForMode(mode, page, pid);

    const buildAndDrive = async (manifest: TourStep[], startIdx: number, pid: string | null) => {
      // The zero-project stub is a prompt ("create your first project"), not
      // the onboarding — finishing it must leave the real tour still owed.
      const isStub = !isDemo && !pid;
      const steps: DriveStep[] = manifest.map((s, i) => {
        // Chapter openers hide Prev: cross-page "back" would double the
        // navigation state machine for marginal value.
        const chapterFirst = i === 0 || manifest[i - 1].page !== s.page;
        return {
          element: s.target,
          ...(s.allowInteraction ? { disableActiveInteraction: false } : {}),
          popover: {
            title: tr(s.titleKey),
            description: tr(s.descKey),
            side: s.side,
            align: s.align ?? 'start',
            ...(chapterFirst ? { showButtons: ['next', 'close'] as ('next' | 'close')[] } : {}),
          },
        };
      });

      const advance = async (drv: Driver, next: number) => {
        if (next >= manifest.length) {
          // Finish. End first, then tear down: destroy() fires no hook we can
          // depend on (see endRun).
          endRun({ keepOffer: isStub });
          drv.destroy();
          return;
        }
        const nextStep = manifest[next];
        if (nextStep.page !== manifest[next - 1].page) {
          // Chapter boundary: persist, tear down silently, navigate. The
          // pathname effect resumes the next chapter on arrival.
          writeTourState({ stepIndex: next, projectId: pid, mode });
          suppressFinish.current = true;
          drv.destroy();
          drvRef.current = null;
          router.push(routeOf(nextStep.page, pid));
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
        writeTourState({ stepIndex: next, projectId: pid, mode });
        drv.moveTo(next);
      };

      // Next-clicks during a pending waitForElement (slow page data) must not
      // stack concurrent advances — a double-timeout would double-skip.
      let advancing = false;

      /**
       * End this run exactly once.
       *
       * driver.js 1.4.0 does NOT reliably call onDestroyed: its public
       * destroy() is `g(false)`, which skips the onDestroyStarted branch and
       * then only invokes onDestroyed `if (__activeElement && __activeStep)` —
       * internal keys its teardown has already released in practice. Verified
       * live on 2026-09-02: finishing (Done) and closing (X) both left the run
       * un-ended, so the walkthrough re-offered itself on every page load and
       * neither users.onboarded nor the demo's seen flag was ever written.
       * Bookkeeping therefore happens HERE, at the two places a run can end,
       * with onDestroyed kept only as a harmless fallback.
       */
      let ended = false;
      const endRun = ({ keepOffer = false } = {}) => {
        if (ended) return;
        ended = true;
        markDone({ keepOffer });
      };

      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const { driver } = await loadDriver();
      if (cancelled) return; // navigated away while the library was loading
      const drv = driver({
        showProgress: true,
        progressText: tr('tour.progress'),
        allowClose: true,
        disableActiveInteraction: true, // a mid-tour click on a highlighted link would desync route vs step
        animate: !reducedMotion,
        nextBtnText: tr('tour.next'),
        prevBtnText: tr('tour.prev'),
        doneBtnText: tr('tour.done-btn'),
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
          writeTourState({ stepIndex: cur - 1, projectId: pid, mode });
          drv.moveTo(cur - 1);
        },
        // X / Esc / overlay click all reach driver's internal destroy with the
        // hook branch ENABLED, so this is the one callback that reliably fires
        // when the founder dismisses the tour. It owns the teardown: destroy()
        // here re-enters as g(false) and does not loop.
        onDestroyStarted: () => {
          endRun({ keepOffer: isStub });
          drv.destroy();
        },
        onDestroyed: () => {
          if (drvRef.current === drv) drvRef.current = null;
          if (suppressFinish.current) {
            suppressFinish.current = false;
            return;
          }
          if (navAbandon.current) {
            navAbandon.current = false;
            deferTourForSession();
            endRun({ keepOffer: true });
            return;
          }
          // Fallback only — endRun() has almost always run by now.
          endRun({ keepOffer: isStub });
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
      if (!isDemo && state.stepIndex === 0 && pid === null && pathname === '/') {
        try {
          const { data } = await api.get<DashboardResp>('/api/dashboard');
          pid = data?.data?.projects?.[0]?.project_id ?? null;
        } catch {
          pid = null;
        }
        if (cancelled) return;
        if (pid) writeTourState({ stepIndex: 0, projectId: pid, mode });
      }

      const manifest = isDemo ? buildDemoManifest() : buildManifest({ hasProjects: !!pid });
      const step = manifest[state.stepIndex];
      if (!step) {
        markDone({ keepOffer: true }); // corrupt/stale index is not a decision
        return;
      }
      if (pathname !== routeOf(step.page, pid)) {
        // Fresh start from the dashboard whose first chapter lives inside the
        // project (changelog 28/08 order: the tour opens on project Home):
        // navigate INTO the tour instead of deferring — the pathname effect
        // resumes chapter 1 on arrival. Only for step 0; anything later is a
        // genuine deep link / browser back.
        if (!isDemo && state.stepIndex === 0 && pathname === '/' && pid) {
          writeTourState({ stepIndex: 0, projectId: pid, mode });
          router.push(routeOf(step.page, pid));
          return;
        }
        // Deep link / browser back mid-tour: end this run rather than dragging
        // the user back to the expected page — but the tour stays owed.
        deferTourForSession();
        markDone({ keepOffer: true });
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
        markDone({ keepOffer: !isDemo && !pid });
        return;
      }
      if (manifest[idx].page !== step.page) {
        // Every remaining in-page step skipped → straight to the next chapter.
        writeTourState({ stepIndex: idx, projectId: pid, mode });
        router.push(routeOf(manifest[idx].page, pid));
        return;
      }
      if (idx !== state.stepIndex || pid !== state.projectId) {
        writeTourState({ stepIndex: idx, projectId: pid, mode });
      }
      void buildAndDrive(manifest, idx, pid);
    };

    const state = readTourState();
    // A run is resumed only by the shell that started it: an app tour paused
    // mid-flight must not try to resume against the demo manifest (different
    // steps, different routes), and it stays owed while the visitor is on /demo.
    if (state && state.mode !== mode) return;
    if (state) {
      void resumeAt(state);
    } else if (isDemo && pathname === '/demo' && !autoChecked.current && !isTourDeferred() && !hasSeenDemoTour()) {
      // Public first visit: no preferences call to make, so start straight away.
      autoChecked.current = true;
      const fresh: TourState = { stepIndex: 0, projectId: null, mode: 'demo' };
      writeTourState(fresh);
      void resumeAt(fresh);
    } else if (!isDemo && pathname === '/' && !autoChecked.current && !isTourDeferred()) {
      // First-login auto-start: once per mount, dashboard only, and never in a
      // session where the founder already walked away from a run.
      autoChecked.current = true;
      void (async () => {
        try {
          const { data } = await api.get<{ onboarded?: boolean }>('/api/user/preferences');
          if (data?.onboarded !== false) return;
        } catch {
          return; // can't determine → don't surprise the user with a tour
        }
        if (cancelled) return;
        const fresh: TourState = { stepIndex: 0, projectId: null, mode: 'app' };
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
  }, [pathname, tick, isDemo, mode]);

  return null;
}
