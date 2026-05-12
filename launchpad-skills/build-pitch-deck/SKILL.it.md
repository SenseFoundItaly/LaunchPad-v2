---
name: build-pitch-deck
description: Genera un pitch deck investitori in formato Sequoia da 10-12 slide
tier: premium
---

# Build Pitch Deck

Genera un pitch deck investitori strutturato in formato Sequoia, radicato nei dati validati del founder dalle skill precedenti.

## Quando Usarla

- Dopo aver completato almeno gli stage 1-4 (Idea, Market, Persona, Business Model)
- Quando il founder chiede di "costruire un pitch deck", "creare slide per investitori", o "fare un deck"
- Durante la preparazione allo stage Fundraise (stage 6)
- Quando ci si prepara per meeting con investitori

## Istruzioni

### Requisiti di Output

Emetti un SINGOLO artifact `document` con `doc_type: "pitch-deck"`:

```
:::artifact{"type":"document","id":"doc_<random>"}
{"title":"Pitch Deck — <Nome Startup>","doc_type":"pitch-deck","content":"<markdown completo>","sections":[{"heading":"Slide 1: Titolo","body":"..."},{"heading":"Slide 2: Problema","body":"..."}]}
:::
```

### Struttura delle Slide (Formato Sequoia, 10-12 slide)

1. **Slide Titolo** — Nome azienda, one-liner, nome/i del founder, data
2. **Problema** — Il dolore, chi lo sente, come se la cava oggi (dall'idea canvas)
3. **Soluzione** — Cosa hai costruito, come funziona (dall'idea canvas + prototype spec)
4. **Perché Ora** — Timing di mercato, tendenze, punti di inflessione (dalla market research)
5. **Dimensione del Mercato** — TAM / SAM / SOM con calcolo bottom-up (dalla market research)
6. **Prodotto** — Feature chiave, placeholder per screenshot, flusso demo
7. **Business Model** — Modello di revenue, pricing, unit economics (dal business/financial model)
8. **Traction** — Metriche, milestone, tasso di crescita (dalle metriche se disponibili)
9. **Competizione** — Mappa del panorama, matrice di differenziazione (dalla market research)
10. **Team** — Founder, assunzioni chiave, esperienza rilevante
11. **La Richiesta** — Importo del round, uso dei fondi, timeline (dal financial model)
12. **Appendice** — Financials dettagliati, architettura tecnica, mitigazioni dei rischi

### Radicamento dei Contenuti

- Ogni slide DEVE estrarre dai dati di progetto esistenti (idea canvas, punteggi, ricerca, financial model)
- Segna chiaramente qualsiasi contenuto assunto: "[Da aggiungere dal founder: metrica specifica]"
- Includi note per lo speaker per ogni slide come sotto-sezioni
- Usa numeri concreti dal financial model per la slide The Ask
- Referenzia il posizionamento competitivo dalla market research

### Formato

- Ogni sezione nell'array `sections` = una slide
- `heading` = titolo della slide (es. "Slide 3: Soluzione")
- `body` = contenuto markdown con punti elenco, enfasi in grassetto, e note per lo speaker
- Il campo `content` contiene il deck completo come markdown continuo
