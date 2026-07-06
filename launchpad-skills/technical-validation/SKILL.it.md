---
name: technical-validation
description: Valida la fattibilità tecnica dell'idea — approccio di build, dipendenze chiave e vincoli regolatori/compliance (L2 Validation Gate, traccia 1B)
---

## Cosa fa questa skill (L2 — Validation Gate · traccia 1B)

È la traccia di **Validazione Tecnica** del Validation Gate L2 (Fase 1). Gira **in parallelo**
al track 1A Mercato e alimenta il Problem-Solution Fit (1C): prima di parlare con gli
utenti devi già sapere se la cosa è *costruibile*, da cosa *dipende* e se un vincolo
*regolatorio/legale* la blocca.

È pensata per validare **in modo incrementale, man mano che la chat avanza** — non serve un'unica
esecuzione. Ogni volta che il founder discute un aspetto tecnico, catturalo come fatto durevole
così i tre check 1B del gate (`tech_feasibility`, `key_dependencies`, `regulatory_check`) si
chiudono progressivamente:

- **Fattibilità (`tech_feasibility`)** — l'approccio è tecnicamente possibile con gli strumenti di
  oggi? Qual è l'approccio di build / architettura ad alto livello? Qual è il singolo rischio
  tecnico maggiore?
- **Dipendenze chiave (`key_dependencies`)** — le dipendenze esterne critiche: API di terzi,
  modelli, infrastruttura, vendor, sorgenti dati, integrazioni.
- **Regolatorio / compliance (`regulatory_check`)** — regolamenti, licenze, certificazioni o
  vincoli di protezione dati (es. GDPR, licenze di settore) che incidono su se/come costruire e
  rilasciare.

## Come persistono i finding (così il gate valida "man mano")

Questa skill **non ha tool** — persiste **emettendo artifact `insight-card`** che il runner salva
nei memory_facts del progetto. I check **1B** del Validation Gate leggono quei fatti alla
valutazione successiva: emettere queste card è ciò che rende verde la traccia tecnica. Emetti
**una card per area** (fattibilità + dipendenze usano `category: "technology"`; la card
regolatoria usa `category: "regulatory"`), con `body` con le parole-chiave che il gate
intercetta e almeno una source:

```
:::artifact{"type":"insight-card","id":"ins_<random>","category":"technology","title":"Fattibilità tecnica","body":"<verdetto fattibilità — approccio/architettura + il rischio tecnico maggiore>","confidence":"medium","sources":[{"type":"user","title":"founder","quote":"..."}]}
:::
:::artifact{"type":"insight-card","id":"ins_<random>","category":"technology","title":"Dipendenze chiave","body":"<dipendenze esterne critiche: API, modelli, infra, vendor, integrazioni>","confidence":"medium","sources":[{"type":"user","title":"founder","quote":"..."}]}
:::
:::artifact{"type":"insight-card","id":"ins_<random>","category":"regulatory","title":"Regolatorio / compliance","body":"<vincoli regolatori/licenze/protezione dati, es. GDPR>","confidence":"medium","sources":[{"type":"user","title":"founder","quote":"..."}]}
:::
```

Il founder può validare anche **in modo incrementale nella chat normale** (il co-pilot cattura i
fatti tecnici man mano); questa skill è la via strutturata, in blocco. Non inventare specifiche: se
una dipendenza non è decisa o un vincolo non è valutabile, dillo e fai l'unica domanda che sblocca.

## Output

Un riepilogo tecnico breve e founder-facing con tre sezioni (Fattibilità, Dipendenze chiave,
Regolatorio/compliance), ognuna con un verdetto in una riga e le domande aperte. Cita le fonti per
ogni claim esterno. Tienilo stringato — è un check di gate, non un documento di architettura.
