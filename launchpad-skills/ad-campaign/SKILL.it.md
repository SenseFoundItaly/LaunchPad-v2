---
name: ad-campaign
description: Costruisce un pack pubblicitario pronto all'export (Meta + Google) — audience, ripartizione budget e varianti di copy che il founder incolla negli ad editor
tier: premium
---

# Pack Campagna Ads

Costruisci un pack completo di acquisizione a pagamento che il founder esporta in Google Ads Editor / import bulk di Meta. LaunchPad non tocca mai gli account pubblicitari — il deliverable è il pack, il founder lo esegue.

## Quando usarla

- Durante Build & Launch (fase 5), quando la landing è pubblicata e il founder vuole traffico a pagamento
- Quando il founder chiede di "ads", "campagne Meta", "Google Ads", "acquisizione a pagamento"

## Istruzioni

Emetti esattamente UN artifact `ad-pack`:

```
:::artifact{"type":"ad-pack","id":"ap_<random>"}
{"title":"Ads di lancio — <Nome Startup>","platform_targets":["meta","google"],"audiences":[{"name":"...","targeting_notes":"...","rationale":"..."}],"budget":{"total_monthly_usd":600,"split":[{"audience":"...","pct":60}]},"ads":[{"audience":"...","headlines":["..."],"descriptions":["..."],"primary_text":"...","image_prompt":"...","cta":"Iscriviti"}],"final_url":"https://...","sources":[...]}
:::
```

### Regole

- Massimo 2-3 audience, ognuna con `targeting_notes` concrete (interessi, ruoli, seed lookalike) e una `rationale` di una riga legata all'ICP.
- Budget: realistico per un founder pre-seed salvo indicazione — default €500-1000/mese totali, ripartiti per convinzione sull'audience. Mai promettere risultati.
- Per audience: 3-5 `headlines` (≤30 caratteri, vincolo RSA di Google), 2-4 `descriptions` (≤90 caratteri), un `primary_text` per Meta (≤125 caratteri visibili), un `image_prompt` (direzione artistica concreta per la creatività, non uno slogan).
- `final_url` = la landing pubblicata quando esiste; altrimenti omettila e dillo.
- Le affermazioni devono essere fedeli a canvas/ricerca (niente "lo strumento n.1", niente numeri inventati); cita con `sources`. Rispetta le basi delle piattaforme: niente riferimenti ad attributi personali ("Sei depresso?"), niente clickbait.
- Scrivi il copy nella lingua del progetto.
