import { describe, it, expect } from 'vitest';
import { applyRevisionToAssumptions, proposeArpuRevisionFromAlert, isRevisableField } from './financial-assumption-revision';
import { defaultAssumptions } from './financial-projection';

describe('applyRevisionToAssumptions', () => {
  const base = defaultAssumptions();

  it('applies a valid numeric revision', () => {
    const r = applyRevisionToAssumptions(base, 'arpu_monthly', 59);
    expect(r?.arpu_monthly).toBe(59);
    expect(r?.monthly_opex).toBe(base.monthly_opex); // others unchanged
  });

  it('coerces string values', () => {
    expect(applyRevisionToAssumptions(base, 'arpu_monthly', '79')?.arpu_monthly).toBe(79);
  });

  it('clamps to sane bounds', () => {
    expect(applyRevisionToAssumptions(base, 'gross_margin_pct', 250)?.gross_margin_pct).toBe(100);
    expect(applyRevisionToAssumptions(base, 'monthly_churn_rate_pct', -5)?.monthly_churn_rate_pct).toBe(0);
    expect(applyRevisionToAssumptions(base, 'horizon_months', 2)?.horizon_months).toBe(6);
  });

  it('rejects unknown field / non-numeric / currency', () => {
    expect(applyRevisionToAssumptions(base, 'currency', 'USD')).toBeNull();
    expect(applyRevisionToAssumptions(base, 'nope', 5)).toBeNull();
    expect(applyRevisionToAssumptions(base, 'arpu_monthly', 'abc')).toBeNull();
  });

  it('isRevisableField guards the union', () => {
    expect(isRevisableField('arpu_monthly')).toBe(true);
    expect(isRevisableField('currency')).toBe(false);
    expect(isRevisableField('toString')).toBe(false); // not a prototype prop
  });
});

describe('proposeArpuRevisionFromAlert', () => {
  it('proposes an ARPU review from a competitor price materially above ARPU', () => {
    const p = proposeArpuRevisionFromAlert(
      { kind: 'competitor', headline: 'SiteSafe raised pricing', body: 'Now $69 per seat per month.' },
      49,
    );
    expect(p).not.toBeNull();
    expect(p!.field).toBe('arpu_monthly');
    expect(p!.value).toBe(69);
    expect(p!.rationale).toMatch(/competitor/i);
  });

  it('skips immaterial differences (<15%)', () => {
    expect(proposeArpuRevisionFromAlert({ kind: 'competitor', body: '$52 per month' }, 49)).toBeNull();
  });

  it('skips non-competitor signals', () => {
    expect(proposeArpuRevisionFromAlert({ kind: 'regulatory', body: '$99 per month fine' }, 49)).toBeNull();
  });

  it('skips when no clean price is present', () => {
    expect(proposeArpuRevisionFromAlert({ kind: 'competitor', body: 'They are growing fast.' }, 49)).toBeNull();
  });

  it('skips when current ARPU is unknown', () => {
    expect(proposeArpuRevisionFromAlert({ kind: 'competitor', body: '$69 per seat per month' }, 0)).toBeNull();
  });
});
