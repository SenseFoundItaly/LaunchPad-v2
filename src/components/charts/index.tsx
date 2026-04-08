'use client';

import {
  BarChart as RBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
  RadarChart as RRadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  PieChart as RPieChart, Pie,
} from 'recharts';

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
const AXIS_TICK = { fontSize: 11, fill: '#71717a' };

function DarkTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-zinc-800 px-3 py-2 text-sm shadow-lg border border-zinc-700">
      {label && <p className="text-zinc-300 mb-1 font-medium">{label}</p>}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-white font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Horizontal or vertical bar chart */
export function BarChart({ data, height = 250, title }: {
  data: { name: string; value: number; color?: string }[];
  height?: number;
  title?: string;
}) {
  if (!data?.length) return null;
  return (
    <div className="my-3">
      {title && <h4 className="text-xs font-semibold text-zinc-400 mb-2">{title}</h4>}
      <ResponsiveContainer width="100%" height={height}>
        <RBarChart data={data} layout="vertical" margin={{ left: 10, right: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis type="number" tick={AXIS_TICK} domain={[0, 'auto']} />
          <YAxis type="category" dataKey="name" tick={AXIS_TICK} width={100} />
          <Tooltip content={<DarkTooltip />} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color || COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Multi-dimensional radar chart */
export function RadarChart({ data, height = 280, title }: {
  data: { subject: string; value: number; fullMark?: number }[];
  height?: number;
  title?: string;
}) {
  if (!data?.length) return null;
  return (
    <div className="my-3">
      {title && <h4 className="text-xs font-semibold text-zinc-400 mb-2">{title}</h4>}
      <ResponsiveContainer width="100%" height={height}>
        <RRadarChart data={data}>
          <PolarGrid stroke="#3f3f46" />
          <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#a1a1aa' }} />
          <PolarRadiusAxis tick={{ fontSize: 9, fill: '#71717a' }} domain={[0, 10]} />
          <Radar dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} strokeWidth={2} />
        </RRadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Pie/donut chart */
export function PieChart({ data, height = 250, title, donut = true }: {
  data: { name: string; value: number; color?: string }[];
  height?: number;
  title?: string;
  donut?: boolean;
}) {
  if (!data?.length) return null;
  return (
    <div className="my-3">
      {title && <h4 className="text-xs font-semibold text-zinc-400 mb-2">{title}</h4>}
      <ResponsiveContainer width="100%" height={height}>
        <RPieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={donut ? 50 : 0}
            outerRadius={80}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            labelLine={{ stroke: '#52525b' }}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color || COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<DarkTooltip />} />
        </RPieChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Score gauge — semicircular progress */
export function GaugeChart({ score, maxScore = 10, label, verdict }: {
  score: number;
  maxScore?: number;
  label?: string;
  verdict?: string;
}) {
  const pct = Math.min(score / maxScore, 1);
  const color = pct >= 0.7 ? '#10b981' : pct >= 0.5 ? '#f59e0b' : '#ef4444';
  const verdictColor = verdict === 'GO' || verdict === 'strong_go' ? 'text-green-400 bg-green-500/20'
    : verdict === 'CAUTION' || verdict === 'conditional' ? 'text-yellow-400 bg-yellow-500/20'
    : verdict === 'NO-GO' || verdict === 'no_go' ? 'text-red-400 bg-red-500/20'
    : 'text-blue-400 bg-blue-500/20';

  return (
    <div className="my-3 flex flex-col items-center">
      <svg width="160" height="90" viewBox="0 0 160 90">
        {/* Background arc */}
        <path
          d="M 15 85 A 65 65 0 0 1 145 85"
          fill="none"
          stroke="#27272a"
          strokeWidth="12"
          strokeLinecap="round"
        />
        {/* Score arc */}
        <path
          d="M 15 85 A 65 65 0 0 1 145 85"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${pct * 204} 204`}
        />
        <text x="80" y="75" textAnchor="middle" className="text-2xl font-bold" fill="white">
          {score.toFixed(1)}
        </text>
        <text x="80" y="88" textAnchor="middle" className="text-xs" fill="#71717a">
          / {maxScore}
        </text>
      </svg>
      {label && <span className="text-xs text-zinc-400 mt-1">{label}</span>}
      {verdict && (
        <span className={`text-xs font-bold px-3 py-1 rounded-full mt-2 ${verdictColor}`}>
          {verdict.replace('_', ' ').toUpperCase()}
        </span>
      )}
    </div>
  );
}

/** Progress ring — circular percentage */
export function ProgressRing({ value, size = 60, label }: {
  value: number;
  size?: number;
  label?: string;
}) {
  const radius = (size - 8) / 2;
  const circ = 2 * Math.PI * radius;
  const pct = Math.min(value / 100, 1);
  const color = pct >= 0.7 ? '#10b981' : pct >= 0.5 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#27272a" strokeWidth="4" />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fill="white" fontSize="13" fontWeight="bold">
          {value}%
        </text>
      </svg>
      {label && <span className="text-[10px] text-zinc-500">{label}</span>}
    </div>
  );
}

/** Score card with metric name, value, and color coding — optionally editable */
export function ScoreCard({ title, score, maxScore = 10, description, onChange, originalScore }: {
  title: string;
  score: number;
  maxScore?: number;
  description?: string;
  onChange?: (newScore: number) => void;
  originalScore?: number;
}) {
  const displayScore = score;
  const pct = displayScore / maxScore;
  const color = pct >= 0.7 ? 'text-green-400' : pct >= 0.5 ? 'text-yellow-400' : 'text-red-400';
  const bg = pct >= 0.7 ? 'bg-green-500/10 border-green-500/30' : pct >= 0.5 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-red-500/10 border-red-500/30';
  const barColor = pct >= 0.7 ? '#10b981' : pct >= 0.5 ? '#f59e0b' : '#ef4444';

  return (
    <div className={`rounded-lg border p-3 ${bg}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-zinc-400">{title}</span>
        <div className="flex items-center gap-2">
          {originalScore !== undefined && originalScore !== displayScore && (
            <span className="text-xs text-zinc-600 line-through">{originalScore.toFixed(1)}</span>
          )}
          <span className={`text-lg font-bold ${color}`}>{displayScore.toFixed(1)}</span>
        </div>
      </div>
      {description && <p className="text-[11px] text-zinc-500">{description}</p>}
      <div className="mt-2 w-full h-1.5 bg-black/20 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct * 100}%`, backgroundColor: barColor }} />
      </div>
      {onChange && (
        <input
          type="range"
          min={0}
          max={maxScore}
          step={0.1}
          value={displayScore}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full mt-2 h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-blue-500"
        />
      )}
    </div>
  );
}
