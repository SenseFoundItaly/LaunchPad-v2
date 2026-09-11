module.exports=[814747,(e,t,r)=>{t.exports=e.x("path",()=>require("path"))},269546,e=>{"use strict";e.s(["calculateNextRun",0,function(e,t){if("manual"===e)return null;let r=t||new Date,i={hourly:36e5,daily:864e5,weekly:6048e5,monthly:2592e6}[e];return i?new Date(r.getTime()+i).toISOString():null}])},254799,(e,t,r)=>{t.exports=e.x("crypto",()=>require("crypto"))},688947,(e,t,r)=>{t.exports=e.x("stream",()=>require("stream"))},446786,(e,t,r)=>{t.exports=e.x("os",()=>require("os"))},522734,(e,t,r)=>{t.exports=e.x("fs",()=>require("fs"))},193695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},918622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},556704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},832319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},324725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},270406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},520378,e=>{"use strict";var t=e.i(284204);e.s(["error",0,function(e,r=400){return t.NextResponse.json({success:!1,error:e},{status:r})},"generateId",0,function(e){let t="abcdefghijklmnopqrstuvwxyz0123456789",r=`${e}_`;for(let e=0;e<12;e++)r+=t.charAt(Math.floor(Math.random()*t.length));return r},"json",0,function(e,r=200){return t.NextResponse.json({success:!0,data:e},{status:r})},"mapProject",0,function(e){let{id:t,...r}=e;return{project_id:t,...r}}])},302541,e=>{"use strict";e.s(["MODEL_CONFIG",0,{"claude-haiku-4-5":{id:"claude-haiku-4-5-20251001",openrouterId:"anthropic/claude-haiku-4.5",tier:"cheap",contextWindow:2e5,maxOutputTokens:64e3,pricing:{input:1,output:5,cacheWrite:1.25,cacheRead:.1}},"claude-sonnet-4-6":{id:"claude-sonnet-4-6",openrouterId:"anthropic/claude-sonnet-4.6",tier:"balanced",contextWindow:1e6,maxOutputTokens:64e3,pricing:{input:3,output:15,cacheWrite:3.75,cacheRead:.3}},"claude-opus-4-7":{id:"claude-opus-4-7",openrouterId:"anthropic/claude-opus-4.7",tier:"premium",contextWindow:1e6,maxOutputTokens:128e3,pricing:{input:5,output:25,cacheWrite:6.25,cacheRead:.5}}},"TIER_DEFAULTS",0,{cheap:{maxTokens:4096,temperature:.7},balanced:{maxTokens:8192,temperature:.7},premium:{maxTokens:16384,temperature:.7}}])},824675,e=>{"use strict";var t=e.i(254799),r=e.i(921284);async function i(e){try{let i=t.default.randomUUID(),n=void 0===e.payload?null:e.payload;return await (0,r.run)(`INSERT INTO memory_events (id, user_id, project_id, event_type, payload)
       VALUES (?, ?, ?, ?, ?)`,i,e.userId,e.projectId,e.eventType,n),i}catch(e){return console.warn("[memory/events] recordEvent failed:",e),""}}async function n(e,t,i={}){let{limit:a=20,since:o,eventTypes:s}=i,l=["user_id = ?","project_id = ?"],c=[e,t];o&&(l.push("created_at >= ?"),c.push(o)),s&&s.length>0&&(l.push(`event_type IN (${s.map(()=>"?").join(",")})`),c.push(...s));let d=`SELECT id, user_id, project_id, event_type, payload, created_at
               FROM memory_events
               WHERE ${l.join(" AND ")}
               ORDER BY created_at DESC
               LIMIT ?`;return c.push(a),(await (0,r.query)(d,...c)).map(e=>({id:e.id,user_id:e.user_id,project_id:e.project_id,event_type:e.event_type,payload:e.payload,created_at:e.created_at}))}async function a(e,t,i={}){let{limit:n=8,lapseAfterTurns:o=2}=i;try{let[i,a]=await Promise.all([(0,r.query)(`SELECT pi.payload->>'skill_id' AS skill_id, pi.created_at
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
          ORDER BY pi.created_at DESC`,e,t),(0,r.query)(`SELECT created_at FROM memory_events
          WHERE user_id = ? AND project_id = ? AND event_type = 'chat_turn'
          ORDER BY created_at DESC LIMIT 200`,e,t)]),s=new Map;for(let e of i){if(!e.skill_id)continue;let t=s.get(e.skill_id);t?t.count+=1:s.set(e.skill_id,{proposed_at:e.created_at,count:1})}let l=a.map(e=>e.created_at),c=[];for(let[e,{proposed_at:t,count:r}]of s){let i=l.filter(e=>e>t).length;c.push({skill_id:e,proposed_at:t,turns_since:i,times_proposed:r,lapsed:i>=o})}return c.sort((e,t)=>e.proposed_at<t.proposed_at?1:-1),c.slice(0,n)}catch(e){return console.warn("[memory/events] openProposals failed:",e.message),[]}}async function o(e,t,i={}){let{limit:n=6,lapseAfterTurns:a=2}=i;try{let[i,o]=await Promise.all([(0,r.query)(`SELECT pi.payload->>'fact_hash' AS fact_hash,
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
          ORDER BY pi.created_at DESC`,e,t),(0,r.query)(`SELECT created_at FROM memory_events
          WHERE user_id = ? AND project_id = ? AND event_type = 'chat_turn'
          ORDER BY created_at DESC LIMIT 200`,e,t)]),s=new Set,l=o.map(e=>e.created_at),c=[];for(let e of i){if(!e.fact_hash||s.has(e.fact_hash))continue;s.add(e.fact_hash);let t=l.filter(t=>t>e.created_at).length;c.push({fact_hash:e.fact_hash,fact_preview:e.fact_preview||"(fact)",proposed_at:e.created_at,turns_since:t,lapsed:t>=a})}return c.slice(0,n)}catch(e){return console.warn("[memory/events] openKnowledgeProposals failed:",e.message),[]}}async function s(e,t,i){let n=await (0,r.get)(`SELECT id, user_id, project_id, event_type, payload, created_at
     FROM memory_events
     WHERE user_id = ? AND project_id = ? AND event_type = ?
     ORDER BY created_at DESC LIMIT 1`,e,t,i);return n?{id:n.id,user_id:n.user_id,project_id:n.project_id,event_type:n.event_type,payload:n.payload,created_at:n.created_at}:null}e.s(["factHash",0,function(e){let r=String(e||"").toLowerCase().replace(/\s+/g," ").trim().replace(/[.,;:!?]+$/,"");return t.default.createHash("sha1").update(r).digest("hex").slice(0,16)},"lastEventOfType",0,s,"listEvents",0,n,"openKnowledgeProposals",0,o,"openProposals",0,a,"recordEvent",0,i])},581507,e=>{"use strict";let t=["en","it"];function r(e){return"string"==typeof e&&t.includes(e)}e.s(["DEFAULT_LOCALE",0,"en","LOCALE_COOKIE",0,"lp_locale","LOCALE_ENGLISH_NAME",0,{en:"English",it:"Italian"},"SUPPORTED_LOCALES",0,t,"asLocale",0,function(e){return r(e)?e:"en"},"isLocale",0,r])},941171,e=>{"use strict";e.s(["coerceJson",0,function(e){if(null==e)return null;if("string"==typeof e)try{return JSON.parse(e)}catch{return null}return e}])},903044,e=>{"use strict";let t=[{id:"idea_validation",number:1,label:"Idea Canvas"},{id:"market_validation",number:2,label:"Validation Gate"},{id:"persona",number:3,label:"Persona"},{id:"business_model",number:4,label:"Business Model"},{id:"build_launch",number:5,label:"Build & Launch"},{id:"fundraise",number:6,label:"Fundraise"},{id:"operate",number:7,label:"Operate"}],r=Object.fromEntries(t.map(e=>[e.id,e]));e.s(["CANONICAL_BY_ID",0,r,"canonicalStageId",0,function(e){let r=t.find(t=>t.number===e);if(!r)throw Error(`canonicalStageId: no stage number ${e}`);return r.id},"canonicalStageLabel",0,function(e){let r=t.find(t=>t.number===e);if(!r)throw Error(`canonicalStageLabel: no stage number ${e}`);return r.label}])},390472,e=>{"use strict";var t=e.i(522734),r=e.i(814747),i=e.i(581507);let n=(0,r.join)(process.cwd(),"agents"),a=(0,r.join)(process.cwd(),"launchpad-skills"),o=new Map;function s(e,n,a){for(let s of[a!==i.DEFAULT_LOCALE?(0,r.join)(e,`${n}.${a}.md`):null,(0,r.join)(e,`${n}.md`)].filter(e=>null!==e)){if(o.has(s)){let e=o.get(s);if(e)return e;continue}if((0,t.existsSync)(s)){let e=(0,t.readFileSync)(s,"utf-8");return o.set(s,e),e}o.set(s,"")}return null}function l(e){if(e===i.DEFAULT_LOCALE)return null;let t=i.LOCALE_ENGLISH_NAME[e];return`## Language
Always write every founder-facing word — chat replies AND the prose inside artifacts — in ${t}.
Stay in ${t} for the entire conversation, even if earlier turns were in another language.
Do NOT translate: brand/product names, people's names, code, URLs, or the structured field *keys* inside :::artifact blocks (only their human-readable values).`}async function c(e,t){let r=await t("SELECT locale FROM projects WHERE id = ?",e);return r[0]?.locale==="it"?"it":"en"}e.s(["buildSystemPromptString",0,function(e={}){return function(e={}){let t=(0,i.asLocale)(e.locale),o=e.context||"chat",c=[],d=s(n,"SOUL",t);d&&c.push(d);let p=s(n,"AGENTS",t);if(p&&c.push(p),"cron"===o||"monitor"===o){let e=s(n,"HEARTBEAT",t);e&&c.push(e)}if(e.activeSkillId){var u;let i=(u=e.activeSkillId,s((0,r.join)(a,u),"SKILL",t));i&&c.push(i)}let g=l(t);g&&c.push(g);let _=c.join("\n\n---\n\n"),h=[];e.tail&&h.push(e.tail),e.projectContext&&h.push(e.projectContext);let f=h.join("\n\n");return{staticPrefix:_,dynamicTail:f,full:f?`${_}

---

${f}`:_,staticTokensEstimate:Math.ceil(_.length/4)}}(e).full},"languageDirective",0,l,"resolveProjectLocale",0,c])},659527,e=>{"use strict";var t=e.i(921284);let r=process.env.RESEND_API_KEY,i=process.env.SENSEFOUND_MAIL_FROM||process.env.LAUNCHPAD_MAIL_FROM||"brief@sensefound.io",n=process.env.SENSEFOUND_APP_URL||process.env.LAUNCHPAD_APP_URL||"http://localhost:3000";async function a(e){var a;let o,s,l,d,p=(await (0,t.query)("SELECT email FROM users WHERE id = ?",e.userId))[0],u=p?.email??null;if(!u)return{stubbed:!0,ok:!1,error:"No email on file for user"};let g=(o=(a=e).pendingActions.length>0?`<h3 style="font-size:15px;margin:18px 0 8px 0;color:#16140F;">Pending actions (${a.pendingActions.length})</h3>
       <ul style="padding-left:18px;margin:0;">
         ${a.pendingActions.slice(0,5).map(e=>`<li style="margin-bottom:6px;color:#2A2620;"><strong>${c(e.title)}</strong>${e.rationale?`<br/><span style="color:#6B6558;font-size:13px;">${c(e.rationale)}</span>`:""}</li>`).join("")}
       </ul>`:'<p style="color:#8F897A;">No pending actions this week.</p>',s=a.ecosystemAlerts.length>0?`<h3 style="font-size:15px;margin:18px 0 8px 0;color:#16140F;">Ecosystem alerts</h3>
       <ul style="padding-left:18px;margin:0;">
         ${a.ecosystemAlerts.slice(0,3).map(e=>`<li style="margin-bottom:6px;color:#2A2620;">${c(e.headline)} <span style="color:#8F897A;font-size:12px;">(relevance ${e.relevance_score.toFixed(2)})</span></li>`).join("")}
       </ul>`:"",l=a.heartbeatSummary?`<div style="padding:12px 14px;background:#F5E6DC;border-radius:6px;margin:18px 0;color:#2A2620;font-size:14px;">
         <strong style="color:#16140F;">Daily reflection</strong><br/>${c(a.heartbeatSummary)}
       </div>`:"",d=a.intelligenceBriefs&&a.intelligenceBriefs.length>0?`<h3 style="font-size:15px;margin:18px 0 8px 0;color:#16140F;">Intelligence briefs</h3>
       ${a.intelligenceBriefs.slice(0,2).map(e=>`<div style="padding:10px 12px;background:#E8F0EB;border-radius:6px;margin-bottom:8px;border-left:3px solid #6B9B80;">
           <strong style="font-size:13px;color:#16140F;">${c(e.title)}</strong>
           ${e.temporal_prediction?`<br/><span style="font-size:11px;color:#6B6558;font-style:italic;">Prediction: ${c(e.temporal_prediction)}</span>`:""}
           <br/><span style="font-size:12px;color:#2A2620;">${c(e.narrative.slice(0,200))}${e.narrative.length>200?"…":""}</span>
         </div>`).join("")}`:"",`
<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:#FAF5EE;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAF5EE;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:#FFFFFF;border:1px solid #E5DFCF;border-radius:8px;overflow:hidden;">
          <!-- Gradient bar -->
          <tr>
            <td style="height:4px;background:linear-gradient(to right,#D4896A,#FAF5EE,#6B9B80);font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <!-- Bracket motif + wordmark -->
          <tr>
            <td align="center" style="padding:24px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:28px;font-weight:300;color:#6B9B80;padding-right:6px;vertical-align:middle;font-family:Georgia,serif;">&#91;</td>
                  <td style="font-size:16px;font-weight:600;letter-spacing:3px;color:#16140F;vertical-align:middle;">SENSEFOUND</td>
                  <td style="font-size:28px;font-weight:300;color:#6B9B80;padding-left:6px;vertical-align:middle;font-family:Georgia,serif;">&#93;</td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Content area -->
          <tr>
            <td style="padding:24px 40px 0 40px;">
              <h1 style="font-size:22px;margin:0 0 4px 0;color:#16140F;">Your Monday Brief</h1>
              <p style="color:#6B6558;margin:0 0 4px 0;font-size:14px;">Here's what matters for <strong style="color:#2A2620;">${c(a.projectName)}</strong> this week.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px;">
              ${l}
              ${d}
              ${o}
              ${s}
              <p style="margin:24px 0 0 0;">
                <a href="${n}/project/${a.projectId}/actions"
                   style="display:inline-block;padding:12px 24px;background:#6B9B80;color:#FFFFFF;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">
                  Open your workspace &#8599;
                </a>
              </p>
            </td>
          </tr>
          <!-- Divider -->
          <tr>
            <td style="padding:24px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #E5DFCF;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 40px 28px 40px;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#B4AE9F;text-align:center;">
                Courage through clarity &middot; AI-powered, human-protected
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`);if(!r)return console.log(`[email/stub] Would have sent Monday Brief to ${u} (project=${e.projectName}, pending=${e.pendingActions.length}, alerts=${e.ecosystemAlerts.length}, html=${g.length}b). Set RESEND_API_KEY + SENSEFOUND_MAIL_FROM to flip from stub to real delivery.`),{stubbed:!0,ok:!0,to:u};try{let t=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${r}`,"Content-Type":"application/json"},body:JSON.stringify({from:i,to:u,subject:`Your Monday Brief — ${e.projectName}`,html:g})});if(!t.ok)return{stubbed:!1,ok:!1,error:`Resend HTTP ${t.status}`,to:u};let n=await t.json();return{stubbed:!1,ok:!0,id:n.id,to:u}}catch(e){return{stubbed:!1,ok:!1,error:e.message,to:u}}}let o={en:{subject:"Your Magic Link",heading:"Your Magic Link",body:"Click the button below to securely sign in to your workspace. This link expires in 10 minutes and can only be used once.",cta:"Log In",security:"If you didn’t request this link, you can safely ignore this email.",tagline:"Courage through clarity",subtitle:"AI-powered, human-protected"},it:{subject:"Il tuo Magic Link",heading:"Il tuo Magic Link",body:"Clicca il pulsante qui sotto per accedere in modo sicuro al tuo workspace. Questo link scade tra 10 minuti e può essere usato una sola volta.",cta:"Accedi",security:"Se non hai richiesto questo link, puoi ignorare questa email.",tagline:"Coraggio attraverso la chiarezza",subtitle:"Potenziato dall’AI, protetto dall’uomo"}};function s(e){let t=(e||"en").slice(0,2).toLowerCase();return t in o?t:"en"}async function l(e,t,n){let a,l,d=(a=o[s(n)],l=s(n),`<!DOCTYPE html>
<html lang="${l}">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#FAF5EE;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAF5EE;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background-color:#FFFFFF;border:1px solid #E5DFCF;border-radius:8px;overflow:hidden;">
          <tr><td style="height:4px;background:linear-gradient(to right,#D4896A,#FAF5EE,#6B9B80);font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td align="center" style="padding:32px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:28px;font-weight:300;color:#6B9B80;padding-right:6px;vertical-align:middle;font-family:Georgia,'Times New Roman',serif;">&#91;</td>
                  <td style="font-size:15px;font-weight:600;letter-spacing:3px;color:#16140F;vertical-align:middle;">SENSEFOUND</td>
                  <td style="font-size:28px;font-weight:300;color:#6B9B80;padding-left:6px;vertical-align:middle;font-family:Georgia,'Times New Roman',serif;">&#93;</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td align="center" style="padding:28px 40px 0 40px;"><h1 style="margin:0;font-size:22px;font-weight:600;color:#16140F;">${c(a.heading)}</h1></td></tr>
          <tr><td align="center" style="padding:12px 40px 0 40px;"><p style="margin:0;font-size:15px;line-height:1.6;color:#6B6558;">${c(a.body)}</p></td></tr>
          <tr>
            <td align="center" style="padding:28px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#6B9B80;border-radius:6px;">
                    <a href="${c(t)}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:Inter,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">${c(a.cta)} &#8599;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td align="center" style="padding:24px 40px 0 40px;"><p style="margin:0;font-size:13px;line-height:1.5;color:#8F897A;">${c(a.security)}</p></td></tr>
          <tr>
            <td style="padding:28px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #E5DFCF;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr><td align="center" style="padding:16px 40px 32px 40px;"><p style="margin:0;font-size:12px;line-height:1.5;color:#B4AE9F;">${c(a.tagline)} &middot; ${c(a.subtitle)}</p></td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`),p=o[s(n)].subject;if(!r)return console.log(`[email/stub] Would have sent magic link to ${e} (locale=${n||"en"}, html=${d.length}b). Set RESEND_API_KEY + SENSEFOUND_MAIL_FROM to enable.`),{stubbed:!0,ok:!0,to:e};try{let t=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${r}`,"Content-Type":"application/json"},body:JSON.stringify({from:i,to:e,subject:p,html:d})});if(!t.ok)return{stubbed:!1,ok:!1,error:`Resend HTTP ${t.status}`,to:e};let n=await t.json();return{stubbed:!1,ok:!0,id:n.id,to:e}}catch(t){return{stubbed:!1,ok:!1,error:t.message,to:e}}}function c(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}e.s(["sendBrief",0,a,"sendMagicLink",0,l])},844419,e=>e.a(async(t,r)=>{try{var i=e.i(328273),n=e.i(516523),a=e.i(530178),o=e.i(669922),s=e.i(537178),l=t([i]);[i]=l.then?(await l)():l;let d="assumption-extract",p={alerts_inserted:0,pending_actions_created:0,routed_to_knowledge:0,parsed:[],parse_errors:0};async function c(e){var t;let r=(e.scanTranscript||"").trim();if(r.length<500)return{attempted:!1,skipped_reason:"transcript_too_short",...p};let l=(t=e.locale,["You are given the transcript of a competitive-intelligence scan that already ran.\nYour ONLY job is to extract the material findings that the scan CONFIRMED into ecosystem_alert artifacts, in EXACTLY the format below.\nRules:\n- Extract ONLY findings present in the transcript. Do not investigate further. Do not add knowledge of your own.\n- Never fabricate URLs: source_url must be a URL that appears in the transcript (or null if none was given for that finding).\n- Write headline and body in the same language as the transcript.\n- If the transcript contains no material confirmed finding, output exactly: NONE\n",(0,o.outputInstructions)(t),'\nSCAN TRANSCRIPT:\n"""',r.length<=3e4?r:`${r.slice(0,1e4)}

[... transcript truncated ...]

${r.slice(-2e4)}`,'"""'].join("\n")),c="",u=Date.now();try{let t=await (0,i.runAgent)(l,{tools:!1,timeout:6e4,task:d});c=t.text;let{provider:r,model:o}=(0,a.pickModel)(d);await (0,n.recordUsage)({project_id:e.projectId,step:`${e.trigger}.${e.monitorType}.second_pass_extract`,provider:r,model:o,usage:t.usage,latency_ms:Date.now()-u}).catch(e=>console.warn("[monitor-extract] recordUsage failed:",e.message))}catch(t){return console.warn(`[monitor-extract] second-pass extraction call failed for monitor ${e.monitorId} (run ${e.monitorRunId}):`,t.message),{attempted:!0,skipped_reason:"extract_call_failed",...p}}let{parsed:g,errors:_}=(0,s.extractEcosystemAlerts)(c);if(_.length>0&&console.warn(`[monitor-extract] second pass produced ${_.length} unparseable artifact(s) — first reason:`,_[0].reason),0===g.length)return console.log(`[monitor-extract] second pass found nothing material for monitor ${e.monitorId} (run ${e.monitorRunId})`),{attempted:!0,...p,parse_errors:_.length};let h=await (0,s.persistEcosystemAlerts)(g,{projectId:e.projectId,monitorId:e.monitorId,monitorRunId:e.monitorRunId,autoQueueRelevanceThreshold:.8,maxPendingActionsPerRun:5});return console.log(`[monitor-extract] LAYER=second_pass recovered ${h.alerts_inserted} alert(s) (+${h.pending_actions_created} pending action(s)) for monitor ${e.monitorId} (run ${e.monitorRunId}) — primary parse had found 0`),{attempted:!0,alerts_inserted:h.alerts_inserted,pending_actions_created:h.pending_actions_created,routed_to_knowledge:h.routed_to_knowledge,parsed:g,parse_errors:_.length}}e.s(["extractAlertsSecondPass",0,c]),r()}catch(e){r(e)}},!1),735349,e=>{"use strict";var t=e.i(520378);e.s(["requireCronAuth",0,function(e){let r=process.env.CRON_SECRET;return r?(e.headers.get("authorization")||e.headers.get("Authorization"))!==`Bearer ${r}`?{ok:!1,response:(0,t.error)("Unauthorized cron invocation",401)}:{ok:!0}:{ok:!1,response:(0,t.error)("CRON_SECRET not configured — cron disabled in production",403)}}])},976557,e=>e.a(async(t,r)=>{try{var i=e.i(921284),n=e.i(520378),a=e.i(328273),o=e.i(530178),s=e.i(516523),l=e.i(669922),c=e.i(738608),d=t([a]);async function p(e,t={}){var r,d;let u,f,m,y=new Date(Date.now()-6048e5).toISOString();if(!t.force&&(await (0,i.query)(`SELECT id FROM intelligence_briefs
       WHERE project_id = ? AND created_at >= ? AND brief_type = 'correlation'
       LIMIT 1`,e,y)).length>0)return{project_id:e,briefs_created:0,briefs_superseded:0,skipped_reason:"recent_brief_exists"};(await (0,s.isProjectCapped)(e)).capped&&console.info(`[intel-correlator] project ${e} over budget — proceeding (observe mode)`);let b=await (0,i.query)(`SELECT id, headline, body, alert_type, source_url, relevance_score, created_at
     FROM ecosystem_alerts
     WHERE project_id = ? AND created_at >= ?
     ORDER BY relevance_score DESC`,e,y),E=await (0,i.query)(`SELECT sc.id, sc.diff_summary, sc.significance, sc.detected_at,
            ws.label, ws.url
     FROM source_changes sc
     JOIN watch_sources ws ON sc.watch_source_id = ws.id
     WHERE sc.project_id = ? AND sc.detected_at >= ?
       AND sc.significance IN ('high', 'medium')
     ORDER BY sc.detected_at DESC`,e,y);if(b.length+E.length<2)return{project_id:e,briefs_created:0,briefs_superseded:0,skipped_reason:"insufficient_signals"};let x=await (0,l.loadMonitorContext)(e),v=function(e,t,r){let i=new Map,n={entity:null,signals:[]},a=r.map(e=>e.toLowerCase());for(let t of e){let e=g(t.headline+" "+(t.body||""),a,r);(e?_(i,e):n).signals.push({id:t.id,text:`[${t.alert_type}] ${t.headline}${t.body?": "+t.body.slice(0,200):""}`,type:t.alert_type,date:t.created_at})}for(let e of t){let t=g(e.label+" "+(e.diff_summary||""),a,r);(t?_(i,t):n).signals.push({id:e.id,text:`[source_change] ${e.label}: ${e.diff_summary||"content changed"}`,type:"source_change",date:e.detected_at})}let o=Array.from(i.values());return n.signals.length>0&&o.push(n),o}(b,E,x.knownCompetitors),w=(0,l.withBriefLanguage)((r=v,d=x,u=[`Project: ${d.projectName}`,d.projectDescription?`Description: ${d.projectDescription}`:null,d.idea?.problem?`Problem: ${d.idea.problem}`:null,d.idea?.solution?`Solution: ${d.idea.solution}`:null,d.idea?.target_market?`Target market: ${d.idea.target_market}`:null,d.idea?.value_proposition?`Value prop: ${d.idea.value_proposition}`:null].filter(Boolean).join("\n"),f=r.map(e=>{let t=e.entity?`## Entity: ${e.entity}`:"## Ungrouped signals",r=e.signals.map(e=>`- [${e.id}] (${e.date.slice(0,10)}) ${e.text}`).join("\n");return`${t}
${r}`}).join("\n\n"),`Analyze these signals from the past 7 days and produce strategic correlations.

${u}

# Signals grouped by entity
${f}

# Output format
Return a JSON array of objects:
[
  {
    "entity_name": "CompetitorX" or null,
    "title": "Concise title (max 120 chars)",
    "narrative": "2-4 sentence strategic narrative",
    "temporal_prediction": "time range prediction or null",
    "confidence": 0.0-1.0,
    "signal_ids_used": ["id1", "id2"],
    "recommended_actions": [
      { "action": "concrete action", "urgency": "immediate|this_week|this_month|watch", "rationale": "why" }
    ]
  }
]

Return [] if no meaningful correlations exist.`),x.locale),k=Date.now();try{let{text:t,usage:r}=await (0,a.runAgent)(w,{systemPrompt:h,timeout:12e4,task:"signal-correlate",projectId:e}),i=Date.now()-k,{provider:n,model:l}=(0,o.pickModel)("signal-correlate");await (0,s.recordUsage)({project_id:e,skill_id:"intelligence",step:"signal_correlate",provider:n,model:l,usage:r,latency_ms:i}).catch(e=>console.warn("[correlator] recordUsage failed:",e.message)),m=function(e){let t,r=e.match(/```(?:json)?\s*([\s\S]*?)```/i),i=r?r[1]:e,n=i.indexOf("["),a=i.lastIndexOf("]");if(-1===n||-1===a||a<n)return[];try{if(t=JSON.parse(i.slice(n,a+1)),!Array.isArray(t))return[]}catch{return[]}let o=[];for(let e of t){if(!e||"object"!=typeof e)continue;let t="string"==typeof e.title?e.title.slice(0,200):"",r="string"==typeof e.narrative?e.narrative:"";if(!t||!r||!/\[founder['’]s moat:[^\]]+\]/i.test(r))continue;let i=Array.isArray(e.signal_ids_used)?e.signal_ids_used.filter(e=>"string"==typeof e):[];if(i.length<2)continue;let n=Array.isArray(e.recommended_actions)?e.recommended_actions.filter(e=>e&&"object"==typeof e&&"string"==typeof e.action).map(e=>({action:String(e.action).slice(0,300),urgency:["immediate","this_week","this_month","watch"].includes(String(e.urgency))?String(e.urgency):"this_week",rationale:"string"==typeof e.rationale?e.rationale.slice(0,300):""})):[];o.push({entity_name:"string"==typeof e.entity_name?e.entity_name:null,title:t,narrative:r,temporal_prediction:"string"==typeof e.temporal_prediction?e.temporal_prediction:null,confidence:"number"==typeof e.confidence&&e.confidence>=0&&e.confidence<=1?e.confidence:.7,signal_ids_used:i,recommended_actions:n})}return o}(t)}catch(t){return console.warn(`[correlator] LLM call failed for ${e}:`,t.message),{project_id:e,briefs_created:0,briefs_superseded:0,skipped_reason:"llm_error"}}if(0===m.length)return{project_id:e,briefs_created:0,briefs_superseded:0,skipped_reason:"no_correlations_found"};let $=(await (0,i.run)(`UPDATE intelligence_briefs SET status = 'superseded'
     WHERE project_id = ? AND status = 'active' AND brief_type = 'correlation'`,e)).count??0,S=new Date().toISOString(),A=new Date(Date.now()+6048e5).toISOString(),N=0;for(let t of m){let r=(0,n.generateId)("ib");try{await (0,i.run)(`INSERT INTO intelligence_briefs
           (id, project_id, brief_type, entity_name, title, narrative,
            temporal_prediction, confidence, signal_ids, signal_count,
            recommended_actions, valid_until, status, created_at)
         VALUES (?, ?, 'correlation', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,r,e,t.entity_name,t.title,t.narrative,t.temporal_prediction,t.confidence,t.signal_ids_used,t.signal_ids_used.length,t.recommended_actions,A,S),N++,t.entity_name&&await (0,c.linkBriefToProfile)(e,t.entity_name,r);try{let a=t.confidence>=.85?"high":t.confidence>=.65?"medium":"low",o=(0,n.generateId)("pa");await (0,i.run)(`INSERT INTO pending_actions
             (id, project_id, source_table, source_id, action_type, title,
              rationale, payload, status, priority, created_at, updated_at)
           VALUES (?, ?, 'intelligence_briefs', ?, 'intelligence_brief', ?, ?, ?, 'pending', ?, ?, ?)`,o,e,r,t.title,(t.narrative??"").slice(0,500),{brief_id:r,entity:t.entity_name,narrative:t.narrative,prediction:t.temporal_prediction,confidence:t.confidence,signal_count:t.signal_ids_used.length,recommended_actions:t.recommended_actions},a,S,S)}catch(e){console.warn("[correlator] pending_action dual-write failed (will be picked up by materialize-on-read):",e.message)}}catch(e){console.warn("[correlator] brief insert failed:",e.message)}}return{project_id:e,briefs_created:N,briefs_superseded:$}}async function u(){let e=new Date(Date.now()-6048e5).toISOString();return(await (0,i.run)(`UPDATE intelligence_briefs SET status = 'expired'
     WHERE status = 'active' AND created_at < ?`,e)).count??0}function g(e,t,r){let i=e.toLowerCase();for(let e=0;e<t.length;e++)if(i.includes(t[e]))return r[e];return null}function _(e,t){let r=e.get(t);return r||(r={entity:t,signals:[]},e.set(t,r)),r}[a]=d.then?(await d)():d;let h=`You are a strategic intelligence analyst for a startup founder. You synthesize multiple market signals into actionable strategic narratives.

SIGNAL TYPES you may encounter:
competitor_activity, ip_filing, trend_signal, partnership_opportunity, regulatory_change,
funding_event, hiring_signal, customer_sentiment, social_signal, ad_activity, pricing_change, product_launch

CROSS-TYPE CORRELATION PATTERNS (actively look for these):
- pricing_change + ad_activity = aggressive growth push (likely grabbing market share)
- hiring_signal[engineering_expansion] + product_launch = major platform shift incoming
- pricing_change + customer_sentiment (negative) = competitor vulnerability, potential churn window
- ad_activity + social_signal = coordinated marketing blitz, likely new campaign or pivot
- funding_event + hiring_signal = scaling push, 3-6 month window before competitive impact
- product_launch + ip_filing = defensible moat being built, harder to compete directly

RULES:
1. Only synthesize when 2+ signals genuinely correlate — do not force connections.
2. Temporal predictions MUST include ranges (e.g. "60-90 days", "Q3-Q4 2026").
3. Return an empty array [] if no meaningful correlations exist.
4. Each brief must be grounded in specific signal IDs.
5. Recommended actions must be concrete and time-bound.
6. Confidence should reflect the strength of correlation, not just signal count.
7. THE ICP-TIE RULE (hard requirement): the LAST SENTENCE of every narrative must
   explicitly state how this signal affects THIS founder's stated moat. Use the
   exact wording from the project context block (Problem / Solution / Target market
   / Value proposition). Format:
       "Threatens [founder's moat: <verbatim phrase>]."
   or
       "Strengthens [founder's moat: <verbatim phrase>]."
   If you cannot make this tie honestly, DROP the brief — it is not strategic
   intelligence, it is just news. Narratives without this clause will be
   rejected downstream.

Respond ONLY with a valid JSON array. No prose before or after.`;e.s(["expireOldBriefs",0,u,"processCorrelations",0,p]),r()}catch(e){r(e)}},!1),996376,e=>{"use strict";var t=e.i(921284),r=e.i(311447),i=e.i(824675);async function n(e,t,r){try{return await t()}catch(t){return console.warn(`[gather-context] ${e} failed:`,t.message),r.push(e),null}}async function a(e,o,s={}){let{maxFacts:l=20,maxEvents:c=15,maxGraphNodes:d=10,maxInbox:p=10,maxTasks:u=15,maxBriefs:g=3,maxRisks:_=3,maxSkills:h=10,maxAlerts:f=10,includeMessages:m=!1,includeGraphNodes:y=!1,includeAlerts:b=!1}=s,E=[],x=new Date().toISOString(),v=await n("project",()=>(0,t.get)("SELECT id, name, description, status, current_step, locale, owner_user_id, settings FROM projects WHERE id = ?",o).then(e=>e??null),E),w=v?.owner_user_id||e,k=s.enriched??v?.settings?.rich_context===!0,$=!0===s.enriched,[S,A,N,R,j,D,O,L,T,I,F,C,P,M]=await Promise.all([n("score",()=>(0,t.get)("SELECT overall_score, benchmark, recommendation FROM scores WHERE project_id = ?",o).then(e=>e??null),E),n("facts",()=>(0,r.listFacts)(w,o,{limit:l,includeSources:k}),E),n("events",()=>(0,i.listEvents)(w,o,{limit:c}),E),n("openProposals",()=>(0,i.openProposals)(w,o),E),n("openKnowledgeProposals",()=>(0,i.openKnowledgeProposals)(w,o),E),n("inbox",()=>(0,t.query)(`SELECT action_type, title, estimated_impact${k?", rationale":""}
         FROM pending_actions
         WHERE project_id = ?
           AND action_type != 'task'
           AND status IN ('pending', 'edited')
         ORDER BY created_at DESC
         LIMIT ?`,o,p),E),n("tasks",()=>(0,t.query)(`SELECT title, priority${k?", rationale":""}${$?", sources":""}
         FROM pending_actions
         WHERE project_id = ?
           AND action_type = 'task'
           AND status IN ('pending', 'edited')
         ORDER BY
           CASE priority
             WHEN 'critical' THEN 1
             WHEN 'high'     THEN 2
             WHEN 'medium'   THEN 3
             WHEN 'low'      THEN 4
             ELSE 5
           END,
           created_at DESC
         LIMIT ?`,o,u),E),n("briefs",()=>(0,t.query)(`SELECT title, narrative, confidence, recommended_actions${k?", brief_type, entity_name, temporal_prediction, signal_count, valid_until":""} FROM intelligence_briefs
         WHERE project_id = ? AND status = 'active'
         ORDER BY confidence DESC LIMIT ?`,o,g),E),n("risks",async()=>{let e=await (0,t.get)("SELECT risk_scenarios FROM simulation WHERE project_id = ?",o);if(!e?.risk_scenarios)return[];let r="string"==typeof e.risk_scenarios?JSON.parse(e.risk_scenarios):e.risk_scenarios;return Array.isArray(r)?r.map(e=>{let t="number"==typeof e.probability?e.probability:.5,r="number"==typeof e.impact?e.impact:.5;return{id:String(e.id||e.risk_id||"?"),title:String(e.title||e.name||"(untitled)"),probability:t,impact:r,severity:t*r}}).sort((e,t)=>t.severity-e.severity).slice(0,_):[]},E),n("graph",async()=>{let[e,r]=await Promise.all([(0,t.query)("SELECT node_type, COUNT(*) as count FROM graph_nodes WHERE project_id = ? AND reviewed_state = 'applied' GROUP BY node_type",o),(0,t.query)(`SELECT s.name as source_name, t.name as target_name, e.relation, e.weight${k?", e.label":""}
           FROM graph_edges e
           JOIN graph_nodes s ON s.id = e.source_node_id AND s.reviewed_state = 'applied'
           JOIN graph_nodes t ON t.id = e.target_node_id AND t.reviewed_state = 'applied'
           WHERE e.project_id = ?
           ORDER BY e.weight DESC LIMIT ?`,o,d)]);return 0===e.length?null:{nodeCounts:e,topEdges:r}},E),y?n("graphNodes",()=>(0,t.query)(`SELECT name, node_type, summary FROM graph_nodes
             WHERE project_id = ? AND reviewed_state = 'applied'
             ORDER BY created_at DESC LIMIT ?`,o,d),E):Promise.resolve(null),n("skills",()=>(0,t.query)(`SELECT skill_id, status, summary, completed_at${k?", section_scores":""} FROM skill_completions
         WHERE project_id = ? ORDER BY completed_at DESC LIMIT ?`,o,h),E),b?n("alerts",()=>(0,t.query)(`SELECT headline, body, alert_type, source${k?", relevance_score, source_url":""} FROM ecosystem_alerts
             WHERE project_id = ? AND reviewed_state = 'pending'
             ORDER BY relevance_score DESC, created_at DESC LIMIT ?`,o,f),E):Promise.resolve(null),m?n("messages",()=>(0,t.query)(`SELECT role, content, "timestamp" FROM chat_messages
             WHERE project_id = ? AND step = 'chat'
             ORDER BY "timestamp"`,o),E):Promise.resolve(null)]);return{context_built_at:x,project:v,score:S,facts:A,events:N,openProposals:R,openKnowledgeProposals:j,inbox:D,tasks:O,briefs:L,risks:T,graph:I,graphNodes:F,skills:C,alerts:P,messages:M,failedSections:E}}e.s(["gatherProjectContext",0,a])},96569,e=>{"use strict";var t=e.i(996376);async function r(e,i,n={}){let a={maxFacts:n.maxFacts??20,maxEvents:n.maxEvents??15,maxGraphNodes:n.maxGraphNodes??10,enriched:n.enriched};return function(e){let t=[];if(t.push("=== MEMORY CONTEXT ==="),t.push(`Context as of: ${e.context_built_at}`),t.push(""),e.project?(t.push("## Project"),t.push(`- Name: ${e.project.name}`),e.project.description&&t.push(`- Description: ${e.project.description}`),t.push(`- Status: ${e.project.status}`),e.project.locale&&"en"!==e.project.locale&&t.push(`- Locale: ${e.project.locale}`),t.push("")):e.failedSections.includes("project")&&(t.push("## Project — [unavailable: project]"),t.push("")),e.score&&(t.push(`## Latest score: ${e.score.overall_score?.toFixed?.(1)??"—"}/10`),e.score.recommendation&&t.push(`- ${e.score.recommendation}`),t.push("")),e.facts&&e.facts.length>0){for(let r of(t.push("## Curated facts"),e.facts))t.push(`- [${r.kind}] ${r.fact}`);t.push("")}else e.failedSections.includes("facts")&&(t.push("## Curated facts — [unavailable: facts]"),t.push(""));if(e.openProposals&&e.openProposals.length>0){for(let r of(t.push("## Open proposals (suggested, not yet run)"),e.openProposals)){let e=0===r.turns_since?"this turn":`${r.turns_since} turn${1===r.turns_since?"":"s"} ago`,i=r.times_proposed>1?` \xb7 proposed ${r.times_proposed}\xd7 (still open)`:"",n=r.lapsed?" · LAPSED":"";t.push(`- ${r.skill_id} — suggested ${e}${i}${n}`)}t.push("")}if(e.openKnowledgeProposals&&e.openKnowledgeProposals.length>0){for(let r of(t.push("## Open fact-suggestions (proposed, not yet applied)"),e.openKnowledgeProposals)){let e=0===r.turns_since?"this turn":`${r.turns_since} turn${1===r.turns_since?"":"s"} ago`,i=r.lapsed?" · LAPSED":"";t.push(`- "${r.fact_preview}" — suggested ${e}${i}`)}t.push("")}if(e.events&&e.events.length>0){for(let r of(t.push("## Recent activity (most recent first)"),e.events)){let e=function(e,t){if(!t||"object"!=typeof t)return e;if("chat_turn"===e&&"string"==typeof t.preview)return t.preview.slice(0,140);if("fact_recorded"===e&&"string"==typeof t.preview)return`+${t.preview}`;if("monitor_alert"===e&&"string"==typeof t.summary)return t.summary.slice(0,140);if("skill_invoked"===e&&"string"==typeof t.skill_id){let e="agent"===t.invoker?" (agent)":"";return`proposed skill=${t.skill_id}${e}`}if("skill_completed"===e&&"string"==typeof t.skill_id){let e="string"==typeof t.proposal_id&&t.proposal_id?" (ran a proposal)":"";return`ran skill=${t.skill_id}${e}`}return"knowledge_proposed"===e&&"string"==typeof t.preview?`proposed fact: ${t.preview.slice(0,120)}`:"knowledge_applied"===e?"founder applied a fact to intelligence":"option_selected"===e&&"string"==typeof t.choice?`founder chose: ${t.choice.slice(0,120)}`:"heartbeat_reflection"===e&&"string"==typeof t.summary?t.summary.slice(0,200):JSON.stringify(t).slice(0,160)}(r.event_type,r.payload);t.push(`- ${r.created_at} [${r.event_type}] ${e}`)}t.push("")}else e.failedSections.includes("events")&&(t.push("## Recent activity — [unavailable: events]"),t.push(""));if(e.inbox&&e.inbox.length>0){for(let r of(t.push("## Founder inbox (awaiting decision)"),e.inbox)){let e=r.estimated_impact?` \xb7 ${r.estimated_impact}`:"",i=r.rationale?` — ${r.rationale.slice(0,60)}`:"";t.push(`- [${r.action_type}${e}] ${r.title}${i}`)}t.push("")}else e.failedSections.includes("inbox")&&(t.push("## Founder inbox — [unavailable: inbox]"),t.push(""));if(e.tasks&&e.tasks.length>0){for(let r of(t.push("## Open tasks"),e.tasks)){let e=r.rationale?` — ${r.rationale.slice(0,80)}`:"";t.push(`- [${r.priority||"—"}] ${r.title}${e}`)}t.push("")}else e.failedSections.includes("tasks")&&(t.push("## Open tasks — [unavailable: tasks]"),t.push(""));if(e.briefs&&e.briefs.length>0){for(let r of(t.push("## Active intelligence briefs"),e.briefs)){let e=r.brief_type&&r.entity_name?`[${r.brief_type}:${r.entity_name}|${r.confidence.toFixed(2)}]`:`[${r.confidence.toFixed(2)}]`;t.push(`- ${e} ${r.title}`),t.push(`  ${r.narrative.slice(0,200)}`);try{let e=r.recommended_actions?"string"==typeof r.recommended_actions?JSON.parse(r.recommended_actions):r.recommended_actions:[],i=Array.isArray(e)?e.filter(e=>"high"===e.urgency||"critical"===e.urgency):[];i.length>0&&t.push(`  URGENT: ${i.map(e=>e.action||e.title).join("; ")}`)}catch{}}t.push("")}else e.failedSections.includes("briefs")&&(t.push("## Active intelligence briefs — [unavailable: briefs]"),t.push(""));if(e.risks&&e.risks.length>0){for(let r of(t.push("## Top risks (from risk audit)"),e.risks))t.push(`- [${r.id}] ${r.title} — severity ${(100*r.severity).toFixed(0)}% (P=${(100*r.probability).toFixed(0)}% I=${(100*r.impact).toFixed(0)}%)`);t.push("")}else e.failedSections.includes("risks")&&(t.push("## Top risks — [unavailable: risks]"),t.push(""));if(e.graph){if(t.push("## Knowledge graph"),t.push("Nodes: "+e.graph.nodeCounts.map(e=>`${e.node_type}=${e.count}`).join(", ")),e.graph.topEdges.length>0)for(let r of(t.push("Top relationships:"),e.graph.topEdges)){let e=r.label?` "${r.label.slice(0,60)}"`:"";t.push(`  ${r.source_name} -[${r.relation}]-> ${r.target_name}${e}`)}t.push("")}else e.failedSections.includes("graph")&&(t.push("## Knowledge graph — [unavailable: graph]"),t.push(""));if(e.skills&&e.skills.length>0){let r=e.skills.filter(e=>"completed"===e.status);if(r.length>0){t.push("## Completed skills");for(let e=0;e<r.length;e++){let i=r[e],n=i.summary?` — ${i.summary.slice(0,160)}`:"",a=e<3&&i.section_scores&&"object"==typeof i.section_scores?` [${Object.entries(i.section_scores).map(([e,t])=>`${e}:${t}`).join(", ")}]`:"";t.push(`- ${i.skill_id}${n}${a}`)}t.push("")}}else e.failedSections.includes("skills")&&(t.push("## Completed skills — [unavailable: skills]"),t.push(""));return t.push("=== END MEMORY CONTEXT ==="),t.join("\n")}(await (0,t.gatherProjectContext)(e,i,a))}e.s(["buildMemoryContext",0,r])},779101,e=>{e.v(e=>Promise.resolve().then(()=>e(516523)))},552384,e=>{e.v(t=>Promise.all(["server/chunks/tech-bricks_LaunchPad-v2_src_lib_10ncx-s._.js","server/chunks/tech-bricks_LaunchPad-v2_src_lib_0ajky3l._.js","server/chunks/tech-bricks_LaunchPad-v2_src_lib_0sb24la._.js","server/chunks/tech-bricks_LaunchPad-v2_src_lib_0fx3neu._.js","server/chunks/0mjv_0yf2dbb._.js","server/chunks/tech-bricks_LaunchPad-v2_src_lib_06nh6hc._.js","server/chunks/tech-bricks_LaunchPad-v2_src_lib_journey_0~y2qc1._.js","server/chunks/tech-bricks_LaunchPad-v2_src_lib_071t7sf._.js","server/chunks/tech-bricks_LaunchPad-v2_src_lib_0bd1300._.js"].map(t=>e.l(t))).then(()=>t(240728)))},45310,e=>{e.v(e=>Promise.resolve().then(()=>e(921284)))}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0cs96i1._.js.map