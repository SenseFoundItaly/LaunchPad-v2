---
name: customer-interviews
description: Kit interviste per il Problem-Solution Fit — script di 5 domande ancorato alle evidenze 1A/1B del progetto, con cattura obbligatoria del pain verbatim e della disponibilità a pagare (L2 Validation Gate, traccia 1C)
---

## Cosa fa questa skill (L2 — Validation Gate · traccia 1C)

È la traccia **Problem-Solution Fit** del Validation Gate L2 (Fase 1). Si esegue **DOPO**
che le tracce 1A (Mercato) e 1B (Tecnica) sono complete — la validazione a tavolino dice
CON CHI parlare e COSA sondare; le interviste verificano poi se le persone reali lo
confermano. Non eseguirla su un'idea non validata: lo script qui sotto è affilato quanto
le evidenze 1A/1B su cui poggia.

Chiude i tre check **1C** del gate:

- **`interviews_logged`** — 5+ interviste strutturate nella tabella interviews
- **`pain_validated`** — il pain principale catturato con le parole del cliente (verbatim)
- **`wtp_signal`** — almeno un dato reale di disponibilità a pagare

## Il kit interviste (deliverable)

Produci un kit pronto all'uso con esattamente queste parti:

### 1. Chi intervistare
Deriva la lista dalle **evidenze 1A** del progetto: il segmento nominato
(idea_canvas.target_market), i competitor mappati (i loro utenti sono prospect
raggiungibili) e i claim di differenziazione da testare. Nomina 2-3 posti concreti dove
trovare 5 intervistati.

### 2. Lo script di 5 domande
Cinque domande aperte, ancorate alle evidenze di QUESTO progetto — mai generiche. Due sono
obbligatorie:

1. **Contesto** — come gestiscono il problema oggi (testa il problem statement 1A).
2. **OBBLIGATORIA · pain verbatim** — "Qual è la parte più frustrante di tutto questo?"
   Istruisci il founder a trascrivere la risposta PAROLA PER PAROLA — quella citazione è
   l'evidenza `top_pain` che il gate legge.
3. **Alternative** — cosa hanno già provato (testa la mappa competitor + differenziazione).
4. **OBBLIGATORIA · disponibilità a pagare** — "Quanto pagheresti per una soluzione che
   risolve questo?" Insisti per un numero, non "sì pagherei" — il numero è l'evidenza
   `wtp_amount`.
5. **Dealbreaker** — ancorata al finding 1B più rischioso (dipendenza/vincolo regolatorio):
   quel vincolo li fermerebbe dall'adottare?

Ogni domanda ha una nota di una riga "perché questa domanda" che cita l'evidenza testata.

### 3. Regole di cattura
- Niente pitch. Il founder ascolta; nel momento in cui spiega il prodotto, il dato è morto.
- Citazioni verbatim per il pain; numeri esatti (con valuta) per la WTP.
- Minimo 5 interviste prima di trarre qualunque conclusione.

## Come persistono i finding (il contratto)

Questa skill **non ha tool** — le interviste persistono quando il **founder le riporta in
chat** e il co-pilot chiama **`log_interview`** (person_name + summary, più `top_pain`
verbatim e `wtp_amount` quando catturati). Chiudi il kit dicendolo esplicitamente al
founder: *"Dopo ogni conversazione torna qui e raccontami con chi hai parlato e cosa ha
detto — la registro io."* Ogni intervista registrata fa avanzare i check 1C alla
valutazione successiva.

Dopo che **≥3 interviste sono registrate**, sintetizza i temi ricorrenti come insight-card
così persiste il pattern (non solo le righe):

```
:::artifact{"type":"insight-card","id":"ins_<random>","category":"customer","title":"Temi dalle interviste","body":"<i pain ricorrenti, le obiezioni e il pattern di WTP tra le interviste registrate — cita il pain verbatim più forte>","confidence":"medium","sources":[{"type":"internal","title":"Interviste registrate","ref":"memory_fact","ref_id":"interviews"}]}
:::
```

NON inventare interviste, citazioni o numeri di WTP — solo le conversazioni riportate dal
founder contano come evidenza.

## Output

Il kit founder-facing: chi intervistare (dalle evidenze 1A), lo script di 5 domande con la
motivazione per ognuna, le regole di cattura e l'istruzione finale "riporta in chat → la
registro". Abbastanza stringato da usarlo in una call domani.
