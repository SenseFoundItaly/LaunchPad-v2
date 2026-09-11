'use client';

import { ReactNode } from 'react';

interface SplitPanelProps {
  left: ReactNode;
  right: ReactNode;
  leftWidth?: string;
}

export default function SplitPanel({ left, right, leftWidth = '50%' }: SplitPanelProps) {
  return (
    <div className="flex h-full overflow-hidden">
      <div className="border-r border-line overflow-y-auto" style={{ width: leftWidth }}>
        {left}
      </div>
      <div className="flex-1 overflow-y-auto">{right}</div>
    </div>
  );
}
