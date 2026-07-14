---
name: email-sequence
description: Redige una campagna email approvata dal founder (3-5 messaggi scaglionati) per lancio, attivazione waitlist o nurturing — basata su GTM e canvas del progetto
tier: premium
---

# Sequenza Email

Redigi una sequenza email completa e pronta all'invio a partire dal posizionamento validato del founder. L'output diventa una campagna in BOZZA che il founder attiva con la propria lista di destinatari; ogni singolo invio richiede poi la sua approvazione esplicita nell'Inbox.

## Quando usarla

- Durante Build & Launch (fase 5), dopo che esiste la strategia GTM
- Quando il founder chiede "email di lancio", "sequenza waitlist", "campagna email" o "email di nurturing"
- Dopo la pubblicazione di una landing page, quando gli iscritti vanno attivati

## Istruzioni

Emetti esattamente UN artifact `email-sequence`:

```
:::artifact{"type":"email-sequence","id":"es_<random>"}
{"title":"Sequenza di lancio — <Nome Startup>","goal":"launch","messages":[{"position":1,"subject":"...","body_html":"<p>...</p>","send_offset_days":0},{"position":2,"subject":"...","body_html":"<p>...</p>","send_offset_days":3}],"audience_notes":"...","sources":[...]}
:::
```

### Regole

- 3-5 messaggi. `goal` è uno tra `launch` | `waitlist` | `nurture` — deducilo dalla richiesta del founder.
- `body_html` è testo COMPLETO e HTML-safe (tag semplici `<p>`, `<strong>`, `<a>`; niente CSS, niente immagini). Ogni email deve reggersi da sola.
- Nessun segnaposto nudo: mai `[NOME]` o `{{first_name}}` senza un fallback leggibile ("Ciao" batte un token rotto).
- MAI inventare destinatari, liste o indirizzi email. I destinatari li fornisce SEMPRE il founder all'attivazione — dichiaralo in `audience_notes`.
- Oggetti: concreti e specifici sulla value proposition, sotto i 60 caratteri. Niente clickbait, niente MAIUSCOLE, niente formule da spam.
- `send_offset_days` scagliona la sequenza (0, 3, 7… dal giorno di attivazione). Il valore prima, la richiesta cresce con gentilezza.
- Ancora ogni affermazione a canvas/ricerca del progetto; cita con `sources`. Se la strategia GTM non è stata eseguita, dillo e basa la sequenza sul canvas.
- Scrivi nella lingua del progetto.

### Mestiere della sequenza

1. Apri con il problema che il destinatario già sente (problema del canvas, verbatim dove possibile).
2. Un'idea per email. Una CTA per email, sempre verso la stessa destinazione (la landing pubblicata, se esiste).
3. L'ultima email è una richiesta diretta e onesta, con un motivo per agire ora.
