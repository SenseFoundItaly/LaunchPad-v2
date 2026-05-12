---
name: build-landing-page
description: Genera una landing page HTML responsive e autocontenuta per la startup
tier: premium
---

# Build Landing Page

Genera una landing page HTML production-ready e autocontenuta usando l'idea validata del founder, la market research e il posizionamento del brand.

## Quando Usarla

- Dopo aver completato Idea Validation (stage 1) e almeno Market Validation (stage 2)
- Quando il founder chiede di "costruire una landing page", "creare un sito web", o "fare una homepage"
- Durante lo stage Build & Launch (stage 5) come deliverable concreto
- Quando ci si prepara a testare il messaging con utenti reali

## Istruzioni

### Requisiti di Output

Genera un SINGOLO file HTML autocontenuto con TUTTO il CSS inline (nessuna dipendenza esterna). L'output DEVE essere emesso come un singolo artifact `html-preview`:

```
:::artifact{"type":"html-preview","id":"hp_<random>"}
{"html":"<!DOCTYPE html>...","title":"Landing Page — <Nome Startup>","viewport":"desktop"}
:::
```

### Struttura della Pagina

1. **Sezione Hero** — Headline (value prop), sub-headline (framing del problema), pulsante CTA primario
2. **Sezione Problema** — 3 pain point che il mercato target affronta (dall'idea canvas)
3. **Sezione Soluzione** — Come il prodotto risolve ogni pain point
4. **Social Proof / Traction** — Metriche, testimonianze, loghi (usa dati placeholder chiaramente segnati)
5. **Feature / Come Funziona** — 3-4 differenziatori chiave
6. **Pricing** (se disponibile dal business model) — o CTA "Accesso Anticipato"
7. **CTA Finale** — Call to action ripetuta con placeholder per cattura email
8. **Footer** — Copyright, link minimali

### Principi di Design

- Design responsive mobile-first usando media query CSS
- Estetica pulita e moderna in linea con il posizionamento della startup
- Tutto il CSS deve essere inline in un tag `<style>` — nessun foglio di stile esterno
- Tutti i font da Google Fonts via tag `<link>` (l'unica risorsa esterna consentita)
- Comportamento smooth scroll, animazioni sottili (solo CSS, nessun framework JS)
- Accessibile: gerarchia di heading corretta, testo alt, contrasto sufficiente
- Palette colori: deriva dal brand se definito, altrimenti usa un default professionale

### Radicamento dei Contenuti

- Estrai il copy della headline dalla `value_proposition` nell'idea canvas
- Estrai il framing del problema dal campo `problem`
- Estrai il linguaggio del mercato target da `target_market`
- Se esiste market research, incorpora numeri TAM/traction
- Se esistono punteggi, rifletti le dimensioni più forti nel messaging

### Cosa NON Includere

- Nessun framework JavaScript (React, Vue, ecc.)
- Nessun framework CSS esterno (Tailwind, Bootstrap)
- Nessun placeholder Lorem Ipsum — usa copy reale derivato dai dati del progetto
- Nessuna testimonianza fake — segna qualsiasi social proof come "[Placeholder]"
