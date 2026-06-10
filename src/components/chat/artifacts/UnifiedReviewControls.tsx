'use client';

/**
 * UnifiedReviewControls — single approval/reject UX for all artifact types.
 *
 * Replaces three patterns:
 *  1. ReviewControls (InsightCard, ComparisonTable, MetricGridCard, EntityCardInline)
 *  2. Custom button rows in MonitorProposalCard / BudgetProposalCard
 *  3. Lane-specific buttons in PendingCard
 *
 * All action routing stays on the page-level `handleArtifactAction` — this
 * component is visual only.
 */

import type { ActionLane } from '@/lib/action-lanes';

// 'monitor' lane never reaches these controls — monitors aren't pending_actions.
// We type the maps without it so we don't have to invent meaningless labels.
type ReviewableLane = Exclude<ActionLane, 'monitor'>;

export interface UnifiedReviewControlsProps {
  lane: ReviewableLane;
  state: 'pending' | 'applied' | 'rejected' | 'busy' | 'error';
  onApply: () => void;
  onReject?: () => void;
  onEdit?: () => void;
  errorMessage?: string;
  /** 'inline' renders compact pills for header placement; 'footer' renders large buttons */
  variant?: 'inline' | 'footer';
  /** Where data goes when applied, e.g. "Knowledge Graph" */
  destination?: string;
  /** Brief impact description, e.g. "Will inform future AI responses".
   *  Rendered ONLY while the action is still pending (next to live
   *  Apply/Reject controls) — so always write it in FUTURE tense. */
  impactHint?: string;
}

// ---------------------------------------------------------------------------
// Lane-aware labels
// ---------------------------------------------------------------------------

const APPLY_LABELS: Record<ReviewableLane, string> = {
  approval: 'Apply',
  todo: 'Mark done',
  notification: 'Acknowledge',
};

const REJECT_LABELS: Record<ReviewableLane, string> = {
  approval: 'Reject',
  todo: 'Dismiss',
  notification: 'Dismiss',
};

const APPLIED_LABELS: Record<ReviewableLane, string> = {
  approval: 'Applied',
  todo: 'Done',
  notification: 'Acknowledged',
};

const REJECTED_LABELS: Record<ReviewableLane, string> = {
  approval: 'Rejected',
  todo: 'Dismissed',
  notification: 'Dismissed',
};

// ---------------------------------------------------------------------------
// Icons (same SVGs as the old ReviewControls for visual continuity)
// ---------------------------------------------------------------------------

const CheckIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
    <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const XIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
    <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const SpinnerIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" className="animate-spin">
    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="8" strokeLinecap="round" />
  </svg>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UnifiedReviewControls({
  lane,
  state,
  onApply,
  onReject,
  onEdit,
  errorMessage,
  variant = 'inline',
  destination,
  impactHint,
}: UnifiedReviewControlsProps) {
  const isFooter = variant === 'footer';

  // --- Applied pill -------------------------------------------------------
  if (state === 'applied') {
    return (
      <span className={`${
        isFooter
          ? 'text-xs px-4 py-2 rounded-lg'
          : 'text-[10px] px-2 py-0.5 rounded-full'
      } bg-moss-wash text-moss font-medium flex items-center gap-1.5`}>
        <CheckIcon size={isFooter ? 14 : 10} />
        {APPLIED_LABELS[lane]}
      </span>
    );
  }

  // --- Rejected pill ------------------------------------------------------
  if (state === 'rejected') {
    return (
      <span className={`${
        isFooter
          ? 'text-xs px-4 py-2 rounded-lg'
          : 'text-[10px] px-2 py-0.5 rounded-full'
      } bg-clay/20 text-clay font-medium flex items-center gap-1.5`}>
        <XIcon size={isFooter ? 14 : 10} />
        {REJECTED_LABELS[lane]}
      </span>
    );
  }

  // --- Busy (spinner) -----------------------------------------------------
  if (state === 'busy') {
    if (isFooter) {
      return (
        <div className="flex items-center justify-center gap-2 pt-3 mt-3 border-t border-line-2">
          <SpinnerIcon size={16} />
          <span className="text-sm text-ink-4">Processing…</span>
        </div>
      );
    }
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-paper-3/50 text-ink-4 font-medium flex items-center gap-1.5">
        <SpinnerIcon size={10} />
      </span>
    );
  }

  // --- Error + retry ------------------------------------------------------
  if (state === 'error') {
    return (
      <div className={isFooter ? 'pt-3 mt-3 border-t border-line-2 space-y-2' : 'flex items-center gap-2'}>
        {errorMessage && (
          <div className={`${isFooter ? 'text-xs' : 'text-[10px]'} text-clay bg-clay/10 border border-clay/30 rounded px-2 py-1`}>
            {errorMessage}
          </div>
        )}
        <div className={`flex items-center gap-${isFooter ? '3' : '2'}`}>
          <button
            onClick={onApply}
            className={`${
              isFooter
                ? 'text-sm px-4 py-2.5 rounded-lg inline-flex items-center justify-center gap-2 bg-moss-wash text-moss hover:bg-moss/30 font-semibold'
                : 'text-[10px] px-2 py-0.5 rounded-full bg-moss-wash text-moss hover:bg-moss/30 font-medium'
            } transition-colors`}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // --- Pending: action buttons --------------------------------------------
  if (isFooter) {
    return (
      <div className="pt-3 mt-3 border-t border-line-2">
        {destination && (
          <div className="flex items-center gap-1.5 mb-2 text-[10px]">
            <span className="font-mono text-ink-4">{'\u2192'} {destination}</span>
            {impactHint && (
              <>
                <span className="text-ink-5">{'\u00B7'}</span>
                <span className="text-ink-5">{impactHint}</span>
              </>
            )}
          </div>
        )}
        <div className="flex items-center gap-3">
        <button
          onClick={onApply}
          className="flex-1 text-sm px-4 py-2.5 rounded-lg inline-flex items-center justify-center gap-2 bg-moss-wash text-moss hover:bg-moss/30 transition-colors font-semibold"
        >
          <CheckIcon size={16} />
          {APPLY_LABELS[lane]}
        </button>
        {onEdit && (
          <button
            onClick={onEdit}
            className="text-sm px-4 py-2.5 rounded-lg inline-flex items-center justify-center gap-2 bg-paper-3/60 text-ink-3 hover:bg-paper-3 transition-colors font-semibold"
          >
            Edit
          </button>
        )}
        {onReject && (
          <button
            onClick={onReject}
            className="flex-1 text-sm px-4 py-2.5 rounded-lg inline-flex items-center justify-center gap-2 bg-paper-3/60 text-ink-4 hover:text-clay hover:bg-clay/15 transition-colors font-semibold"
          >
            <XIcon size={16} />
            {REJECT_LABELS[lane]}
          </button>
        )}
        </div>
      </div>
    );
  }

  // inline variant
  const inlineTooltip = destination
    ? `\u2192 ${destination}${impactHint ? ` \u2014 ${impactHint}` : ''}`
    : undefined;

  return (
    <>
      <button
        onClick={onApply}
        title={inlineTooltip}
        className="text-[10px] px-2 py-0.5 rounded-full bg-moss-wash text-moss hover:bg-moss/30 transition-colors font-medium"
      >
        {APPLY_LABELS[lane]}
      </button>
      {onEdit && (
        <button
          onClick={onEdit}
          className="text-[10px] px-2 py-0.5 rounded-full bg-paper-3/50 text-ink-3 hover:bg-paper-3 transition-colors font-medium"
        >
          Edit
        </button>
      )}
      {onReject && (
        <button
          onClick={onReject}
          className="text-[10px] px-2 py-0.5 rounded-full bg-paper-3/50 text-ink-4 hover:text-clay hover:bg-clay/20 transition-colors font-medium"
        >
          {REJECT_LABELS[lane]}
        </button>
      )}
    </>
  );
}
