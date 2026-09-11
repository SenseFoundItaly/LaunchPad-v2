module.exports=[850670,e=>{"use strict";var t=e.i(921284),a=e.i(520378);async function i(e){let i=(0,a.generateId)("slog");return await (0,t.run)(`INSERT INTO signal_activity_logs
       (id, project_id, event_type, entity_id, entity_type, headline, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,i,e.project_id,e.event_type,e.entity_id??null,e.entity_type??null,e.headline,e.metadata??{}),i}e.s(["logSignalActivity",0,i])},179401,e=>{"use strict";var t=e.i(921284),a=e.i(850670);async function i(i,n){try{var r,o;let d=await (0,t.get)(`SELECT ea.reviewed_state, ea.relevance_score, ea.entity,
              gn.id AS node_id, gn.reviewed_state AS node_state
         FROM ecosystem_alerts ea
         LEFT JOIN graph_nodes gn
           ON gn.project_id = ea.project_id AND LOWER(gn.name) = LOWER(ea.entity)
        WHERE ea.id = ?`,n);if(!d)return"inbox";if(d.reviewed_state&&"pending"!==d.reviewed_state)return"accepted"===d.reviewed_state?"enrich":"drop";let s=(r={relevance_score:d.relevance_score,entity:d.entity},o=d.node_id?{id:d.node_id,reviewed_state:d.node_state}:null,r.relevance_score<.5?{verdict:"drop",reason:`relevance ${r.relevance_score.toFixed(2)} below 0.5 floor`}:r.entity&&r.entity.trim()?o&&"rejected"===o.reviewed_state?{verdict:"drop",reason:`entity "${r.entity}" was rejected by the founder (tombstone)`}:o&&"pending"===o.reviewed_state?{verdict:"inbox",reason:`entity "${r.entity}" matches a PENDING proposal — founder review first`}:o?{verdict:"enrich",reason:`entity "${r.entity}" matches existing node`,nodeId:o.id}:r.relevance_score>=.8?{verdict:"new_entity",reason:`new entity "${r.entity}" at relevance ${r.relevance_score.toFixed(2)}`}:{verdict:"inbox",reason:"new entity below 0.8 auto-create bar — needs human review"}:{verdict:"inbox",reason:"no resolvable entity — needs human attribution"});if("drop"===s.verdict){let{run:t}=await e.A(45310);return await t(`UPDATE ecosystem_alerts
            SET reviewed_state = 'auto_dropped',
                reviewed_at = CURRENT_TIMESTAMP,
                founder_action_taken = 'autoflow'
          WHERE id = ? AND (reviewed_state IS NULL OR reviewed_state = 'pending')`,n),(0,a.logSignalActivity)({project_id:i,event_type:"signal_auto_dropped",entity_id:n,entity_type:"ecosystem_alert",headline:`Autoflow dropped: ${s.reason}`,metadata:{reason:s.reason}}).catch(()=>{}),"drop"}if("enrich"===s.verdict||"new_entity"===s.verdict){let{acceptAlertIntoKnowledge:t}=await e.A(552384),r=await t({project_id:i,ecosystem_alert_id:n},{founderAction:"autoflow"});if(!r){let{run:t}=await e.A(45310);return await t(`UPDATE ecosystem_alerts
              SET reviewed_state = 'pending', reviewed_at = NULL, founder_action_taken = NULL
            WHERE id = ? AND reviewed_state = 'accepted' AND graph_node_id IS NULL`,n),"inbox"}return(0,a.logSignalActivity)({project_id:i,event_type:"signal_autoflowed",entity_id:n,entity_type:"ecosystem_alert",headline:`Autoflow ${"enrich"===s.verdict?"enriched":"created"} knowledge: ${s.reason}`,metadata:{verdict:s.verdict,reason:s.reason,graph_node_id:r}}).catch(()=>{}),s.verdict}return"inbox"}catch(e){return console.warn("[signal-autoflow] routing failed, falling back to inbox:",e.message),"inbox"}}e.s(["isAutoflowEnabled",0,function(){return"1"===process.env.SIGNAL_AUTOFLOW},"routeAlertAutoflow",0,i])},932037,e=>{"use strict";let t={task:"todo",skill_rerun_result:"notification",configure_monitor:"approval",edit_monitor:"approval",delete_monitor:"approval",configure_budget:"approval",configure_watch_source:"approval",run_skill:"approval",validation_proposal:"approval",propose_assumption_revision:"approval",workflow_step:"approval",draft_email:"approval",draft_linkedin_post:"approval",draft_linkedin_dm:"approval",proposed_hypothesis:"approval",proposed_interview_question:"approval",proposed_landing_copy:"approval",proposed_investor_followup:"approval",proposed_graph_update:"approval",signal_alert:"signal",intelligence_brief:"approval",assumption_review:"approval"},a=[...new Set(["signal_alert","intelligence_brief"]),"configure_monitor","configure_watch_source"];e.s(["SURFACED_ACTION_TYPES",0,a,"typesForLane",0,function(e){return Object.keys(t).filter(a=>t[a]===e)}])},703072,e=>{"use strict";var t=e.i(921284),a=e.i(520378),i=e.i(179401),n=e.i(932037);function r(e){return{id:e.id,project_id:e.project_id,monitor_run_id:e.monitor_run_id,ecosystem_alert_id:e.ecosystem_alert_id,action_type:e.action_type,title:e.title,rationale:e.rationale,payload:e.payload||{},estimated_impact:e.estimated_impact,status:e.status,edited_payload:e.edited_payload,execution_target:e.execution_target,executed_at:e.executed_at,execution_result:e.execution_result,created_at:e.created_at,updated_at:e.updated_at}}let o={pending:["applied","edited","rejected"],edited:["applied","edited","rejected"],applied:["sent","failed"],rejected:[],sent:[],failed:["applied"]};async function d(e){let i=(0,a.generateId)("pa"),n=new Date().toISOString(),r=Array.isArray(e.sources)&&e.sources.length>0?e.sources:null;await (0,t.run)(`INSERT INTO pending_actions
       (id, project_id, monitor_run_id, ecosystem_alert_id, action_type, title, rationale,
        payload, estimated_impact, status, execution_target, sources, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,i,e.project_id,e.monitor_run_id||null,e.ecosystem_alert_id||null,e.action_type,e.title,e.rationale||null,e.payload,e.estimated_impact||null,e.execution_target||null,r,e.priority||null,n,n);let o=await s(i);if(!o)throw Error(`Failed to read back pending action ${i} after write`);return o}async function s(e){let a=await (0,t.query)("SELECT * FROM pending_actions WHERE id = ?",e);return a[0]?r(a[0]):null}async function c(e){if(!1!==e.materialize)try{await p(e.project_id)}catch(e){console.warn("[listPendingActions] materialize skipped:",e.message)}let a=e.status?Array.isArray(e.status)?e.status:[e.status]:null,i="SELECT * FROM pending_actions WHERE project_id = ?",n=[e.project_id];return a&&(i+=` AND status IN (${a.map(()=>"?").join(",")})`,n.push(...a)),i+=" ORDER BY CASE WHEN status IN ('pending', 'edited') THEN 0 ELSE 1 END, created_at DESC",e.limit&&(i+=` LIMIT ${Math.max(1,Math.min(500,e.limit))}`),(await (0,t.query)(i,...n)).map(r)}async function p(e){for(let n of(await (0,t.query)(`SELECT ea.id, ea.alert_type, ea.headline, ea.body, ea.relevance_score,
            ea.source, ea.source_url
       FROM ecosystem_alerts ea
      WHERE ea.project_id = ?
        AND (ea.reviewed_state IS NULL OR ea.reviewed_state = 'pending')
        AND NOT EXISTS (
          SELECT 1 FROM pending_actions pa WHERE pa.ecosystem_alert_id = ea.id
        )`,e))){if((0,i.isAutoflowEnabled)()&&"inbox"!==await (0,i.routeAlertAutoflow)(e,n.id))continue;let r=(0,a.generateId)("pa"),o=new Date().toISOString(),d=n.relevance_score>=.85?"critical":n.relevance_score>=.7?"high":n.relevance_score>=.5?"medium":"low",s={alert_type:n.alert_type,source:n.source,source_url:n.source_url,body:n.body,relevance_score:n.relevance_score},c=n.source_url?[{type:"web",title:n.source,url:n.source_url}]:null;await (0,t.run)(`INSERT INTO pending_actions
         (id, project_id, ecosystem_alert_id, action_type, title, rationale,
          payload, status, priority, sources, created_at, updated_at)
       VALUES (?, ?, ?, 'signal_alert', ?, ?, ?, 'pending', ?, ?, ?, ?)
       ON CONFLICT (ecosystem_alert_id) WHERE ecosystem_alert_id IS NOT NULL
       DO NOTHING`,r,e,n.id,n.headline,n.body?.slice(0,500)??null,s,d,c,o,o)}for(let i of(await (0,t.query)(`SELECT ib.id, ib.entity_name, ib.title, ib.narrative,
            ib.temporal_prediction, ib.confidence,
            ib.recommended_actions, ib.signal_count
       FROM intelligence_briefs ib
      WHERE ib.project_id = ?
        AND (ib.status IS NULL OR ib.status = 'active')
        AND NOT EXISTS (
          SELECT 1 FROM pending_actions pa
           WHERE pa.project_id = ib.project_id
             AND pa.action_type = 'intelligence_brief'
             AND (pa.payload->>'brief_id') = ib.id
        )`,e))){let n=(0,a.generateId)("pa"),r=new Date().toISOString(),o=i.confidence??0,d=o>=.85?"high":o>=.65?"medium":"low",s={brief_id:i.id,entity:i.entity_name,narrative:i.narrative,prediction:i.temporal_prediction,confidence:o,signal_count:i.signal_count,recommended_actions:i.recommended_actions};await (0,t.run)(`INSERT INTO pending_actions
         (id, project_id, action_type, title, rationale, payload, status,
          priority, created_at, updated_at)
       VALUES (?, ?, 'intelligence_brief', ?, ?, ?, 'pending', ?, ?, ?)`,n,e,i.title,i.narrative?.slice(0,500)??null,s,d,r,r)}try{for(let i of(await (0,t.query)(`SELECT a.id, a.number, a.category, a.text, a.criticality
         FROM assumptions a
        WHERE a.project_id = ?
          AND a.status = 'open'
          AND NOT EXISTS (
            SELECT 1 FROM pending_actions pa
             WHERE pa.project_id = a.project_id
               AND pa.action_type = 'assumption_review'
               AND (pa.payload->>'assumption_id') = a.id
          )`,e))){let n=(0,a.generateId)("pa"),r=new Date().toISOString(),o="high"===i.criticality?"high":"medium"===i.criticality?"medium":"low",d={assumption_id:i.id,number:i.number,category:i.category};await (0,t.run)(`INSERT INTO pending_actions
           (id, project_id, action_type, title, rationale, payload, status,
            priority, created_at, updated_at)
         VALUES (?, ?, 'assumption_review', ?, ?, ?, 'pending', ?, ?, ?)`,n,e,`#${i.number} (${i.category}) — ${i.text.slice(0,90)}`,i.text,d,o,r,r)}}catch(t){let e=t.message;/assumptions.*does not exist/i.test(e)||console.warn("[materialize] assumption_review skipped:",e)}try{for(let i of(await (0,t.query)(`SELECT gn.id, gn.name, gn.node_type, gn.summary
         FROM graph_nodes gn
        WHERE gn.project_id = ?
          AND gn.reviewed_state = 'pending'
          AND gn.sources::text NOT LIKE '%Extracted from %'
          -- Competitors (item 14): reviewed in the Knowledge graph + the textual
          -- Competitors matryoshka, NOT the Inbox — which stays for watcher
          -- findings + to-dos. (competitor_set is the summary node; same rule.)
          AND gn.node_type NOT IN ('competitor', 'competitor_set')
          AND NOT EXISTS (
            SELECT 1 FROM pending_actions pa
             WHERE pa.project_id = gn.project_id
               AND pa.action_type = 'proposed_graph_update'
               AND (pa.payload->'knowledge_source'->>'id') = gn.id
          )`,e))){let n=(0,a.generateId)("pa"),r=new Date().toISOString(),o={knowledge_source:{table:"graph_nodes",id:i.id},node_type:i.node_type};await (0,t.run)(`INSERT INTO pending_actions
           (id, project_id, action_type, title, rationale, payload, status,
            estimated_impact, priority, created_at, updated_at)
         VALUES (?, ?, 'proposed_graph_update', ?, ?, ?, 'pending', 'medium', 'medium', ?, ?)`,n,e,i.name?.slice(0,120)||"Knowledge proposal",(i.summary??"").slice(0,500)||null,o,r,r)}for(let i of(await (0,t.query)(`SELECT mf.id, mf.fact
         FROM memory_facts mf
        WHERE mf.project_id = ?
          AND mf.reviewed_state = 'pending'
          AND mf.source_type = 'chat'
          AND NOT EXISTS (
            SELECT 1 FROM pending_actions pa
             WHERE pa.project_id = mf.project_id
               AND pa.action_type = 'proposed_graph_update'
               AND (pa.payload->'knowledge_source'->>'id') = mf.id
          )`,e))){let n=(0,a.generateId)("pa"),r=new Date().toISOString(),o={knowledge_source:{table:"memory_facts",id:i.id}};await (0,t.run)(`INSERT INTO pending_actions
           (id, project_id, action_type, title, rationale, payload, status,
            estimated_impact, priority, created_at, updated_at)
         VALUES (?, ?, 'proposed_graph_update', ?, ?, ?, 'pending', 'medium', 'medium', ?, ?)`,n,e,i.fact.slice(0,120),i.fact.slice(0,500),o,r,r)}}catch(e){console.warn("[materialize] chat-knowledge proposals skipped:",e.message)}}class l extends Error{constructor(e,t){super(`Invalid transition: ${e} -> ${t}`),this.name="InvalidTransitionError"}}async function _(e,a,i=[]){var n;let r=await s(e);if(!r)throw Error(`Pending action not found: ${e}`);if(n=r.status,!o[n]?.includes(a))throw new l(r.status,a);let d=new Date().toISOString(),c=["status = ?","updated_at = ?",...i.map(e=>`${e.key} = ?`)],p=[a,d,...i.map(e=>e.value),e,r.status];if(((await (0,t.run)(`UPDATE pending_actions SET ${c.join(", ")} WHERE id = ? AND status = ?`,...p)).count??0)===0){let t=await s(e);throw new l(t?.status??r.status,a)}let u=await s(e);if(!u)throw Error(`Failed to read back pending action ${e} after write`);return u}async function u(e){return _(e,"applied")}async function y(e,t){return _(e,"edited",[{key:"edited_payload",value:t}])}async function g(e,a,i={}){let n=["payload = ?","updated_at = ?"],r=[a,new Date().toISOString()];return i.title&&(n.push("title = ?"),r.push(i.title)),i.rationale&&(n.push("rationale = ?"),r.push(i.rationale)),((await (0,t.run)(`UPDATE pending_actions SET ${n.join(", ")} WHERE id = ? AND status = 'pending'`,...r,e)).count??0)>0}async function m(e,t){let a=[];return t&&a.push({key:"execution_result",value:{rejected_reason:t}}),_(e,"rejected",a)}async function E(e,t){return _(e,"sent",[{key:"execution_result",value:t},{key:"executed_at",value:new Date().toISOString()}])}async function w(e,t){return _(e,"failed",[{key:"execution_result",value:{error:t}},{key:"executed_at",value:new Date().toISOString()}])}async function v(e){let a=new Date(Date.now()-6048e5).toISOString(),i=n.SURFACED_ACTION_TYPES.map(()=>"?").join(","),r=await (0,t.query)(`SELECT status, COUNT(*) as c FROM pending_actions
     WHERE project_id = ? AND action_type IN (${i})
     GROUP BY status`,e,...n.SURFACED_ACTION_TYPES),o={};for(let e of r)o[e.status]=e.c;let d=await (0,t.query)(`SELECT status, COUNT(*) as c FROM pending_actions
     WHERE project_id = ? AND action_type IN (${i})
       AND updated_at >= ? AND status IN ('sent', 'rejected')
     GROUP BY status`,e,...n.SURFACED_ACTION_TYPES,a),s={};for(let e of d)s[e.status]=e.c;return{pending:o.pending||0,edited:o.edited||0,applied_awaiting_send:o.applied||0,sent_last_7d:s.sent||0,rejected_last_7d:s.rejected||0}}e.s(["InvalidTransitionError",0,l,"applyPendingAction",0,u,"createPendingAction",0,d,"editPendingAction",0,y,"getPendingAction",0,s,"inboxSummary",0,v,"listPendingActions",0,c,"markActionFailed",0,w,"markActionSent",0,E,"rejectPendingAction",0,m,"updateOpenProposalPayload",0,g])}];

//# sourceMappingURL=tech-bricks_LaunchPad-v2_src_lib_0c_d7i~._.js.map