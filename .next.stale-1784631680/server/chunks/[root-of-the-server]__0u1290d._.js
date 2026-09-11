module.exports=[254799,(e,t,r)=>{t.exports=e.x("crypto",()=>require("crypto"))},688947,(e,t,r)=>{t.exports=e.x("stream",()=>require("stream"))},446786,(e,t,r)=>{t.exports=e.x("os",()=>require("os"))},522734,(e,t,r)=>{t.exports=e.x("fs",()=>require("fs"))},193695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},918622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},556704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},832319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},324725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},270406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},659527,e=>{"use strict";var t=e.i(921284);let r=process.env.RESEND_API_KEY,n=process.env.SENSEFOUND_MAIL_FROM||process.env.LAUNCHPAD_MAIL_FROM||"brief@sensefound.io",a=process.env.SENSEFOUND_APP_URL||process.env.LAUNCHPAD_APP_URL||"http://localhost:3000";async function i(e){var i;let o,s,l,p,c=(await (0,t.query)("SELECT email FROM users WHERE id = ?",e.userId))[0],u=c?.email??null;if(!u)return{stubbed:!0,ok:!1,error:"No email on file for user"};let g=(o=(i=e).pendingActions.length>0?`<h3 style="font-size:15px;margin:18px 0 8px 0;color:#16140F;">Pending actions (${i.pendingActions.length})</h3>
       <ul style="padding-left:18px;margin:0;">
         ${i.pendingActions.slice(0,5).map(e=>`<li style="margin-bottom:6px;color:#2A2620;"><strong>${d(e.title)}</strong>${e.rationale?`<br/><span style="color:#6B6558;font-size:13px;">${d(e.rationale)}</span>`:""}</li>`).join("")}
       </ul>`:'<p style="color:#8F897A;">No pending actions this week.</p>',s=i.ecosystemAlerts.length>0?`<h3 style="font-size:15px;margin:18px 0 8px 0;color:#16140F;">Ecosystem alerts</h3>
       <ul style="padding-left:18px;margin:0;">
         ${i.ecosystemAlerts.slice(0,3).map(e=>`<li style="margin-bottom:6px;color:#2A2620;">${d(e.headline)} <span style="color:#8F897A;font-size:12px;">(relevance ${e.relevance_score.toFixed(2)})</span></li>`).join("")}
       </ul>`:"",l=i.heartbeatSummary?`<div style="padding:12px 14px;background:#F5E6DC;border-radius:6px;margin:18px 0;color:#2A2620;font-size:14px;">
         <strong style="color:#16140F;">Daily reflection</strong><br/>${d(i.heartbeatSummary)}
       </div>`:"",p=i.intelligenceBriefs&&i.intelligenceBriefs.length>0?`<h3 style="font-size:15px;margin:18px 0 8px 0;color:#16140F;">Intelligence briefs</h3>
       ${i.intelligenceBriefs.slice(0,2).map(e=>`<div style="padding:10px 12px;background:#E8F0EB;border-radius:6px;margin-bottom:8px;border-left:3px solid #6B9B80;">
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
              <p style="color:#6B6558;margin:0 0 4px 0;font-size:14px;">Here's what matters for <strong style="color:#2A2620;">${d(i.projectName)}</strong> this week.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px;">
              ${l}
              ${p}
              ${o}
              ${s}
              <p style="margin:24px 0 0 0;">
                <a href="${a}/project/${i.projectId}/actions"
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
</html>`);if(!r)return console.log(`[email/stub] Would have sent Monday Brief to ${u} (project=${e.projectName}, pending=${e.pendingActions.length}, alerts=${e.ecosystemAlerts.length}, html=${g.length}b). Set RESEND_API_KEY + SENSEFOUND_MAIL_FROM to flip from stub to real delivery.`),{stubbed:!0,ok:!0,to:u};try{let t=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${r}`,"Content-Type":"application/json"},body:JSON.stringify({from:n,to:u,subject:`Your Monday Brief — ${e.projectName}`,html:g})});if(!t.ok)return{stubbed:!1,ok:!1,error:`Resend HTTP ${t.status}`,to:u};let a=await t.json();return{stubbed:!1,ok:!0,id:a.id,to:u}}catch(e){return{stubbed:!1,ok:!1,error:e.message,to:u}}}let o={en:{subject:"Your Magic Link",heading:"Your Magic Link",body:"Click the button below to securely sign in to your workspace. This link expires in 10 minutes and can only be used once.",cta:"Log In",security:"If you didn’t request this link, you can safely ignore this email.",tagline:"Courage through clarity",subtitle:"AI-powered, human-protected"},it:{subject:"Il tuo Magic Link",heading:"Il tuo Magic Link",body:"Clicca il pulsante qui sotto per accedere in modo sicuro al tuo workspace. Questo link scade tra 10 minuti e può essere usato una sola volta.",cta:"Accedi",security:"Se non hai richiesto questo link, puoi ignorare questa email.",tagline:"Coraggio attraverso la chiarezza",subtitle:"Potenziato dall’AI, protetto dall’uomo"}};function s(e){let t=(e||"en").slice(0,2).toLowerCase();return t in o?t:"en"}async function l(e,t,a){let i,l,p=(i=o[s(a)],l=s(a),`<!DOCTYPE html>
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
          <tr><td align="center" style="padding:28px 40px 0 40px;"><h1 style="margin:0;font-size:22px;font-weight:600;color:#16140F;">${d(i.heading)}</h1></td></tr>
          <tr><td align="center" style="padding:12px 40px 0 40px;"><p style="margin:0;font-size:15px;line-height:1.6;color:#6B6558;">${d(i.body)}</p></td></tr>
          <tr>
            <td align="center" style="padding:28px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#6B9B80;border-radius:6px;">
                    <a href="${d(t)}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;font-family:Inter,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">${d(i.cta)} &#8599;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td align="center" style="padding:24px 40px 0 40px;"><p style="margin:0;font-size:13px;line-height:1.5;color:#8F897A;">${d(i.security)}</p></td></tr>
          <tr>
            <td style="padding:28px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #E5DFCF;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr><td align="center" style="padding:16px 40px 32px 40px;"><p style="margin:0;font-size:12px;line-height:1.5;color:#B4AE9F;">${d(i.tagline)} &middot; ${d(i.subtitle)}</p></td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`),c=o[s(a)].subject;if(!r)return console.log(`[email/stub] Would have sent magic link to ${e} (locale=${a||"en"}, html=${p.length}b). Set RESEND_API_KEY + SENSEFOUND_MAIL_FROM to enable.`),{stubbed:!0,ok:!0,to:e};try{let t=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${r}`,"Content-Type":"application/json"},body:JSON.stringify({from:n,to:e,subject:c,html:p})});if(!t.ok)return{stubbed:!1,ok:!1,error:`Resend HTTP ${t.status}`,to:e};let a=await t.json();return{stubbed:!1,ok:!0,id:a.id,to:e}}catch(t){return{stubbed:!1,ok:!1,error:t.message,to:e}}}function d(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}e.s(["sendBrief",0,i,"sendMagicLink",0,l])},729550,e=>{"use strict";var t=e.i(505826),r=e.i(937401),n=e.i(46496),a=e.i(150723),i=e.i(179406),o=e.i(276150),s=e.i(286892),l=e.i(426211),d=e.i(702676),p=e.i(605413),c=e.i(408638),u=e.i(803883),g=e.i(411421),h=e.i(246435),x=e.i(557645),m=e.i(193695);e.i(111714);var f=e.i(80447),y=e.i(284204),b=e.i(659527),v=e.i(254799);let E=process.env.SUPABASE_AUTH_HOOK_SECRET;async function w(e){let t,r=await e.text();if(E&&!function(e,t){if(!E||!t)return!1;let r=(0,v.createHmac)("sha256",E).update(e).digest("hex");try{return(0,v.timingSafeEqual)(Buffer.from(r),Buffer.from(t))}catch{return!1}}(r,e.headers.get("x-supabase-signature")))return y.NextResponse.json({error:"Invalid signature"},{status:401});try{t=JSON.parse(r)}catch{return y.NextResponse.json({error:"Invalid JSON"},{status:400})}let{user:n,email_data:a}=t;if("magic_link"!==a.email_action_type)return y.NextResponse.json({error:"Unhandled email type"},{status:422});let i=`${a.site_url}/api/auth/callback?token_hash=${a.token_hash}&type=magiclink&next=${encodeURIComponent(a.redirect_to||"/")}`,o=n.user_metadata?.locale,s=await (0,b.sendMagicLink)(n.email,i,o);return s.ok?y.NextResponse.json({success:!0}):(console.error("[auth-hook/send-email] Failed:",s.error),y.NextResponse.json({error:s.error},{status:500}))}e.s(["POST",0,w],365100);var R=e.i(365100);let F=new t.AppRouteRouteModule({definition:{kind:r.RouteKind.APP_ROUTE,page:"/api/auth/hook/send-email/route",pathname:"/api/auth/hook/send-email",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/tech-bricks/LaunchPad-v2/src/app/api/auth/hook/send-email/route.ts",nextConfigOutput:"standalone",userland:R}),{workAsyncStorage:A,workUnitAsyncStorage:k,serverHooks:N}=F;async function C(e,t,n){n.requestMeta&&(0,a.setRequestMeta)(e,n.requestMeta),F.isDev&&(0,a.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let y="/api/auth/hook/send-email/route";y=y.replace(/\/index$/,"")||"/";let b=await F.prepare(e,t,{srcPage:y,multiZoneDraftMode:!1});if(!b)return t.statusCode=400,t.end("Bad Request"),null==n.waitUntil||n.waitUntil.call(n,Promise.resolve()),null;let{buildId:v,params:E,nextConfig:w,parsedUrl:R,isDraftMode:A,prerenderManifest:k,routerServerContext:N,isOnDemandRevalidate:C,revalidateOnlyGenerated:S,resolvedPathname:$,clientReferenceManifest:_,serverActionsManifest:P}=b,B=(0,s.normalizeAppPath)(y),O=!!(k.dynamicRoutes[B]||k.routes[$]),T=async()=>((null==N?void 0:N.render404)?await N.render404(e,t,R,!1):t.end("This page could not be found"),null);if(O&&!A){let e=!!k.routes[$],t=k.dynamicRoutes[B];if(t&&!1===t.fallback&&!e){if(w.adapterPath)return await T();throw new m.NoFallbackError}}let I=null;!O||F.isDev||A||(I="/index"===(I=$)?"/":I);let j=!0===F.isDev||!O,q=O&&!j;P&&_&&(0,o.setManifestsSingleton)({page:y,clientReferenceManifest:_,serverActionsManifest:P});let D=e.method||"GET",z=(0,i.getTracer)(),M=z.getActiveScopeSpan(),U=!!(null==N?void 0:N.isWrappedByNextServer),H=!!(0,a.getRequestMeta)(e,"minimalMode"),L=(0,a.getRequestMeta)(e,"incrementalCache")||await F.getIncrementalCache(e,w,k,H);null==L||L.resetRequestCache(),globalThis.__incrementalCache=L;let K={params:E,previewProps:k.preview,renderOpts:{experimental:{authInterrupts:!!w.experimental.authInterrupts},cacheComponents:!!w.cacheComponents,supportsDynamicResponse:j,incrementalCache:L,cacheLifeProfiles:w.cacheLife,waitUntil:n.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,r,n,a)=>F.onRequestError(e,t,n,a,N)},sharedContext:{buildId:v}},Y=new l.NodeNextRequest(e),G=new l.NodeNextResponse(t),W=d.NextRequestAdapter.fromNodeNextRequest(Y,(0,d.signalFromNodeResponse)(t));try{let a,o=async e=>F.handle(W,K).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let r=z.getRootSpanAttributes();if(!r)return;if(r.get("next.span_type")!==p.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${r.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let n=r.get("next.route");if(n){let t=`${D} ${n}`;e.setAttributes({"next.route":n,"http.route":n,"next.span_name":t}),e.updateName(t),a&&a!==e&&(a.setAttribute("http.route",n),a.updateName(t))}else e.updateName(`${D} ${y}`)}),s=async a=>{var i,s;let l=async({previousCacheEntry:r})=>{try{if(!H&&C&&S&&!r)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let i=await o(a);e.fetchMetrics=K.renderOpts.fetchMetrics;let s=K.renderOpts.pendingWaitUntil;s&&n.waitUntil&&(n.waitUntil(s),s=void 0);let l=K.renderOpts.collectedTags;if(!O)return await (0,u.sendResponse)(Y,G,i,K.renderOpts.pendingWaitUntil),null;{let e=await i.blob(),t=(0,g.toNodeOutgoingHttpHeaders)(i.headers);l&&(t[x.NEXT_CACHE_TAGS_HEADER]=l),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let r=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=x.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,n=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=x.INFINITE_CACHE?void 0:K.renderOpts.collectedExpire;return{value:{kind:f.CachedRouteKind.APP_ROUTE,status:i.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:r,expire:n}}}}catch(t){throw(null==r?void 0:r.isStale)&&await F.onRequestError(e,t,{routerKind:"App Router",routePath:y,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:q,isOnDemandRevalidate:C})},!1,N),t}},d=await F.handleResponse({req:e,nextConfig:w,cacheKey:I,routeKind:r.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:k,isRoutePPREnabled:!1,isOnDemandRevalidate:C,revalidateOnlyGenerated:S,responseGenerator:l,waitUntil:n.waitUntil,isMinimalMode:H});if(!O)return null;if((null==d||null==(i=d.value)?void 0:i.kind)!==f.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==d||null==(s=d.value)?void 0:s.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});H||t.setHeader("x-nextjs-cache",C?"REVALIDATED":d.isMiss?"MISS":d.isStale?"STALE":"HIT"),A&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let p=(0,g.fromNodeOutgoingHttpHeaders)(d.value.headers);return H&&O||p.delete(x.NEXT_CACHE_TAGS_HEADER),!d.cacheControl||t.getHeader("Cache-Control")||p.get("Cache-Control")||p.set("Cache-Control",(0,h.getCacheControlHeader)(d.cacheControl)),await (0,u.sendResponse)(Y,G,new Response(d.value.body,{headers:p,status:d.value.status||200})),null};U&&M?await s(M):(a=z.getActiveScopeSpan(),await z.withPropagatedContext(e.headers,()=>z.trace(p.BaseServerSpan.handleRequest,{spanName:`${D} ${y}`,kind:i.SpanKind.SERVER,attributes:{"http.method":D,"http.target":e.url}},s),void 0,!U))}catch(t){if(t instanceof m.NoFallbackError||await F.onRequestError(e,t,{routerKind:"App Router",routePath:B,routeType:"route",revalidateReason:(0,c.getRevalidateReason)({isStaticGeneration:q,isOnDemandRevalidate:C})},!1,N),O)throw t;return await (0,u.sendResponse)(Y,G,new Response(null,{status:500})),null}}e.s(["handler",0,C,"patchFetch",0,function(){return(0,n.patchFetch)({workAsyncStorage:A,workUnitAsyncStorage:k})},"routeModule",0,F,"serverHooks",0,N,"workAsyncStorage",0,A,"workUnitAsyncStorage",0,k],729550)}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0u1290d._.js.map