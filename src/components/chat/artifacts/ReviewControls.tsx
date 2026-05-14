'use client';

import type { ReviewedState } from '@/types/artifacts';

interface ReviewControlsProps {
  reviewState: ReviewedState;
  onReview: (state: 'applied' | 'rejected') => void | Promise<void>;
}

export default function ReviewControls({ reviewState, onReview }: ReviewControlsProps) {
  if (reviewState === 'applied') {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium flex items-center gap-1">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Applied
      </span>
    );
  }

  if (reviewState === 'rejected') {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-medium flex items-center gap-1">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        Rejected
      </span>
    );
  }

  return (
    <>
      <button
        onClick={() => onReview('applied')}
        className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors font-medium"
      >
        Apply
      </button>
      <button
        onClick={() => onReview('rejected')}
        className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-700/50 text-zinc-400 hover:text-red-400 hover:bg-red-500/20 transition-colors font-medium"
      >
        Reject
      </button>
    </>
  );
}
