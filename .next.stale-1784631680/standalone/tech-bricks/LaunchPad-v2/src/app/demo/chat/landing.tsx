'use client';

/**
 * /demo/chat — DEMO PURPOSES ONLY. A mock MatchLens landing/app page rendered
 * inside the Build tab's preview frame, standing in for the real BuildHub
 * iframe (which loads the agent-built app). Token-driven so it adapts to the
 * active theme; fully scrollable inside the preview container.
 */

import * as React from 'react';

export function MockLanding() {
  return (
    <div style={{ background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--f-sans)' }}>
      <Nav />
      <Hero />
      <TrustBar />
      <Features />
      <HowItWorks />
      <Pricing />
      <Testimonial />
      <FinalCta />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 28px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--paper)', zIndex: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 20, height: 20, borderRadius: 5, background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-accent)', fontSize: 11, fontWeight: 800 }}>M</span>
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.2 }}>MatchLens</span>
      </div>
      <span style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', fontSize: 12.5, color: 'var(--ink-3)' }}>
        <span>Funzionalità</span>
        <span>Prezzi</span>
        <span>Accedi</span>
        <span style={{ background: 'var(--accent)', color: 'var(--on-accent)', borderRadius: 8, padding: '7px 14px', fontWeight: 600, fontSize: 12.5 }}>Prova gratis</span>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <header style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 28, alignItems: 'center', padding: '44px 28px', background: 'linear-gradient(160deg, var(--accent-wash), transparent 70%)' }}>
      <div>
        <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, color: 'var(--accent-ink)', background: 'var(--accent-wash)', border: '1px solid var(--line)', borderRadius: 999, padding: '4px 10px', marginBottom: 14 }}>
          ⚽ Analisi video AI per club dilettantistici
        </span>
        <h1 style={{ margin: 0, fontSize: 34, lineHeight: 1.1, letterSpacing: -0.8, fontWeight: 700 }}>
          Analisi pro per il tuo club, a prezzo amatoriale.
        </h1>
        <p style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.5, color: 'var(--ink-3)', maxWidth: 460 }}>
          La telecamera AI registra, tagga gli eventi e monta le clip da sola. Zero montaggio manuale — i tuoi allenatori risparmiano ore ogni settimana.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 22, alignItems: 'center' }}>
          <span style={{ background: 'var(--accent)', color: 'var(--on-accent)', borderRadius: 10, padding: '11px 20px', fontWeight: 600, fontSize: 14 }}>Inizia gratis 14 giorni</span>
          <span style={{ border: '1px solid var(--line-2)', borderRadius: 10, padding: '11px 18px', fontWeight: 600, fontSize: 14, color: 'var(--ink-2)' }}>▶ Guarda la demo</span>
        </div>
        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-5)' }}>Nessuna carta richiesta · attivo in 5 minuti</div>
      </div>
      <PitchVisual />
    </header>
  );
}

// A soccer-pitch mock with AI tracking overlay — sells "video analysis".
function PitchVisual() {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-lift)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
        <span className="lp-dot lp-pulse" style={{ background: 'var(--clay)' }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)' }}>LIVE · U15 · 2° tempo</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, fontFamily: 'var(--f-mono)', color: 'var(--ink-5)' }}>AI tracking on</span>
      </div>
      <svg viewBox="0 0 320 190" style={{ width: '100%', display: 'block' }}>
        <rect x="0" y="0" width="320" height="190" fill="#2f7d4f" />
        {[0, 40, 80, 120, 160, 200, 240, 280].map((x) => (
          <rect key={x} x={x} y="0" width="40" height="190" fill={(x / 40) % 2 === 0 ? '#2f7d4f' : '#2b744a'} />
        ))}
        <rect x="8" y="8" width="304" height="174" fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="1.5" />
        <line x1="160" y1="8" x2="160" y2="182" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="1.5" />
        <circle cx="160" cy="95" r="26" fill="none" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="1.5" />
        <rect x="8" y="55" width="34" height="80" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.2" />
        <rect x="278" y="55" width="34" height="80" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.2" />
        {/* tracked players */}
        {[[90, 70], [120, 120], [200, 60], [230, 130], [160, 95]].map(([cx, cy], i) => (
          <g key={i}>
            <circle cx={cx} cy={cy} r="5" fill={i === 4 ? 'var(--accent)' : '#e8eef2'} stroke="#0c1a12" strokeWidth="0.8" />
          </g>
        ))}
        {/* ball + AI bounding box + trajectory */}
        <path d="M120 120 Q150 80 205 66" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeDasharray="3 3" opacity="0.9" />
        <rect x="198" y="58" width="16" height="16" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
        <circle cx="206" cy="66" r="3" fill="#ffffff" />
        <text x="216" y="60" fill="var(--accent)" fontSize="7" fontFamily="var(--f-mono)">ball 0.98</text>
      </svg>
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderTop: '1px solid var(--line)', background: 'var(--paper-2)' }}>
        {['Gol 12′', 'Tiro 34′', 'Assist 51′'].map((c) => (
          <span key={c} style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '3px 8px' }}>{c}</span>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--accent-ink)', fontWeight: 600 }}>3 clip pronte →</span>
      </div>
    </div>
  );
}

function TrustBar() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, justifyContent: 'center', flexWrap: 'wrap', padding: '18px 28px', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-5)' }}>Usato da 38 club dilettantistici</span>
      {['FIGC Piemonte', 'ASD Rivoli', 'Pol. Chieri', 'US Grugliasco'].map((n) => (
        <span key={n} style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-4)', letterSpacing: -0.2 }}>{n}</span>
      ))}
    </div>
  );
}

const FEATURES = [
  { icon: '🎥', title: 'Registrazione automatica', body: 'Installa la camera una volta. Registra ogni partita e allenamento senza operatore.' },
  { icon: '🤖', title: 'Tagging AI degli eventi', body: 'Gol, tiri, assist e falli riconosciuti e taggati automaticamente in tempo reale.' },
  { icon: '✂️', title: 'Clip per l’allenamento', body: 'La AI monta le clip chiave per giocatore e per squadra. Pronte in minuti, non ore.' },
  { icon: '📲', title: 'Condivisione con i genitori', body: 'Gli highlights arrivano alle famiglie via app e WhatsApp — engagement e retention del club.' },
];

function Features() {
  return (
    <section style={{ padding: '40px 28px' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 700, letterSpacing: -0.4, textAlign: 'center' }}>Tutto quello che serve, in un’unica telecamera</h2>
      <p style={{ margin: '0 auto 26px', fontSize: 14, color: 'var(--ink-4)', textAlign: 'center', maxWidth: 480 }}>Dalla registrazione alla clip condivisa, senza toccare un editor video.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, maxWidth: 900, margin: '0 auto' }}>
        {FEATURES.map((f) => (
          <div key={f.title} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 18, background: 'var(--surface)' }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{f.icon}</div>
            <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 5 }}>{f.title}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.5 }}>{f.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: 1, t: 'Monta la camera', d: 'Un supporto a bordo campo. Nessun cablaggio complicato.' },
    { n: 2, t: 'Gioca la partita', d: 'La AI registra e traccia tutto in autonomia.' },
    { n: 3, t: 'Ricevi le clip', d: 'Highlights e analisi pronti nell’app subito dopo il fischio finale.' },
  ];
  return (
    <section style={{ padding: '40px 28px', background: 'var(--paper-2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
      <h2 style={{ margin: '0 0 26px', fontSize: 24, fontWeight: 700, letterSpacing: -0.4, textAlign: 'center' }}>Come funziona</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, maxWidth: 820, margin: '0 auto' }}>
        {steps.map((s) => (
          <div key={s.n} style={{ textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 999, background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 800, fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>{s.n}</div>
            <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 4 }}>{s.t}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.5, maxWidth: 220, margin: '0 auto' }}>{s.d}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Pricing() {
  const tiers = [
    { name: 'Starter', price: '€49', per: '/mese', tag: 'Squadra singola', feats: ['1 squadra', 'Highlights automatici', 'Storage 30 giorni'], highlight: false },
    { name: 'Club', price: '€79', per: '/mese', tag: 'Il più scelto', feats: ['Fino a 5 squadre', 'Tagging eventi AI', 'Condivisione genitori', 'Storage illimitato'], highlight: true },
    { name: 'Federazione', price: 'Su misura', per: '', tag: 'Multi-club', feats: ['Club illimitati', 'Consenso GDPR gestito', 'Dashboard federazione', 'Supporto dedicato'], highlight: false },
  ];
  return (
    <section style={{ padding: '44px 28px' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 700, letterSpacing: -0.4, textAlign: 'center' }}>Un prezzo pensato per i dilettanti</h2>
      <p style={{ margin: '0 auto 26px', fontSize: 14, color: 'var(--ink-4)', textAlign: 'center', maxWidth: 460 }}>Niente contratti pluriennali. Disdici quando vuoi.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, maxWidth: 860, margin: '0 auto', alignItems: 'start' }}>
        {tiers.map((t) => (
          <div key={t.name} style={{ border: t.highlight ? '2px solid var(--accent)' : '1px solid var(--line)', borderRadius: 14, padding: 20, background: t.highlight ? 'var(--accent-wash)' : 'var(--surface)', position: 'relative' }}>
            {t.highlight && <span style={{ position: 'absolute', top: -11, left: 20, fontSize: 10.5, fontWeight: 700, color: 'var(--on-accent)', background: 'var(--accent)', borderRadius: 999, padding: '3px 10px' }}>{t.tag}</span>}
            {!t.highlight && <div style={{ fontSize: 11, color: 'var(--ink-5)', marginBottom: 4 }}>{t.tag}</div>}
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{t.name}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginBottom: 14 }}>
              <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: -1 }}>{t.price}</span>
              <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>{t.per}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
              {t.feats.map((f) => (
                <div key={f} style={{ fontSize: 12.5, color: 'var(--ink-2)', display: 'flex', gap: 7 }}>
                  <span style={{ color: 'var(--moss)', fontWeight: 700 }}>✓</span>{f}
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'center', borderRadius: 9, padding: '9px 0', fontWeight: 650, fontSize: 13, background: t.highlight ? 'var(--accent)' : 'transparent', color: t.highlight ? 'var(--on-accent)' : 'var(--ink-2)', border: t.highlight ? 'none' : '1px solid var(--line-2)' }}>
              {t.name === 'Federazione' ? 'Contattaci' : 'Prova gratis'}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Testimonial() {
  return (
    <section style={{ padding: '40px 28px', background: 'var(--paper-2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 620, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: 18, lineHeight: 1.5, fontWeight: 500, letterSpacing: -0.2 }}>
          “Prima passavo la domenica sera a tagliare i video a mano. Ora le clip dei ragazzi sono pronte prima che io torni a casa.”
        </div>
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
          <span style={{ width: 34, height: 34, borderRadius: 999, background: 'var(--cat-teal)', color: 'var(--on-accent)', fontWeight: 700, fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>MR</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 13, fontWeight: 650 }}>Marco Rossi</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-5)' }}>Allenatore U15 · ASD Rivoli</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section style={{ padding: '48px 28px', textAlign: 'center' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 26, fontWeight: 800, letterSpacing: -0.6 }}>Porta il tuo club nel futuro</h2>
      <p style={{ margin: '0 auto 20px', fontSize: 14, color: 'var(--ink-4)', maxWidth: 420 }}>Prova MatchLens gratis per 14 giorni. Attivo in 5 minuti.</p>
      <span style={{ background: 'var(--accent)', color: 'var(--on-accent)', borderRadius: 10, padding: '13px 26px', fontWeight: 700, fontSize: 15 }}>Inizia gratis</span>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{ padding: '22px 28px', borderTop: '1px solid var(--line)', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 18, height: 18, borderRadius: 5, background: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-accent)', fontSize: 10, fontWeight: 800 }}>M</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>MatchLens</span>
      </div>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11.5, color: 'var(--ink-5)' }}>Privacy · Termini · GDPR minori · © 2026 MatchLens</span>
    </footer>
  );
}
