import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadStore, updateStore, appendAudit, saveStore } from './lib/store.js';
import { jiraConfigured, testJira, listBoards, listSprints, boardIssues, projectIssues, createIssue, findPlanIssue } from './lib/jira.js';
import { modelHealth, modelSettings } from './lib/model.js';
import { runPlanningGraph, runPublisherGraph, runTrackingGraph } from './lib/graph.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const mime = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml' };
const maxBody = 1024 * 1024;

function send(res,status,payload,headers={}) { res.writeHead(status,{ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers });res.end(JSON.stringify(payload)); }
function safeSettings(settings) {
  const model=modelSettings(settings);
  return { ...settings, modelProvider:model.provider, modelBaseUrl:model.baseUrl, modelName:model.model, jiraConfigured:jiraConfigured(), jiraBaseUrl:process.env.JIRA_BASE_URL||'', jiraEmailConfigured:Boolean(process.env.JIRA_EMAIL), jiraTokenConfigured:Boolean(process.env.JIRA_API_TOKEN) };
}
async function readBody(req) {
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>maxBody)throw Object.assign(new Error('Request body is too large.'),{status:413});chunks.push(chunk);}
  if(!chunks.length)return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Request body must be valid JSON.'),{status:400});}
}
function inferJiraSkills(issues) {
  const counts=new Map();
  for(const issue of issues){const labels=[...(issue.fields?.labels||[]),...(issue.fields?.components||[]).map(c=>c.name),issue.fields?.issuetype?.name].filter(Boolean);
    for(const label of labels){const clean=String(label).trim();if(clean.length<2||clean.length>32)continue;const key=clean.toLowerCase();const old=counts.get(key)||{name:clean,count:0};old.count++;counts.set(key,old);}}
  return [...counts.values()].sort((a,b)=>b.count-a.count).slice(0,8).map(s=>({name:s.name,source:'jira-history',confidence:Math.min(.9,.35+s.count*.08),observedIssues:s.count}));
}
function publicMember(member){return {...member,accountId:member.accountId||'',jiraHistory:(member.jiraHistory||[]).slice(0,30)};}
function currentPlanGate(plan,team,settings){
  const obsolete=f=>/^qa-(missing|owner)-/.test(f.id||'')||/^release-(impact-missing|owner)-/.test(f.id||'')||f.id==='ui-qa-journey-missing';
  const findings=(plan.findings||[]).filter(f=>!obsolete(f));
  const items=plan.selectedItems||[];
  const ui=/\bui redesign\b|\bui\b.{0,20}improv|improv.{0,20}\bui\b|user interface.{0,20}(design|redesign|improve|implement|build)|redesign.{0,25}(ui|interface|screen)|front.?end.{0,25}(implement|build|deliver)|implement.{0,25}(ui|interface|screen)|build.{0,25}(ui|interface|screen)/i.test(String(plan.goal||''));
  const qa=items.find(item=>item.id==='qa-e2e'||/comprehensive.{0,30}(end[- ]to[- ]end|qa|test)|end[- ]to[- ]end.{0,30}(qa|test|verification)|full.{0,25}journey.{0,20}(qa|test)/i.test(`${item.summary||''} ${item.description||''}`));
  const release=items.find(item=>item.id==='release-plan'||/sprint[- ]level release readiness|release readiness plan|release plan/i.test(`${item.summary||''} ${item.description||''}`));
  const ownerRole=item=>team.find(member=>member.id===item?.assignee?.id)?.role||item?.assignee?.role||'';
  if(!qa)findings.push({id:'qa-e2e-missing',severity:'blocker',category:'quality',summary:'The plan needs one comprehensive, goal-level end-to-end QA task.',action:'Add one QA task covering the complete goal, integrations, relevant accessibility and responsive checks, regression, and pass/fail evidence.'});
  else if(!/qa|quality assurance|test engineer/i.test(ownerRole(qa)))findings.push({id:'qa-e2e-owner',severity:'blocker',category:'quality',itemId:qa.id,summary:'The end-to-end QA task needs a confirmed QA Engineer owner.',action:'Assign the goal-level verification task to an available QA Engineer.'});
  if(!release)findings.push({id:'release-plan-missing',severity:'blocker',category:'release',summary:'The sprint-level release readiness plan is missing.',action:'Include one goal-level Release Manager readiness and rollout task.'});
  else if(!/release manager/i.test(ownerRole(release)))findings.push({id:'release-plan-owner',severity:'blocker',category:'release',itemId:release.id,summary:'The sprint-level release plan has no confirmed Release Manager owner.',action:'Assign the release readiness plan to the configured Release Manager.'});
  if(ui){
    const hasRoleTask=(pattern,role)=>items.some(item=>pattern.test(`${item.summary||''} ${item.description||''}`)&&new RegExp(role,'i').test(ownerRole(item)));
    if(!hasRoleTask(/front.?end|design.*(ui|interface|screen)|redesign|implement.*(ui|interface|screen)/,'front.?end engineer'))findings.push({id:'ui-frontend-missing',severity:'blocker',category:'assignment',summary:'A Frontend Engineer task to design and implement the new UI is missing.',action:'Include and assign the UI design and frontend delivery task.'});
    if(!hasRoleTask(/compatib|api|service|data contract|backward compat/i,'back.?end engineer'))findings.push({id:'ui-backend-missing',severity:'blocker',category:'assignment',summary:'A Backend Engineer compatibility review for the new UI is missing.',action:'Include and assign an API, service, or data compatibility task.'});
  }
  return findings;
}
async function requireJiraBoard(settings){
  if(!jiraConfigured())throw Object.assign(new Error('Configure JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in .env, then restart NovaSprint.'),{status:503});
  if(!settings.projectKey||!settings.boardId)throw Object.assign(new Error('Connect Jira, enter a project key, load its boards, and select a board before planning.'),{status:503});
  try{
    await testJira();
    const boards=await listBoards(settings.projectKey);
    if(!boards.some(board=>String(board.id)===String(settings.boardId)))throw new Error('The selected Jira board is not available for this project or account. Reload the board list in Integrations.');
  }catch(error){throw Object.assign(new Error(`Jira connection check failed: ${error.message}`),{status:503});}
}
async function requirePlanningConnections(settings,team){
  const model=await modelHealth(settings);
  if(!model.connected||!model.model||model.error)throw Object.assign(new Error(model.error||'Configure a model provider and model before planning.'),{status:503});
  await requireJiraBoard(settings);
  if(!team?.length||team.some(member=>!Array.isArray(member.skills)||!member.skills.length||member.profileStatus!=='confirmed'))throw Object.assign(new Error('Complete the selected teammate profiles with confirmed skills before planning.'),{status:503});
}

async function api(req,res,url) {
  const pathname=url.pathname;
  if(req.method==='GET'&&pathname==='/api/status'){
    const data=loadStore();const model=await modelHealth(data.settings);
    const modelReady=Boolean(model.connected&&model.model&&!model.error);
    const jira={configured:jiraConfigured(),connected:false,baseUrl:process.env.JIRA_BASE_URL||'',emailConfigured:Boolean(process.env.JIRA_EMAIL),tokenConfigured:Boolean(process.env.JIRA_API_TOKEN),projectSelected:Boolean(data.settings.projectKey),boardSelected:Boolean(data.settings.boardId),error:null};
    if(jira.configured){try{await testJira();jira.connected=true;if(jira.projectSelected){const boards=await listBoards(data.settings.projectKey);if(jira.boardSelected&&!boards.some(board=>String(board.id)===String(data.settings.boardId)))jira.error='Selected board is not available for this Jira project.';else if(!jira.boardSelected)jira.error='Choose a board.';}else jira.error='Choose a Jira project.';}catch(error){jira.error=error.message;}}
    const jiraReady=jira.connected&&jira.projectSelected&&jira.boardSelected;
    const activeTeam=data.team.filter(member=>data.settings.teamMembers.includes(member.id));
    const teamReady=Boolean(activeTeam.length&&activeTeam.every(member=>member.profileStatus==='confirmed'&&Array.isArray(member.skills)&&member.skills.length));
    const teamSetupMissing=activeTeam.filter(member=>member.profileStatus!=='confirmed'||!member.skills?.length).map(member=>member.name);
    return send(res,200,{workspace:data.settings.workspaceName,mode:modelReady?model.provider:'unavailable',model,jira,teamReady,teamSetupMissing,ready:modelReady&&jiraReady&&teamReady,publicationPolicy:data.settings.publicationPolicy,teamCount:activeTeam.length});
  }
  if(req.method==='GET'&&pathname==='/api/settings')return send(res,200,{settings:safeSettings(loadStore().settings)});
  if(req.method==='PUT'&&pathname==='/api/settings'){
    const body=await readBody(req);const allowed=['workspaceName','teamName','projectKey','boardId','sprintId','sprintCadenceDays','publicationPolicy','assignmentPolicy','teamMembers','ollamaBaseUrl','ollamaModel','velocityBaseline'];
    const policy=['draft','approval','auto'].includes(body.publicationPolicy)?body.publicationPolicy:null;
    if(body.publicationPolicy&&!policy)return send(res,400,{error:'Publication policy must be draft, approval, or auto.'});
    if(body.ollamaBaseUrl&&!/^https?:\/\//i.test(body.ollamaBaseUrl))return send(res,400,{error:'Ollama URL must start with http:// or https://.'});
    const saved=updateStore(data=>{for(const key of allowed)if(body[key]!==undefined){if(key==='teamMembers'&&Array.isArray(body[key]))data.settings[key]=body[key].filter(id=>data.team.some(m=>m.id===id));else if(key==='sprintCadenceDays')data.settings[key]=Math.max(1,Math.min(60,Number(body[key])||14));else if(key==='projectKey'||key==='boardId'||key==='sprintId')data.settings[key]=String(body[key]).trim().slice(0,100);else if(key==='ollamaBaseUrl')data.settings[key]=String(body[key]).trim().replace(/\/+$/,'');else if(key==='ollamaModel')data.settings[key]=String(body[key]).trim().slice(0,100);else if(key==='publicationPolicy')data.settings[key]=policy;else if(key==='assignmentPolicy')data.settings[key]=['recommend','self-select'].includes(body[key])?body[key]:'recommend';else if(key==='velocityBaseline')data.settings[key]=body[key];else data.settings[key]=String(body[key]).trim().slice(0,100);}appendAudit(data,'settings.updated',{fields:Object.keys(body).filter(k=>allowed.includes(k))});return safeSettings(data.settings);});
    return send(res,200,{settings:saved});
  }
  if(req.method==='GET'&&pathname==='/api/team'){
    const data=loadStore();let issues=[];let jiraIssuesAvailable=false;
    if(jiraConfigured()&&data.settings.projectKey){try{issues=await projectIssues(data.settings.projectKey);jiraIssuesAvailable=true;}catch{}}
    const team=data.team.map(member=>{
      const jiraHistory=jiraIssuesAvailable?issues.filter(issue=>{
        const assignee=issue.fields?.assignee;
        return Boolean(assignee&&((member.accountId&&assignee.accountId===member.accountId)||String(assignee.displayName||'').trim().toLowerCase()===String(member.name||'').trim().toLowerCase()));
      }).slice(0,30).map(issue=>({key:issue.key,summary:issue.fields.summary,status:issue.fields.status?.name,updated:issue.fields.updated,browseUrl:`${String(process.env.JIRA_BASE_URL||'').replace(/\/+$/,'')}/browse/${issue.key}`})):[];
      return {...publicMember(member),jiraHistory};
    });
    return send(res,200,{team,jiraIssuesAvailable,openIssueCount:issues.length,projectKey:data.settings.projectKey});
  }
  const memberMatch=pathname.match(/^\/api\/team\/([^/]+)$/);
  if(req.method==='PUT'&&memberMatch){
    const id=decodeURIComponent(memberMatch[1]);const body=await readBody(req);
    const member=updateStore(data=>{const m=data.team.find(x=>x.id===id);if(!m)return null;
      for(const k of ['name','accountId','role','preference','profileStatus'])if(body[k]!==undefined)m[k]=String(body[k]).trim().slice(0,160);
      if(Array.isArray(body.skills))m.skills=body.skills.slice(0,40).map(s=>typeof s==='string'?{name:s.trim().slice(0,60),level:'intermediate',source:'team-confirmed',confidence:1,confirmedAt:new Date().toISOString().slice(0,10)}:{name:String(s.name||'').trim().slice(0,60),level:['beginner','intermediate','advanced','expert'].includes(s.level)?s.level:'intermediate',source:'team-confirmed',confidence:1,confirmedAt:new Date().toISOString().slice(0,10)}).filter(s=>s.name);
      if(Array.isArray(body.inferredSkills))m.inferredSkills=body.inferredSkills.slice(0,40).map(s=>({name:String(s.name||'').trim().slice(0,60),source:'jira-history',confidence:Math.max(0,Math.min(1,Number(s.confidence)||0))})).filter(s=>s.name);
      if(body.availability&&typeof body.availability==='object')m.availability={capacityPercent:Math.max(0,Math.min(100,Number(body.availability.capacityPercent)||0)),note:String(body.availability.note||'').slice(0,300)};
      m.lastConfirmed=new Date().toISOString();m.profileStatus='confirmed';appendAudit(data,'team.member.updated',{memberId:id});return publicMember(m);});
    return member?send(res,200,{member}):send(res,404,{error:'Team member not found.'});
  }
  if(req.method==='POST'&&pathname==='/api/team/context/refresh'){
    const data=loadStore();try{await requireJiraBoard(data.settings);}catch(error){return send(res,error.status||503,{error:error.message});}
    const boards=await listBoards(data.settings.projectKey),issues=await boardIssues(data.settings.boardId),sprints=await listSprints(data.settings.boardId);
    const updated=updateStore(state=>{for(const m of state.team){const own=issues.filter(i=>i.fields?.assignee?.accountId&&i.fields.assignee.accountId===m.accountId);m.jiraHistory=own.slice(0,30).map(i=>({key:i.key,summary:i.fields.summary,status:i.fields.status?.name,updated:i.fields.updated,components:(i.fields.components||[]).map(c=>c.name),labels:i.fields.labels||[]}));if(own.length)m.inferredSkills=inferJiraSkills(own);}state.settings.contextRefreshedAt=new Date().toISOString();appendAudit(state,'team.context.refreshed',{issueCount:issues.length});return {team:state.team.map(publicMember),refreshedAt:state.settings.contextRefreshedAt,source:'Jira + team profile',issueCount:issues.length,sprints:sprints.map(s=>({id:s.id,name:s.name,state:s.state,startDate:s.startDate,endDate:s.endDate})),boards:boards.map(b=>({id:b.id,name:b.name,type:b.type}))};});
    return send(res,200,updated);
  }
  if(req.method==='POST'&&pathname==='/api/jira/test'){
    try{return send(res,200,{connected:true,account:await testJira()});}catch(e){return send(res,400,{connected:false,error:e.message});}
  }
  if(req.method==='GET'&&pathname==='/api/jira/boards'){
    const data=loadStore();if(!jiraConfigured())return send(res,400,{error:'Jira server credentials are not configured. See .env.example and README.md.'});
    try{return send(res,200,{boards:await listBoards(url.searchParams.get('projectKey')||data.settings.projectKey)});}catch(e){return send(res,400,{error:e.message});}
  }
  if(req.method==='GET'&&pathname==='/api/jira/sprints'){
    const data=loadStore();const boardId=url.searchParams.get('boardId')||data.settings.boardId;if(!jiraConfigured()||!boardId)return send(res,400,{error:'Configure Jira credentials and select a board first.'});
    try{return send(res,200,{sprints:await listSprints(boardId)});}catch(e){return send(res,400,{error:e.message});}
  }
  if(req.method==='GET'&&pathname==='/api/plans')return send(res,200,{plans:loadStore().plans});
  const deletePlanMatch=pathname.match(/^\/api\/plans\/([^/]+)$/);
  if(deletePlanMatch&&req.method==='DELETE'){
    const id=deletePlanMatch[1];let deleted=false;
    updateStore(state=>{const index=state.plans.findIndex(plan=>plan.id===id);if(index<0)return;state.plans.splice(index,1);deleted=true;appendAudit(state,'plan.deleted',{planId:id});});
    return deleted?send(res,200,{deleted:true,id}):send(res,404,{error:'Plan not found.'});
  }
  if(req.method==='POST'&&pathname==='/api/plans/stream'){
    const body=await readBody(req);const data=loadStore();
    try{await requirePlanningConnections(data.settings,data.team.filter(m=>data.settings.teamMembers.includes(m.id)));}catch(error){return send(res,error.status||503,{error:error.message});}
    const team=data.team.filter(m=>data.settings.teamMembers.includes(m.id));
    const workspace={settings:data.settings,team,teamContext:team};
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Content-Type-Options':'nosniff'});
    const emit=event=>res.write(`data: ${JSON.stringify(event)}\n\n`);
    try{
      const result=await runPlanningGraph(body,workspace,event=>emit({type:'agent',...event}));
      if(result.error){emit({type:'error',error:result.error.join(' '),agentRuns:result.agentRuns||[]});return res.end();}
      const plan=result.plan;
      if(result.publication){plan.publication=result.publication;if(['published','partial'].includes(result.publication.status))plan.status=result.publication.status;}
      updateStore(state=>{state.plans.unshift(plan);appendAudit(state,'plan.created',{planId:plan.id,status:plan.status,mode:plan.mode});});
      emit({type:'complete',plan});
    }catch(error){emit({type:'error',error:error.message,agent:error.agentName||null});}
    return res.end();
  }
  if(req.method==='POST'&&pathname==='/api/plans'){
    const body=await readBody(req);const data=loadStore();
    try{await requirePlanningConnections(data.settings,data.team.filter(m=>data.settings.teamMembers.includes(m.id)));}catch(error){return send(res,error.status||503,{error:error.message});}
    const team=data.team.filter(m=>data.settings.teamMembers.includes(m.id));
    const workspace={settings:data.settings,team,teamContext:team};
    let result;
    try{result=await runPlanningGraph(body,workspace);}catch(e){return send(res,502,{error:e.message,agent:e.agentName||null});}
    if(result.error)return send(res,400,{error:result.error.join(' '),agentRuns:result.agentRuns||[]});
    const plan=result.plan;
    if(result.publication){plan.publication=result.publication;if(result.publication.status==='published'||result.publication.status==='partial')plan.status=result.publication.status;}
    updateStore(state=>{state.plans.unshift(plan);appendAudit(state,'plan.created',{planId:plan.id,status:plan.status,mode:plan.mode});});
    return send(res,201,{plan});
  }
  const draftMatch=pathname.match(/^\/api\/plans\/([^/]+)\/draft-issues$/);
  if(draftMatch&&req.method==='POST'){
    const id=draftMatch[1],data=loadStore(),plan=data.plans.find(p=>p.id===id);
    if(!plan)return send(res,404,{error:'Plan not found.'});
    if(!jiraConfigured()||!data.settings.projectKey)return send(res,503,{error:'Jira credentials and a project are required to create these draft issues.'});
    if(!Array.isArray(plan.selectedItems)||!plan.selectedItems.length)return send(res,400,{error:'This plan has no selected tasks.'});
    try{
      const existing=await findPlanIssue(data.settings.projectKey,id,'');
      const issues=[];
      for(const item of plan.selectedItems){
        const match=existing.find(issue=>issue.fields?.summary===item.summary);
        const issue=match||await createIssue(data.settings.projectKey,item,id,{draft:true});
        issues.push({key:issue.key,summary:item.summary,browseUrl:`${(process.env.JIRA_BASE_URL||'').replace(/\/+$/,'')}/browse/${issue.key}`,status:match?'already_exists':'created'});
      }
      plan.draftPublication={status:'created',createdAt:new Date().toISOString(),issues,summary:'Draft Jira issues created without sprint assignment or Jira assignees. Confirm scope and acceptance criteria before committing the sprint.'};
      updateStore(state=>{const index=state.plans.findIndex(p=>p.id===id);if(index>=0)state.plans[index]=plan;appendAudit(state,'plan.draft_issues_created',{planId:id,issues:issues.map(x=>x.key)});});
      return send(res,200,{plan,issues});
    }catch(error){return send(res,502,{error:`Could not create Jira draft issues: ${error.message}`});}
  }
  const planMatch=pathname.match(/^\/api\/plans\/([^/]+)(?:\/(approve|publish))?$/);
  if(planMatch&&req.method==='GET'&&!planMatch[2]){const plan=loadStore().plans.find(p=>p.id===planMatch[1]);return plan?send(res,200,{plan}):send(res,404,{error:'Plan not found.'});}
  if(planMatch&&req.method==='PUT'&&!planMatch[2]){
    const id=planMatch[1],body=await readBody(req);const result=updateStore(data=>{const plan=data.plans.find(p=>p.id===id);if(!plan)return null;
      if(Array.isArray(body.items))for(const update of body.items){const item=plan.selectedItems.find(i=>i.id===update.id);if(!item)continue;if(Array.isArray(update.acceptanceCriteria))item.acceptanceCriteria=update.acceptanceCriteria.map(x=>String(x).trim().slice(0,500)).filter(Boolean);if(update.assigneeId!==undefined){const m=data.team.find(x=>x.id===update.assigneeId&&data.settings.teamMembers.includes(x.id));item.assignee=m||null;item.assignmentRationale=m?'PO/team selected this owner.':'Left open for team selection.';item.assignmentEvidence=m?['Human-confirmed selection']:[];item.assignmentConfidence=m?'high':'unknown';}item.needsPOReview=!item.acceptanceCriteria.length;}
      plan.findings=(plan.findings||[]).filter(f=>!f.id.startsWith('criteria-')&&!f.id.startsWith('owner-'));
      for(const item of plan.selectedItems){
        if(!item.acceptanceCriteria?.length)plan.findings.push({id:`criteria-${item.id}`,severity:'question',category:'acceptance-criteria',itemId:item.id,summary:`Acceptance criteria are missing for “${item.summary}”.`,action:'Add observable acceptance criteria before Jira publishing.'});
        if(!item.assignee)plan.findings.push({id:`owner-${item.id}`,severity:'warning',category:'assignment',itemId:item.id,summary:`No owner is assigned for “${item.summary}”.`,action:'Leave open for team self-selection or select a team member.'});
      }
      if(!plan.findings.some(f=>f.severity==='blocker'))plan.status='ready_for_review';appendAudit(data,'plan.edited',{planId:id});return plan;});
    return result?send(res,200,{plan:result}):send(res,404,{error:'Plan not found.'});
  }
  const trackMatch=pathname.match(/^\/api\/plans\/([^/]+)\/track$/);
  if(trackMatch&&req.method==='POST'){
    const id=trackMatch[1],body=await readBody(req),data=loadStore(),plan=data.plans.find(item=>item.id===id);
    if(!plan)return send(res,404,{error:'Plan not found.'});
    try{
      await requireJiraBoard(data.settings);
      const jiraIssues=await findPlanIssue(data.settings.projectKey,id,'');
      const team=data.team.filter(member=>data.settings.teamMembers.includes(member.id));
      const workspace={settings:data.settings,team,teamContext:team};
      const result=await runTrackingGraph(plan,workspace,jiraIssues,body.trackingConfiguration||plan.trackingConfiguration||{});
      const report={id:randomUUID(),checkedAt:result.dashboard.checkedAt,dashboard:result.dashboard,orchestrator:result.orchestrator,agentRuns:result.agentRuns,agentOutputs:result.agentOutputs};
      updateStore(state=>{const saved=state.plans.find(item=>item.id===id);if(!saved)return;saved.latestTracking=report;saved.trackingReports=[...(saved.trackingReports||[]),report].slice(-20);const monitorOutput=result.agentOutputs.find(output=>output.agent==='Monitor Agent'),monitorRun=result.agentRuns.find(run=>run.agent==='Monitor Agent');if(monitorOutput){let replaced=false;saved.agentOutputs=(saved.agentOutputs||[]).map(output=>output.agent==='Monitor Agent'?(replaced=true,monitorOutput):output);if(!replaced)saved.agentOutputs.push(monitorOutput);}if(monitorRun){let replaced=false;saved.agentRuns=(saved.agentRuns||[]).map(run=>run.agent==='Monitor Agent'?(replaced=true,monitorRun):run);if(!replaced)saved.agentRuns.push(monitorRun);}const completed=Number(report.dashboard.completion?.completed)||0,total=Number(report.dashboard.completion?.total)||0;if(total>0&&completed>=total)saved.status='completed';appendAudit(state,'plan.tracked',{planId:id,checkedAt:report.checkedAt,jiraIssueCount:jiraIssues.length,status:saved.status});});
      const updated=loadStore().plans.find(item=>item.id===id);
      return send(res,200,{plan:updated,tracking:report});
    }catch(error){return send(res,error.status||502,{error:`Could not track Jira progress: ${error.message}`,agent:error.agentName||null});}
  }
  const rejectMatch=pathname.match(/^\/api\/plans\/([^/]+)\/reject$/);
  if(rejectMatch&&req.method==='POST'){
    const id=rejectMatch[1],body=await readBody(req);let rejected=null;
    updateStore(data=>{const plan=data.plans.find(p=>p.id===id);if(!plan)return;if(plan.approval?.status==='approved'||plan.publication?.status==='published')return;plan.approval={...(plan.approval||{}),status:'rejected',rejectedAt:new Date().toISOString(),rejectedBy:String(body.rejectedBy||'PO/team').slice(0,100)};plan.status='rejected';plan.rejectionReason=String(body.reason||'Rejected during plan review.').slice(0,500);rejected=plan;appendAudit(data,'plan.rejected',{planId:id});});
    return rejected?send(res,200,{plan:rejected}):send(res,404,{error:'Plan not found.'});
  }
  if(planMatch&&req.method==='POST'&&(planMatch[2]==='approve'||planMatch[2]==='publish')){
    const id=planMatch[1],body=await readBody(req);let current=loadStore();let plan=current.plans.find(p=>p.id===id);if(!plan)return send(res,404,{error:'Plan not found.'});
    try{await requireJiraBoard(current.settings);}catch(error){return send(res,error.status||503,{error:error.message});}
    plan.findings=currentPlanGate(plan,current.team.filter(m=>current.settings.teamMembers.includes(m.id)),current.settings);
    if(plan.approval.status!=='approved'){plan.approval={status:'approved',approvedAt:new Date().toISOString(),approvedBy:String(body.approvedBy||'PO/team').slice(0,100)};plan.status='approved';}
    const workspace={settings:current.settings,team:current.team.filter(m=>current.settings.teamMembers.includes(m.id)),teamContext:current.team.filter(m=>current.settings.teamMembers.includes(m.id))};
    let publication;try{publication=await runPublisherGraph(plan,workspace,true);}catch(e){return send(res,502,{error:e.message});}
    plan.publication=publication;plan.agentRuns=[...(plan.agentRuns||[]),{id:publication.id,agent:'Jira Publisher Agent',status:publication.status,mode:publication.mode,summary:publication.summary,createdAt:publication.createdAt}];if(['published','partial'].includes(publication.status))plan.status=publication.status;else if(['stale','blocked'].includes(publication.status))plan.status=publication.status;
    updateStore(data=>{const index=data.plans.findIndex(p=>p.id===id);if(index>=0)data.plans[index]=plan;appendAudit(data,'plan.approved_or_published',{planId:id,status:plan.status,publication:publication.status});});
    return send(res,200,{plan,publication});
  }
  if(req.method==='GET'&&pathname==='/api/audit')return send(res,200,{events:loadStore().audit});
  return send(res,404,{error:'API route not found.'});
}

const server=http.createServer(async(req,res)=>{
  try{
    const host=req.headers.host||'';
    if(!host.startsWith('127.0.0.1:')&&!host.startsWith('localhost:'))return send(res,403,{error:'NovaSprint is bound to localhost only.'});
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/'))return await api(req,res,url);
    const pathname=url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname);
    const file=path.resolve(root,`.${pathname}`);if(!file.startsWith(root+path.sep)&&file!==path.join(root,'index.html'))return send(res,403,{error:'Forbidden.'});
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,404,{error:'Not found.'});
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"});fs.createReadStream(file).pipe(res);
  }catch(error){send(res,error.status||500,{error:error.status?error.message:'NovaSprint server error.'});}
});
const port=Number(process.env.PORT)||4174;
server.listen(port,'127.0.0.1',()=>{loadStore();console.log(`NovaSprint is ready at http://127.0.0.1:${port}`);});
