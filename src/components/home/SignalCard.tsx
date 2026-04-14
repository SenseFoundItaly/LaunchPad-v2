'use client';

interface SignalCardProps {
  severity: string;
  projectName: string;
  message: string;
  createdAt: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  warning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  info: 'bg-zinc-700/50 text-zinc-400 border-zinc-700',
  positive: 'bg-green-500/20 text-green-400 border-green-500/30',
};

export default function SignalCard({ severity, projectName, message, createdAt }: SignalCardProps) {
  const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.info;

  return (
    <div className={`shrink-0 w-64 border rounded-lg p-3 ${style}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider">{severity}</span>
        <span className="text-[10px] text-zinc-600">{timeAgo(createdAt)}</span>
      </div>
      <div className="text-[10px] text-zinc-500 mb-1">{projectName}</div>
      <p className="text-xs leading-relaxed line-clamp-2">{message}</p>
    </div>
  );
}
