/**
 * Mid-tour persistence for the cross-page walkthrough (TourController.tsx).
 *
 * sessionStorage (not localStorage): a refresh or client navigation resumes
 * the tour at the saved step, but an abandoned half-tour doesn't resurrect
 * days later — users.onboarded stays the durable cross-device gate.
 */

export interface TourState {
  /** Global index into the buildManifest() step array. */
  stepIndex: number;
  /** The project the tour walks through; null = zero-project variant. */
  projectId: string | null;
}

const TOUR_KEY = 'lp_tour_state';
/**
 * Set when a run ends by NAVIGATION rather than by an explicit close. Such a
 * run keeps the tour owed (users.onboarded stays false) but must not re-offer
 * itself the instant the founder returns to `/`, or wandering off once would
 * turn into a nag loop for the rest of the session.
 */
const TOUR_DEFERRED_KEY = 'lp_tour_deferred';

export function deferTourForSession(): void {
  try {
    sessionStorage.setItem(TOUR_DEFERRED_KEY, '1');
  } catch {
    /* private mode — worst case the tour re-offers once more this session */
  }
}

export function isTourDeferred(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(TOUR_DEFERRED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Fired by relaunchTour() so an already-mounted controller re-evaluates. */
export const TOUR_START_EVENT = 'lp-tour-start';

export function readTourState(): TourState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(TOUR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TourState>;
    if (typeof parsed.stepIndex !== 'number' || parsed.stepIndex < 0) return null;
    return {
      stepIndex: parsed.stepIndex,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : null,
    };
  } catch {
    return null;
  }
}

export function writeTourState(state: TourState): void {
  try {
    sessionStorage.setItem(TOUR_KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — tour still works, just won't survive a refresh */
  }
}

export function clearTourState(): void {
  try {
    sessionStorage.removeItem(TOUR_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Manual replay entry point (Settings → "Replay tour", and the founder's
 * "1. Take the tour" step on the project Home card).
 *
 * The tour's first chapter lives on `/`. Called from anywhere else the
 * controller used to resume, find pathname !== '/', treat it as "wandered off
 * mid-tour" and immediately mark the account onboarded — so the most prominent
 * entry point in the product did visibly nothing AND burned the durable flag
 * (2026-08-08 onboarding audit). Navigating here makes every call site work.
 */
export function relaunchTour(): void {
  writeTourState({ stepIndex: 0, projectId: null });
  try {
    sessionStorage.removeItem(TOUR_DEFERRED_KEY); // an explicit ask overrides a deferral
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.location.pathname !== '/') {
    window.location.assign('/');
    return;
  }
  window.dispatchEvent(new Event(TOUR_START_EVENT));
}

/**
 * Poll for a step target (async data-loaded surfaces). 100ms interval keeps
 * this dependency-free; resolves null on timeout so the caller can skip.
 */
export function waitForElement(selector: string, timeoutMs = 3000): Promise<Element | null> {
  return new Promise((resolve) => {
    const immediate = document.querySelector(selector);
    if (immediate) {
      resolve(immediate);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const el = document.querySelector(selector);
      if (el) {
        clearInterval(timer);
        resolve(el);
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolve(null);
      }
    }, 100);
  });
}
