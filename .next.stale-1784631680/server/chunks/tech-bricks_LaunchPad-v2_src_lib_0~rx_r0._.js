module.exports=[302541,e=>{"use strict";e.s(["MODEL_CONFIG",0,{"claude-haiku-4-5":{id:"claude-haiku-4-5-20251001",openrouterId:"anthropic/claude-haiku-4.5",tier:"cheap",contextWindow:2e5,maxOutputTokens:64e3,pricing:{input:1,output:5,cacheWrite:1.25,cacheRead:.1}},"claude-sonnet-4-6":{id:"claude-sonnet-4-6",openrouterId:"anthropic/claude-sonnet-4.6",tier:"balanced",contextWindow:1e6,maxOutputTokens:64e3,pricing:{input:3,output:15,cacheWrite:3.75,cacheRead:.3}},"claude-opus-4-7":{id:"claude-opus-4-7",openrouterId:"anthropic/claude-opus-4.7",tier:"premium",contextWindow:1e6,maxOutputTokens:128e3,pricing:{input:5,output:25,cacheWrite:6.25,cacheRead:.5}}},"TIER_DEFAULTS",0,{cheap:{maxTokens:4096,temperature:.7},balanced:{maxTokens:8192,temperature:.7},premium:{maxTokens:16384,temperature:.7}}])},941171,e=>{"use strict";e.s(["coerceJson",0,function(e){if(null==e)return null;if("string"==typeof e)try{return JSON.parse(e)}catch{return null}return e}])},581507,e=>{"use strict";let t=["en","it"];function i(e){return"string"==typeof e&&t.includes(e)}e.s(["DEFAULT_LOCALE",0,"en","LOCALE_COOKIE",0,"lp_locale","LOCALE_ENGLISH_NAME",0,{en:"English",it:"Italian"},"SUPPORTED_LOCALES",0,t,"asLocale",0,function(e){return i(e)?e:"en"},"isLocale",0,i])},123834,e=>{"use strict";var t=e.i(921284),i=e.i(581507);async function a(e,a){let s={user:null,project:null};if(e){let i=await (0,t.query)("SELECT locale FROM users WHERE id = ?",e);s.user=i[0]?.locale??null}if(a){let e=await (0,t.query)("SELECT locale FROM projects WHERE id = ?",a);s.project=e[0]?.locale??null}return(0,i.isLocale)(s.project)?s.project:(0,i.isLocale)(s.user)?s.user:i.DEFAULT_LOCALE}e.s(["resolveLocale",0,a])},764527,e=>e.a(async(t,i)=>{try{var a=e.i(921284),s=e.i(520378),r=e.i(328273),n=e.i(516523),o=e.i(123834),u=t([r]);[r]=u.then?(await u)():u;let g=new Set(["market","user_behavior","execution","financial","competitive","org","external"]),_=new Set(["high","medium","low"]),f=`You are an applied epistemologist for early-stage startups.

Your job: read a project context and surface every assumption the project rests on. The most dangerous assumptions are the ones nobody noticed as assumptions — find those.

For each statement, ask "what must be true for this to hold?" — that answer is an assumption.

Categories (use exactly these slugs):
- market — beliefs about market size, demand, willingness to pay, timing
- user_behavior — how the target user thinks, decides, acts
- execution — team's ability to ship in time with available resources
- financial — CAC, LTV, margins, burn assumptions
- competitive — competitor behavior, defensibility, moat
- org — internal alignment, key-person risk, decision velocity
- external — regulation, macro, tech infrastructure

Criticality:
- high — if false, the project collapses
- medium — if false, the project suffers but survives
- low — if false, needs minor adjustment

Return STRICT JSON only — no prose, no markdown fences. Schema:
{
  "assumptions": [
    {
      "text": "string — clear, specific, falsifiable statement",
      "category": "market | user_behavior | execution | financial | competitive | org | external",
      "criticality": "high | medium | low",
      "explicit": false,
      "source": "string — which part of the brief this came from"
    }
  ]
}

Aim for 12-25 assumptions for a typical project. Skip restating the project verbatim — surface the implicit beliefs underneath.`;async function l(e,t){let i={inserted:0,skipped:0,errors:[]},u=await (0,o.resolveLocale)("",e),l=`Project context:

${t}

Extract assumptions. Return JSON only.${"it"===u?'\n\nWrite each assumption\'s "text" value in Italian. Keep the JSON keys and the category/criticality enum values in English.':""}`,c=Date.now(),d=await (0,r.runAgent)(l,{systemPrompt:f,task:"assumption-extract",tools:!1,timeout:6e4,maxToolCalls:0});await (0,n.recordAgentUsage)({project_id:e,step:"assumption-extract",task:"assumption-extract",usage:d.usage,latency_ms:Date.now()-c});let p=function(e){let t=e.replace(/```json\s*/gi,"").replace(/```\s*$/g,"").trim(),i=t.indexOf("{"),a=t.lastIndexOf("}");if(-1===i||-1===a||a<=i)return null;let s=t.slice(i,a+1);try{let e=JSON.parse(s);if(!e||!Array.isArray(e.assumptions))return null;return e.assumptions.filter(e=>"object"==typeof e&&null!==e&&"string"==typeof e.text&&"string"==typeof e.category&&"string"==typeof e.criticality)}catch{return null}}(d.text);if(!p)return i.errors.push("Extractor returned non-JSON output"),i;let m=await (0,a.get)("SELECT MAX(number) AS max FROM assumptions WHERE project_id = ?",e),h=(m?.max??0)+1;for(let t of p){if(!g.has(t.category)||!_.has(t.criticality)||await (0,a.get)("SELECT id FROM assumptions WHERE project_id = ? AND LOWER(text) = LOWER(?) LIMIT 1",e,t.text)){i.skipped++;continue}try{await (0,a.run)(`INSERT INTO assumptions
          (id, project_id, number, category, text, source, explicit, criticality, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
         ON CONFLICT (project_id, number) DO NOTHING`,(0,s.generateId)("asm"),e,h,t.category,t.text,t.source??null,!0===t.explicit,t.criticality),i.inserted++,h++}catch(e){i.errors.push(e.message)}}return i}async function c(e,t){try{if(t.trim().length<40||await (0,a.get)("SELECT 1 AS one FROM assumptions WHERE project_id = ? LIMIT 1",e))return;l(e,t).catch(t=>{console.warn(`[assumptions] background seed failed for ${e}:`,t.message)})}catch(e){console.warn("[assumptions] seed guard failed (non-fatal):",e.message)}}async function d(e,t={}){let i=["project_id = ?"],s=[e];return t.status&&(Array.isArray(t.status)?(i.push(`status IN (${t.status.map(()=>"?").join(",")})`),s.push(...t.status)):(i.push("status = ?"),s.push(t.status))),t.criticality&&(i.push("criticality = ?"),s.push(t.criticality)),t.category&&(i.push("category = ?"),s.push(t.category)),(0,a.query)(`SELECT * FROM assumptions WHERE ${i.join(" AND ")} ORDER BY number ASC`,...s)}async function p(e){return(0,a.get)("SELECT * FROM assumptions WHERE id = ?",e)}async function m(e){let t=await (0,a.get)(`SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'open' AND criticality = 'high') AS open_high,
       COUNT(*) FILTER (WHERE status = 'open') AS open_total,
       COUNT(*) FILTER (WHERE status = 'validated') AS validated,
       COUNT(*) FILTER (WHERE status = 'invalidated') AS invalidated
     FROM assumptions WHERE project_id = ?`,e);return t?{total:Number(t.total)||0,open_high:Number(t.open_high)||0,open_total:Number(t.open_total)||0,validated:Number(t.validated)||0,invalidated:Number(t.invalidated)||0}:{total:0,open_high:0,open_total:0,validated:0,invalidated:0}}async function h(e,t,i){await (0,a.run)(`UPDATE assumptions
     SET status = 'validated',
         validated_by_skill_completion_id = ?,
         validated_at = CURRENT_TIMESTAMP,
         validation_evidence = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,t,i,e)}async function E(e,t){await (0,a.run)(`UPDATE assumptions
     SET status = 'invalidated',
         invalidated_at = CURRENT_TIMESTAMP,
         invalidated_reason = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,t,e)}let v=`You judge whether a skill output validates, invalidates, or is irrelevant to a specific assumption.

Return STRICT JSON only:
{ "verdict": "validates" | "invalidates" | "irrelevant", "evidence": "string — one sentence quoting or paraphrasing the relevant part of the output. Empty string if irrelevant." }

Rules:
- "validates" only when the output provides concrete evidence the assumption holds. Weak or implicit support is "irrelevant".
- "invalidates" only when the output provides concrete evidence the assumption is false.
- Default to "irrelevant" when in doubt. False positives are worse than false negatives — a wrong validation hides risk.`;async function y(e,t,i,a){let s={checked:0,validated:0,invalidated:0};if(!a||a.trim().length<20)return s;let o=await d(e,{status:"open"});if(0===o.length)return s;for(let u of[...o].sort((e,t)=>{let i=e=>"high"===e?0:"medium"===e?1:2;return i(e.criticality)-i(t.criticality)}).slice(0,8)){let o=`Assumption #${u.number} [${u.category}, ${u.criticality}]:
"${u.text}"

Skill output (skill_id=${i}):
${a.slice(0,4e3)}

Verdict?`,l=null;try{let t=Date.now(),a=await (0,r.runAgent)(o,{systemPrompt:v,task:"classify",tools:!1,timeout:3e4,maxToolCalls:0});await (0,n.recordAgentUsage)({project_id:e,skill_id:i,step:"assumption-linker",task:"classify",usage:a.usage,latency_ms:Date.now()-t}),l=function(e){let t=e.replace(/```json\s*/gi,"").replace(/```\s*$/g,"").trim(),i=t.indexOf("{"),a=t.lastIndexOf("}");if(-1===i||-1===a)return null;try{let e=JSON.parse(t.slice(i,a+1));if(!e||"string"!=typeof e.verdict||"validates"!==e.verdict&&"invalidates"!==e.verdict&&"irrelevant"!==e.verdict)return null;return{verdict:e.verdict,evidence:"string"==typeof e.evidence?e.evidence:""}}catch{return null}}(a.text)}catch(e){console.warn(`[assumptions] linker LLM failed for #${u.number}:`,e.message);continue}s.checked++,l&&"irrelevant"!==l.verdict&&("validates"===l.verdict?(await h(u.id,t,l.evidence),s.validated++):(await E(u.id,l.evidence),s.invalidated++))}return s}e.s(["countAssumptions",0,m,"extractAssumptions",0,l,"getAssumption",0,p,"linkSkillCompletionToAssumptions",0,y,"listAssumptions",0,d,"markInvalidated",0,E,"markValidated",0,h,"seedAssumptionsIfEmpty",0,c]),i()}catch(e){i(e)}},!1),837239,e=>{"use strict";var t=e.i(921284),i=e.i(520378);async function a(e){try{let a=await (0,t.get)("SELECT id FROM graph_nodes WHERE project_id = ? AND node_type = 'your_startup' LIMIT 1",e);if(a?.id)return a.id;let s=await (0,t.get)("SELECT name, description FROM projects WHERE id = ? LIMIT 1",e),r=await (0,t.get)("SELECT value_proposition, problem FROM idea_canvas WHERE project_id = ? LIMIT 1",e),n=s?.name&&s.name.trim()||"Your Startup",o=r?.value_proposition&&r.value_proposition.trim()||r?.problem&&r.problem.trim()||s?.description&&s.description.trim()||"",u=(0,i.generateId)("gnode");return await (0,t.run)(`INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
       VALUES (?, ?, ?, 'your_startup', ?, ?, ?, 'applied')`,u,e,n,o,{root:!0},null),u}catch(t){return console.warn(`[ensureStartupRootNode] failed for project ${e}:`,t),""}}e.s(["ensureStartupRootNode",0,a])},714968,e=>{"use strict";var t=e.i(921284),i=e.i(520378),a=e.i(837239);let s=[{column:"business_model",name:"Business model",node_type:"business_essential",relation:"requires"},{column:"revenue_streams",name:"Revenue streams",node_type:"business_essential",relation:"requires"},{column:"cost_structure",name:"Cost structure",node_type:"business_essential",relation:"requires"},{column:"key_metrics",name:"Key metrics",node_type:"business_essential",relation:"requires"},{column:"channels",name:"Channels",node_type:"gtm_strategy",relation:"executes"}],r=new Set(["business_model","channels"]),n=e=>Array.isArray(e)?e.filter(e=>"string"==typeof e&&e.trim().length>0).map(e=>e.trim()).join("; "):"";async function o(e){try{let o=await (0,t.get)("SELECT business_model, revenue_streams, cost_structure, key_metrics, channels FROM idea_canvas WHERE project_id = ?",e);if(!o)return;let u=[];for(let e of s){let t=o[e.column],i=r.has(e.column)?"string"==typeof t?t.trim():"":n(t);i&&u.push({column:e.column,name:e.name,summary:i.slice(0,600),node_type:e.node_type,relation:e.relation})}if(0===u.length)return;let l=await (0,a.ensureStartupRootNode)(e);for(let a of u){let s=await (0,t.run)(`INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'applied')
         ON CONFLICT (project_id, LOWER(name)) DO UPDATE SET
           summary = EXCLUDED.summary,
           node_type = EXCLUDED.node_type,
           attributes = EXCLUDED.attributes,
           reviewed_state = 'applied'
         WHERE graph_nodes.attributes->>'origin' = 'idea_canvas'
         RETURNING id`,(0,i.generateId)("gnode"),e,a.name,a.node_type,a.summary,{origin:"idea_canvas",canvas_field:a.column},[{type:"user",title:`From your Idea Canvas — ${a.name}`,quote:a.summary.slice(0,280)}]),r=s[0]?.id;l&&r&&(await (0,t.get)(`SELECT id FROM graph_edges
          WHERE project_id = ? AND source_node_id = ? AND target_node_id = ? AND relation = ?
          LIMIT 1`,e,l,r,a.relation)||await (0,t.run)(`INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation, sources)
           VALUES (?, ?, ?, ?, ?, ?)`,(0,i.generateId)("edge"),e,l,r,a.relation,null))}}catch(t){console.warn(`[business-essentials-sync] failed for project ${e}:`,t.message)}}e.s(["syncBusinessEssentialNodes",0,o])}];

//# sourceMappingURL=tech-bricks_LaunchPad-v2_src_lib_0~rx_r0._.js.map