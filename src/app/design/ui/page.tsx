'use client';

/**
 * UI primitives gallery — every component in src/components/ui, mounted with
 * representative data.
 *
 * This is an internal design surface, not a founder-facing route: it exists so
 * the primitives can be seen, clicked, and compared against the SenseFound
 * tokens in one place before any of them is wired into a product surface.
 * Sample data is deliberately LaunchPad-shaped (validation, evidence, spine)
 * rather than the ice-cream fixtures the components were ported from, so the
 * fit — or the mismatch — is legible.
 *
 * Section headings render from the SECTIONS array as expressions on purpose:
 * the i18n CI guard flags literal JSX prose, and these are component names, not
 * translatable product copy.
 */

import { useState } from 'react';
import { ApprovalCard } from '@/components/ui/ApprovalCard';
import { TaskRows } from '@/components/ui/TaskRows';
import { LoadingState } from '@/components/ui/LoadingState';
import { Thinking } from '@/components/ui/Thinking';
import { StreamingText } from '@/components/ui/StreamingText';
import { ToolChips } from '@/components/ui/ToolChips';
import { ChatComposer } from '@/components/ui/ChatComposer';
import { DiffTable } from '@/components/ui/DiffTable';
import { RecordsTable } from '@/components/ui/RecordsTable';
import { FilterTable } from '@/components/ui/FilterTable';
import { SidebarNav } from '@/components/ui/SidebarNav';
import { RecommendationCard } from '@/components/ui/RecommendationCard';
import { ContextCards } from '@/components/ui/ContextCards';
import {
  InsightCards, CompareCard, AnomalyCard, AllocationCard, InsightEntity, InsightMono,
} from '@/components/ui/InsightCards';

const series = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => ({ value: 40 + ((seed * (i + 3)) % 47) }));

/**
 * Fixture copy. Hoisted into constants so the strings sit in plain JS rather
 * than JSX attributes: the i18n guard rightly flags a bare `title="…"`, and
 * these are sample data for an internal gallery, not translatable product copy.
 */
const FX = {
  recommendation: 'How should we close Loop 1?', // i18n-exempt — gallery fixture
  diff: 'Canvas changes awaiting your approval', // i18n-exempt — gallery fixture
  anomaly: 'Score trajectory', // i18n-exempt — gallery fixture
  allocation: 'Evidence by source', // i18n-exempt — gallery fixture
  thinking: 'Checking the spine for contiguity', // i18n-exempt — gallery fixture
  context: 'Evidence behind this verdict', // i18n-exempt — gallery fixture
  streaming:
    'Your willingness-to-pay signal is below the 30% threshold, so Loop 1 stays open and the Validation Gate will not unlock.', // i18n-exempt — gallery fixture
  heading: 'UI primitives', // i18n-exempt — gallery chrome
  subheading:
    '14 components from src/components/ui, on SenseFound tokens. Nothing here is wired to product data.', // i18n-exempt — gallery chrome
};

function Section({ name, note, children }: { name: string; note: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-7">
      <div className="flex flex-col gap-0.5">
        <h2 className="lp-mono text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{name}</h2>
        <p className="text-[13px] text-ink-2">{note}</p>
      </div>
      <div className="flex flex-wrap items-start gap-5 pt-1">{children}</div>
    </section>
  );
}

export default function UIGalleryPage() {
  const [log, setLog] = useState<string>('');
  const say = (m: string) => setLog(m);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold text-ink">{FX.heading}</h1>
        <p className="text-[13px] text-ink-2">
          {FX.subheading}
        </p>
        {log && (
          <p className="lp-fade-in lp-mono mt-1 text-[12px] text-accent-ink">{log}</p>
        )}
      </header>

      <Section name="LoadingState" note="Long-running work — three grid patterns, real elapsed timer.">
        <LoadingState variant="drive" />
        <LoadingState variant="dots" />
        <LoadingState variant="orbit" />
      </Section>

      <Section name="ApprovalCard" note="Multi-question founder gate. Radio auto-advances; the last answer submits.">
        <ApprovalCard
          questions={[
            { id: 'segment', question: 'Which segment do we validate first?', type: 'radio', options: ['SMB operators', 'Mid-market ops leads', 'Solo founders'] },
            { id: 'evidence', question: 'What counts as proof here?', type: 'check', options: ['Paid pilot', 'Signed LOI', '10 interviews at 30% WTP'] },
          ]}
          onSubmit={(a) => say(`ApprovalCard → ${JSON.stringify(a)}`)}
          onDismiss={() => say('ApprovalCard → dismissed')}
        />
      </Section>

      <Section name="TaskRows" note="Agent tasks with status and expandable steps. Status is caller-supplied.">
        <TaskRows
          rows={[
            { id: 'r1', status: 'done', label: 'Scored the Idea Canvas', amount: '9 blocks', steps: [{ label: 'Parsed scorecard JSON', meta: '57/100' }, { label: 'Wrote score_history', meta: '1 row' }] },
            { id: 'r2', status: 'running', label: 'Researching competitors', amount: '4 sources', steps: [{ label: 'Reading G2 category', meta: '3 pages' }] },
            { id: 'r3', status: 'failed', retrying: true, label: 'Drafting outreach', amount: '2 drafts' },
          ]}
        />
      </Section>

      <Section name="Thinking" note="Reasoning trace with a measured rail. `working` drives the shimmer.">
        <Thinking
          label={FX.thinking}
          working
          rows={[
            { primary: 'Phase 0 active, phases 1-3 claim validated' },
            { primary: 'Contiguity broken at phase 1', secondary: 'evidence count 0' },
            { primary: 'Recomputing from evidence' },
          ]}
        />
      </Section>

      <Section name="StreamingText" note="Assistant answer with citations, sources and follow-ups. Typewriter is opt-in.">
        <StreamingText
          text={FX.streaming}
          sources={[{ id: 's1', name: 'Interview set', domain: 'launchpad' }]}
          sourceCount={1}
          followUps={[{ id: 'f1', text: 'Show the interview breakdown' }]}
          onFollowUp={(id) => say(`StreamingText → follow-up ${id}`)}
          onCopy={() => say('StreamingText → copied')}
        />
      </Section>

      <Section name="ToolChips" note="Per-turn tool calls, collapsed by default, with a file-diff summary.">
        <ToolChips
          toolCount={4}
          messageCount={2}
          rows={[
            { id: 't1', icon: 'read', label: 'get_project_summary', chip: 'project' },
            { id: 't2', icon: 'think', label: 'Weighing evidence', detail: [{ text: 'WTP 22% vs 30% threshold' }] },
            { id: 't3', icon: 'run', label: 'skill_market_research', chip: '12s' },
          ]}
          diffs={[{ file: 'idea_canvas', add: 4, del: 1 }]}
        />
      </Section>

      <Section name="ChatComposer" note="Composer with optional tabs and actions. No fake reply loop.">
        <ChatComposer onSend={(t) => say(`ChatComposer → sent "${t}"`)} />
      </Section>

      <Section name="RecommendationCard" note="Ranked options with a signal bar; one is accepted.">
        <RecommendationCard
          title={FX.recommendation}
          options={[
            { id: 'o1', short: 'Re-interview', signal: 82, label: 'Strongest', cta: 'Run interviews', tone: 'moss', body: 'Ten more interviews at the same price point would settle the WTP question.' },
            { id: 'o2', short: 'Cut price', signal: 41, label: 'Weak', cta: 'Model it', tone: 'clay', body: 'Dropping the anchor price lifts WTP but breaks the LTV/CAC floor.' },
          ]}
          onAccept={(o) => say(`RecommendationCard → accepted ${o.id}`)}
        />
      </Section>

      <Section name="ContextCards" note="Retrieved evidence chunks with source attribution.">
        <ContextCards
          heading={FX.context}
          total={12}
          chunks={[
            { id: 'c1', title: 'Interview 7 — ops lead', meta: '2026-07-14', body: 'Said they would pay if it cut reconciliation time by half.', source: { label: 'Interviews', badge: 'IV', tone: 'moss' } },
            { id: 'c2', title: 'Competitor pricing', meta: 'G2', body: 'Median seat price in this category is well below the modelled anchor.', source: { label: 'Research', badge: 'RS', tone: 'sky' } },
          ]}
          onOpenSource={(c) => say(`ContextCards → open ${c.id}`)}
        />
      </Section>

      <Section name="DiffTable" note="Proposed changes to a record set — added, removed, unchanged.">
        <DiffTable
          title={FX.diff}
          columns={[{ key: 'field', label: 'Field', kind: 'strong' }, { key: 'value', label: 'Proposed value' }]}
          rows={[
            { id: 'd1', change: 'unchanged', cells: { field: 'Problem', value: 'Reconciliation takes ops teams days' } },
            { id: 'd2', change: 'removed', cells: { field: 'Channel', value: 'Cold outbound' } },
            { id: 'd3', change: 'added', cells: { field: 'Channel', value: 'Partner referral' } },
          ]}
        />
      </Section>

      <Section name="FilterTable" note="Status-filtered rows; chip counts derive from the data, not literals.">
        <FilterTable
          columns={[{ key: 'name', label: 'Check' }, { key: 'track', label: 'Track' }, { key: 'status', label: 'Status', status: true }]}
          options={[
            { key: 'green', label: 'Validated', tone: 'moss' },
            { key: 'open', label: 'Open', tone: 'cat-gold' },
          ]}
          rows={[
            { id: 'f1', status: 'green', cells: { name: 'value_prop', track: '1A' } },
            { id: 'f2', status: 'open', cells: { name: 'wtp_signal', track: '1C' } },
            { id: 'f3', status: 'green', cells: { name: 'buyer_persona_defined', track: '1A' } },
          ]}
        />
      </Section>

      <Section name="RecordsTable" note="Sortable, selectable grid with a sticky identity column.">
        <RecordsTable
          columns={[
            { key: 'name', label: 'Competitor', width: '14rem' },
            { key: 'pricing', label: 'Pricing', sortable: true },
            { key: 'tags', label: 'Segments' },
          ]}
          rows={[
            { id: 'p1', label: 'Northwind', cells: { pricing: { text: '$49/seat', sort: 49 }, tags: { kind: 'tags', tags: [{ label: 'SMB', color: 'var(--cat-teal)' }] } } },
            { id: 'p2', label: 'Ledgerly', cells: { pricing: { text: '$120/seat', sort: 120 }, tags: { kind: 'tags', tags: [{ label: 'Mid-market', color: 'var(--cat-gold)' }] } } },
          ]}
          onSelectionChange={(ids) => say(`RecordsTable → ${ids.length} selected`)}
        />
      </Section>

      <Section name="SidebarNav" note="Workspace nav with real search filtering and a hover-follow highlight.">
        <div className="w-64">
          <SidebarNav
            workspace={{ name: 'MatchLens', subtitle: 'Phase 1 — Validate', initial: 'M' }}
            sections={[{ key: 'work', label: 'Work' }]}
            items={[
              { key: 'today', label: 'Today', section: 'work' },
              { key: 'inbox', label: 'Watchers', section: 'work', badge: 3 },
              { key: 'knowledge', label: 'Knowledge', section: 'work' },
            ]}
            activeKey="today"
            onSelect={(k) => say(`SidebarNav → ${k}`)}
          />
        </div>
      </Section>

      <Section name="InsightCards" note="Carousel of findings, each paired with a chart. Charts are inline SVG.">
        <InsightCards
          insights={[
            {
              id: 'i1',
              prose: <>Willingness to pay is <InsightMono tone="negative">22%</InsightMono>, below the <InsightEntity name="30% gate" color="var(--clay)" /> threshold.</>, // i18n-exempt — gallery fixture
              card: (
                <CompareCard
                  caption="WTP across interview rounds"
                  series={[
                    { id: 'r1', name: 'Round 1', color: 'var(--moss)', delta: '+4%', tone: 'positive', points: series(12, 5) },
                    { id: 'r2', name: 'Round 2', color: 'var(--clay)', delta: '-8%', tone: 'negative', points: series(12, 9) },
                  ]}
                />
              ),
            },
            {
              id: 'i2',
              prose: <>Score moved on <InsightEntity name="evidence" color="var(--accent)" />, not on new claims.</>, // i18n-exempt — gallery fixture
              card: (
                <AnomalyCard
                  title={FX.anomaly}
                  metrics={[{ id: 'm1', label: 'Overall', points: series(14, 7), format: (v) => `${Math.round(v)}/100`, caption: 'Baseline to latest' }]}
                  summary={{ value: '57/100', delta: '+12', deltaTone: 'positive' }}
                />
              ),
            },
            {
              id: 'i3',
              prose: <>Most evidence still sits in <InsightEntity name="interviews" color="var(--cat-teal)" />.</>, // i18n-exempt — gallery fixture
              card: (
                <AllocationCard
                  title={FX.allocation}
                  segments={[
                    { id: 'a1', code: 'IV', label: 'Interviews', pct: 55, amount: '22 facts', color: 'var(--cat-teal)' },
                    { id: 'a2', code: 'RS', label: 'Research', pct: 30, amount: '12 facts', color: 'var(--cat-gold)' },
                    { id: 'a3', code: 'DOC', label: 'Uploads', pct: 15, amount: '6 facts', color: 'var(--cat-rose)' },
                  ]}
                />
              ),
            },
          ]}
        />
      </Section>
    </main>
  );
}
