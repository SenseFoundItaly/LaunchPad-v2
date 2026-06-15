'use client';

import { useT } from '@/components/providers/LocaleProvider';

interface SignalCardProps {
  severity: string;
  projectName: string;
  message: string;
  createdAt: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-clay/20 text-clay border-clay/30',
  warning: 'bg-accent-wash text-accent border-accent/30',
  info: 'bg-paper-3/50 text-ink-4 border-paper-3',
  positive: 'bg-moss-wash text-moss border-moss/30',
};

export default function SignalCard({ severity, projectName, message, createdAt }: SignalCardProps) {
  const t = useT();
  const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.info;

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return t('cards.time-mins-ago', { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('cards.time-hours-ago', { count: hrs });
    const days = Math.floor(hrs / 24);
    return t('cards.time-days-ago', { count: days });
  }

  return (
    <div className={`shrink-0 w-64 border rounded-lg p-3 ${style}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider">{severity}</span>
        <span className="text-[10px] text-ink-6">{timeAgo(createdAt)}</span>
      </div>
      <div className="text-[10px] text-ink-5 mb-1">{projectName}</div>
      <p className="text-xs leading-relaxed line-clamp-2">{message}</p>
    </div>
  );
}
