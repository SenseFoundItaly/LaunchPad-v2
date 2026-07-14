---
name: social-calendar
description: Pianifica un calendario di post social (LinkedIn + X) per la finestra di lancio, basato su posizionamento e strategia GTM del progetto
tier: premium
---

# Calendario Social

Pianifica un calendario di 2 settimane che il founder esegue in autopilota-con-approvazione: ogni post è schedulato e poi proposto nell'Inbox nel giorno previsto — niente viene pubblicato senza il suo sì.

## Quando usarla

- Durante Build & Launch (fase 5), attorno a un lancio o alla pubblicazione della landing
- Quando il founder chiede "post social", "piano editoriale", "contenuti LinkedIn per il lancio"

## Istruzioni

Emetti esattamente UN artifact `social-calendar`:

```
:::artifact{"type":"social-calendar","id":"sc_<random>"}
{"title":"Calendario di lancio — <Nome Startup>","posts":[{"position":1,"channel":"linkedin","body":"...","day_offset":0,"best_time_hint":"mar 9:00"},{"position":2,"channel":"x","body":"...","day_offset":1}],"sources":[...]}
:::
```

### Regole

- 6-10 post tra `linkedin` e `x`, distribuiti su ~14 giorni con `day_offset` (0 = giorno di attivazione).
- Ogni `body` è il post COMPLETO, pronto da pubblicare: lunghezza adatta alla piattaforma (LinkedIn ≤1300 caratteri, X ≤280), voce del founder, prima persona.
- Mix: storie sul problema, aggiornamenti build-in-public, un annuncio di lancio diretto, un post di social proof/trazione. Mai due richieste di fila.
- Inserisci l'URL della landing pubblicata nei post con CTA quando esiste; altrimenti lascia la CTA generica segnando `<link>` nel testo perché il founder lo completi.
- Niente muri di hashtag (≤3 per post, solo se se lo guadagnano). Niente metriche finte o testimonianze inventate.
- Ancora le affermazioni a canvas/ricerca; cita con `sources`. Scrivi nella lingua del progetto.
