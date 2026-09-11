module.exports=[302541,e=>{"use strict";e.s(["MODEL_CONFIG",0,{"claude-haiku-4-5":{id:"claude-haiku-4-5-20251001",openrouterId:"anthropic/claude-haiku-4.5",tier:"cheap",contextWindow:2e5,maxOutputTokens:64e3,pricing:{input:1,output:5,cacheWrite:1.25,cacheRead:.1}},"claude-sonnet-4-6":{id:"claude-sonnet-4-6",openrouterId:"anthropic/claude-sonnet-4.6",tier:"balanced",contextWindow:1e6,maxOutputTokens:64e3,pricing:{input:3,output:15,cacheWrite:3.75,cacheRead:.3}},"claude-opus-4-7":{id:"claude-opus-4-7",openrouterId:"anthropic/claude-opus-4.7",tier:"premium",contextWindow:1e6,maxOutputTokens:128e3,pricing:{input:5,output:25,cacheWrite:6.25,cacheRead:.5}}},"TIER_DEFAULTS",0,{cheap:{maxTokens:4096,temperature:.7},balanced:{maxTokens:8192,temperature:.7},premium:{maxTokens:16384,temperature:.7}}])},941171,e=>{"use strict";e.s(["coerceJson",0,function(e){if(null==e)return null;if("string"==typeof e)try{return JSON.parse(e)}catch{return null}return e}])},824675,e=>{"use strict";var t=e.i(254799),a=e.i(921284);async function i(e){try{let i=t.default.randomUUID(),r=void 0===e.payload?null:e.payload;return await (0,a.run)(`INSERT INTO memory_events (id, user_id, project_id, event_type, payload)
       VALUES (?, ?, ?, ?, ?)`,i,e.userId,e.projectId,e.eventType,r),i}catch(e){return console.warn("[memory/events] recordEvent failed:",e),""}}async function r(e,t,i={}){let{limit:s=20,since:n,eventTypes:o}=i,l=["user_id = ?","project_id = ?"],c=[e,t];n&&(l.push("created_at >= ?"),c.push(n)),o&&o.length>0&&(l.push(`event_type IN (${o.map(()=>"?").join(",")})`),c.push(...o));let u=`SELECT id, user_id, project_id, event_type, payload, created_at
               FROM memory_events
               WHERE ${l.join(" AND ")}
               ORDER BY created_at DESC
               LIMIT ?`;return c.push(s),(await (0,a.query)(u,...c)).map(e=>({id:e.id,user_id:e.user_id,project_id:e.project_id,event_type:e.event_type,payload:e.payload,created_at:e.created_at}))}async function s(e,t,i={}){let{limit:r=8,lapseAfterTurns:n=2}=i;try{let[i,s]=await Promise.all([(0,a.query)(`SELECT pi.payload->>'skill_id' AS skill_id, pi.created_at
           FROM memory_events pi
          WHERE pi.user_id = ? AND pi.project_id = ?
            AND pi.event_type = 'skill_invoked'
            AND pi.payload->>'invoker' = 'agent'
            AND pi.payload->>'skill_id' IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM memory_events c
               WHERE c.project_id = pi.project_id
                 AND c.event_type = 'skill_completed'
                 AND c.payload->>'skill_id' = pi.payload->>'skill_id'
                 AND c.created_at >= pi.created_at
            )
          ORDER BY pi.created_at DESC`,e,t),(0,a.query)(`SELECT created_at FROM memory_events
          WHERE user_id = ? AND project_id = ? AND event_type = 'chat_turn'
          ORDER BY created_at DESC LIMIT 200`,e,t)]),o=new Map;for(let e of i){if(!e.skill_id)continue;let t=o.get(e.skill_id);t?t.count+=1:o.set(e.skill_id,{proposed_at:e.created_at,count:1})}let l=s.map(e=>e.created_at),c=[];for(let[e,{proposed_at:t,count:a}]of o){let i=l.filter(e=>e>t).length;c.push({skill_id:e,proposed_at:t,turns_since:i,times_proposed:a,lapsed:i>=n})}return c.sort((e,t)=>e.proposed_at<t.proposed_at?1:-1),c.slice(0,r)}catch(e){return console.warn("[memory/events] openProposals failed:",e.message),[]}}async function n(e,t,i={}){let{limit:r=6,lapseAfterTurns:s=2}=i;try{let[i,n]=await Promise.all([(0,a.query)(`SELECT pi.payload->>'fact_hash' AS fact_hash,
                pi.payload->>'preview'   AS fact_preview,
                pi.created_at
           FROM memory_events pi
          WHERE pi.user_id = ? AND pi.project_id = ?
            AND pi.event_type = 'knowledge_proposed'
            AND pi.payload->>'fact_hash' IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM memory_events c
               WHERE c.project_id = pi.project_id
                 AND c.event_type = 'knowledge_applied'
                 AND c.payload->>'fact_hash' = pi.payload->>'fact_hash'
                 AND c.created_at >= pi.created_at
            )
          ORDER BY pi.created_at DESC`,e,t),(0,a.query)(`SELECT created_at FROM memory_events
          WHERE user_id = ? AND project_id = ? AND event_type = 'chat_turn'
          ORDER BY created_at DESC LIMIT 200`,e,t)]),o=new Set,l=n.map(e=>e.created_at),c=[];for(let e of i){if(!e.fact_hash||o.has(e.fact_hash))continue;o.add(e.fact_hash);let t=l.filter(t=>t>e.created_at).length;c.push({fact_hash:e.fact_hash,fact_preview:e.fact_preview||"(fact)",proposed_at:e.created_at,turns_since:t,lapsed:t>=s})}return c.slice(0,r)}catch(e){return console.warn("[memory/events] openKnowledgeProposals failed:",e.message),[]}}async function o(e,t,i){let r=await (0,a.get)(`SELECT id, user_id, project_id, event_type, payload, created_at
     FROM memory_events
     WHERE user_id = ? AND project_id = ? AND event_type = ?
     ORDER BY created_at DESC LIMIT 1`,e,t,i);return r?{id:r.id,user_id:r.user_id,project_id:r.project_id,event_type:r.event_type,payload:r.payload,created_at:r.created_at}:null}e.s(["factHash",0,function(e){let a=String(e||"").toLowerCase().replace(/\s+/g," ").trim().replace(/[.,;:!?]+$/,"");return t.default.createHash("sha1").update(a).digest("hex").slice(0,16)},"lastEventOfType",0,o,"listEvents",0,r,"openKnowledgeProposals",0,n,"openProposals",0,s,"recordEvent",0,i])},903044,e=>{"use strict";let t=[{id:"idea_validation",number:1,label:"Idea Canvas"},{id:"market_validation",number:2,label:"Validation Gate"},{id:"persona",number:3,label:"Persona"},{id:"business_model",number:4,label:"Business Model"},{id:"build_launch",number:5,label:"Build & Launch"},{id:"fundraise",number:6,label:"Fundraise"},{id:"operate",number:7,label:"Operate"}],a=Object.fromEntries(t.map(e=>[e.id,e]));e.s(["CANONICAL_BY_ID",0,a,"canonicalStageId",0,function(e){let a=t.find(t=>t.number===e);if(!a)throw Error(`canonicalStageId: no stage number ${e}`);return a.id},"canonicalStageLabel",0,function(e){let a=t.find(t=>t.number===e);if(!a)throw Error(`canonicalStageLabel: no stage number ${e}`);return a.label}])},581507,e=>{"use strict";let t=["en","it"];function a(e){return"string"==typeof e&&t.includes(e)}e.s(["DEFAULT_LOCALE",0,"en","LOCALE_COOKIE",0,"lp_locale","LOCALE_ENGLISH_NAME",0,{en:"English",it:"Italian"},"SUPPORTED_LOCALES",0,t,"asLocale",0,function(e){return a(e)?e:"en"},"isLocale",0,a])},123834,e=>{"use strict";var t=e.i(921284),a=e.i(581507);async function i(e,i){let r={user:null,project:null};if(e){let a=await (0,t.query)("SELECT locale FROM users WHERE id = ?",e);r.user=a[0]?.locale??null}if(i){let e=await (0,t.query)("SELECT locale FROM projects WHERE id = ?",i);r.project=e[0]?.locale??null}return(0,a.isLocale)(r.project)?r.project:(0,a.isLocale)(r.user)?r.user:a.DEFAULT_LOCALE}e.s(["resolveLocale",0,i])},764527,e=>e.a(async(t,a)=>{try{var i=e.i(921284),r=e.i(520378),s=e.i(328273),n=e.i(516523),o=e.i(123834),l=t([s]);[s]=l.then?(await l)():l;let E=new Set(["market","user_behavior","execution","financial","competitive","org","external"]),f=new Set(["high","medium","low"]),v=`You are an applied epistemologist for early-stage startups.

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

Aim for 12-25 assumptions for a typical project. Skip restating the project verbatim — surface the implicit beliefs underneath.`;async function c(e,t){let a={inserted:0,skipped:0,errors:[]},l=await (0,o.resolveLocale)("",e),c=`Project context:

${t}

Extract assumptions. Return JSON only.${"it"===l?'\n\nWrite each assumption\'s "text" value in Italian. Keep the JSON keys and the category/criticality enum values in English.':""}`,u=Date.now(),d=await (0,s.runAgent)(c,{systemPrompt:v,task:"assumption-extract",tools:!1,timeout:6e4,maxToolCalls:0});await (0,n.recordAgentUsage)({project_id:e,step:"assumption-extract",task:"assumption-extract",usage:d.usage,latency_ms:Date.now()-u});let p=function(e){let t=e.replace(/```json\s*/gi,"").replace(/```\s*$/g,"").trim(),a=t.indexOf("{"),i=t.lastIndexOf("}");if(-1===a||-1===i||i<=a)return null;let r=t.slice(a,i+1);try{let e=JSON.parse(r);if(!e||!Array.isArray(e.assumptions))return null;return e.assumptions.filter(e=>"object"==typeof e&&null!==e&&"string"==typeof e.text&&"string"==typeof e.category&&"string"==typeof e.criticality)}catch{return null}}(d.text);if(!p)return a.errors.push("Extractor returned non-JSON output"),a;let m=await (0,i.get)("SELECT MAX(number) AS max FROM assumptions WHERE project_id = ?",e),_=(m?.max??0)+1;for(let t of p){if(!E.has(t.category)||!f.has(t.criticality)||await (0,i.get)("SELECT id FROM assumptions WHERE project_id = ? AND LOWER(text) = LOWER(?) LIMIT 1",e,t.text)){a.skipped++;continue}try{await (0,i.run)(`INSERT INTO assumptions
          (id, project_id, number, category, text, source, explicit, criticality, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
         ON CONFLICT (project_id, number) DO NOTHING`,(0,r.generateId)("asm"),e,_,t.category,t.text,t.source??null,!0===t.explicit,t.criticality),a.inserted++,_++}catch(e){a.errors.push(e.message)}}return a}async function u(e,t){try{if(t.trim().length<40||await (0,i.get)("SELECT 1 AS one FROM assumptions WHERE project_id = ? LIMIT 1",e))return;c(e,t).catch(t=>{console.warn(`[assumptions] background seed failed for ${e}:`,t.message)})}catch(e){console.warn("[assumptions] seed guard failed (non-fatal):",e.message)}}async function d(e,t={}){let a=["project_id = ?"],r=[e];return t.status&&(Array.isArray(t.status)?(a.push(`status IN (${t.status.map(()=>"?").join(",")})`),r.push(...t.status)):(a.push("status = ?"),r.push(t.status))),t.criticality&&(a.push("criticality = ?"),r.push(t.criticality)),t.category&&(a.push("category = ?"),r.push(t.category)),(0,i.query)(`SELECT * FROM assumptions WHERE ${a.join(" AND ")} ORDER BY number ASC`,...r)}async function p(e){return(0,i.get)("SELECT * FROM assumptions WHERE id = ?",e)}async function m(e){let t=await (0,i.get)(`SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'open' AND criticality = 'high') AS open_high,
       COUNT(*) FILTER (WHERE status = 'open') AS open_total,
       COUNT(*) FILTER (WHERE status = 'validated') AS validated,
       COUNT(*) FILTER (WHERE status = 'invalidated') AS invalidated
     FROM assumptions WHERE project_id = ?`,e);return t?{total:Number(t.total)||0,open_high:Number(t.open_high)||0,open_total:Number(t.open_total)||0,validated:Number(t.validated)||0,invalidated:Number(t.invalidated)||0}:{total:0,open_high:0,open_total:0,validated:0,invalidated:0}}async function _(e,t,a){await (0,i.run)(`UPDATE assumptions
     SET status = 'validated',
         validated_by_skill_completion_id = ?,
         validated_at = CURRENT_TIMESTAMP,
         validation_evidence = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,t,a,e)}async function h(e,t){await (0,i.run)(`UPDATE assumptions
     SET status = 'invalidated',
         invalidated_at = CURRENT_TIMESTAMP,
         invalidated_reason = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,t,e)}let g=`You judge whether a skill output validates, invalidates, or is irrelevant to a specific assumption.

Return STRICT JSON only:
{ "verdict": "validates" | "invalidates" | "irrelevant", "evidence": "string — one sentence quoting or paraphrasing the relevant part of the output. Empty string if irrelevant." }

Rules:
- "validates" only when the output provides concrete evidence the assumption holds. Weak or implicit support is "irrelevant".
- "invalidates" only when the output provides concrete evidence the assumption is false.
- Default to "irrelevant" when in doubt. False positives are worse than false negatives — a wrong validation hides risk.`;async function y(e,t,a,i){let r={checked:0,validated:0,invalidated:0};if(!i||i.trim().length<20)return r;let o=await d(e,{status:"open"});if(0===o.length)return r;for(let l of[...o].sort((e,t)=>{let a=e=>"high"===e?0:"medium"===e?1:2;return a(e.criticality)-a(t.criticality)}).slice(0,8)){let o=`Assumption #${l.number} [${l.category}, ${l.criticality}]:
"${l.text}"

Skill output (skill_id=${a}):
${i.slice(0,4e3)}

Verdict?`,c=null;try{let t=Date.now(),i=await (0,s.runAgent)(o,{systemPrompt:g,task:"classify",tools:!1,timeout:3e4,maxToolCalls:0});await (0,n.recordAgentUsage)({project_id:e,skill_id:a,step:"assumption-linker",task:"classify",usage:i.usage,latency_ms:Date.now()-t}),c=function(e){let t=e.replace(/```json\s*/gi,"").replace(/```\s*$/g,"").trim(),a=t.indexOf("{"),i=t.lastIndexOf("}");if(-1===a||-1===i)return null;try{let e=JSON.parse(t.slice(a,i+1));if(!e||"string"!=typeof e.verdict||"validates"!==e.verdict&&"invalidates"!==e.verdict&&"irrelevant"!==e.verdict)return null;return{verdict:e.verdict,evidence:"string"==typeof e.evidence?e.evidence:""}}catch{return null}}(i.text)}catch(e){console.warn(`[assumptions] linker LLM failed for #${l.number}:`,e.message);continue}r.checked++,c&&"irrelevant"!==c.verdict&&("validates"===c.verdict?(await _(l.id,t,c.evidence),r.validated++):(await h(l.id,c.evidence),r.invalidated++))}return r}e.s(["countAssumptions",0,m,"extractAssumptions",0,c,"getAssumption",0,p,"linkSkillCompletionToAssumptions",0,y,"listAssumptions",0,d,"markInvalidated",0,h,"markValidated",0,_,"seedAssumptionsIfEmpty",0,u]),a()}catch(e){a(e)}},!1)];

//# sourceMappingURL=tech-bricks_LaunchPad-v2_src_lib_04~r269._.js.map