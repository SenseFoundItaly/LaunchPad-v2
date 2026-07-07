import { describe, it, expect } from 'vitest';
import { extractEcosystemAlerts } from '@/lib/ecosystem-alert-parser';

function alertBlock(alertType: string): string {
  return [
    ':::artifact{"type":"ecosystem_alert"}',
    JSON.stringify({
      alert_type: alertType,
      entity: 'Acme',
      headline: `Acme did a thing (${alertType})`,
      body: 'Two factual sentences about the finding.',
      source_url: 'https://example.com/news',
      relevance_score: 0.8,
      confidence: 0.7,
      suggested_action: null,
    }),
    ':::',
  ].join('\n');
}

describe('extractEcosystemAlerts — alert_type vocabulary', () => {
  // supplier_move + gtm_signal feed the FORNITORI/GTM satellites — the parser
  // allowlist must accept what outputInstructions advertises (this set was
  // stale once before and silently dropped valid findings).
  it.each(['supplier_move', 'gtm_signal', 'ad_activity', 'customer_sentiment'])(
    'accepts alert_type=%s',
    (type) => {
      const { parsed, errors } = extractEcosystemAlerts(alertBlock(type));
      expect(errors).toHaveLength(0);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].alert_type).toBe(type);
      expect(parsed[0].entity).toBe('Acme');
    },
  );

  it('rejects an unknown alert_type', () => {
    const { parsed, errors } = extractEcosystemAlerts(alertBlock('vibe_shift'));
    expect(parsed).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toContain('invalid alert_type');
  });

  it('accepts the header-variant form for the new types', () => {
    const text = [
      ':::artifact{"type":"supplier_move"}',
      JSON.stringify({
        headline: 'Key packaging supplier raises minimums',
        body: 'Supplier X doubled its MOQ.',
        source_url: 'https://example.com/supplier',
        relevance_score: 0.9,
        confidence: 0.8,
      }),
      ':::',
    ].join('\n');
    const { parsed, errors } = extractEcosystemAlerts(text);
    expect(errors).toHaveLength(0);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].alert_type).toBe('supplier_move');
  });
});
