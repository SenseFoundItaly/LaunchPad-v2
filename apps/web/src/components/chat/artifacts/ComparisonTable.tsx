'use client';

import type { ComparisonTable as ComparisonTableType } from '@/types/artifacts';

interface ComparisonTableProps {
  artifact: ComparisonTableType;
}

export default function ComparisonTable({ artifact }: ComparisonTableProps) {
  return (
    <div className="my-3 overflow-x-auto">
      {artifact.title && (
        <h4 className="text-sm font-semibold text-ink mb-2">{artifact.title}</h4>
      )}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-paper-3">
            <th className="text-left px-3 py-2 text-ink-4 font-medium border border-line-2 rounded-tl-md">
              &nbsp;
            </th>
            {artifact.columns.map((col) => (
              <th
                key={col}
                className="text-left px-3 py-2 text-ink-4 font-medium border border-line-2"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {artifact.rows.map((row) => (
            <tr key={row.label} className="bg-paper-2 hover:bg-paper-3/60 transition-colors">
              <td className="px-3 py-2 text-ink-2 font-medium border border-line-2">
                {row.label}
              </td>
              {row.values.map((value, idx) => (
                <td
                  key={`${row.label}-${artifact.columns[idx]}`}
                  className="px-3 py-2 text-ink-3 border border-line-2"
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
