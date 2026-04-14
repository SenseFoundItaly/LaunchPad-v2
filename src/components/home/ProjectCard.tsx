'use client';

import { useRouter } from 'next/navigation';

interface ProjectCardProps {
  projectId: string;
  name: string;
  description?: string;
  skillsCompleted: number;
  totalSkills: number;
  weeklyAlerts: number;
  createdAt: string;
}

export default function ProjectCard({
  projectId, name, description, skillsCompleted, totalSkills, weeklyAlerts, createdAt,
}: ProjectCardProps) {
  const router = useRouter();
  const pct = totalSkills > 0 ? Math.round((skillsCompleted / totalSkills) * 100) : 0;
  const score = (skillsCompleted / totalSkills) * 10;
  const verdict = score >= 8 ? 'STRONG GO' : score >= 6 ? 'GO' : score >= 4 ? 'CAUTION' : 'NOT READY';
  const verdictColor = score >= 8 ? 'bg-green-500/20 text-green-400'
    : score >= 6 ? 'bg-emerald-500/20 text-emerald-400'
    : score >= 4 ? 'bg-yellow-500/20 text-yellow-400'
    : 'bg-red-500/20 text-red-400';

  return (
    <div
      onClick={() => router.push(`/project/${projectId}/chat`)}
      className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 cursor-pointer hover:border-zinc-700 transition-colors group"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors truncate flex-1">
          {name}
        </h3>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ml-2 shrink-0 ${verdictColor}`}>
          {verdict}
        </span>
      </div>

      {description && (
        <p className="text-xs text-zinc-500 mb-3 line-clamp-1">{description}</p>
      )}

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-zinc-600">{skillsCompleted}/{totalSkills} skills</span>
          <span className="text-[10px] text-zinc-600">{pct}%</span>
        </div>
        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              backgroundColor: pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444',
            }}
          />
        </div>
      </div>

      {/* Bottom stats */}
      <div className="flex items-center justify-between text-[10px] text-zinc-600">
        <span>{weeklyAlerts > 0 ? `${weeklyAlerts} alert${weeklyAlerts > 1 ? 's' : ''} this week` : 'No alerts'}</span>
        <span>{new Date(createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}
