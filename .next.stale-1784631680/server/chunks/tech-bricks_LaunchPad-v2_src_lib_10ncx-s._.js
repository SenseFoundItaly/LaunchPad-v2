module.exports=[956863,e=>e.a(async(t,r)=>{try{var i=e.i(328273),o=e.i(530178),a=e.i(516523),n=e.i(390472),s=t([i]);[i]=s.then?(await s)():s;let l=["competitors","ip","trends","partnerships","hiring","sentiment","funding","regulatory","pricing","custom"],d=["scan","diff","hybrid"],h=["pulse","deep"],u=["daily","weekly","monthly"],m=`
RULES — follow strictly, no exceptions:

VETO (the single hard rule — proposals violating this are silently dropped):
- Every proposal MUST include at least one named URL in inputs.urls.
- Keyword-only scans without a URL are forbidden, even if the keyword is highly
  specific. The reason: keyword-scan noise is the #1 thing founders triage and
  abandon. A URL anchors the watcher to something a human can verify and click.
- 'kind' MUST be 'diff' or 'hybrid'. Pure 'scan' (URL-less keyword search) is
  rejected by the validator — do not propose it.

SPECIFICITY (the bar that disqualifies generics):
- Each URL must point at a specific page that holds the answer:
  ✓ https://stripe.com/pricing  (pricing page diff)
  ✓ https://stripe.com/jobs/search?team=engineering  (eng hiring diff)
  ✓ https://patents.google.com/?q=("differential+privacy"+"telemetry")  (IP search)
  ✗ https://stripe.com  (homepage = no specific signal)
  ✗ https://news.ycombinator.com  (generic feed = not tied to this project)
- The URL must derive from THIS project's context block (a known competitor,
  the target market, a stated value-prop term). Generic feeds get rejected.

DEPTH SELECTION (deep is expensive, pulse is free):
- depth = 'pulse' (cheap URL hash diff) is the DEFAULT for any single-page watcher.
- depth = 'deep' (LLM synthesis with cited sources) ONLY when the URL is a
  search/aggregator page (USPTO query, news search, Google results) where the
  diff alone is uninformative without LLM interpretation.
- When in doubt, choose 'pulse'. The cost asymmetry is ~50\xd7.

CADENCE (match the topic's natural rhythm):
- daily   — pricing, sentiment, ads, breaking competitive moves.
- weekly  — competitors, hiring, partnerships, trends, custom (default).
- monthly — ip, regulatory, funding (low base-rate events).
- Never propose hourly. Never propose 'manual' (defeats the point of a watcher).

KIND CONSISTENCY:
- kind = 'diff'   → inputs.urls only (1-3 URLs). No LLM call per run.
- kind = 'hybrid' → inputs.urls REQUIRED + keywords/competitors as filtering hints.
- kind = 'scan'   → FORBIDDEN per the VETO above.

DEDUPE (avoid near-duplicates of existing watchers):
- "Existing watchers" lists what's already running. Skip any topic the founder
  already covers — one watcher per topic per entity, not two with overlapping angles.
- If a competitor is in 'Known competitors', do not propose a generic watcher for
  them — propose a SPECIFIC page (their pricing, their careers, their changelog).

OUTPUT DISCIPLINE:
- 3-5 proposals total. Quality > quantity. Returning 3 sharp watchers beats 5 mediocre.
- Empty array [] is the right answer when context is too thin or every angle is covered.
- Rationale field MUST cite a specific context field (e.g. "covers value prop X"
  or "tracks competitor Y's pricing for ICP fit").
- No emojis, no markdown, no prose outside the JSON array.
`.trim(),g=`
OUTPUT CONTRACT — JSON only, no prose, no markdown fence:
[
  {
    "name": "string — founder-facing label, <60 chars, no emojis",
    "topic": "competitors|ip|trends|partnerships|hiring|sentiment|funding|regulatory|pricing|custom",
    "kind": "scan|diff|hybrid",
    "depth": "pulse|deep",
    "cadence": "daily|weekly|monthly",
    "rationale": "string — <140 chars — WHY this watcher for THIS project, cite the context field",
    "inputs": {
      "urls": ["https://..."],            // required if kind=diff or hybrid
      "keywords": ["string"],             // required if kind=scan
      "competitor_names": ["string"]      // optional
    }
  }
]
Return 3-5 items. Empty array [] is allowed if the context is too thin.
`.trim();async function c(e){let t;if(!(e.idea?.problem||e.idea?.solution||e.knownCompetitors.length>0||e.keywords.length>0))return{proposed:[],raw:"",skipped_reason:"insufficient_context"};let r=[`## Project: ${e.projectName}`,e.idea?.problem&&`Problem: ${e.idea.problem}`,e.idea?.solution&&`Solution: ${e.idea.solution}`,e.idea?.target_market&&`Target market: ${e.idea.target_market}`,e.idea?.value_proposition&&`Value prop: ${e.idea.value_proposition}`,e.knownCompetitors.length>0&&`Known competitors: ${e.knownCompetitors.join(", ")}`,e.keywords.length>0&&`Keywords: ${e.keywords.join(", ")}`,`Existing watchers (do not duplicate): ${e.existingWatcherNames.join(", ")||"(none)"}`].filter(Boolean).join("\n"),s=(0,n.buildSystemPromptString)({locale:e.locale,context:"cron",tail:`You propose recurring watchers for a startup. ${m}

${g}`,projectContext:r}),c=Date.now(),f="";try{let r=await (0,i.runAgent)("Propose watchers for this project now.",{systemPrompt:s,timeout:6e4,task:"monitor-agent",projectId:e.projectId});f=r.text,t=r.usage}catch(e){return console.warn("[watcher-proposer] LLM call failed:",e.message),{proposed:[],raw:"",skipped_reason:"llm_failure"}}let y=Date.now()-c,{provider:w,model:_}=(0,o.pickModel)("monitor-agent");return await (0,a.recordUsage)({project_id:e.projectId,step:"watcher_proposer",provider:w,model:_,usage:t,latency_ms:y}).catch(e=>console.warn("[watcher-proposer] recordUsage failed:",e.message)),{proposed:function(e,t){let r,i=e.indexOf("["),o=e.lastIndexOf("]");if(-1===i||-1===o||o<i)return[];try{r=JSON.parse(e.slice(i,o+1))}catch{return[]}if(!Array.isArray(r))return[];let a=e=>e.toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\b(the|a|an|for|on|of|watcher|track|monitor)\b/g," ").replace(/\s+/g," ").trim(),n=new Set(t.existingWatcherNames.map(a)),s=[];for(let e of r){if(!e||"object"!=typeof e)continue;let t="string"==typeof e.name?e.name.trim().slice(0,80):"";if(!t)continue;let r=a(t);if(!r||n.has(r))continue;let i=p(e.topic,l)?e.topic:"custom",o=p(e.kind,d)?e.kind:"scan",c=p(e.depth,h)?e.depth:"pulse",m=p(e.cadence,u)?e.cadence:"weekly",g="string"==typeof e.rationale?e.rationale.slice(0,240):"",f=e.inputs||{},y={};if(Array.isArray(f.urls)&&(y.urls=f.urls.filter(e=>"string"==typeof e&&/^https?:\/\//.test(e)).slice(0,10)),Array.isArray(f.keywords)&&(y.keywords=f.keywords.filter(e=>"string"==typeof e).slice(0,15)),Array.isArray(f.competitor_names)&&(y.competitor_names=f.competitor_names.filter(e=>"string"==typeof e).slice(0,10)),!y.urls||0===y.urls.length||"scan"===o)continue;let w=function(e,t){if(t.urls?.[0])try{let r=new URL(t.urls[0]).hostname.replace(/^www\./,"");return`${e}@${r}`}catch{}return t.competitor_names?.[0]?`${e}@${t.competitor_names[0].toLowerCase().trim()}`:t.keywords?.[0]?`${e}@${t.keywords[0].toLowerCase().trim()}`:null}(i,y);if(!(w&&n.has(w))&&(s.push({name:t,topic:i,kind:o,depth:c,cadence:m,rationale:g,inputs:y}),n.add(r),w&&n.add(w),s.length>=5))break}return s}(f,e),raw:f}}function p(e,t){return"string"==typeof e&&t.includes(e)}e.s(["proposeWatchers",0,c]),r()}catch(e){r(e)}},!1),48698,e=>e.a(async(t,r)=>{try{var i=e.i(921284),o=e.i(55376),a=e.i(448782),n=e.i(956863),s=e.i(703072),c=e.i(824675),p=e.i(123834),l=t([n]);[n]=l.then?(await l)():l;let u="phase1_auto",m={competitors:"competitor",ip:"technology",trends:"market",partnerships:"partner",hiring:"custom",sentiment:"custom",funding:"funding",regulatory:"regulation",pricing:"competitor",risk:"black_swan",custom:"custom"},g={competitors:"competitor_product",ip:"patent_database",trends:"news",partnerships:"news",hiring:"careers_page",sentiment:"review_site",funding:"news",regulatory:"regulatory",pricing:"competitor_pricing",risk:"news",custom:"custom"};async function d(e,t){try{let r,s,l,d=t??await (0,a.buildProjectSnapshot)(e);if(r=(0,o.evaluateAllStages)(d),s=r.find(e=>"market_validation"===e.stage.id)?.status==="done",l=d.monitors.filter(e=>"active"===e.status).length+d.watch_sources.filter(e=>"active"===e.status).length,!s||0!==l)return;let m=(await (0,i.query)("SELECT name, owner_user_id FROM projects WHERE id = ?",e))[0],g=m?.owner_user_id||"";if(!g||await (0,c.lastEventOfType)(g,e,"phase1_watchers_proposed")||(await (0,i.query)("SELECT id FROM pending_actions WHERE project_id = ? AND payload->>'origin' = ? LIMIT 1",e,u)).length>0)return;let f=await (0,i.query)(`SELECT name FROM monitors WHERE project_id = ?
       UNION ALL
       SELECT label AS name FROM watch_sources WHERE project_id = ?`,e,e).catch(()=>[]),y=await (0,p.resolveLocale)(g,e),w=await (0,n.proposeWatchers)({projectId:e,projectName:m?.name??"this project",idea:d.idea_canvas?{problem:d.idea_canvas.problem??void 0,solution:d.idea_canvas.solution??void 0,target_market:d.idea_canvas.target_market??void 0,value_proposition:d.idea_canvas.value_proposition??void 0}:null,knownCompetitors:d.competitors.map(e=>e.name).filter(Boolean).slice(0,10),keywords:[],existingWatcherNames:f.map(e=>e.name).filter(Boolean),locale:y});if((await (0,i.query)("SELECT id FROM pending_actions WHERE project_id = ? AND payload->>'origin' = ? LIMIT 1",e,u)).length>0)return;let _=[];for(let t of w.proposed){let r=await h(e,t,y);r&&_.push(r)}_.length>0&&(await (0,c.recordEvent)({userId:g,projectId:e,eventType:"phase1_watchers_proposed",payload:{origin:u,pending_action_ids:_,count:_.length}}),console.info(`[phase1-watchers] proposed ${_.length} watcher(s) for ${e}`))}catch(e){console.warn("[phase1-watchers] maybeProposePhase1Watchers failed (non-fatal):",e.message)}}async function h(e,t,r){try{if("diff"===t.kind){let i=t.inputs.urls?.[0];if(!i)return null;return(await (0,s.createPendingAction)({project_id:e,action_type:"configure_watch_source",title:"it"===r?`Traccia URL: ${t.name}`:`Track URL: ${t.name}`,rationale:t.rationale||void 0,payload:{url:i,label:t.name,category:g[t.topic]??"custom",schedule:"daily"===t.cadence?"daily":"weekly",rationale:t.rationale,origin:u},estimated_impact:"medium"})).id}return(await (0,s.createPendingAction)({project_id:e,action_type:"configure_monitor",title:"it"===r?`Configura monitor: ${t.name}`:`Configure monitor: ${t.name}`,rationale:t.rationale||void 0,payload:{name:t.name,objective:t.rationale,kind:m[t.topic]??"custom",schedule:"daily"===t.cadence?"daily":"weekly",query:t.inputs.keywords?.length?t.inputs.keywords.join(" "):void 0,urls_to_track:t.inputs.urls??[],alert_threshold:t.rationale||`Material change relevant to ${t.name}`,linked_risk_id:"ad_hoc",topic:t.topic,origin:u},estimated_impact:"medium"})).id}catch(e){return console.warn("[phase1-watchers] proposal persist failed (non-fatal):",e.message),null}}e.s(["maybeProposePhase1Watchers",0,d]),r()}catch(e){r(e)}},!1)];

//# sourceMappingURL=tech-bricks_LaunchPad-v2_src_lib_10ncx-s._.js.map