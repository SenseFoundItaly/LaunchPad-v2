'use client';

import { useRouter } from 'next/navigation';
import { useT } from '@/components/providers/LocaleProvider';

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
  const t = useT();
  const pct = totalSkills > 0 ? Math.round((skillsCompleted / totalSkills) * 100) : 0;
  const score = (skillsCompleted / totalSkills) * 10;
  const verdictKey = score >= 8 ? 'cards.verdict-strong-go' : score >= 6 ? 'cards.verdict-go' : score >= 4 ? 'cards.verdict-caution' : 'cards.verdict-not-ready';
  const verdictColor = score >= 8 ? 'bg-moss-wash text-moss'
    : score >= 6 ? 'bg-moss/20 text-moss'
    : score >= 4 ? 'bg-accent-wash text-accent'
    : 'bg-clay/20 text-clay';

  return (
    <div
      onClick={() => router.push(`/project/${projectId}/chat`)}
      className="bg-paper border border-line rounded-xl p-5 cursor-pointer hover:border-line-2 transition-colors group"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-ink group-hover:text-moss transition-colors truncate flex-1">
          {name}
        </h3>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ml-2 shrink-0 ${verdictColor}`}>
          {t(verdictKey)}
        </span>
      </div>

      {description && (
        <p className="text-xs text-ink-5 mb-3 line-clamp-1">{description}</p>
      )}

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-ink-6">{t('cards.skills-count', { completed: skillsCompleted, total: totalSkills })}</span>
          <span className="text-[10px] text-ink-6">{pct}%</span>
        </div>
        <div className="w-full h-1.5 bg-paper-2 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              backgroundColor: pct >= 70 ? 'var(--moss)' : pct >= 40 ? 'var(--cat-gold)' : 'var(--clay)',
            }}
          />
        </div>
      </div>

      {/* Bottom stats */}
      <div className="flex items-center justify-between text-[10px] text-ink-6">
        <span>{weeklyAlerts > 0 ? (weeklyAlerts === 1 ? t('cards.alerts-this-week-one', { count: weeklyAlerts }) : t('cards.alerts-this-week-other', { count: weeklyAlerts })) : t('cards.no-alerts')}</span>
        <span>{new Date(createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}
