module.exports=[254799,(e,t,r)=>{t.exports=e.x("crypto",()=>require("crypto"))},688947,(e,t,r)=>{t.exports=e.x("stream",()=>require("stream"))},446786,(e,t,r)=>{t.exports=e.x("os",()=>require("os"))},522734,(e,t,r)=>{t.exports=e.x("fs",()=>require("fs"))},193695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},918622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},556704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},832319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},324725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},270406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},659527,e=>{"use strict";var t=e.i(921284);let r=process.env.RESEND_API_KEY,n=process.env.SENSEFOUND_MAIL_FROM||process.env.LAUNCHPAD_MAIL_FROM||"brief@sensefound.io",i=process.env.SENSEFOUND_APP_URL||process.env.LAUNCHPAD_APP_URL||"http://localhost:3000";async function a(e){var a;let o,l,s,p,c=(await (0,t.query)("SELECT email FROM users WHERE id = ?",e.userId))[0],u=c?.email??null;if(!u)return{stubbed:!0,ok:!1,error:"No email on file for user"};let g=(o=(a=e).pendingActions.length>0?`<h3 style="font-size:15px;margin:18px 0 8px 0;color:#16140F;">Pending actions (${a.pendingActions.length})</h3>
       <ul style="padding-left:18px;margin:0;">
         ${a.pendingActions.slice(0,5).map(e=>`<li style="margin-bottom:6px;color:#2A2620;"><strong>${d(e.title)}</strong>${e.rationale?`<br/><span style="color:#6B6558;font-size:13px;">${d(e.rationale)}</span>`:""}</li>`).join("")}
       </ul>`:'<p style="color:#8F897A;">No pending actions this week.</p>',l=a.ecosystemAlerts.length>0?`<h3 style="font-size:15px;margin:18px 0 8px 0;color:#16140F;">Ecosystem alerts</h3>
       <ul style="padding-left:18px;margin:0;">
         ${a.ecosystemAlerts.slice(0,3).map(e=>`<li style="margin-bottom:6px;color:#2A2620;">${d(e.headline)} <span style="color:#8F897A;font-size:12px;">(relevance ${e.relevance_score.toFixed(2)})</span></li>`).join("")}
       </ul>`:"",s=a.heartbeatSummary?`<div style="padding:12px 14px;background:#F5E6DC;border-radius:6px;margin:18px 0;color:#2A2620;font-size:14px;">
         <strong style="color:#16140F;">Daily reflection</strong><br/>${d(a.heartbeatSummary)}
       </div>`:"",p=a.intelligenceBriefs&&a.intelligenceBriefs.length>0?`<h3 style="font-size:15px;margin:18px 0 8px 0;color:#16140F;">Intelligence briefs</h3>
       ${a.intelligenceBriefs.slice(0,2).map(e=>`<div style="padding:10px 12px;background:#E8F0EB;border-radius:6px;margin-bottom:8px;border-left:3px solid #6B9B80;">
           <strong style="font-size:13px;color:#16140F;">${d(e.title)}</strong>
           ${e.temporal_prediction?`<br/><span style="font-size:11px;color:#6B6558;font-style:italic;">Prediction: ${d(e.temporal_prediction)}</span>`:""}
           <br/><span style="font-size:12px;color:#2A2620;">${d(e.narrative.slice(0,200))}${e.narrative.length>200?"…":""}</span>
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
              <p style="color:#6B6558;margin:0 0 4px 0;font-size:14px;">Here's what matters for <strong style="color:#2A2620;">${d(a.projectName)}</strong> this week.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px;">
              ${s}
              ${p}
              ${o}
              ${l}
              <p style="margin:24px 0 0 0;">
                <a href="${i}/project/${a.projectId}/actions"
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
</html>`);if(!r)return console.log(`[email/stub] Would have sent Monday Brief to ${u} (project=${e.projectName}, pending=${e.pendingActions.length}, alerts=${e.ecosystemAlerts.length}, html=${g.length}b). Set RESEND_API_KEY + SENSEFOUND_MAIL_FROM to flip from stub to real delivery.`),{stubbed:!0,ok:!0,to:u};try{let t=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${r}`,"Content-Type":"application/json"},body:JSON.stringify({from:n,to:u,subject:`Your Monday Brief — ${e.projectName}`,html:g})});if(!t.ok)return{stubbed:!1,ok:!1,error:`Resend HTTP ${t.status}`,to:u};let i=await t.json();return{stubbed:!1,ok:!0,id:i.id,to:u}}catch(e){return{stubbed:!1,ok:!1,error:e.message,to:u}}}let o={en:{subject:"Your Magic Link",heading:"Your Magic Link",body:"Click the button below to securely sign in to your workspace. This link expires in 10 minutes and can only be used once.",cta:"Log In",security:"If you didn’t request this link, you can safely ignore this email.",tagline:"Courage through clarity",subtitle:"AI-powered, human-protected"},it:{subject:"Il tuo Magic Link",heading:"Il tuo Magic Link",body:"Clicca il pulsante qui sotto per accedere in modo sicuro al tuo workspace. Questo link scade tra 10 minuti e può essere usato una sola volta.",cta:"Accedi",security:"Se non hai richiesto questo link, puoi ignorare questa email.",tagline:"Coraggio attraverso la chiarezza",subtitle:"Potenziato dall’AI, protetto dall’uomo"}};function l(e){let t=(e||"en").slice(0,2).toLowerCase();return t in o?t:"en"}async function s(e,t,i){let a,s,p=(a=o[l(i)],s=l(i),`<!DOCTYPE html>
<html lang="${s}">
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
          <tr><td align="center" style="padding:28px 40px 0 40px;"><h1 style="margin:0;font-size:22px;font-weight:600;color:#16140F;">${d(a.heading)}</h1></td></tr>
          <tr><td align="center" style="padding:12px 40px 0 40px;"><p style="margin:0;font-size:15px;line-height:1.6;color:#6B6558;">${d(a.body)}</p></td></tr>
          <tr>
            <td align="center" style="padding:28px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#6B9B80;border-radius:6px;">
                    <a href="${d(t)}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:Inter,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">${d(a.cta)} &#8599;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td align="center" style="padding:24px 40px 0 40px;"><p style="margin:0;font-size:13px;line-height:1.5;color:#8F897A;">${d(a.security)}</p></td></tr>
          <tr>
            <td style="padding:28px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #E5DFCF;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr><td align="center" style="padding:16px 40px 32px 40px;"><p style="margin:0;font-size:12px;line-height:1.5;color:#B4AE9F;">${d(a.tagline)} &middot; ${d(a.subtitle)}</p></td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`),c=o[l(i)].subject;if(!r)return console.log(`[email/stub] Would have sent magic link to ${e} (locale=${i||"en"}, html=${p.length}b). Set RESEND_API_KEY + SENSEFOUND_MAIL_FROM to enable.`),{stubbed:!0,ok:!0,to:e};try{let t=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${r}`,"Content-Type":"application/json"},body:JSON.stringify({from:n,to:e,subject:c,html:p})});if(!t.ok)return{stubbed:!1,ok:!1,error:`Resend HTTP ${t.status}`,to:e};let i=await t.json();return{stubbed:!1,ok:!0,id:i.id,to:e}}catch(t){return{stubbed:!1,ok:!1,error:t.message,to:e}}}function d(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}e.s(["sendBrief",0,a,"sendMagicLink",0,s])},510080,e=>{"use strict";var t=e.i(505826),r=e.i(937401),n=e.i(46496),i=e.i(150723),a=e.i(179406),o=e.i(276150),l=e.i(286892),s=e.i(426211),d=e.i(702676),p=e.i(605413),c=e.i(408638),u=e.i(803883),g=e.i(411421),h=e.i(246435),x=e.i(557645),m=e.i(193695);e.i(111714);var f=e.i(80447),y=e.i(284204);async function b(e){return y.NextResponse.json({error:"Not available in production"},{status:404})}e.i(659527),e.s(["GET",0,b],946778);var v=e.i(946778);let E=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/preview-email/route",pathname:"/api/preview-email",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/tech-bricks/LaunchPad-v2/src/app/api/preview-email/route.ts",nextConfigOutput:"standalone",userland:v}),{workAsyncStorage:w,workUnitAsyncStorage:F,serverHooks:A}=E;async function R(e,t,n){n.requestMeta&&(0,i.setRequestMeta)(e,n.requestMeta),E.isDev&&(0,i.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let y="/api/preview-email/route";y=y.replace(/\/index$/,"")||"/";let b=await E.prepare(e,t,{srcPage:y,multiZoneDraftMode:!1});if(!b)return t.statusCode=400,t.end("Bad Request"),null==n.waitUntil||n.waitUntil.call(n,Promise.resolve()),null;let{buildId:v,params:w,nextConfig:F,parsedUrl:A,isDraftMode:R,prerenderManifest:k,routerServerContext:C,isOnDemandRevalidate:N,revalidateOnlyGenerated:$,resolvedPathname:S,clientReferenceManifest:_,serverActionsManifest:P}=b,B=(0,l.normalizeAppPath)(y),T=!!(k.dynamicRoutes[B]||k.routes[S]),O=async()=>((null==C?void 0:C.render404)?await C.render404(e,t,A,!1):t.end("This page could not be found"),null);if(T&&!R){let e=!!k.routes[S],t=k.dynamicRoutes[B];if(t&&!1===t.fallback&&!e){if(F.adapterPath)return await O();throw new m.NoFallbackError}}let I=null;!T||E.isDev||R||(I="/index"===(I=S)?"/":I);let j=!0===E.isDev||!T,D=T&&!j;P&&_&&(0,o.setManifestsSingleton)({page:y,clientReferenceManifest:_,serverActionsManifest:P});let q=e.method||"GET",z=(0,a.getTracer)(),M=z.getActiveScopeSpan(),U=!!(null==C?void 0:C.isWrappedByNextServer),H=!!(0,i.getRequestMeta)(e,"minimalMode"),L=(0,i.getRequestMeta)(e,"incrementalCache")||await E.getIncrementalCache(e,F,k,H);null==L||L.resetRequestCache(),globalThis.__incrementalCache=L;let K={params:w,previewProps:k.preview,renderOpts:{experimental:{authInterrupts:!!F.experimental.authInterrupts},cacheComponents:!!F.cacheComponents,supportsDynamicResponse:j,incrementalCache:L,cacheLifeProfiles:F.cacheLife,waitUntil:n.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,n,i)=>E.onRequestError(e,t,n,i,C)},sharedContext:{buildId:v}},G=new s.NodeNextRequest(e),Y=new s.NodeNextResponse(t),W=d.NextRequestAdapter.fromNodeNextRequest(G,(0,d.signalFromNodeResponse)(t));try{let i,o=async e=>E.handle(W,K).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=z.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==p.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let n=r.get("next.route");if(n){let t=`${q} ${n}`;e.setAttributes({"next.route":n,"http.route":n,"next.span_name":t}),e.updateName(t),i&&i!==e&&(i.setAttribute("http.route",n),i.updateName(t))}else e.updateName(`${q} ${y}`)}),l=async i=>{var a,l;let s=async({previousCacheEntry:r})=>{try{if(!H&&N&&$&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let a=await o(i);e.fetchMetrics=K.renderOpts.fetchMetrics;let l=K.renderOpts.pendingWaitUntil;l&&n.waitUntil&&(n.waitUntil(l),l=void 0);let s=K.renderOpts.collectedTags;if(!T)return await (0,u.sendResponse)(G,Y,a,K.renderOpts.pendingWaitUntil),null;{let e=await a.blob(),t=(0,g.toNodeOutgoingHttpHeaders)(a.headers);s&&(t[x.NEXT_CACHE_TAGS_HEADER]=s),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=x.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,n=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=x.INFINITE_CACHE?void 0:K.renderOpts.collectedExpire;return{value:{kind:f.CachedRouteKind.APP_ROUTE,status:a.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:n}}}}catch(t){throw(null==r?void 0:r.isStale)&&await E.onRequestError(e,t,{routerKind:"App Router",routePath:y,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:D,isOnDemandRevalidate:N})},!1,C),t}},d=await E.handleResponse({req:e,nextConfig:F,cacheKey:I,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:k,isRoutePPREnabled:!1,isOnDemandRevalidate:N,revalidateOnlyGenerated:$,responseGenerator:s,waitUntil:n.waitUntil,isMinimalMode:H});if(!T)return null;if((null==d||null==(a=d.value)?void 0:a.kind)!==f.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==d||null==(l=d.value)?void 0:l.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});H||t.setHeader("x-nextjs-cache",N?"REVALIDATED":d.isMiss?"MISS":d.isStale?"STALE":"HIT"),R&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let p=(0,g.fromNodeOutgoingHttpHeaders)(d.value.headers);return H&&T||p.delete(x.NEXT_CACHE_TAGS_HEADER),!d.cacheControl||t.getHeader("Cache-Control")||p.get("Cache-Control")||p.set("Cache-Control",(0,h.getCacheControlHeader)(d.cacheControl)),await (0,u.sendResponse)(G,Y,new Response(d.value.body,{headers:p,status:d.value.status||200})),null};U&&M?await l(M):(i=z.getActiveScopeSpan(),await z.withPropagatedContext(e.headers,()=>z.trace(p.BaseServerSpan.handleRequest,{spanName:`${q} ${y}`,kind:a.SpanKind.SERVER,attributes:{"http.method":q,"http.target":e.url}},l),void 0,!U))}catch(t){if(t instanceof m.NoFallbackError||await E.onRequestError(e,t,{routerKind:"App Router",routePath:B,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:D,isOnDemandRevalidate:N})},!1,C),T)throw t;return await (0,u.sendResponse)(G,Y,new Response(null,{status:500})),null}}e.s(["handler",0,R,"patchFetch",0,function(){return(0,n.patchFetch)({workAsyncStorage:w,workUnitAsyncStorage:F})},"routeModule",0,E,"serverHooks",0,A,"workAsyncStorage",0,w,"workUnitAsyncStorage",0,F],510080)}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0km_npj._.js.map