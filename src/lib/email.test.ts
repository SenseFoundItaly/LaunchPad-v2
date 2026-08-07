import { describe, it, expect } from 'vitest';
import { stripArtifactBlocks, renderBriefHtml, extractProseFromArtifact } from './email';

/**
 * The Monday Brief goes live 2026-08-10 — the founder's FIRST-ever email from
 * the product. These pin the two defects found by reading the real 27/07
 * reflection before enabling delivery:
 *   1. the model sometimes emits the reflection as an :::artifact insight-card
 *      → escaped JSON in the email body;
 *   2. the frame was English-only for a project whose locale is Italian.
 */

const REAL_SHAPE = `Score: 0.0 → 0.0 (Δ0.0) · last 24h: no skills completed

---

:::artifact
\`\`\`json
{ "type": "insight-card", "title": "Heartbeat Settimanale" }
\`\`\`
:::

La settimana è stata densa: hai chiuso l'Idea Canvas.`;

describe('stripArtifactBlocks', () => {
  it('removes a closed artifact block, keeps the prose around it', () => {
    const out = stripArtifactBlocks(REAL_SHAPE);
    expect(out).toContain('Score: 0.0');
    expect(out).toContain('La settimana è stata densa');
    expect(out).not.toContain(':::');
    expect(out).not.toContain('insight-card');
  });

  it('removes an UNTERMINATED trailing block — the sliced-mid-artifact case', () => {
    // The cron slices to 500/800 chars; a block cut mid-JSON has no closing :::.
    const out = stripArtifactBlocks('Prosa utile.\n\n:::artifact\n{ "type": "insi');
    expect(out).toBe('Prosa utile.');
  });
});

describe('renderBriefHtml locale', () => {
  const base = {
    userId: 'u', projectId: 'p', projectName: 'DeskMate',
    pendingActions: [{ id: 'a', title: 'Approva i concorrenti' }],
    ecosystemAlerts: [], heartbeatSummary: 'Riflessione.',
  };

  it('renders the Italian frame for an Italian project', () => {
    const html = renderBriefHtml({ ...base, locale: 'it' });
    expect(html).toContain('La tua Monday Brief');
    expect(html).toContain('Riflessione settimanale');
    expect(html).toContain('Azioni in attesa (1)');
    expect(html).toContain('Apri il tuo workspace');
    expect(html).toContain('lang="it"');
    expect(html).not.toContain('Pending actions');
  });

  it('defaults to English, and says WEEKLY — the reflection never was daily', () => {
    const html = renderBriefHtml(base);
    expect(html).toContain('Your Monday Brief');
    expect(html).toContain('Weekly reflection');
    expect(html).not.toContain('Daily reflection');
  });
});

describe('extractProseFromArtifact — the all-artifact reflection rescue', () => {
  it('pulls section prose out of an insight-card-only reply', () => {
    const raw = ':::artifact\n```json\n' + JSON.stringify({
      type: 'insight-card', title: 'Heartbeat',
      content: { sections: [{ heading: 'Cosa è cambiato', body: 'Hai chiuso il canvas e avviato il mapping.' }] },
    }) + '\n```\n:::';
    // stripArtifactBlocks yields '' here — the guard case the audit found:
    // heartbeat completed, email silently missing its reflection.
    expect(stripArtifactBlocks(raw)).toBe('');
    expect(extractProseFromArtifact(raw)).toContain('Hai chiuso il canvas');
  });

  it('returns empty on garbage instead of throwing', () => {
    expect(extractProseFromArtifact('no json here')).toBe('');
  });
});
