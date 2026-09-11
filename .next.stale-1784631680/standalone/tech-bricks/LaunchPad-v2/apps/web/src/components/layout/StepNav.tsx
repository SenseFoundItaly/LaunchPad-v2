'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const STEPS = [
  { num: 1, name: 'Idea', path: 'idea' },
  { num: 2, name: 'Score', path: 'scoring' },
  { num: 3, name: 'Evidence', path: 'research' },
  { num: 4, name: 'Stress Test', path: 'simulation' },
  { num: 5, name: 'Action Plan', path: 'workflow' },
];

interface StepNavProps {
  projectId: string;
  currentStep: number;
}

export default function StepNav({ projectId, currentStep }: StepNavProps) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 px-6 py-3 bg-paper-2 border-b border-line overflow-x-auto">
      {STEPS.map((step, i) => {
        const href = `/project/${projectId}/${step.path}`;
        const isActive = pathname?.includes(step.path);
        const isCompleted = step.num < currentStep;
        const isAccessible = step.num <= currentStep;

        return (
          <div key={step.num} className="flex items-center">
            {i > 0 && (
              <div className={`w-8 h-px mx-1 ${isCompleted ? 'bg-moss' : 'bg-ink-6'}`} />
            )}
            <Link
              href={href}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-sky-wash text-sky'
                  : isCompleted
                    ? 'text-ink-3 hover:bg-paper-3'
                    : isAccessible
                      ? 'text-ink-4 hover:bg-paper-3'
                      : 'text-ink-6 cursor-default'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${
                  isActive
                    ? 'bg-moss text-on-accent'
                    : isCompleted
                      ? 'bg-moss/30 text-sky'
                      : 'bg-paper-3 text-ink-5'
                }`}
              >
                {isCompleted ? '\u2713' : step.num}
              </span>
              <span className="whitespace-nowrap">{step.name}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
