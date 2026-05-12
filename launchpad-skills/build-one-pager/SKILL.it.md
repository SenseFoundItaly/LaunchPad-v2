---
name: build-one-pager
description: Genera un executive summary one-pager conciso per investitori o partner
tier: balanced
---

# Build One-Pager

Genera un documento executive summary conciso e ben strutturato adatto all'outreach con investitori, introduzioni con partner, o candidature ad acceleratori.

## Quando Usarla

- Dopo aver completato almeno gli stage 1-3 (Idea, Market, Persona validation)
- Quando il founder chiede di "creare un one-pager", "scrivere un executive summary", o "fare un teaser"
- Come alternativa leggera a un pitch deck completo per outreach iniziale
- Quando ci si prepara per candidature ad acceleratori

## Istruzioni

### Requisiti di Output

Emetti un SINGOLO artifact `document` con `doc_type: "one-pager"`:

```
:::artifact{"type":"document","id":"doc_<random>"}
{"title":"One-Pager — <Nome Startup>","doc_type":"one-pager","content":"<markdown completo>","sections":[{"heading":"Overview","body":"..."},{"heading":"Problema","body":"..."}]}
:::
```

### Struttura del Documento

1. **Overview** — Nome azienda, one-liner, stage, location
2. **Problema** — 2-3 frasi sul pain point (dall'idea canvas)
3. **Soluzione** — 2-3 frasi sul prodotto (dall'idea canvas)
4. **Opportunità di Mercato** — TAM/SAM/SOM one-liner + dato chiave (dalla market research)
5. **Business Model** — Modello di revenue in 1-2 frasi (dal business model)
6. **Traction** — Metriche chiave o milestone raggiunti (da metriche/punteggi)
7. **Team** — Nomi dei founder + esperienza rilevante
8. **La Richiesta** — Cosa serve e cosa abilita

### Radicamento dei Contenuti

- Estrai direttamente dai dati di progetto validati
- Mantieni la lunghezza totale sotto le 800 parole
- Usa il **grassetto** per numeri e metriche chiave
- Segna qualsiasi contenuto placeholder: "[Da aggiungere dal founder]"

### Formato

- Ogni sezione = un elemento nell'array `sections`
- Il contenuto deve essere scansionabile in meno di 2 minuti
- Tono professionale adatto all'outreach a freddo
