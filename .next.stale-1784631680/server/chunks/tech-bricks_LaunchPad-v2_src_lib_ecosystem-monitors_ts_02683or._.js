module.exports=[669922,e=>{"use strict";var i=e.i(254799),t=e.i(921284),n=e.i(941171),o=e.i(596067);e.i(520378);let a=`
7. EMIT AS YOU GO — emit each ecosystem_alert artifact IMMEDIATELY when a material finding is confirmed, BEFORE starting the next search or page fetch. Do NOT defer emission to a final summary: the tool budget or time limit can end the scan first, and an un-emitted finding is lost. If the scan is ending and you have confirmed a material finding you have not yet emitted, emit its artifact block NOW, before stopping.
8. The artifact header is ALWAYS exactly {"type":"ecosystem_alert"} — never put the alert_type value in the header. The alert_type belongs ONLY in the body JSON.
`.trim(),r=`
7. EMETTI SUBITO — emetti ogni artifact ecosystem_alert IMMEDIATAMENTE quando un finding materiale \xe8 confermato, PRIMA di iniziare la ricerca o il fetch successivo. NON rimandare l'emissione a un riassunto finale: il budget di tool o il limite di tempo possono terminare lo scan prima, e un finding non emesso \xe8 perso. Se lo scan sta finendo e hai confermato un finding materiale non ancora emesso, emetti SUBITO il suo blocco artifact, prima di fermarti.
8. L'header dell'artifact \xe8 SEMPRE esattamente {"type":"ecosystem_alert"} — non mettere mai il valore di alert_type nell'header. L'alert_type va SOLO nel JSON del body.
`.trim(),s=`
OUTPUT CONTRACT — do not deviate:
1. Start with a 2-3 sentence narrative summary of what moved this week.
2. Then emit one artifact block per distinct finding, EXACTLY in this format:
   :::artifact{"type":"ecosystem_alert"}
   {
     "alert_type": "...",
     "entity": "...",
     "headline": "...",
     "body": "...",
     "source_url": "...",
     "relevance_score": 0.0,
     "confidence": 0.0,
     "suggested_action": null
   }
   :::
3. Field rules:
   - alert_type: one of "competitor_activity" | "ip_filing" | "trend_signal" | "partnership_opportunity" | "regulatory_change" | "funding_event" | "hiring_signal" | "customer_sentiment" | "social_signal" | "ad_activity" | "pricing_change" | "product_launch" | "supplier_move" | "gtm_signal"
     ("supplier_move" = a supplier/vendor in the founder's chain changes terms, capacity, pricing or ownership; "gtm_signal" = a go-to-market motion — channel launch, distribution deal, campaign or positioning shift)
   - entity: the single company/product name the alert is about (1-4 words, e.g. "HelloFresh") — the NAME only, never the event sentence
   - headline: 1 line, <=120 chars
   - body: 2-4 sentences, factual
   - source_url: direct URL (not a search page)
   - relevance_score: float 0.0-1.0 — how relevant to THIS founder's problem/solution/ICP
   - confidence: float 0.0-1.0 — how confident you are in the finding
   - suggested_action: one of "draft_email" | "draft_linkedin_post" | "proposed_hypothesis" | "proposed_graph_update" or null
4. Both header {"type":"ecosystem_alert"} and body must be VALID JSON — double quotes, no trailing commas.
5. If nothing materially moved, say so explicitly and emit zero artifacts. Do not pad.
6. Never fabricate URLs. If you cannot verify, omit the finding.
${a}
`.trim(),l=`
CONTRATTO DI OUTPUT — non deviare:
1. Inizia con un riassunto narrativo di 2-3 frasi su cosa si \xe8 mosso questa settimana.
2. Poi emetti un blocco artifact per ogni finding distinto, ESATTAMENTE in questo formato:
   :::artifact{"type":"ecosystem_alert"}
   {
     "alert_type": "...",
     "entity": "...",
     "headline": "...",
     "body": "...",
     "source_url": "...",
     "relevance_score": 0.0,
     "confidence": 0.0,
     "suggested_action": null
   }
   :::
3. Regole dei campi:
   - alert_type: uno tra "competitor_activity" | "ip_filing" | "trend_signal" | "partnership_opportunity" | "regulatory_change" | "funding_event" | "hiring_signal" | "customer_sentiment" | "social_signal" | "ad_activity" | "pricing_change" | "product_launch" | "supplier_move" | "gtm_signal"
     ("supplier_move" = un fornitore/vendor nella filiera del founder cambia condizioni, capacit\xe0, prezzi o propriet\xe0; "gtm_signal" = una mossa go-to-market — lancio di canale, accordo di distribuzione, cambio di campagna o posizionamento)
   - entity: il nome della singola azienda/prodotto a cui si riferisce l'alert (1-4 parole, es. "HelloFresh") — SOLO il nome, mai la frase dell'evento
   - headline: 1 riga, <=120 caratteri
   - body: 2-4 frasi, fattuale
   - source_url: URL diretto (non una pagina di ricerca)
   - relevance_score: float 0.0-1.0 — quanto rilevante per problema/soluzione/ICP di QUESTO founder
   - confidence: float 0.0-1.0 — quanto sei confidente nel finding
   - suggested_action: uno tra "draft_email" | "draft_linkedin_post" | "proposed_hypothesis" | "proposed_graph_update" o null
4. Sia l'header {"type":"ecosystem_alert"} sia il body devono essere JSON VALIDO — virgolette doppie, niente virgole finali.
5. Se nulla si \xe8 mosso in modo rilevante, dillo esplicitamente ed emetti zero artifact. Non riempire.
6. Non inventare mai URL. Se non puoi verificare, ometti il finding.
${r}
`.trim();async function c(e){let i=(await (0,t.query)("SELECT id, name, description, locale FROM projects WHERE id = ?",e))[0];if(!i)throw Error(`Project not found: ${e}`);let a=(await (0,t.query)("SELECT problem, solution, target_market, value_proposition, channels FROM idea_canvas WHERE project_id = ?",e))[0]||null,r=(await (0,t.query)("SELECT competitors, trends FROM research WHERE project_id = ?",e))[0],s=null,l=await (0,o.getCompetitorNames)(e);if(r){if(s={},r.competitors)try{let e=(0,n.coerceJson)(r.competitors)??[];s.competitors=e}catch{}if(r.trends)try{s.trends=(0,n.coerceJson)(r.trends)??[]}catch{}}let c=(await (0,t.query)(`SELECT name FROM graph_nodes WHERE project_id = ?
     AND node_type IN ('market_segment', 'technology', 'trend') LIMIT 10`,e)).map(e=>e.name),d="it"===i.locale?"it":"en";return{projectId:e,projectName:i.name,projectDescription:i.description,locale:d,idea:a,research:s,knownCompetitors:l,keywords:c}}e.s(["computeDedupeHash",0,function(e,t,n){let o=[e.toLowerCase().trim(),(t||"").toLowerCase().trim().replace(/[?#].*$/,""),n.toLowerCase().trim().replace(/\s+/g," ").slice(0,200)].join("|");return(0,i.createHash)("sha256").update(o).digest("hex").slice(0,32)},"loadMonitorContext",0,c,"outputInstructions",0,function(e){return"it"===e?l:s},"projectContext",0,function(e){let i=[];return i.push(`Project: ${e.projectName}`),e.projectDescription&&i.push(`Description: ${e.projectDescription}`),e.idea?.problem&&i.push(`Problem: ${e.idea.problem}`),e.idea?.solution&&i.push(`Solution: ${e.idea.solution}`),e.idea?.target_market&&i.push(`Target market: ${e.idea.target_market}`),e.idea?.value_proposition&&i.push(`Value proposition: ${e.idea.value_proposition}`),e.idea?.channels&&i.push(`Acquisition channels: ${e.idea.channels}`),i.join("\n")},"withBriefLanguage",0,function(e,i){return"it"!==i?e:`${e}

[LINGUA] Scrivi ogni campo destinato al founder — title, narrative, recommended actions/azioni — in ITALIANO. Mantieni in inglese solo gli identificatori tecnici (signal_ids, nomi di entit\xe0/competitor). Non rispondere in inglese.`},"withEmissionDiscipline",0,function(e,i){return e.includes("EMIT AS YOU GO")||e.includes("EMETTI SUBITO")?e:`${e}

${"it"===i?r:a}`}])}];

//# sourceMappingURL=tech-bricks_LaunchPad-v2_src_lib_ecosystem-monitors_ts_02683or._.js.map