'use client';

/**
 * SpineSection — horizontal 7-stage strip with click-to-expand inline detail.
 *
 * Data: GET /api/projects/{id}/intelligence (returns `stages[]` already
 * verdict-tagged + GET /api/projects/{id}/skills for per-skill completion).
 *
 * Layout: horizontal row of 7 chips. Click expands an inline detail panel
 * underneath the strip showing per-skill completion. Only one stage can be
 * open at a time.
 *
 * Verdict colors mirror IntelligenceSection (now removed).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { STAGES } from '@/lib/stages';
import type { StageVerdict as Verdict } from '@/lib/stages';

interface StageRow {
  id: string;
  name: string;
  order: number;
  color: string;
  completion_ratio: number;
  overall_score: number;
  /** Blended verdict — skill scores floored by journey evidence (audit M2). */
  verdict: Verdict;
  /** Journey gate checks passed/total — same numbers the Home journey card
   *  shows. Optional defensively: older cached payloads may lack them. */
  evidence_passed?: number;
  evidence_total?: number;
  skills_total: number;
  skills_completed: number;
  last_signal: { type: string; label: string; at: string } | null;
}

interface SkillCompletion {
  skill_id: string;
  status: string;
  summary: string | null;
  completed_at: string;
}

interface SpineSectionProps {
  projectId: string;
  locale: 'en' | 'it';
  /** Click handler for a skill row in the expanded breakdown. Convention:
   *  parent sends `I choose: <label>` through the chat — matches the existing
   *  select-option flow in chat/page.tsx so the agent kicks off the skill. */
  onSkillClick?: (skillLabel: string) => void;
}

const VERDICT_COLOR: Record<Verdict, string> = {
  strong_go: 'var(--moss)',
  go: 'var(--moss)',
  caution: 'var(--accent)',
  not_ready: 'var(--clay)',
};

const VERDICT_LABEL: Record<Verdict, { en: string; it: string }> = {
  strong_go: { en: 'STRONG GO', it: 'AVANTI FORTE' },
  go: { en: 'GO', it: 'AVANTI' },
  caution: { en: 'CAUTION', it: 'CAUTELA' },
  not_ready: { en: 'NOT READY', it: 'NON PRONTO' },
};

/** Compact relative-age formatter for the skill completion timestamp.
 *  e.g. "3d ago" / "2h ago" / "12m ago". Keeps the breakdown chip small. */
function formatRelativeAge(iso: string, locale: 'en' | 'it'): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const sec = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return locale === 'it' ? `${sec}s fa` : `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return locale === 'it' ? `${min}m fa` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return locale === 'it' ? `${hr}h fa` : `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return locale === 'it' ? `${day}g fa` : `${day}d ago`;
  return new Date(iso).toLocaleDateString(locale === 'it' ? 'it' : 'en');
}

interface ParsedSummary {
  prose: string;          // Prose outside any JSON block (intro / outro narrative)
  sections: { label: string; value: string }[];  // Top-level string fields from the JSON
  sources: { type?: string; title?: string; url?: string; quote?: string }[];
}

/**
 * Parse a skill completion summary into human-readable sections.
 *
 * Skill outputs are typically a single ```json {...}``` block wrapping the
 * structured payload under a top-level key like "scientific_validation" or
 * "market_research". Showing this raw to the founder is unfriendly. This
 * helper extracts: (a) prose narrative around the JSON block, (b) top-level
 * string fields (icp_statement, summary, overall_grade, etc.) labeled, and
 * (c) the sources array if present.
 *
 * Falls back gracefully — if no JSON block matches, returns the raw text as
 * prose so the popover never goes blank.
 */
function parseSkillSummary(raw: string): ParsedSummary {
  const out: ParsedSummary = { prose: '', sections: [], sources: [] };
  if (!raw) return out;

  // Skill outputs commonly drop the closing ``` fence (token cutoff during
  // streaming or model laziness). Try the well-formed shape first, then fall
  // back to "from ```json to end of string" so we still extract the payload.
  let fenceMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
  let jsonText = fenceMatch?.[1];
  let fenceStart = fenceMatch?.index ?? -1;
  let fenceEnd = fenceMatch ? fenceStart + fenceMatch[0].length : -1;
  if (!jsonText) {
    const openIdx = raw.search(/```json\s*/);
    if (openIdx >= 0) {
      const after = raw.slice(openIdx).replace(/```json\s*/, '');
      jsonText = after;
      fenceStart = openIdx;
      fenceEnd = raw.length;
    }
  }
  if (!jsonText) {
    out.prose = raw.trim();
    return out;
  }

  out.prose = (raw.slice(0, fenceStart) + ' ' + raw.slice(fenceEnd)).trim();

  // Try parsing as-is; if the JSON is truncated by streaming/token cutoff,
  // walk the structure and append the missing closers. Skill outputs often
  // run thousands of chars deep into nested objects and never reach the
  // outermost close, so naive parse always fails — but the early/top-level
  // fields we want to surface are intact.
  const tryParse = (s: string): unknown | null => {
    try { return JSON.parse(s); } catch { return null; }
  };
  let parsed: unknown = tryParse(jsonText);
  if (parsed === null) {
    // Walk the text tracking container depth + the depth-stack at each
    // safe boundary. lastSafe only updates on STRUCTURAL boundaries: `,`,
    // `{`, `[`, `}`, `]` outside any string. It must NOT update on string
    // closes — that lets a partial key like `"foo_bar"` with no `:value`
    // leak into the candidate and break the parse.
    let stack: string[] = [];
    let safeStack: string[] = [];
    let inString = false;
    let escape = false;
    let lastSafe = 0;
    for (let i = 0; i < jsonText.length; i++) {
      const c = jsonText[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{' || c === '[') {
        stack.push(c);
      } else if (c === '}' || c === ']') {
        stack.pop();
      }
      if (c === ',' || c === '{' || c === '[' || c === '}' || c === ']') {
        lastSafe = i + 1;
        safeStack = [...stack];
      }
    }
    let candidate = jsonText.slice(0, lastSafe).replace(/,\s*$/, '');
    for (let i = safeStack.length - 1; i >= 0; i--) {
      candidate += safeStack[i] === '{' ? '}' : ']';
    }
    parsed = tryParse(candidate);
  }
  if (parsed === null) {
    out.prose = (out.prose + '\n\n' + jsonText).trim();
    return out;
  }

  if (!parsed || typeof parsed !== 'object') return out;

  // Unwrap the single top-level wrapper key (e.g. "scientific_validation").
  let body = parsed as Record<string, unknown>;
  const topKeys = Object.keys(body);
  if (topKeys.length === 1 && typeof body[topKeys[0]] === 'object' && body[topKeys[0]] !== null) {
    body = body[topKeys[0]] as Record<string, unknown>;
  }

  const labelize = (key: string) =>
    key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  for (const [key, value] of Object.entries(body)) {
    if (key === 'sources' && Array.isArray(value)) {
      for (const s of value) {
        if (s && typeof s === 'object') {
          const src = s as Record<string, unknown>;
          out.sources.push({
            type: typeof src.type === 'string' ? src.type : undefined,
            title: typeof src.title === 'string' ? src.title : undefined,
            url: typeof src.url === 'string' ? src.url : undefined,
            quote: typeof src.quote === 'string' ? src.quote : undefined,
          });
        }
      }
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      out.sections.push({ label: labelize(key), value: value.trim() });
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out.sections.push({ label: labelize(key), value: String(value) });
    }
    // Nested objects/arrays are skipped — they're usually too deep to surface
    // meaningfully in a hover popover. Founder can click Revisit to see the
    // full structured output.
  }

  return out;
}

export function SpineSection({ projectId, locale, onSkillClick }: SpineSectionProps) {
  const [stages, setStages] = useState<StageRow[]>([]);
  const [skills, setSkills] = useState<SkillCompletion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openStage, setOpenStage] = useState<string | null>(null);
  // Hover popover for skill cards — shows full summary, scrollable, with
  // optional "expand" to remove height cap. Replaces the native `title=`
  // tooltip which clipped long summaries with no scroll/expand affordance.
  //
  // Two timers: openTimerRef debounces hover-in (250ms) so accidental
  // mouseovers don't pop the card; closeTimerRef debounces hover-out (150ms)
  // so the cursor can cross the gap from the skill card to the popover
  // without the popover unmounting. The popover's own onMouseEnter cancels
  // the close timer, keeping it open as long as the cursor is over it.
  const [hoveredSkillId, setHoveredSkillId] = useState<string | null>(null);
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearOpenTimer() {
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
  }
  function clearCloseTimer() {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
  }
  function scheduleHover(skillId: string) {
    clearCloseTimer();
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => setHoveredSkillId(skillId), 250);
  }
  function cancelHover() {
    clearOpenTimer();
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setHoveredSkillId(null), 150);
  }
  function keepHover() {
    clearCloseTimer();
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [intelRes, skillsRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/intelligence`),
          fetch(`/api/projects/${projectId}/skills`),
        ]);
        const intelBody = await intelRes.json();
        const skillsBody = await skillsRes.json();
        if (cancelled) return;
        const inner = intelBody?.data ?? intelBody;
        setStages(Array.isArray(inner?.stages) ? inner.stages : []);
        const sk = skillsBody?.data ?? skillsBody;
        setSkills(Array.isArray(sk) ? sk : []);
        setLoaded(true);
      } catch {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    const handler = () => { if (!cancelled) load(); };
    window.addEventListener('lp-actions-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('lp-actions-changed', handler);
    };
  }, [projectId]);

  // Lookup skill completion by skill_id once
  const skillMap = useMemo(() => {
    const m = new Map<string, SkillCompletion>();
    for (const s of skills) m.set(s.skill_id, s);
    return m;
  }, [skills]);

  if (!loaded) {
    return (
      <div style={{ fontSize: 11, color: 'var(--ink-5)', padding: '4px 0 14px' }}>
        {locale === 'it' ? 'Caricamento pipeline…' : 'Loading pipeline…'}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div
        className="lp-mono"
        style={{
          fontSize: 9.5,
          color: 'var(--ink-5)',
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {locale === 'it' ? 'Pipeline di validazione' : 'Validation pipeline'}
      </div>
      {/* Legend — the three numbers on each chip are three views of the SAME
          stage, not different stages: readiness scores the skill outputs,
          % complete counts skills run, evidence counts journey validation
          checks (the same checks the Home journey card shows). */}
      <div style={{ fontSize: 10, color: 'var(--ink-5)', marginBottom: 6, lineHeight: 1.4 }}>
        {locale === 'it'
          ? 'Tre viste dello stesso stadio: Prontezza = punteggio skill (0–10) · % completo = quota di skill eseguiti · Evidenze = controlli di validazione superati.'
          : 'Three views of the same stage: Readiness = skill scores (0–10) · % complete = share of skills run · Evidence = validation checks passed.'}
      </div>
      {/* Horizontal 7-step strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(stages.length, 7)}, 1fr)`,
          gap: 6,
        }}
      >
        {stages.map((s) => {
          const isOpen = openStage === s.id;
          const verdictColor = VERDICT_COLOR[s.verdict];
          const pct = Math.round(s.completion_ratio * 100);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setOpenStage(isOpen ? null : s.id)}
              className="lp-card"
              style={{
                padding: '8px 8px 6px',
                background: isOpen ? 'var(--paper-2)' : 'var(--paper)',
                cursor: 'pointer',
                textAlign: 'left',
                border: '1px solid ' + (isOpen ? verdictColor : 'var(--line)'),
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                minWidth: 0,
                color: 'inherit',
              }}
              title={s.name}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span
                  className="lp-mono"
                  style={{ fontSize: 10, color: 'var(--ink-5)' }}
                >
                  {String(s.order).padStart(2, '0')}
                </span>
                <span
                  className="lp-mono"
                  style={{ fontSize: 9.5, color: verdictColor, letterSpacing: 0.4 }}
                >
                  {VERDICT_LABEL[s.verdict][locale]}
                </span>
              </div>
              <div
                className="lp-serif"
                style={{
                  fontSize: 11.5,
                  color: 'var(--ink)',
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  minHeight: 28,
                }}
              >
                {s.name}
              </div>
              <div
                style={{
                  height: 4,
                  background: 'var(--paper-2)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: verdictColor,
                    transition: 'width 200ms ease',
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  fontSize: 9,
                  color: 'var(--ink-5)',
                  fontFamily: 'var(--f-mono)',
                }}
              >
                <span>
                  {locale === 'it'
                    ? `Prontezza ${s.overall_score.toFixed(1)}/10`
                    : `Readiness ${s.overall_score.toFixed(1)}/10`}
                </span>
                <span>
                  {locale === 'it' ? `${pct}% completo` : `${pct}% complete`}
                </span>
                {(s.evidence_total ?? 0) > 0 && (
                  <span>
                    {locale === 'it'
                      ? `Evidenze ${s.evidence_passed ?? 0}/${s.evidence_total}`
                      : `Evidence ${s.evidence_passed ?? 0}/${s.evidence_total}`}
                  </span>
                )}
              </div>
            </button>
          );
        })}
        {stages.length === 0 && (
          <div
            style={{
              gridColumn: '1 / -1',
              fontSize: 11.5,
              color: 'var(--ink-5)',
              fontStyle: 'italic',
              padding: '6px 0',
            }}
          >
            {locale === 'it' ? 'Nessuno stadio ancora avviato.' : 'No stages started yet.'}
          </div>
        )}
      </div>

      {/* Expanded detail under the strip */}
      {openStage && (() => {
        const stage = stages.find((s) => s.id === openStage);
        if (!stage) return null;
        const stageDef = STAGES.find((d) => d.number === stage.order);
        const skillsList = stageDef?.skills ?? [];
        const verdictColor = VERDICT_COLOR[stage.verdict];
        return (
          <div
            className="lp-card"
            style={{
              marginTop: 8,
              padding: 12,
              background: 'var(--paper-2)',
              borderColor: verdictColor,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span
                className="lp-serif"
                style={{ fontSize: 13, color: 'var(--ink)' }}
              >
                {stage.name}
              </span>
              <span
                className="lp-mono"
                style={{ fontSize: 10, color: 'var(--ink-5)' }}
              >
                {locale === 'it'
                  ? `Prontezza ${stage.overall_score.toFixed(1)}/10`
                  : `Readiness ${stage.overall_score.toFixed(1)}/10`}
              </span>
              <span
                className="lp-mono"
                style={{ fontSize: 10, color: 'var(--ink-5)' }}
                title={locale === 'it'
                  ? 'Il punteggio si basa sugli skill completati elencati sotto.'
                  : 'Score is derived from the completed skills listed below.'}
              >
                · {locale === 'it'
                  ? `basato su ${stage.skills_completed}/${stage.skills_total} skill`
                  : `backed by ${stage.skills_completed}/${stage.skills_total} skills`}
              </span>
              {(stage.evidence_total ?? 0) > 0 && (
                <span
                  className="lp-mono"
                  style={{ fontSize: 10, color: 'var(--ink-5)' }}
                  title={locale === 'it'
                    ? 'Controlli di validazione superati — gli stessi della scheda percorso in Home.'
                    : 'Validation checks passed — the same checks as the Home journey card.'}
                >
                  · {locale === 'it'
                    ? `evidenze ${stage.evidence_passed ?? 0}/${stage.evidence_total}`
                    : `evidence ${stage.evidence_passed ?? 0}/${stage.evidence_total}`}
                </span>
              )}
            </div>
            {skillsList.length === 0 ? (
              <div style={{ fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic' }}>
                {locale === 'it' ? 'Nessuno skill configurato.' : 'No skills configured.'}
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: 6,
                }}
              >
                {skillsList.map((sk) => {
                  const completion = skillMap.get(sk.id);
                  const done = completion?.status === 'completed';
                  const clickable = !!onSkillClick;
                  const verb = done
                    ? (locale === 'it' ? 'Rivedi' : 'Revisit')
                    : (locale === 'it' ? 'Avvia' : 'Start');
                  const summary = completion?.summary?.trim() || '';
                  const completedAt = completion?.completed_at || '';
                  const popoverOpen = hoveredSkillId === sk.id && done && !!summary;
                  const popoverExpanded = expandedSkillId === sk.id;
                  return (
                    <div
                      key={sk.id}
                      style={{ position: 'relative' }}
                      onMouseEnter={() => done && summary && scheduleHover(sk.id)}
                      onMouseLeave={() => cancelHover()}
                    >
                    <button
                      type="button"
                      onClick={clickable ? () => onSkillClick!(sk.label) : undefined}
                      disabled={!clickable}
                      aria-label={clickable ? `${verb} ${sk.label}` : sk.label}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: 4,
                        padding: '6px 8px',
                        background: done ? 'var(--paper)' : 'transparent',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--r-s)',
                        fontSize: 11.5,
                        cursor: clickable ? 'pointer' : 'default',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                        color: 'inherit',
                        transition: 'border-color 100ms, background 100ms',
                        width: '100%',
                      }}
                      onMouseEnter={(e) => {
                        if (clickable) {
                          e.currentTarget.style.borderColor = 'var(--accent)';
                          e.currentTarget.style.background = 'var(--paper)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (clickable) {
                          e.currentTarget.style.borderColor = 'var(--line)';
                          e.currentTarget.style.background = done ? 'var(--paper)' : 'transparent';
                        }
                      }}
                    >
                      {/* Header row: dot + label + verb */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            background: done ? 'var(--moss)' : 'var(--paper-2)',
                            border: done ? 'none' : '1px solid var(--line-2)',
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            color: done ? 'var(--ink-2)' : 'var(--ink-4)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                            fontWeight: done ? 500 : 400,
                          }}
                        >
                          {sk.label}
                        </span>
                        {clickable && (
                          <span
                            className="lp-mono"
                            style={{
                              fontSize: 9.5,
                              color: 'var(--ink-5)',
                              letterSpacing: 0.3,
                              textTransform: 'uppercase',
                              flexShrink: 0,
                            }}
                          >
                            {verb} →
                          </span>
                        )}
                      </div>
                      {/* Evidence row: summary excerpt + timestamp.
                          Visible only for completed skills with a real summary —
                          this is what backs the stage score. */}
                      {done && summary && (
                        <div
                          style={{
                            fontSize: 10.5,
                            color: 'var(--ink-4)',
                            lineHeight: 1.4,
                            paddingLeft: 14, // align under the label, past the dot
                            overflow: 'hidden',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            whiteSpace: 'normal',
                          }}
                        >
                          {summary}
                        </div>
                      )}
                      {done && completedAt && (
                        <div
                          className="lp-mono"
                          style={{
                            fontSize: 9.5,
                            color: 'var(--ink-5)',
                            paddingLeft: 14,
                          }}
                        >
                          {locale === 'it' ? 'completato ' : 'ran '}{formatRelativeAge(completedAt, locale)}
                        </div>
                      )}
                    </button>
                    {popoverOpen && (() => {
                      const parsed = parseSkillSummary(summary);
                      return (
                      <div
                        role="tooltip"
                        // Block ALL click events bubbling from inside the popover
                        // up to the wrapper. Without this, a click on the expand
                        // button (or a source link) propagates to the skill card
                        // button below and fires onSkillClick → opens a chat turn.
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onMouseEnter={keepHover}
                        onMouseLeave={cancelHover}
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 6px)',
                          left: 0,
                          right: 0,
                          minWidth: 360,
                          maxWidth: 560,
                          zIndex: 50,
                          background: 'var(--paper)',
                          border: '1px solid var(--line-2)',
                          borderRadius: 'var(--r-s)',
                          boxShadow: '0 8px 24px rgba(0,0,0,0.32)',
                          padding: '10px 12px',
                          fontSize: 11.5,
                          lineHeight: 1.5,
                          color: 'var(--ink-2)',
                          maxHeight: popoverExpanded ? '70vh' : 280,
                          overflowY: 'auto',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                            marginBottom: 8,
                            paddingBottom: 6,
                            borderBottom: '1px solid var(--line)',
                            position: 'sticky',
                            top: -10,
                            background: 'var(--paper)',
                            zIndex: 1,
                          }}
                        >
                          <strong style={{ fontSize: 11.5, color: 'var(--ink-1)' }}>
                            {verb} {sk.label}
                          </strong>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedSkillId(popoverExpanded ? null : sk.id);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="lp-mono"
                            style={{
                              fontSize: 9.5,
                              color: 'var(--ink-5)',
                              background: 'transparent',
                              border: '1px solid var(--line)',
                              borderRadius: 'var(--r-s)',
                              padding: '2px 6px',
                              cursor: 'pointer',
                              letterSpacing: 0.3,
                              textTransform: 'uppercase',
                            }}
                          >
                            {popoverExpanded
                              ? (locale === 'it' ? 'comprimi' : 'collapse')
                              : (locale === 'it' ? 'espandi' : 'expand')}
                          </button>
                        </div>

                        {parsed.sections.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {parsed.sections.map((s, i) => (
                              <div key={i}>
                                <div
                                  className="lp-mono"
                                  style={{
                                    fontSize: 9.5,
                                    color: 'var(--ink-5)',
                                    letterSpacing: 0.3,
                                    textTransform: 'uppercase',
                                    marginBottom: 2,
                                  }}
                                >
                                  {s.label}
                                </div>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{s.value}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {parsed.sources.length > 0 && (
                          <div
                            style={{
                              marginTop: 12,
                              paddingTop: 8,
                              borderTop: '1px solid var(--line)',
                            }}
                          >
                            <div
                              className="lp-mono"
                              style={{
                                fontSize: 9.5,
                                color: 'var(--ink-5)',
                                letterSpacing: 0.3,
                                textTransform: 'uppercase',
                                marginBottom: 4,
                              }}
                            >
                              {locale === 'it'
                                ? `Fonti (${parsed.sources.length})`
                                : `Sources (${parsed.sources.length})`}
                            </div>
                            <ol style={{ paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {parsed.sources.map((src, i) => (
                                <li key={i} style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                                  {src.url ? (
                                    <a
                                      href={src.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                                    >
                                      {src.title || src.url}
                                    </a>
                                  ) : (
                                    <span>{src.title || src.type || '(unnamed source)'}</span>
                                  )}
                                  {src.type && src.type !== 'web' && (
                                    <span className="lp-mono" style={{ fontSize: 9.5, color: 'var(--ink-5)', marginLeft: 6 }}>
                                      [{src.type}]
                                    </span>
                                  )}
                                  {src.quote && (
                                    <div style={{ fontSize: 10.5, color: 'var(--ink-4)', fontStyle: 'italic', marginTop: 2 }}>
                                      "{src.quote.length > 200 ? src.quote.slice(0, 200) + '…' : src.quote}"
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {parsed.prose && parsed.sections.length === 0 && parsed.sources.length === 0 && (
                          <div style={{ whiteSpace: 'pre-wrap' }}>{parsed.prose}</div>
                        )}

                        {completedAt && (
                          <div
                            className="lp-mono"
                            style={{
                              fontSize: 9.5,
                              color: 'var(--ink-5)',
                              marginTop: 10,
                              paddingTop: 6,
                              borderTop: '1px solid var(--line)',
                            }}
                          >
                            {locale === 'it' ? 'completato ' : 'ran '}{formatRelativeAge(completedAt, locale)}
                          </div>
                        )}
                      </div>
                      );
                    })()}
                    </div>
                  );
                })}
              </div>
            )}
            {stage.last_signal && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 10.5,
                  color: 'var(--ink-5)',
                  fontFamily: 'var(--f-mono)',
                }}
              >
                {stage.last_signal.label}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
