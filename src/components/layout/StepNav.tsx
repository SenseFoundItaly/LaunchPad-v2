'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';

const STEPS: { num: number; labelKey: MessageKey; path: string }[] = [
  { num: 1, labelKey: 'layout.step.chat', path: 'chat' },
  { num: 2, labelKey: 'layout.step.scoring', path: 'scoring' },
  { num: 3, labelKey: 'layout.step.research', path: 'research' },
  { num: 4, labelKey: 'layout.step.simulation', path: 'simulation' },
  { num: 5, labelKey: 'layout.step.workflow', path: 'workflow' },
];

interface StepNavProps {
  projectId: string;
  currentStep: number;
}

export default function StepNav({ projectId, currentStep }: StepNavProps) {
  const pathname = usePathname();
  const t = useT();

  return (
    <nav className="flex items-center gap-1 px-6 py-3 bg-paper border-b border-line overflow-x-auto">
      {STEPS.map((step, i) => {
        const href = `/project/${projectId}/${step.path}`;
        const isActive = pathname?.includes(step.path);
        const isCompleted = step.num < currentStep;
        const isAccessible = step.num <= currentStep;

        return (
          <div key={step.num} className="flex items-center">
            {i > 0 && (
              <div className={`w-8 h-px mx-1 ${isCompleted ? 'bg-moss' : 'bg-paper-3'}`} />
            )}
            <Link
              href={href}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-moss/20 text-moss'
                  : isCompleted
                    ? 'text-ink-3 hover:bg-paper-2'
                    : isAccessible
                      ? 'text-ink-4 hover:bg-paper-2'
                      : 'text-ink-6 cursor-default'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${
                  isActive
                    ? 'bg-moss text-paper'
                    : isCompleted
                      ? 'bg-moss/30 text-moss'
                      : 'bg-paper-2 text-ink-5'
                }`}
              >
                {isCompleted ? '+' : step.num}
              </span>
              <span className="whitespace-nowrap">{t(step.labelKey)}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
