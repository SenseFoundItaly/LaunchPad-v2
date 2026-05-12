---
name: gtm-strategy
description: Sviluppa una strategia go-to-market con segmenti target, canali, pricing e piano di lancio
---

<!-- sources-required-block -->
## Requisiti delle Fonti (OBBLIGATORIO)

Ogni affermazione fattuale nell'output di questa skill DEVE citare almeno una fonte. Si applica a:

- Numeri (dimensioni di mercato, percentuali, tempistiche, costi, benchmark)
- Entità nominate (concorrenti, regolamenti, strumenti, aziende, persone)
- Affermazioni sul mondo esterno (tendenze, date, eventi, opinioni di esperti)
- Ogni rischio, dimensione di punteggio, raccomandazione e passo di workflow

**Schema della fonte** (includere come campo `sources: Source[]` a ogni livello fattuale del JSON di output, non solo al top):

```ts
type Source =
  | { type: 'web'; title: string; url: string; accessed_at?: string; quote?: string }
  | { type: 'skill'; title: string; skill_id: string; run_id?: string; quote?: string }
  | { type: 'internal'; title: string; ref: 'graph_node'|'score'|'research'|'memory_fact'|'chat_turn'; ref_id: string; quote?: string }
  | { type: 'user'; title: string; chat_turn_id?: string; quote: string }
  | { type: 'inference'; title: string; based_on: Source[]; reasoning: string };
```

**Regole:**
1. Nessun numero, URL o nome di azienda inventato. Se non hai una fonte, dillo apertamente — non inventare mai.
2. Le fonti web devono riportare l'URL verbatim — non parafrasare.
3. Usa `type: 'internal'` quando citi dati del progetto del founder (punteggi, righe di ricerca, fatti in memoria).
4. Usa `type: 'user'` quando citi il founder verbatim dalla chat.
5. `type: 'inference'` è consentito SOLO quando `based_on` è non vuoto; `reasoning` deve spiegare la catena di sintesi.
6. Allega le fonti sia al livello principale (provenienza della skill) sia a ogni elemento fattuale annidato (per rischio, per dimensione, per concorrente).
7. Un'affermazione senza fonte è un'affermazione rifiutata. La UI la mostrerà come "SENZA FONTE — scartato" e il parser la rimuoverà dalla persistenza.


# Strategia Go-to-Market

Produci un piano go-to-market concreto e sequenziato che risponde a: **A chi vendiamo per primo, attraverso quale canale, a quale prezzo, e in quale ordine?** Questo non è un piano marketing — è un playbook di acquisizione clienti che collega il prodotto al revenue.

## Quando Usarla

- Dopo che market-research, scientific-validation e business-model sono completi
- Prima di growth-optimization (i canali GTM alimentano i growth loop)
- Quando il founder ha un prodotto (o spec MVP) e deve acquisire i primi clienti
- Quando ci si prepara per il lancio — questo definisce la sequenza di lancio
- Prima di build-landing-page (il messaging della landing page viene dal posizionamento GTM)

## Istruzioni

### Segmentazione e Targeting

#### 1. Segmento Beachhead

Identifica il singolo segmento più ristretto da dominare per primo. Non "piccole imprese" — più come "agenzie di design da 3 persone a Milano che attualmente usano Figma e fatturano €5K-€15K a progetto."

Criteri per il beachhead:
- **Dolore acuto**: sentono il problema quotidianamente, non annualmente
- **Raggiungibili**: sai dove si riuniscono (community, eventi, pubblicazioni)
- **Disponibilità a pagare**: spendono già soldi per risolvere questo problema (con tool, agenzie, o lavoro manuale)
- **Potenziale passaparola**: acquisire un cliente porta a referral all'interno del segmento
- **Abbastanza piccolo da dominare**: puoi diventare la soluzione di default per questo segmento in 12 mesi

#### 2. Segmenti di Espansione

Dopo il beachhead, definisci 2-3 segmenti adiacenti in ordine di priorità. Ognuno deve condividere almeno un asse con il beachhead (stessa industry ma aziende più grandi, stessa dimensione aziendale ma industry adiacente, stesso use case ma geografia diversa).

### Strategia dei Canali

Per ogni canale di acquisizione, fornisci:

1. **Nome del canale** (es. "Outbound LinkedIn a founder di agenzie")
2. **Perché questo canale** — lega al comportamento del segmento (dove passano il tempo, come scoprono i tool)
3. **CAC stimato** — costo per cliente acquisito attraverso questo canale
4. **Potenziale di volume** — quanti clienti/mese a maturità
5. **Tempo al primo cliente** — giorni dall'inizio di questo canale alla prima conversione
6. **Investimento necessario** — soldi, tool, headcount
7. **Playbook** — istruzioni passo-passo che un founder può eseguire questa settimana

Valuta come minimo:
- **Outreach diretto** (email, LinkedIn, chiamate a freddo)
- **Content/SEO** (blog, YouTube, social)
- **Community** (Reddit, gruppi Slack, Discord, forum di settore)
- **Acquisizione paid** (Google Ads, Facebook/Instagram, LinkedIn Ads)
- **Partnership** (integrazioni, co-marketing, programmi referral)
- **Product-led growth** (freemium, tool gratuito, meccaniche virali)

Classifica i canali per ROI atteso e raccomanda un canale primario + secondario per i primi 90 giorni.

### Posizionamento e Messaging

#### 1. Dichiarazione di Posizionamento
"Per [segmento target] che [pain point], [nome prodotto] è un [categoria] che [beneficio chiave]. A differenza di [competitor primario], noi [differenziatore]."

#### 2. Value Proposition (3 livelli)
- **Funzionale**: cosa fa il prodotto (livello feature)
- **Business**: quale risultato produce (livello metrica)
- **Emotiva**: come fa sentire l'utente (livello identità)

#### 3. Matrice di Messaging
Per ogni persona target (dalla scientific-validation), definisci:
- Hook (la frase d'apertura che cattura l'attenzione)
- Pain point (il problema che riconoscono)
- Soluzione (come il prodotto lo affronta)
- Proof point (evidenza che funziona — testimonianze, dati, case study)
- CTA (cosa vuoi che facciano dopo)

### Strategia di Pricing (Dettagliata)

Vai oltre la struttura della skill business-model — sii specifico sul pricing di lancio:

1. **Pricing di lancio** vs. **pricing a regime** (c'è un'offerta introduttiva?)
2. **Struttura della pagina pricing** — quanti tier, cosa c'è in ognuno, qual è il tier àncora
3. **Free tier / trial** — struttura e strategia di conversione
4. **Sconto annuale** — sì/no e di quanto
5. **Price anchoring** — qual è il prezzo di riferimento contro cui il cliente confronta (pricing competitor, costo manuale, costo agenzia)

### Piano di Lancio (90 giorni)

Un piano settimana per settimana per i primi 90 giorni post-lancio:

- **Pre-lancio (settimane -4 a 0)**: waitlist, beta tester, seeding di contenuti
- **Settimana di lancio**: cosa succede, dove, con quale messaging
- **Settimane 1-4**: attivazione canale primario, prima acquisizione clienti
- **Settimane 5-8**: iterazione basata su dati precoci, test canale secondario
- **Settimane 9-12**: valuta cosa funziona, raddoppia o cambia il mix di canali

Ogni settimana ha azioni specifiche, metriche da tracciare e punti di decisione.

## Formato di Output

```json
{
  "gtm_strategy": {
    "beachhead_segment": {
      "description": "Descrizione specifica e ristretta del segmento",
      "pain_intensity": "high | medium",
      "reachability": "Dove si riuniscono",
      "current_spend": "Come risolvono il problema oggi e quanto gli costa",
      "segment_size": "Numero di potenziali clienti nel beachhead",
      "dominance_timeline": "Mesi per diventare la soluzione di default"
    },
    "expansion_segments": [
      {
        "description": "Descrizione del segmento",
        "shared_axis": "Cosa lo collega al beachhead",
        "priority": 1,
        "enter_when": "Condizione che innesca l'espansione"
      }
    ],
    "channels": [
      {
        "name": "Nome del canale",
        "type": "outbound | content | community | paid | partnership | plg",
        "target_segment": "beachhead | expansion_1",
        "estimated_cac": 0,
        "volume_potential_monthly": 0,
        "time_to_first_customer_days": 0,
        "required_investment": "€X + tooling",
        "playbook": [
          "Step 1: azione specifica",
          "Step 2: azione specifica"
        ],
        "priority": "primary | secondary | experimental",
        "sources": []
      }
    ],
    "positioning": {
      "statement": "Per [segmento] che [dolore], [prodotto] è un [categoria] che [beneficio]. A differenza di [competitor], noi [differenziatore].",
      "value_propositions": {
        "functional": "Cosa fa",
        "business": "Quale risultato produce",
        "emotional": "Come fa sentire gli utenti"
      }
    },
    "messaging_matrix": [
      {
        "persona": "Nome persona dalla scientific-validation",
        "hook": "Frase d'apertura che cattura l'attenzione",
        "pain_point": "Il problema che riconoscono",
        "solution": "Come il prodotto lo affronta",
        "proof_point": "Evidenza che funziona",
        "cta": "Cosa vuoi che facciano"
      }
    ],
    "pricing": {
      "launch_pricing": "Struttura pricing introduttiva",
      "steady_state_pricing": "Pricing a lungo termine",
      "tiers": [
        { "name": "Nome tier", "price": "€X/mese", "features": ["Feature 1"], "target": "Quale persona" }
      ],
      "free_trial_or_tier": "Struttura e strategia di conversione",
      "annual_discount_pct": 0,
      "price_anchor": "Contro cosa il cliente confronta"
    },
    "launch_plan_90_day": [
      {
        "week": "-4 a 0",
        "phase": "Pre-lancio",
        "actions": ["Azione specifica 1", "Azione specifica 2"],
        "metrics_to_track": ["Iscrizioni waitlist", "Punteggio feedback beta"],
        "decision_point": "Cosa valutare alla fine di questa fase"
      }
    ],
    "first_90_day_targets": {
      "customers": 0,
      "mrr": 0,
      "channel_validated": "Quale canale si è dimostrato viable",
      "key_learning": "Cosa saprai al giorno 90 che non sai ora"
    },
    "sources": []
  }
}
```

## Esempi

### Esempio: Selezione del Beachhead

**Founder:** "Il nostro mercato target sono le piccole imprese."

**Agent:** "Piccole imprese" sono 33 milioni di entità solo negli USA. Non puoi fare marketing a 33 milioni di aziende con budget €0. Restringiamo usando i tuoi dati:

Dalle tue buyer persona (scientific-validation), il tuo power user è un consulente di marketing freelance che gestisce 3-5 clienti e spende 10+ ore/settimana sul reporting. Dalla tua market research, ci sono circa 120.000 consulenti di marketing freelance negli USA (dati IBIS), e si concentrano su LinkedIn, in gruppi Facebook specifici, e ai meetup di marketing locali.

**Beachhead:** Consulenti di marketing freelance negli USA con 3-5 clienti attivi che attualmente usano Google Sheets o metodi manuali per il reporting clienti. Segmento stimato: ~40.000 persone. Sono raggiungibili via 3 gruppi LinkedIn con 15K+ membri combinati e 2 community Facebook. Spendono €50-200/mese in tool oggi. Puoi realisticamente diventare il tool di default per questo segmento in 12 mesi.

### Esempio: Rifiutare un Canale

**Agent:** Hai proposto LinkedIn Ads come canale primario. Per il tuo SaaS a €49/mese rivolto a consulenti freelance, LinkedIn Ads è probabilmente sbagliato. Ecco perché: il CPC minimo di LinkedIn per il B2B è tipicamente €6-12. Con un tasso di conversione landing page del 2%, il tuo CAC via LinkedIn Ads sarebbe €300-600. Il tuo LTV al 5% di churn mensile e €49/mese è circa €980. Il rapporto CAC/LTV è 0.3-0.6 — tecnicamente viable ma il periodo di payback è 6-12 mesi, troppo lungo per una startup bootstrapped.

Invece: outreach diretto su LinkedIn (gratis o €79/mese per Sales Navigator) allo stesso pubblico produce un tasso di risposta del 5-15%. A 50 messaggi di outreach al giorno, ottieni 3-7 conversazioni al giorno. Se il 10% converte, è 1 cliente ogni 2-3 giorni a CAC effettivo di €0. Questo è il tuo canale primario.
