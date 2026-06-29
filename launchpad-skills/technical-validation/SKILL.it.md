---
name: technical-validation
description: Valida la fattibilità tecnica dell'idea — approccio di build, dipendenze chiave e vincoli regolatori/compliance (L2 Validation Gate, traccia 1B)
---

## Cosa fa questa skill (L2 — Validation Gate · traccia 1B)

È la traccia di **Validazione Tecnica** del Validation Gate L2 (Fase 1). Gira **in parallelo**
alla Market Validation (1A) e alimenta il Problem-Solution Fit (1C): prima di parlare con gli
utenti devi già sapere se la cosa è *costruibile*, da cosa *dipende* e se un vincolo
*regolatorio/legale* la blocca.

È pensata per validare **in modo incrementale, man mano che la chat avanza** — non serve un'unica
esecuzione. Ogni volta che il founder discute un aspetto tecnico, catturalo come fatto durevole
così i check 1B del gate si chiudono progressivamente:

- **Fattibilità** — l'approccio è tecnicamente possibile con gli strumenti di oggi? Qual è
  l'approccio di build / architettura ad alto livello? Qual è il singolo rischio tecnico maggiore?
- **Dipendenze chiave** — le dipendenze esterne critiche: API di terzi, modelli, infrastruttura,
  vendor, sorgenti dati, integrazioni.
- **Regolatorio / compliance** — regolamenti, licenze, certificazioni o vincoli di protezione dati
  (es. GDPR, licenze di settore) che incidono su se/come costruire e rilasciare.

## Come catturare l'evidenza (così il gate valida "man mano")

Per ogni finding tecnico, persistilo con `save_memory_fact` così i check 1B lo leggono alla
valutazione successiva. Usa frasi chiare e con le parole-chiave che il gate può intercettare
(feasibility / dependency / regulatory). Non inventare specifiche: se il founder non ha deciso una
dipendenza o non puoi valutare un vincolo, dillo chiaramente e fai l'unica domanda che sblocca —
poi cattura la risposta.

## Output

Un riepilogo tecnico breve e founder-facing con tre sezioni (Fattibilità, Dipendenze chiave,
Regolatorio/compliance), ognuna con un verdetto in una riga e le domande aperte. Cita le fonti per
ogni claim esterno. Tienilo stringato — è un check di gate, non un documento di architettura.
