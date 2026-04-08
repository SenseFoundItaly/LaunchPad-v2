'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const STEPS = [
  { num: 1, name: 'Chat', path: 'chat' },
  { num: 2, name: 'Scoring', path: 'scoring' },
  { num: 3, name: 'Research', path: 'research' },
  { num: 4, name: 'Simulation', path: 'simulation' },
  { num: 5, name: 'Workflow', path: 'workflow' },
];

interface StepNavProps {
  projectId: string;
  currentStep: number;
}

export default function StepNav({ projectId, currentStep }: StepNavProps) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 px-6 py-3 bg-zinc-900 border-b border-zinc-800 overflow-x-auto">
      {STEPS.map((step, i) => {
        const href = `/project/${projectId}/${step.path}`;
        const isActive = pathname?.includes(step.path);
        const isCompleted = step.num < currentStep;
        const isAccessible = step.num <= currentStep;

        return (
          <div key={step.num} className="flex items-center">
            {i > 0 && (
              <div className={`w-8 h-px mx-1 ${isCompleted ? 'bg-blue-500' : 'bg-zinc-700'}`} />
            )}
            <Link
              href={href}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-blue-500/20 text-blue-400'
                  : isCompleted
                    ? 'text-zinc-300 hover:bg-zinc-800'
                    : isAccessible
                      ? 'text-zinc-400 hover:bg-zinc-800'
                      : 'text-zinc-600 cursor-default'
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${
                  isActive
                    ? 'bg-blue-500 text-white'
                    : isCompleted
                      ? 'bg-blue-500/30 text-blue-400'
                      : 'bg-zinc-800 text-zinc-500'
                }`}
              >
                {isCompleted ? '+' : step.num}
              </span>
              <span className="whitespace-nowrap">{step.name}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
