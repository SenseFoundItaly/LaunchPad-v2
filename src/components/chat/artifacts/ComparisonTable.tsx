'use client';

import type { ComparisonTable as ComparisonTableType } from '@/types/artifacts';

interface ComparisonTableProps {
  artifact: ComparisonTableType;
}

export default function ComparisonTable({ artifact }: ComparisonTableProps) {
  return (
    <div className="my-3 overflow-x-auto">
      {artifact.title && (
        <h4 className="text-sm font-semibold text-zinc-100 mb-2">{artifact.title}</h4>
      )}
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-zinc-800">
            <th className="text-left px-3 py-2 text-zinc-400 font-medium border border-zinc-700 rounded-tl-md">
              &nbsp;
            </th>
            {artifact.columns.map((col) => (
              <th
                key={col}
                className="text-left px-3 py-2 text-zinc-400 font-medium border border-zinc-700"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {artifact.rows.map((row) => (
            <tr key={row.label} className="bg-zinc-900 hover:bg-zinc-800/60 transition-colors">
              <td className="px-3 py-2 text-zinc-200 font-medium border border-zinc-700">
                {row.label}
              </td>
              {row.values.map((value, idx) => (
                <td
                  key={`${row.label}-${artifact.columns[idx]}`}
                  className="px-3 py-2 text-zinc-300 border border-zinc-700"
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
