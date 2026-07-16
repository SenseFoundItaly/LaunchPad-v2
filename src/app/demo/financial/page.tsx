'use client';

/**
 * /demo/financial — DEMO PURPOSES ONLY. The financial model surface, mirroring
 * FinancialModelPanel: assumptions grid, 3-scenario summary, and the base
 * monthly projection table. Numbers are computed deterministically in ../mock.
 */

import * as React from 'react';
import { Icon, I } from '@/components/design/primitives';
import { FIN_ASSUMPTIONS, FIN_SCENARIOS, FIN_MONTHLY } from '../mock';

function eur(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M` : abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : `${abs}`;
  return `${n < 0 ? '−' : ''}€${s}`;
}

export default function DemoFinancial() {
  return (
    <div className="lp-scroll lp-rise" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header */}
        <div>
          <h3 className="lp-serif" style={{ margin: 0, fontSize: 20, fontWeight: 400 }}>Proiezioni finanziarie</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-4)' }}>36 mesi · 3 scenari · ricalcolo istantaneo. <strong style={{ color: 'var(--ink-3)' }}>Salva</strong> per persistere, <strong style={{ color: 'var(--ink-3)' }}>Scarica</strong> per aprire in Excel/Sheets.</p>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--accent-ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon d={I.sparkles} size={11} />Seminato con le evidenze del progetto: ARPU €79 (WTP), churn 3,5% (Loop 2), runway 14 mesi.
          </p>
        </div>

        {/* Assumptions */}
        <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-l)', background: 'var(--paper)', padding: 16 }}>
          <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)', marginBottom: 10 }}>Assunzioni</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {FIN_ASSUMPTIONS.map((a) => (
              <label key={a.label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{a.label}</span>
                <input readOnly value={a.value} style={{ fontSize: 12, fontFamily: 'var(--f-mono)', color: 'var(--ink-2)', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', padding: '6px 8px' }} />
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 'var(--r-m)', padding: '7px 14px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>Salva</button>
            <button style={{ background: 'var(--paper-3)', color: 'var(--ink-3)', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', padding: '7px 14px', fontSize: 11.5, cursor: 'pointer' }}>Scarica CSV</button>
          </div>
        </section>

        {/* Scenario summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {FIN_SCENARIOS.map((s) => (
            <section key={s.label} style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-l)', background: 'var(--surface)', padding: 16 }}>
              <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)' }}>{s.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '4px 0 10px' }}>
                <span className="lp-serif" style={{ fontSize: 24, fontWeight: 400 }}>{s.arr}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>ARR (Y3)</span>
              </div>
              <Row k="Breakeven" v={s.breakeven} />
              <Row k="Picco cassa" v={s.peakCash} />
              <Row k="Cassa finale" v={s.endCash} />
              <Row k="Club finali" v={s.endCustomers} />
            </section>
          ))}
        </div>

        {/* Monthly table */}
        <section style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-l)', background: 'var(--paper)', overflow: 'hidden' }}>
          <div className="lp-mono" style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--ink-5)', padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>Scenario base — mensile (primi 24 mesi)</div>
          <div className="lp-scroll" style={{ maxHeight: 420, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--paper-2)', zIndex: 1 }}>
                <tr style={{ color: 'var(--ink-5)', textAlign: 'right' }}>
                  {['Mese', 'Nuovi', 'Churn', 'Club', 'MRR', 'Ricavi', 'COGS', 'Opex', 'Net burn', 'Cassa', 'Runway'].map((h) => (
                    <th key={h} style={{ padding: '6px 10px', fontWeight: 500, textAlign: h === 'Mese' ? 'left' : 'right', borderBottom: '1px solid var(--line)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="lp-mono">
                {FIN_MONTHLY.map((r) => (
                  <tr key={r.mo} style={{ borderTop: '1px solid var(--line)', textAlign: 'right', color: 'var(--ink-3)' }}>
                    <td style={{ padding: '4px 10px', textAlign: 'left', color: 'var(--ink-4)' }}>{r.mo}</td>
                    <td style={{ padding: '4px 10px' }}>{r.add}</td>
                    <td style={{ padding: '4px 10px', color: 'var(--ink-5)' }}>{r.churn}</td>
                    <td style={{ padding: '4px 10px', color: 'var(--ink-2)' }}>{r.customers}</td>
                    <td style={{ padding: '4px 10px' }}>{eur(r.mrr)}</td>
                    <td style={{ padding: '4px 10px' }}>{eur(r.revenue)}</td>
                    <td style={{ padding: '4px 10px', color: 'var(--ink-5)' }}>{eur(r.cogs)}</td>
                    <td style={{ padding: '4px 10px', color: 'var(--ink-5)' }}>{eur(r.opex)}</td>
                    <td style={{ padding: '4px 10px', color: r.netBurn > 0 ? 'var(--clay)' : 'var(--moss)' }}>{eur(r.netBurn)}</td>
                    <td style={{ padding: '4px 10px', color: r.cash < 0 ? 'var(--clay)' : 'var(--ink-3)' }}>{eur(r.cash)}</td>
                    <td style={{ padding: '4px 10px', color: 'var(--ink-4)' }}>{r.runway}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '2px 0' }}>
      <span style={{ color: 'var(--ink-5)' }}>{k}</span>
      <span className="lp-mono" style={{ color: 'var(--ink-2)' }}>{v}</span>
    </div>
  );
}
