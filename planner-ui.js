/* Full-page sprint request, live run, and review surfaces. Loaded after app.js. */
let activePlannerPlan = null;

function reportEscape(value='') { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function cleanTaskDescription(value='') { return String(value??'').replace(/\s*[^.!?]*\bsee\s+openquestions\b[^.!?]*\.?/gi,'').replace(/\s*\.?\s*decomposed from request-\d+\.?/gi,'').replace(/\s{2,}/g,' ').trim(); }
function agentPurpose(agent) {
    return ({'Team Context Agent':'Shows who is available and which skills can support the sprint.','Intake Agent':'Turns your goal and any backlog into a clear planning brief.','Task Decomposer Agent':'Turns your sprint goal into the delivery tasks and checks needed to complete it.','Sprint Planner Agent':'Chooses and orders a sprint scope around your goal.','Predictor Agent':'Forecasts task time, resources, success likelihood, and rework risk.','Assignment Agent':'Matches work to teammates using their roles, skills, and availability.','Monitor Agent':'Checks Jira task updates and reports progress, KPI movement, and schedule deviations.','Evaluator Agent':'Assesses usability, goal alignment, and measured impact of the change.','Orchestrator Agent':'Combines the agent findings into a clear sprint decision and progress dashboard.','Jira Publisher Agent':'Creates the planned tasks and subtasks in Jira after planning finishes.'})[agent]||'Contributes planning evidence to the sprint.';
}
function agentOutputBullets(agent, details={}, summary='') {
  details=details&&typeof details==='object'?details:{};
  const items=details.items||details.workItems||details.selectedItems||[],assignments=details.assignments||[];
  const candidates=details.candidates||[];
  const results=[];
  const push=(...lines)=>lines.forEach(line=>{if(line&&results.length<4)results.push(cleanTaskDescription(String(line)));});
  switch(agent){
    case 'Team Context Agent': {
      const team=details.team||[];push(`${team.length||0} teammate profiles reviewed.`,`${details.jiraIssueCount??'No'} Jira issues checked for current project context.`);
      const names=[...new Set(team.map(member=>member.name).filter(Boolean))];if(names.length)push(`Team members: ${names.join(', ')}.`);
      const skills=[...new Set(team.flatMap(member=>(member.confirmedSkills||member.skills||[]).map(skill=>typeof skill==='string'?skill:skill.name).filter(Boolean)))];if(skills.length)push(`Skills available include ${skills.slice(0,5).join(', ')}.`);break;
    }
    case 'Intake Agent': {
      if(details.sprintGoal)push(`Goal: ${details.sprintGoal}`);
      const count=(details.requestedAndPlannedWork||details.workItems||[]).length;if(count)push(`${count} supplied work item${count===1?'':'s'} organized for planning.`);else push('No backlog list supplied; the Task Decomposer built the work from the sprint goal.');
      if(details.startDate||details.endDate)push(`Sprint dates: ${details.startDate||'not set'} to ${details.endDate||'not set'}.`);
      break;
    }
    case 'Task Decomposer Agent': {
      push(`${items.length} task${items.length===1?'':'s'} prepared with completion criteria.`);
      if(items.some(item=>item.id==='qa-e2e'||/comprehensive.{0,30}(end[- ]to[- ]end|qa|test)|end[- ]to[- ]end.{0,30}(qa|test|verification)/i.test(`${item.summary||''} ${item.description||''}`)))push('One goal-level task covers comprehensive end-to-end QA.');else push('A comprehensive goal-level end-to-end QA task is missing.');
      if(items.some(item=>item.id==='release-plan'||/release readiness plan|release plan/i.test(`${item.summary||''} ${item.description||''}`)))push('One sprint-level release-readiness task is included.');else push('A sprint-level release-readiness task is missing.');
      const criteria=items.reduce((count,item)=>count+(item.acceptanceCriteria||[]).length,0);if(criteria)push(`${criteria} checkable acceptance criteria define how work is reviewed.`);break;
    }
    case 'Sprint Planner Agent': {
      const recommended=details.recommendedCandidate||details.recommendedPlan;
      if(recommended)push(`Recommended scope: ${recommended}.`);
      if(candidates.length){push(`${candidates.length} scope option${candidates.length===1?'':'s'} compared.`);const best=candidates[0];if(best?.selectedItemIds)push(`Top option includes ${best.selectedItemIds.length} tasks and defers ${(best.deferredItemIds||[]).length}.`);if(best?.rationale)push(best.rationale);}
      else {const selected=details.selectedItems||[];if(selected.length)push(`${selected.length} tasks selected; ${(details.deferredItems||[]).length} deferred.`);if(details.rationale)push(details.rationale);}
      break;
    }
    case 'Predictor Agent': {
      const estimates=details.estimates||[];push(`${estimates.length} task estimate${estimates.length===1?'':'s'} reviewed.`);
      const sized=estimates.filter(row=>row.low!=null||row.high!=null);sized.slice(0,2).forEach(row=>push(`${row.task||'Task'}: ${row.low??'?'}–${row.high??'?'} ${row.unit||''}${row.successProbability!=null?`, ${row.successProbability}% success likelihood`:''}${row.riskLevel?`, ${row.riskLevel} rework risk`:''}${row.confidence?` (${row.confidence} confidence)`:''}.`.trim()));if(!sized.length)push('No task effort ranges were recorded.');
      const risks=details.risks||details.overallRisks||[];push(`${risks.length} forecast rework risk${risks.length===1?'':'s'} recorded.`);
      if(details.capacity?.summary)push(details.capacity.summary);break;
    }
    case 'Assignment Agent': {
      const planItems=activePlannerPlan?.selectedItems||[];
      const byId=new Map(planItems.map(item=>[item.id,item]));
      const planAssignments=planItems.map(item=>({task:item.summary||item.title,owner:item.assignee?.name||'Unassigned',role:item.assignee?.role||''})).filter(row=>row.task);
      const rows=planAssignments.length?planAssignments:assignments.map(row=>({...row,task:row.task||row.summary||byId.get(row.itemId)?.summary||byId.get(row.itemId)?.title})).filter(row=>row.task);
      const groups=new Map();rows.forEach(row=>{const key=`${row.owner||'Unassigned'}${row.role?` · ${row.role}`:''}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row.task);});
      const groupRows=[...groups];groupRows.slice(0,3).forEach(([owner,tasks])=>push(`${owner}: ${tasks.join('; ')}.`));if(groupRows.length>3)push(`Also assigned: ${groupRows.slice(3).map(([owner,tasks])=>`${owner}: ${tasks.join('; ')}`).join(' · ')}.`);
      if(!rows.length)push('Owner assignments were recorded, but task titles are unavailable in this saved plan.');break;
    }
    case 'Monitor Agent': {
      if(details.statusReport)push(details.statusReport);
      const progress=details.taskProgress||[];if(progress.length)push(`${progress.length} task status${progress.length===1?'':'es'} tracked: ${progress.slice(0,2).map(row=>`${row.task} — ${row.status}`).join('; ')}.`);else push('No live progress is available for the proposed tasks yet.');
      const alerts=details.deviationAlerts||[];if(alerts.length)push(`Deviation alert: ${alerts[0]}`);
      const kpis=details.kpiTracking||[];if(kpis.length)push(`Tracking ${kpis.length} KPI${kpis.length===1?'':'s'} using supplied targets and sources.`);break;
    }
    case 'Evaluator Agent': {
      if(details.overallAssessment)push(details.overallAssessment);
      if(details.goalAlignment)push(`Goal alignment: ${details.goalAlignment}`);
      const checks=details.usabilityChecks||[];if(checks.length)push(`Usability review: ${checks.filter(row=>row.status==='met').length} met, ${checks.filter(row=>row.status==='gap').length} gaps, ${checks.filter(row=>row.status==='not_evidenced').length} not evidenced.`);
      const metrics=details.metrics||[];if(metrics.length)metrics.slice(0,2).forEach(row=>push(`${row.name}: ${row.baseline??'—'} → ${row.postEnhancement??'—'}${row.improvement?` (${row.improvement})`:''}. Source: ${row.source||'not recorded'}.`));else push('No baseline and post-change measurements were supplied; impact remains to be measured after release.');
      const finding=(details.findings||[])[0];if(finding)push(`${finding.summary}${finding.action?` Next: ${finding.action}`:''}`);break;
    }
    case 'Orchestrator Agent': {
      if(details.agentSummary)push(details.agentSummary);
      else if(details.recommendedPlan)push(`Recommended plan: ${details.recommendedPlan}.`);
      if(details.roadmap)push(`Roadmap: ${details.roadmap}.`);
      if(details.estimation)push(`Effort and confidence: ${details.estimation}.`);
      if(details.owners)push(`Owners and release: ${details.owners}.`);
      if(!results.length&&details.status)push(`Plan status: ${details.status}.`);break;
    }
    case 'Jira Publisher Agent': {
      const issues=details.issues||[];push(`Publication status: ${details.status||'Waiting for plan approval'}.`);
      push(`${issues.length} Jira issue${issues.length===1?'':'s'} recorded.`);
      if(issues.length)push(`Created: ${issues.slice(0,3).map(issue=>issue.key||issue.summary).join(', ')}.`);break;
    }
    default: if(summary)push(summary);
  }
  if(!results.length&&summary)push(summary);
  if(!results.length)results.push('No structured result was recorded.');
  return results.slice(0,4);
}
function renderCompactAgentOutput(agent,details,summary='',includePurpose=true) {
  const bullets=agentOutputBullets(agent,details,summary),table=(headers,rows)=>`<div class="agent-table-wrap"><table class="agent-output-table"><thead><tr>${headers.map(value=>`<th>${reportEscape(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${reportEscape(value??'—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  let evidence='';
  if(agent==='Predictor Agent'){
    const rows=(details.estimates||[]).map(row=>[row.task||row.summary||'Task',row.low!=null||row.high!=null?`${row.low??'—'}–${row.high??'—'} ${row.unit||''}`.trim():'Not estimated',row.successProbability==null?'Not estimated':`${row.successProbability}%`,row.riskLevel||'Unknown',(row.resourceNeeds||[]).join(', ')||'Not specified']);
    evidence=`<h5>Task forecast</h5>${table(['Task','Predicted time','Success probability','Rework risk','Resources'],rows.length?rows:[['No task forecasts recorded','—','—','—','—']])}`;
  }
  if(agent==='Evaluator Agent'){
    const metrics=details.metrics||[],rows=metrics.map(row=>[row.name,row.baseline??'Not supplied',row.postEnhancement??'Not measured',row.improvement??'Not calculated']);
    evidence=`<h5>Outcome measures</h5>${table(['Metric','Baseline','Post-enhancement','Improvement'],rows.length?rows:[['No outcome metrics supplied','Not supplied','Not measured','Not calculated']])}`;
    if(details.usabilityScore!=null)evidence+=`<p class="agent-purpose">Evidence-based usability score: ${reportEscape(details.usabilityScore)}/100</p>`;
  }
  if(agent==='Monitor Agent'){
    const progress=details.taskProgress||[],kpis=details.kpiTracking||[];
    if(progress.length)evidence+=`<h5>Task progress</h5>${table(['Task','Status','Evidence'],progress.map(row=>[row.task,row.status,row.evidence]))}`;
    if(kpis.length)evidence+=`<h5>KPI tracking</h5>${table(['Metric','Current','Target','Source','Cadence'],kpis.map(row=>[row.metric,row.currentValue,row.target,row.source,row.cadence]))}`;
    if(details.reportingCadence)evidence+=`<p class="agent-purpose">Reporting cadence: ${reportEscape(details.reportingCadence)}</p>`;
  }
  return `<div class="agent-result-compact">${includePurpose?`<p class="agent-purpose">${reportEscape(agentPurpose(agent))}</p>`:''}<h4>${reportEscape(agent)}</h4><ul>${bullets.map(line=>`<li>${reportEscape(line)}</li>`).join('')}</ul>${evidence}</div>`;
}
function buildBlueprintLines(plan={}){
  const items=plan.selectedItems||[],byId=new Map(items.map(item=>[item.id,item]));
  const sequence=plan.candidate?.sequence||plan.candidate?.selectedItemIds||[];
  const ordered=[...sequence.map(id=>byId.get(id)).filter(Boolean),...items.filter(item=>!sequence.includes(item.id))];
  const roadmap=ordered.map(item=>item.summary).filter(Boolean).slice(0,6);
  const estimates=items.filter(item=>item.estimate&&(item.estimate.low!=null||item.estimate.high!=null)).map(item=>`${item.summary}: ${item.estimate.low??'?'}–${item.estimate.high??'?'} ${item.estimate.unit||''}`.trim());
  const owners=[...new Set(items.map(item=>item.assignee?.name).filter(Boolean))].map(name=>`${name}: ${items.filter(item=>item.assignee?.name===name).map(item=>item.summary).slice(0,2).join(', ')}`).slice(0,4);
  const qa=items.find(item=>item.id==='qa-e2e'),release=items.find(item=>item.id==='release-plan');
  const evaluation=plan.evaluation||{};
  return [
    `Selected delivery sequence: ${roadmap.length?roadmap.join(' → '):'No ordered task sequence was recorded.'}`,
    `Task owners: ${owners.length?owners.join('; '):'No named task owners were recorded.'}${estimates.length?` Effort estimates: ${estimates.slice(0,3).join('; ')}.`:' Effort ranges were not available from the supplied history.'}`,
    `Goal-level validation: ${qa?`end-to-end QA — ${qa.assignee?.name||'owner not assigned'}`:'QA task missing'}; ${release?`release readiness — ${release.assignee?.name||'owner not assigned'}`:'release plan missing'}.`,
    `Outcome evaluation: ${evaluation.overallAssessment||'The Evaluator will assess goal alignment and usability.'}${evaluation.metrics?.length?` Measured results: ${evaluation.metrics.slice(0,2).map(metric=>`${metric.name} ${metric.baseline??'—'} → ${metric.postEnhancement??'—'}${metric.improvement?` (${metric.improvement})`:''}`).join('; ')}.`:' Baseline and post-change metrics were not supplied, so user impact remains to be measured.'}`
  ];
}
window.downloadPlanReport = function(plan=activePlannerPlan) {
  if (!plan) return;
  const items=plan.selectedItems||[], outputs=plan._fullAgentOutputs||plan.agentOutputs||[], findings=(plan.findings||[]).filter(finding=>finding.severity!=='question');
  const list=(values=[])=>values.length?`<ul>${values.map(x=>`<li>${reportEscape(x)}</li>`).join('')}</ul>`:'<p class="muted">None recorded.</p>';
  const qaTask=items.find(item=>item.id==='qa-e2e'||/comprehensive.{0,30}(end[- ]to[- ]end|qa|test)|end[- ]to[- ]end.{0,30}(qa|test|verification)/i.test(`${item.summary||''} ${item.description||''}`));
  const releaseTask=items.find(item=>item.id==='release-plan'||/sprint[- ]level release readiness|release readiness plan|release plan/i.test(`${item.summary||''} ${item.description||''}`));
  const frontendOwner=items.find(item=>/front.?end|implement.*(ui|interface|screen)|build.*(ui|interface|screen)|redesign/i.test(`${item.summary||''} ${item.description||''}`))?.assignee?.name;
  const releaseOwner=releaseTask?.assignee?.name;
  const summaryBullets=[`${items.length} tasks are included in the sprint plan.`,...(qaTask?[`One comprehensive end-to-end QA task is assigned to ${qaTask.assignee?.name||'an unassigned QA owner'}.`]:['The goal-level end-to-end QA task is missing.']),...(releaseOwner?[`One sprint release-readiness plan is assigned to ${releaseOwner}.`]:['The sprint release-readiness plan or its Release Manager owner is missing.']),...(frontendOwner?[`Frontend delivery is assigned to ${frontendOwner}.`]:[]),`Sprint window: ${plan.startDate||'start date not set'} to ${plan.endDate||'end date not set'}.`];
  const summary=`<ul class="summary-bullets">${summaryBullets.slice(0,4).map(line=>`<li>${reportEscape(line)}</li>`).join('')}</ul>`;
  const tasks=items.map((item,index)=>`<article class="task"><div class="task-number">${String(index+1).padStart(2,'0')}</div><div><h3>${reportEscape(item.summary)}</h3><p class="muted">${reportEscape(item.issueType||'Task')} · Owner: ${reportEscape(item.assignee?.name||'Unassigned')}</p><p>${reportEscape(cleanTaskDescription(item.description))}</p>${item.assignmentRationale?`<p class="muted">Assignment rationale: ${reportEscape(item.assignmentRationale)}</p>`:''}<h4>Acceptance criteria</h4>${list(item.acceptanceCriteria||[])}${item.subtasks?.length?`<h4>Subtasks</h4>${item.subtasks.map(s=>`<p><b>${reportEscape(s.summary)}</b>${s.assignedTo?.name?`<br>Owner: ${reportEscape(s.assignedTo.name)}${s.assignedTo.role?' · '+reportEscape(s.assignedTo.role):''}`:''}<br>${reportEscape(cleanTaskDescription(s.description))}</p>${list(s.acceptanceCriteria||[])}`).join('')}`:''}</div></article>`).join('')||'<p class="muted">No sprint tasks were selected.</p>';
  const agentCards=[...outputs.map(agent=>`<article class="agent"><h3>${reportEscape(agent.agent)}</h3>${renderCompactAgentOutput(agent.agent,agent.details||{},agent.summary||'No output was recorded.')}</article>`),`<article class="agent"><h3>Jira Publisher Agent</h3>${renderCompactAgentOutput('Jira Publisher Agent',{status:plan.publication?.summary||'Waiting for plan approval',issues:plan.publication?.issues||[]},plan.publication?.summary)}</article>`].join('');
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sprint plan — ${reportEscape(plan.goal)}</title><style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#15365f;font:15px/1.6 Inter,Segoe UI,Arial,sans-serif}.report{max-width:920px;margin:44px auto;padding:52px;background:#fff;border:1px solid #d7e3f1;border-radius:20px;box-shadow:0 14px 45px #173f720c}.brand,.eyebrow{color:#173f72;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.eyebrow{margin-top:30px}h1{font-size:38px;line-height:1.14;letter-spacing:-.04em;margin:10px 0}h2{font-size:21px;letter-spacing:-.02em;margin:0 0 5px}h3{font-size:16px;margin:0 0 6px}h4{font-size:11px;text-transform:uppercase;letter-spacing:.1em;margin:18px 0 4px}.muted{color:#4f6682}.meta{display:flex;gap:24px;flex-wrap:wrap;margin:22px 0;padding:16px 0;border-block:1px solid #d7e3f1}.metric b{display:block;font-size:18px}.metric span{font-size:11px;color:#4f6682}.task,.agent{padding:18px 0;border-top:1px solid #d7e3f1}.task-number{width:34px;height:34px;border-radius:10px;background:#edf4fc;color:#15365f;display:grid;place-items:center;font-weight:800}.task p{margin:5px 0}.agent-purpose{margin:0;color:#4f6682}.agent-result-compact h4{margin:12px 0 2px}.agent-result-compact ul{margin:4px 0;padding-left:22px}.agent-result-compact li,.findings li,.task li{margin:4px 0}.summary-bullets{padding-left:22px}.foot{margin-top:38px;color:#4f6682;font-size:11px}@media(max-width:700px){.report{margin:0;padding:25px;border:0;border-radius:0}h1{font-size:30px}}@media print{body{background:#fff}.report{margin:0 auto;padding:24px;border:0;box-shadow:none}.task,.agent{break-inside:avoid}}</style></head><body><main class="report"><div class="brand">✳ NovaSprint · Sprint report</div><div class="eyebrow">Sprint plan · ${reportEscape(String(plan.status||'Ready for review').replaceAll('_',' '))}</div><h1>${reportEscape(plan.goal||'Sprint plan')}</h1>${summary}<div class="meta"><div class="metric"><span>Sprint window</span><b>${reportEscape(plan.startDate||'—')} — ${reportEscape(plan.endDate||'—')}</b></div><div class="metric"><span>Planned tasks</span><b>${items.length}</b></div><div class="metric"><span>Agent summaries</span><b>${outputs.length+1}</b></div><div class="metric"><span>Review notes</span><b>${findings.length}</b></div></div><section><h2>Sprint work</h2>${tasks}</section><section style="margin-top:35px"><h2>Agent outputs</h2><p class="muted">See each specialist’s purpose and the key result they contributed.</p>${agentCards}</section><section style="margin-top:35px"><h2>Review notes</h2>${findings.length?`<ul class="findings">${findings.map(f=>`<li><b>${reportEscape(f.severity||'Note')}:</b> ${reportEscape(cleanTaskDescription(f.summary||''))} ${f.action?`<span class="muted">— ${reportEscape(cleanTaskDescription(f.action))}</span>`:''}</li>`).join('')}</ul>`:'<p class="muted">No review notes.</p>'}</section><p class="foot">Generated by NovaSprint · ${new Date().toLocaleDateString()}</p></main></body></html>`;
  const orchestratorText=outputs.find(agent=>agent.agent==='Orchestrator Agent')?.details?.agentSummary||outputs.find(agent=>agent.agent==='Orchestrator Agent')?.summary||'';
  const orchestratorReport=`<section style="margin-top:35px;padding:22px;border:1px solid #d7e3f1;border-radius:14px;background:#f7faff"><h2>Final sprint blueprint · Orchestrator Agent</h2>${orchestratorText?`<p>${reportEscape(orchestratorText)}</p>`:''}<ul>${buildBlueprintLines(plan).map(line=>`<li>${reportEscape(line)}</li>`).join('')}</ul></section>`;
  const completeHtml=html.replace('<section style="margin-top:35px"><h2>Review notes</h2>',`${orchestratorReport}<section style="margin-top:35px"><h2>Review notes</h2>`);
  const blob=new Blob([completeHtml],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`novasprint-${String(plan.goal||'sprint-plan').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'sprint-plan'}.html`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

window.downloadPlanReport = function(plan=activePlannerPlan) {
  if(!plan)return;
  const items=plan.selectedItems||[];
  const list=(values=[])=>values.length?`<ul>${values.map(value=>`<li>${reportEscape(value)}</li>`).join('')}</ul>`:'';
  const tasks=items.map((item,index)=>`<article class="task"><span class="task-number">${String(index+1).padStart(2,'0')}</span><div><h3>${reportEscape(item.summary||'Untitled task')}</h3><p class="muted">${reportEscape(item.issueType||'Task')} · Owner: ${reportEscape(item.assignee?.name||'Unassigned')}</p>${item.description?`<p>${reportEscape(cleanTaskDescription(item.description))}</p>`:''}${item.acceptanceCriteria?.length?`<h4>Acceptance criteria</h4>${list(item.acceptanceCriteria)}`:''}${item.subtasks?.length?`<h4>Subtasks</h4><ol>${item.subtasks.map(sub=>`<li><b>${reportEscape(sub.summary||'Subtask')}</b>${sub.assignedTo?.name?` · ${reportEscape(sub.assignedTo.name)}`:''}${sub.description?`<p>${reportEscape(cleanTaskDescription(sub.description))}</p>`:''}${sub.acceptanceCriteria?.length?list(sub.acceptanceCriteria):''}</li>`).join('')}</ol>`:''}</div></article>`).join('')||'<p class="muted">No sprint tasks were selected.</p>';
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Task list — ${reportEscape(plan.goal||'Sprint plan')}</title><style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#15365f;font:15px/1.6 Inter,Segoe UI,Arial,sans-serif}.report{max-width:900px;margin:36px auto;padding:44px;background:#fff;border:1px solid #d7e3f1;border-radius:18px}.brand,.eyebrow{color:#173f72;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.eyebrow{margin-top:24px}h1{font-size:34px;line-height:1.2;margin:10px 0 4px}h2{font-size:21px;margin:0 0 12px}.meta{margin:14px 0 26px;color:#526984;font-size:12px}.task{display:grid;grid-template-columns:38px minmax(0,1fr);gap:14px;padding:20px 0;border-top:1px solid #d7e3f1;break-inside:avoid}.task-number{width:34px;height:34px;border-radius:9px;background:#edf4fc;color:#15365f;display:grid;place-items:center;font-weight:800}.task h3{font-size:17px;margin:0 0 5px}.task h4{font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin:16px 0 4px}.task p{margin:6px 0}.task ul,.task ol{margin:4px 0;padding-left:22px}.muted{color:#526984}@media(max-width:700px){.report{margin:0;padding:24px;border:0;border-radius:0}h1{font-size:28px}}@media print{.report{margin:0 auto;padding:20px;border:0}}</style></head><body><main class="report"><div class="brand">NovaSprint · Task list</div><div class="eyebrow">Sprint plan</div><h1>${reportEscape(plan.goal||'Sprint plan')}</h1><p class="meta">${reportEscape(plan.startDate||'—')} — ${reportEscape(plan.endDate||'—')} · ${items.length} tasks</p><section><h2>Tasks</h2>${tasks}</section></main></body></html>`;
  const blob=new Blob([html],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`novasprint-tasks-${String(plan.goal||'sprint-plan').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'sprint-plan'}.html`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

window.setView = function(view) {
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active-view', el.id === `view-${view}`));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  const titles = { overview: 'Overview', team: 'Team & skills', plans: 'Plan history', planner: activePlannerPlan ? 'Plan review' : 'Plan a sprint' };
  document.querySelector('#pageCrumb').textContent = titles[view] || 'Overview';
  document.querySelector('#sidebar').classList.remove('open');
  if (view === 'plans') renderHistory();
};

function plannerShell(content) {
  content = content.replace(/<section class="plan-decision-bar">[\s\S]*?<\/section>/gi, '');
  window.setView('planner');
  document.querySelector('#plannerContent').innerHTML = content;
  document.querySelector('#plannerContent').scrollIntoView({ block: 'start' });
}

function plannerStatusPage(title, message, actions = '') {
  plannerShell(`<div class="planner-page"><div class="planner-breadcrumb"><button class="planner-back" data-planner-back>← Plan history</button><span>/</span><strong>Plan a sprint</strong></div><header class="planner-page-heading"><div class="planner-eyebrow">NOVASPRINT · SPRINT PLANNING</div><h1>${esc(title)}</h1><p>${esc(message)}</p></header><section class="planner-status-card"><span class="planner-status-icon">!</span><div><strong>Planning is not ready yet</strong><p>Check the items below, then return here to start a planning run.</p></div></section>${actions}</div>`);
  document.querySelector('[data-planner-back]')?.addEventListener('click', () => window.setView('plans'));
}

window.newPlan = async function() {
  activePlannerPlan = null;
  try { status = await api('/status'); }
  catch (error) { plannerStatusPage('We could not load the planner.', error.message, '<button class="secondary-button" data-retry-planner>Try again</button>'); document.querySelector('[data-retry-planner]')?.addEventListener('click', () => window.newPlan()); return; }
  const requirements = [];
  if (!status.model?.connected || status.model?.error) requirements.push(status.model?.error || 'The configured planning model is not connected.');
  if (!status.jira?.configured) requirements.push('Jira credentials are not configured on the server.');
  else if (!status.jira?.connected) requirements.push(status.jira?.error || 'Jira could not be reached.');
  if (!status.jira?.projectSelected || !status.jira?.boardSelected) requirements.push('Select a Jira project and board.');
  if (!status.teamReady) requirements.push(`Complete team profiles: ${(status.teamSetupMissing || []).join(', ') || 'confirmed skills'}.`);
  if (requirements.length) {
    plannerStatusPage('A few connections need attention', 'Fix these setup items to give the planning agents the right team and Jira context.', `<section class="planner-requirements">${requirements.map((item, i) => `<article><span>${String(i + 1).padStart(2, '0')}</span><p>${esc(item)}</p></article>`).join('')}</section><button class="primary-button" data-review-team>Review team profiles</button>`);
    document.querySelector('[data-review-team]')?.addEventListener('click', () => window.setView('team'));
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  plannerShell(`<div class="planner-page"><div class="planner-breadcrumb"><button class="planner-back" data-planner-back>← Plan history</button><span>/</span><strong>New sprint plan</strong></div><div class="planner-steps"><span class="current"><b>1</b> Sprint request</span><i></i><span><b>2</b> Agent planning</span><i></i><span><b>3</b> Review & publish</span></div><header class="planner-page-heading"><div class="planner-eyebrow">START WITH THE OUTCOME</div><h1>What should the team achieve?</h1><p>Set the outcome; the Task Decomposer creates a reviewable work plan from your goal. Add existing backlog items only if you have them.</p></header><form id="fullPlanForm" class="planner-form-layout"><section class="planner-form-main"><div class="planner-form-card"><label for="sprintGoal">Sprint goal</label><span class="planner-field-hint">Describe the customer or product outcome in one sentence.</span><input id="sprintGoal" name="sprintGoal" required placeholder="Example: Make checkout faster and reduce address errors"></div><div class="planner-form-card"><label for="workItems">Existing backlog tasks (optional)</label><span class="planner-field-hint">Add existing items if helpful, or leave blank so the Task Decomposer can create tasks from your goal.</span><textarea id="workItems" name="workItems" rows="8" placeholder="Add one task per line, or leave empty to let the Task Decomposer create the task list"></textarea><div class="planner-task-hint"><span>↳</span> The Task Decomposer builds the task list from your goal when this is empty.</div></div><div class="planner-form-card"><label for="exclusions">Out of scope <span class="optional-label">Optional</span></label><input id="exclusions" name="exclusions" placeholder="Comma separated, e.g. payment provider migration"></div><div class="planner-form-card"><label for="constraints">Constraints or dependencies <span class="optional-label">Optional</span></label><textarea id="constraints" name="constraints" rows="3" placeholder="Dates, external dependencies, compliance rules"></textarea></div></section><aside class="planner-form-aside"><section class="planner-side-card"><h2>Sprint window</h2><p>Choose the dates the team is planning for.</p><label for="startDate">Start date</label><input id="startDate" name="startDate" type="date" value="2026-10-26" required><label for="endDate">End date</label><input id="endDate" name="endDate" type="date" value="2026-11-06" min="${today}" required><span class="planner-field-hint">Dates can be adjusted before you build the plan.</span></section><section class="planner-side-card team-context-card"><div class="context-card-icon">✳</div><h2>Planning context</h2><p>Agents use the connected Jira project and all ${team.length} team profiles. The Release Manager adds a release-readiness plan to every sprint.</p><div class="context-stat"><span>Jira project</span><strong>${esc(jiraProjectKey)}</strong></div><div class="context-stat"><span>Team members</span><strong>${team.length}</strong></div><div class="context-stat"><span>Planning model</span><strong>${esc(status.model?.provider || 'Configured model')}</strong></div></section><button class="primary-button planner-submit" type="submit">Build sprint plan <span>→</span></button><span class="planner-submit-note">Jira Publisher creates the selected tasks when planning finishes.</span></aside></form></div>`);
  document.querySelector('[data-planner-back]')?.addEventListener('click', () => window.setView('plans'));
  document.querySelector('#fullPlanForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.currentTarget), startDate = String(form.get('startDate')), endDate = String(form.get('endDate'));
    if (endDate < startDate) { showToast('Sprint end date must be after its start date.'); return; }
    const workItems = String(form.get('workItems')).split(/\r?\n/).map(x => x.trim()).filter(Boolean).map((text, i) => ({ id: `request-${i + 1}`, text, priority: i + 1, mandatory: false }));
    await window.runPlanning({ sprintGoal: String(form.get('sprintGoal')).trim(), startDate, endDate, workItems, exclusions: String(form.get('exclusions')).split(',').map(x => x.trim()).filter(Boolean), constraints: String(form.get('constraints')).split(',').map(x => x.trim()).filter(Boolean) });
  });
};

window.runPlanning = async function(request) {
  let total = agentSteps.length - 1; const completed = new Set(), activity = [];
  const indexes = Object.fromEntries(agentSteps.map(([name], i) => [name, i]));
  const rows = agentSteps.map(([name, description, icon], i) => `<article class="full-agent-row" id="fullAgentRow${i}"><span class="full-agent-icon">${icon}</span><div><strong>${esc(name)}</strong><p id="fullAgentSummary${i}">${esc(description)}</p></div><span class="full-agent-state queued" id="fullAgentState${i}">${i === agentSteps.length - 1 ? 'Runs after planning' : 'Waiting'}</span></article>`).join('');
  const stageGroups = [
    { title: '1 · Understand the team', detail: 'Load the team, confirmed skills, and sprint request.', agents: ['Team Context Agent', 'Intake Agent'] },
    { title: '2 · Shape the work', detail: 'Turn the request into a focused scope and sequence.', agents: ['Task Decomposer Agent', 'Sprint Planner Agent'] },
    { title: '3 · Forecast and match', detail: 'Estimate uncertainty and recommend owners from skills and capacity.', agents: ['Predictor Agent', 'Assignment Agent'] },
    { title: '4 · Track progress', detail: 'Monitor task status and KPI movement from project evidence.', agents: ['Monitor Agent'] },
    { title: '5 · Evaluate outcomes', detail: 'Assess usability, goal alignment, and available before-and-after measures.', agents: ['Evaluator Agent', 'Orchestrator Agent'] },
    { title: '6 · Publish to Jira', detail: 'Create the selected Jira tasks and subtasks when planning finishes.', agents: ['Jira Publisher Agent'] }
  ];
  const stageRows = stageGroups.map((stage, i) => `<section class="map-stage ${i === stageGroups.length - 1 ? 'map-stage-publisher' : ''}"><div class="map-stage-heading"><span>${String(i + 1).padStart(2, '0')}</span><div><strong>${esc(stage.title.replace(/^\d+ · /, ''))}</strong><p>${esc(stage.detail)}</p></div></div><div class="map-stage-agents">${stage.agents.map(name => rows.split(`</article>`).find(x => x.includes(`id="fullAgentRow${indexes[name]}"`)) ? `${rows.split(`</article>`).find(x => x.includes(`id="fullAgentRow${indexes[name]}"`))}</article>` : '').join('')}</div></section>${i < stageGroups.length - 1 ? '<span class="workflow-connector" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12h14m-5-5 5 5-5 5"/></svg></span>' : ''}`).join('');
  plannerShell(`<div class="planner-page planner-running"><div class="planner-breadcrumb"><strong>New sprint plan</strong><span>/</span><strong>Agent planning</strong></div><header class="planner-page-heading run-page-heading"><div class="planner-eyebrow"><span class="run-pulse"></span> MODULAR AGENT PLANNING · LIVE</div><h1>Building your sprint plan</h1><p>Follow each specialist from team context through automatic Jira publishing. Each result is explained in plain language.</p></header><section class="planner-run-summary"><div><span class="planner-field-hint">SPRINT GOAL</span><strong>${esc(request.sprintGoal)}</strong></div><div><span class="planner-field-hint">SPRINT WINDOW</span><strong>${prettyDate(request.startDate)} — ${prettyDate(request.endDate)}</strong></div><div class="run-progress-count"><strong id="fullProgressCount">0 of ${total} planning agents complete</strong><span id="fullProgressPercent">0%</span></div><div class="full-progress-track" role="progressbar" aria-label="Planning agents complete" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="fullProgressFill"></i></div></section><div class="full-run-layout"><section class="full-agent-list"><div class="full-section-heading"><div><span class="planner-eyebrow">THE MAP WORKFLOW</span><h2>Follow the plan from context to Jira</h2><p>Each stage shows its agents, status, handoffs, and completed output.</p></div><span class="live-pill"><i></i> LIVE</span></div><div class="map-stage-list">${stageRows}</div></section><aside class="full-activity-column"><section class="active-agent-card"><span class="planner-field-hint">CURRENTLY WORKING</span><strong id="fullCurrentAgent">Connecting to Jira</strong><p id="fullCurrentDetail">Loading team profiles and current Jira work.</p><div class="working-dots"><i></i><i></i><i></i></div></section><section class="full-activity-card"><div class="full-section-heading"><div><span class="planner-eyebrow">AGENT OUTPUTS</span><h2>What each specialist produced</h2></div></div><div id="fullActivityFeed" role="log" aria-live="polite"><p class="feed-empty">Completed agents’ findings and structured outputs will appear here.</p></div></section></aside></div><div class="planner-bottom-bar"><button class="secondary-button" data-view="overview">Return to workspace</button><span>The workflow publishes the selected tasks to Jira automatically when the Publisher Agent completes.</span></div></div>`);
  const updateProgress = () => { const pct = Math.min(100, Math.round(completed.size / total * 100)); document.querySelector('#fullProgressCount').textContent = `${completed.size} of ${total} planning agents complete`; document.querySelector('#fullProgressPercent').textContent = `${pct}%`; document.querySelector('#fullProgressFill').style.width = `${pct}%`; document.querySelector('.full-progress-track').setAttribute('aria-valuenow',String(pct)); };
  const renderActivity = () => { document.querySelector('#fullActivityFeed').innerHTML = activity.map(item => `<details class="full-feed-entry" open><summary><span>✓</span><div><strong>${esc(item.agent)}</strong><p>${esc(agentPurpose(item.agent))}</p>${item.durationMs ? `<small>${Math.max(1, Math.round(item.durationMs / 1000))} sec</small>` : ''}</div></summary><div class="live-agent-output">${renderStructuredAgentOutput(item.agent,item.output||{},item.summary||'')}</div></details>`).join('')||'<p class="feed-empty">Agent results will appear here as they finish.</p>'; };
  const appendActivity = (agent, summary, durationMs, output) => { activity.unshift({ agent, summary, durationMs, output }); renderActivity(); };
  try {
    const response = await fetch('/api/plans/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    if (!response.ok || !response.body) { const data = await response.json().catch(() => ({})); throw new Error(data.error || `Planning request failed (${response.status})`); }
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', plan = null, streamError = null;
    const consume = frame => { for (const line of frame.split(/\r?\n/)) { if (!line.startsWith('data: ')) continue; const event = JSON.parse(line.slice(6));
      if (event.type === 'agent') {
        const index = indexes[event.agent]; if (index === undefined) return;
        if (event.agent === 'Jira Publisher Agent') { total = agentSteps.length; updateProgress(); }
        const row = document.querySelector(`#fullAgentRow${index}`), stateNode = document.querySelector(`#fullAgentState${index}`), summaryNode = document.querySelector(`#fullAgentSummary${index}`);
        row.classList.remove('is-running', 'is-complete', 'is-failed');
        if (event.status === 'running') { row.classList.add('is-running'); stateNode.className = 'full-agent-state working'; stateNode.textContent = 'Working'; summaryNode.textContent = event.summary || agentSteps[index][1]; document.querySelector('#fullCurrentAgent').textContent = event.agent; document.querySelector('#fullCurrentDetail').textContent = event.summary || agentSteps[index][1]; }
        else if (event.status === 'completed') { row.classList.add('is-complete'); stateNode.className = 'full-agent-state done'; stateNode.textContent = 'Complete'; summaryNode.textContent = event.summary || 'Step complete.'; completed.add(event.agent); updateProgress(); appendActivity(event.agent, event.summary, event.durationMs, event.output); document.querySelector('#fullCurrentAgent').textContent = `${event.agent} complete`; document.querySelector('#fullCurrentDetail').textContent = event.summary || 'The result is available to the next agent.'; }
        else if (event.status === 'failed') { row.classList.add('is-failed'); stateNode.className = 'full-agent-state failed'; stateNode.textContent = 'Needs attention'; summaryNode.textContent = event.summary || 'This step could not complete.'; }
      } else if (event.type === 'complete') { plan = event.plan; const saved=new Map((plan.agentOutputs||[]).map(result=>[result.agent,result])); activity.forEach(item=>{const result=saved.get(item.agent);if(result?.details)item.output=result.details;if(result?.summary)item.summary=result.summary;});renderActivity(); } else if (event.type === 'error') streamError = new Error(event.error || 'The planning graph failed.');
    } };
    while (true) { const { done, value } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done }); let cut; while ((cut = buffer.indexOf('\n\n')) >= 0) { const frame = buffer.slice(0, cut); buffer = buffer.slice(cut + 2); consume(frame); } if (done) break; }
    if (streamError) throw streamError; if (!plan) throw new Error('The planning stream closed before returning a plan.');
    plans.unshift(plan); renderHistory(); activePlannerPlan = plan; window.showPlan(plan);
  } catch (error) {
    showToast(error.message || 'The planning run could not be completed.');
    document.querySelector('#fullCurrentAgent').textContent = 'Needs attention'; document.querySelector('#fullCurrentDetail').textContent = error.message || 'The planning run could not be completed.';
  }
};

function renderAgentDetails(value){if(Array.isArray(value)){if(!value.length)return '<p>No entries.</p>';if(value.every(x=>x&&typeof x==='object'&&!Array.isArray(x))){const keys=[...new Set(value.flatMap(x=>Object.keys(x)))].slice(0,5);const cell=v=>Array.isArray(v)?v.map(item=>item&&typeof item==='object'?(item.name||item.skill||item.label||JSON.stringify(item)):item).join(', '):v&&typeof v==='object'?(v.capacityPercent!==undefined?`${v.capacityPercent}% capacity`:v.name||v.label||JSON.stringify(v)):v??'—';return '<div class="agent-table-wrap"><table class="agent-output-table"><thead><tr>'+keys.map(k=>'<th>'+esc(k.replaceAll(/([A-Z])/g,' $1'))+'</th>').join('')+'</tr></thead><tbody>'+value.map(row=>'<tr>'+keys.map(k=>'<td>'+esc(cell(row[k]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'}return '<ul>'+value.map(v=>'<li>'+esc(typeof v==='object'?JSON.stringify(v):v)+'</li>').join('')+'</ul>'}if(value&&typeof value==='object')return '<dl class="agent-output-fields">'+Object.entries(value).map(([k,v])=>'<div><dt>'+esc(k.replaceAll(/([A-Z])/g,' $1'))+'</dt><dd>'+(Array.isArray(v)||typeof v==='object'?renderAgentDetails(v):esc(v??'—'))+'</dd></div>').join('')+'</dl>';return '<p>'+esc(value??'—')+'</p>'}
function renderStructuredAgentOutput(agent,output,summary=''){return renderCompactAgentOutput(agent,output||{},summary,false)}
function trackingDashboardMarkup(report){const d=report?.dashboard;if(!d)return '';const rows=Array.isArray(d.taskProgress)?d.taskProgress:[],completed=Number(d.completion?.completed)||0,total=Number(d.completion?.total)||rows.length,pct=total?Math.round(completed/total*100):0;return `<section class="review-agent-section review-tracking-dashboard"><div class="review-section-heading"><div><div class="planner-eyebrow">JIRA PROGRESS</div><h2>Monitor Agent dashboard</h2><p>Checked ${reportEscape(new Date(report.checkedAt||d.checkedAt).toLocaleString())} · ${completed} of ${total} tasks complete</p></div></div><div class="history-progress"><span style="width:${pct}%"></span></div>${trackingMonitorOutputMarkup(d,reportEscape)}${rows.length?`<div class="history-task-table"><div class="history-task-row history-task-header"><span>Task</span><span>Jira status</span><span>Evidence</span></div>${rows.map(row=>`<div class="history-task-row"><span>${reportEscape(row.task||'')}</span><span>${reportEscape(row.status||'Unknown')}</span><span>${reportEscape(row.evidence||'')}</span></div>`).join('')}</div>`:''}${Array.isArray(d.kpiTracking)&&d.kpiTracking.length?renderAgentDetails(d.kpiTracking):''}${Array.isArray(d.deviationAlerts)&&d.deviationAlerts.length?`<ul>${d.deviationAlerts.map(alert=>`<li>${reportEscape(alert)}</li>`).join('')}</ul>`:''}</section>`;}
window.showPlan=function(plan){activePlannerPlan=plan;const items=plan.selectedItems||[],findings=plan.findings||[],outputs=plan.agentOutputs||[],orch=outputs.find(x=>x.agent==='Orchestrator Agent')||(plan.orchestrator?{summary:plan.summary,details:plan.orchestrator}:null),agents=outputs.filter(x=>!['Orchestrator Agent','Jira Publisher Agent'].includes(x.agent)),publisher=plan.publication,subcount=items.reduce((n,x)=>n+(x.subtasks||[]).length,0);const tasks=items.map((x,i)=>'<article class="review-task-card"><div class="review-task-top"><span class="review-task-number">'+(i+1)+'</span><div class="review-task-title"><h3>'+esc(x.summary)+'</h3><span>'+esc(x.issueType||'Task')+' · '+esc(x.assignee?.name||'Unassigned')+'</span></div></div><p class="review-task-description">'+esc(x.description||'')+'</p><strong>Acceptance criteria</strong><ul>'+(x.acceptanceCriteria||[]).map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul>'+((x.subtasks||[]).length?'<section class="review-subtasks"><h4>Subtasks · '+x.subtasks.length+'</h4>'+x.subtasks.map((s,j)=>'<article><b>'+(j+1)+'. '+esc(s.summary)+'</b>'+(s.assignedTo?.name?'<small class="review-subtask-owner">Owner: '+esc(s.assignedTo.name)+(s.assignedTo.role?' · '+esc(s.assignedTo.role):'')+'</small>':'')+'<p>'+esc(s.description||'')+'</p>'+(s.acceptanceCriteria?.length?'<ul>'+s.acceptanceCriteria.map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul>':'')+'</article>').join('')+'</section>':'')+'</article>').join('');const agentCard=a=>'<details class="agent-output-card"><summary><span><b>'+esc(a.agent)+'</b><small>'+esc(a.summary||'Result available')+'</small></span><span>View summary</span></summary><div class="agent-output-body">'+(a.details?renderAgentDetails(a.details):'<p>No structured result was recorded.</p>')+'</div></details>';const state=publisher?.status==='published'?'Published':plan.approval?.status==='rejected'?'Rejected':plan.approval?.status==='approved'?'Approved':'Ready to publish';plannerShell('<main class="planner-page review-page"><div class="planner-breadcrumb"><button class="planner-back" data-planner-back>← Plan history</button><span>/</span><strong>Plan review</strong></div><header class="review-hero"><div><div class="planner-eyebrow">SPRINT PLAN · '+esc(state.toUpperCase())+'</div><h1>'+esc(plan.goal)+'</h1><p>'+esc(plan.summary||'Review the proposed work and agent results.')+'</p></div><div class="review-hero-date"><span>SPRINT WINDOW</span><strong>'+prettyDate(plan.startDate)+'</strong><i>to</i><strong>'+prettyDate(plan.endDate)+'</strong></div></header><div class="review-overview-strip"><div><span>Tasks</span><strong>'+items.length+'</strong></div><div><span>Subtasks</span><strong>'+subcount+'</strong></div><div><span>Jira project</span><strong>'+esc(jiraProjectKey)+'</strong></div><div><span>Review checks</span><strong>'+findings.filter(f=>f.severity==='blocker'||f.severity==='warning').length+'</strong></div></div><section class="review-work-section"><div class="review-section-heading"><div><div class="planner-eyebrow">SPRINT WORK</div><h2>Tasks and delivery subtasks</h2><p>Each task includes its own QA verification and release impact check.</p></div></div><div class="review-task-list">'+(tasks||'<div class="empty-review">No tasks selected.</div>')+'</div></section>'+(orch?'<section class="orchestrator-output"><div class="planner-eyebrow">FINAL PLANNING DECISION</div><h2>Orchestrator Agent</h2><p>'+esc(orch.summary||plan.summary||'')+'</p>'+renderAgentDetails(orch.details||{})+'</section>':'')+'<section class="review-agent-section"><div class="review-section-heading"><div><div class="planner-eyebrow">AGENT RESULTS</div><h2>Outputs from the planning crew</h2><p>Each specialist has a plain-language purpose and a short summary of its result.</p></div></div><div class="agent-output-list">'+agents.map(agentCard).join('')+agentCard({agent:'Jira Publisher Agent',summary:publisher?.summary||'Jira Publisher runs automatically after planning.',details:{status:publisher?.status||'Waiting for Jira publishing',issues:publisher?.issues||[]}})+'</div></section><section class="plan-decision-bar"><div><strong>Ready for your decision</strong><span>Approve the plan to record your decision. Review notes and warnings remain available above.</span></div><div class="plan-decision-actions"><button class="secondary-button" id="rejectPlan" '+(plan.approval?.status==='rejected'||publisher?.status==='published'?'disabled':'')+'>Reject</button><button class="primary-button" id="approvePlan">Approve plan</button></div></section></main>');document.querySelector('[data-planner-back]')?.addEventListener('click',()=>window.setView('plans'));document.querySelector('#approvePlan')?.addEventListener('click',()=>window.approvePlan(plan.id));document.querySelector('#rejectPlan')?.addEventListener('click',()=>window.rejectPlan(plan.id))};/* Existing action helpers are reused, but resolve to the full-page showPlan above. */
// Older saved plans may only contain run summaries; keep those visible as agent cards.
const showPlanWithRunFallback=window.showPlan;
window.showPlan=function(plan){
  const items=plan.selectedItems||[],findings=plan.findings||[];
  const allItems=[...items,...(plan.deferredItems||[])].map(item=>({...item,description:cleanTaskDescription(item.description),subtasks:(item.subtasks||[]).map(sub=>({...sub,description:cleanTaskDescription(sub.description)}))}));
  const savedRecordDetails=run=>{
    const source='Derived from saved plan fields; this historical run did not store the agent’s detailed output.';
    const work=allItems.map(item=>({task:item.summary,owner:item.assignee?.name||'Unassigned',acceptanceCriteria:item.acceptanceCriteria||[],subtasks:(item.subtasks||[]).map(sub=>sub.summary)}));
    switch(run.agent){
      case 'Team Context Agent': return {source,capturedAt:plan.snapshot?.capturedAt||'Not recorded',team:plan.snapshot?.team?.map((member,index)=>{const profile=(window.team||[]).find(candidate=>candidate.id===member.id)||(window.team||[])[index]||{};return {name:member.name||profile.name||member.id||`Team member ${index+1}`,role:member.role||profile.role||'Role not recorded',availability:member.availability?.capacityPercent,confirmedSkills:(member.skills||profile.skills||[]).map(skill=>typeof skill==='string'?skill:skill.name||'')}})||[],jiraIssueCount:plan.snapshot?.jiraIssueCount??'Not recorded'};
      case 'Intake Agent': return {source,sprintGoal:plan.goal,startDate:plan.startDate,endDate:plan.endDate,requestedAndPlannedWork:work.map(item=>item.task),unresolvedQuestions:plan.unresolvedQuestions||[]};
      case 'Task Decomposer Agent': return {source,workItems:work};
      case 'Sprint Planner Agent': return {source,recommendedCandidate:plan.candidate?.name||'Not recorded',sequence:plan.candidate?.sequence?.length?plan.candidate.sequence:items.map(item=>item.id),selectedItems:items.map(item=>item.summary),deferredItems:(plan.deferredItems||[]).map(item=>item.summary),rationale:plan.candidate?.rationale||'',tradeoffs:plan.candidate?.tradeoffs||[]};
      case 'Predictor Agent': return {source,capacity:plan.capacity||{},risks:plan.risks||[],estimates:items.map(item=>({task:item.summary,...(item.estimate||{})}))};
      case 'Assignment Agent': return {source,assignments:items.map(item=>({task:item.summary,owner:item.assignee?.name||'Unassigned',rationale:item.assignmentRationale||'Not recorded',evidence:item.assignmentEvidence||[]}))};
      case 'Monitor Agent': return {source,statusReport:'No task-progress report was saved for this historical plan.',taskProgress:[],kpiTracking:[],deviationAlerts:[]};
      case 'Evaluator Agent': return {source,...(plan.evaluation||{}),overallAssessment:plan.evaluation?.overallAssessment||'No outcome assessment was saved for this historical plan.'};
      case 'Orchestrator Agent': return {source,decision:plan.status||'ready_for_review',summary:plan.summary||''};
      default: return {source,recordedRunSummary:run.summary||'No run summary recorded.'};
    }
  };
  const savedOutputs=new Map((plan.agentOutputs||[]).map(output=>[output.agent,output]));
  const sourceOutputs=(plan.agentRuns||[]).filter(run=>run.agent!=='Jira Publisher Agent').map(run=>{
    const saved=savedOutputs.get(run.agent)||{};
    return {agent:run.agent,summary:saved.summary||run.summary||`${run.status||'completed'} planning step`,details:{...savedRecordDetails(run),...(saved.details||{})}};
  });
  const displayItems=allItems.map(item=>{
    if(!(item.acceptanceCriteria||[]).some(value=>/\[PO REVIEW|to be confirmed|not specified|see openquestions/i.test(String(value))))return item;
    const summary=String(item.summary||'').toLowerCase(),text=`${summary} ${item.sourceText||''} ${item.description||''}`.toLowerCase();
    let acceptanceCriteria;
    if(/analytics|drop.?off|conversion|kpi|measure/.test(summary))acceptanceCriteria=['The report names its data source and exact date range; unavailable coverage is stated.','Each journey step reports eligible users, users continuing, and the calculated drop-off rate.','The largest drop-off points are ranked by rate and volume, with the calculation method included.','A reviewer can reproduce the figures from the linked query, export, or dashboard.'];
    else if(/feedback|interview|survey|support ticket|user review|synthesi[sz].*feedback/.test(summary))acceptanceCriteria=['The synthesis lists the feedback sources and collection period; inaccessible or excluded sources are named.','Findings are grouped into themes and each theme includes its supporting count.','Each theme is linked to a journey step with an anonymized example where available.','Source records or links are attached so the synthesis can be verified.'];
    else if(/current.*flow|document.*flow|journey map|user flow/.test(summary))acceptanceCriteria=['The flow shows entry, each user-visible step, decision branch, and exit or completion state.','Every step names the screen or interface element that implements it today.','The flow is checked against the current product; discrepancies include a reference.','The final flow is stored where design and engineering can access it.'];
    else if(/pain point|prioriti[sz].*(ux|user|experience)|ux research|usability/.test(summary))acceptanceCriteria=['Each pain point identifies the affected journey step and describes the user-visible problem.','Each item links to supporting feedback or analytics; unsupported hypotheses are labeled.','Items are ranked using an explicit impact-and-frequency method, with rationale recorded.','The prioritized list names a next action and is ready for design and frontend estimation.'];
    else if(/front.?end|implement.*(ui|journey|interface)|build.*(ui|journey|interface)|redesign|user interface/.test(summary))acceptanceCriteria=['The approved journey changes are implemented in the named screens and stay within the agreed product scope.','The affected journey works at mobile and desktop breakpoints without clipped content or horizontal overflow.','Loading, empty, success, and error states are visible and give users a clear next action.','Controls have accessible names, keyboard operation, and visible focus.','Automated checks for the changed journey and relevant regression checks pass.'];
    else acceptanceCriteria=['The requested deliverable is completed within scope and saved at the agreed project location.','The result includes evidence or a reference that lets a reviewer verify completion.','Known gaps, assumptions, or blocked work are recorded with an owner and next action.'];
    return {...item,acceptanceCriteria,needsPOReview:false};
  });
  const cleanItemByTitle=new Map(displayItems.map(item=>[item.summary,item]));
  sourceOutputs.forEach(output=>{
    if(output.details?.source&&Array.isArray(output.details.workItems))output.details.workItems=output.details.workItems.map(saved=>{const clean=cleanItemByTitle.get(saved.task);return clean?{...saved,acceptanceCriteria:clean.acceptanceCriteria}:saved;});
  });
  const owners=new Set(items.map(item=>item.assignee?.id||item.assignee?.name).filter(Boolean)).size;
  const qaTask=items.find(item=>item.id==='qa-e2e'||/comprehensive.{0,30}(end[- ]to[- ]end|qa|test)|end[- ]to[- ]end.{0,30}(qa|test|verification)|full.{0,25}journey.{0,20}(qa|test)/i.test(`${item.summary||''} ${item.description||''}`));
  const releaseTask=items.find(item=>item.id==='release-plan'||/sprint[- ]level release readiness|release readiness plan|release plan/i.test(`${item.summary||''} ${item.description||''}`));
  const uiImplementation=/\bui redesign\b|\bui\b.{0,20}improv|improv.{0,20}\bui\b|user interface.{0,20}(design|redesign|improve|implement|build)|redesign.{0,25}(ui|interface|screen)|front.?end.{0,25}(implement|build|deliver)|implement.{0,25}(ui|interface|screen)|build.{0,25}(ui|interface|screen)/i.test(String(plan.goal||''));
  const frontendTask=items.find(item=>/front.?end|implement.*(ui|interface|screen)|build.*(ui|interface|screen)|redesign/i.test(`${item.summary||''} ${item.description||''}`));
  const frontendOwner=frontendTask?.assignee?.name;
  const releaseOwner=releaseTask?.assignee?.name;
  const qaOwner=Boolean(qaTask?.assignee?.role&&/qa|quality assurance|test engineer/i.test(qaTask.assignee.role));
  const releaseManagerOwner=Boolean(releaseTask?.assignee?.role&&/release manager/i.test(releaseTask.assignee.role));
  const legacyFinding=f=>/^qa-(missing|owner)-/.test(f.id||'')||/^release-(impact-missing|owner)-/.test(f.id||'')||f.id==='ui-qa-journey-missing'||(!uiImplementation&&/^ui-(frontend|backend)-missing$/.test(f.id||''));
  const activeFindings=findings.filter(f=>!legacyFinding(f));
  const blockers=activeFindings.filter(f=>f.severity==='blocker').length;
  const hasReleaseTask=Boolean(releaseTask);
  const planNeedsRevision=!qaTask||!qaOwner||!releaseTask||!releaseManagerOwner||(uiImplementation&&!frontendOwner)||blockers>0;
  const briefLines=[`${items.length} planned tasks across ${owners} assigned team members.`,...(qaTask&&qaOwner?[`One comprehensive end-to-end QA task is assigned to ${qaTask.assignee.name}.`]:['A comprehensive end-to-end QA task with a confirmed QA owner is required.']),...(uiImplementation?(frontendOwner?[`Frontend delivery is assigned to ${frontendOwner}.`]:['Frontend implementation is missing from this UI delivery plan.']):[]),...(releaseTask&&releaseManagerOwner?[`One sprint release-readiness plan is assigned to ${releaseOwner}.`]:[hasReleaseTask?'The release-readiness task needs a confirmed Release Manager owner.':'A sprint-level Release Manager readiness task is missing.']),`Sprint window: ${plan.startDate||'start date not set'} to ${plan.endDate||'end date not set'}.`].slice(0,4);
    const cleanSummaryText=value=>cleanTaskDescription(String(value??'').replace(/\bPO REVIEW flags?\b/gi,'review note').replace(/\bsuggested owner(s)?\b/gi,'assigned owner$1').replace(/\bPO priority\b/gi,'request priority').replace(/\bthe PO\b/gi,'the team').replace(/\bPO questions\b/gi,'planning details').replace(/\bPO\b/gi,'request owner'));
    const sanitizeAgentValue=value=>typeof value==='string'?cleanSummaryText(value):Array.isArray(value)?value.map(sanitizeAgentValue):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!/(question|clarification)/i.test(key)).map(([key,entry])=>[key,sanitizeAgentValue(entry)])):value;
  const brief=briefLines.join(' ');
  const orchestrator=sourceOutputs.find(output=>output.agent==='Orchestrator Agent');
  const candidateNames=new Map([[plan.candidate?.id,plan.candidate?.name],...(plan.alternatives||[]).map(entry=>[entry.candidate?.id,entry.candidate?.name])].filter(([id,name])=>id&&name));
  const blueprint=buildBlueprintLines({...plan,selectedItems:items,findings:activeFindings});
  const safeSourceOutputs=sourceOutputs.map(output=>{
    if(output.agent==='Orchestrator Agent')return {...output,summary:cleanSummaryText(output.summary||'Final sprint blueprint is listed below.'),details:{status:'Ready for your decision',recommendedPlan:cleanSummaryText(output.details?.recommendedPlan||plan.candidate?.name||'Recommended sprint scope'),agentSummary:cleanSummaryText(output.details?.agentSummary||output.summary||''),roadmap:blueprint[0].replace(/^Selected delivery sequence: /,''),estimation:blueprint[1].replace(/^Task owners: /,''),owners:blueprint[2].replace(/^Goal-level validation: /,''),outcomeEvaluation:blueprint[3].replace(/^Outcome evaluation: /,''),selectedTaskCount:items.length}};
    if(output.agent==='Monitor Agent')return {...output,summary:cleanSummaryText(output.details?.statusReport||output.summary),details:sanitizeAgentValue(output.details||{})};
    if(output.agent==='Assignment Agent')return {...output,summary:`Ownership mapped for ${items.length} planned tasks.`,details:{assignments:items.map(item=>({task:item.summary,owner:item.assignee?.name||'Unassigned',role:item.assignee?.role||'',rationale:item.assignmentRationale||'Assignment reason not recorded.'}))}};
    if(output.agent==='Predictor Agent')return {...output,summary:`Effort and delivery confidence recorded for ${items.filter(item=>item.estimate).length} planned tasks.`,details:{estimates:items.filter(item=>item.estimate).map(item=>({task:item.summary,...item.estimate})),risks:plan.risks||[],capacity:{summary:plan.capacity?.summary||'Capacity context was not recorded.'}}};
    if(output.agent==='Evaluator Agent')return {...output,summary:cleanSummaryText(plan.evaluation?.overallAssessment||output.summary),details:sanitizeAgentValue(plan.evaluation||output.details||{})};
    return {...output,summary:cleanSummaryText(output.summary),details:sanitizeAgentValue(output.details)};
  });
  const safeOutputs=safeSourceOutputs;
  const visibleItems=displayItems.filter(item=>items.some(selected=>selected.id===item.id));
  const viewPlan={...plan,findings:activeFindings,_requiresRevision:planNeedsRevision,_fullSummary:brief,_fullAgentOutputs:safeSourceOutputs,agentOutputs:safeOutputs,selectedItems:visibleItems,summary:brief};
  if(!orchestrator&&plan.orchestrator)viewPlan.orchestrator={status:blockers||planNeedsRevision?'Needs revision':'Ready for review',recommendedPlan:cleanSummaryText(plan.candidate?.name||'Recommended sprint scope'),selectedTaskCount:items.length,subtaskCount:items.reduce((n,item)=>n+(item.subtasks||[]).length,0),qaTask:qaTask?.summary||'',...(frontendOwner?{frontendEngineer:frontendOwner}:{}),...(releaseOwner?{releaseManager:releaseOwner}:{}),blockingItems:activeFindings.filter(f=>f.severity==='blocker')};
  const rendered=showPlanWithRunFallback(viewPlan);
  if(viewPlan.status==='completed'){const stateLabel=document.querySelector('#plannerContent .review-hero .planner-eyebrow');if(stateLabel)stateLabel.textContent='SPRINT PLAN · COMPLETED';}
  const approveButton=document.querySelector('#plannerContent #approvePlan');
  if(approveButton&&publisher?.status!=='published')approveButton.removeAttribute('disabled');
  const decisionBar=document.querySelector('#plannerContent .plan-decision-bar');
  decisionBar?.remove();
  const hero=document.querySelector('#plannerContent .review-hero');
  if(hero&&!hero.querySelector('#trackCurrentPlan')){const button=document.createElement('button');button.id='trackCurrentPlan';button.className='secondary-button report-download-button';button.type='button';button.textContent='Track Jira progress';button.addEventListener('click',()=>window.trackCurrentPlan(button));hero.append(button);}
  document.querySelector('#plannerContent .review-tracking-dashboard')?.remove();
  if(plan.latestTracking?.dashboard){const mount=document.createElement('div');mount.innerHTML=trackingDashboardMarkup(plan.latestTracking);document.querySelector('#plannerContent .review-work-section')?.after(mount.firstElementChild);}
  const workflowStages=[['Team Context Agent','Team and project context'],['Intake Agent','Sprint request'],['Task Decomposer Agent','Task breakdown'],['Sprint Planner Agent','Scope and sequence'],['Predictor Agent','Task time, outcome likelihood, and rework forecast'],['Assignment Agent','Team ownership'],['Monitor Agent','Jira task and KPI progress tracking'],['Evaluator Agent','Usability, goal alignment, and outcome evaluation'],['Orchestrator Agent','Plan summary']];
  const workflow=document.createElement('section');workflow.className='completed-workflow-section';workflow.setAttribute('aria-label','Completed planning workflow');
  workflow.innerHTML='<div class="review-section-heading"><div><div class="planner-eyebrow">PLANNING WORKFLOW · COMPLETE</div><h2>Every planning step, in one view</h2><p>Follow the sequence, then open each agent below for its result.</p></div><span class="workflow-complete-badge">Plan ready</span></div><ol class="completed-workflow-list">'+workflowStages.map(([name,stage])=>`<li><span class="completed-workflow-check" aria-hidden="true">✓</span><div><strong>${reportEscape(name)}</strong><small>${reportEscape(stage)}</small></div><span class="completed-workflow-state">Complete</span></li>`).join('')+'<li class="publisher-workflow-row"><span class="completed-workflow-check" aria-hidden="true">↗</span><div><strong>Jira Publisher Agent</strong><small>Creates planned tasks in Jira</small></div><span class="completed-workflow-state">Runs automatically</span></li></ol>';
  document.querySelector('#plannerContent .review-work-section')?.before(workflow);
  const heroSummary=document.querySelector('#plannerContent .review-hero>div>p');
  if(heroSummary){const list=document.createElement('ul');list.className='plan-summary-bullets';briefLines.forEach(line=>{const bullet=document.createElement('li');bullet.textContent=line;list.append(bullet);});heroSummary.replaceWith(list);}
  const workIntro=document.querySelector('#plannerContent .review-work-section .review-section-heading p');
  if(workIntro)workIntro.textContent=`The delivery tasks are followed by one comprehensive end-to-end QA task and one sprint-level release-readiness plan. ${qaTask&&qaOwner?`QA owner: ${qaTask.assignee.name}.`:'A confirmed QA owner is required.'} ${releaseTask&&releaseManagerOwner?`Release owner: ${releaseOwner}.`:'A confirmed Release Manager owner is required.'}`;
  const decision=document.querySelector('#plannerContent .orchestrator-output');
  if(decision){
    const candidate={...(plan.candidate||{}),name:cleanSummaryText(plan.candidate?.name||'Recommended sprint plan'),rationale:cleanSummaryText(plan.candidate?.rationale||''),tradeoffs:(plan.candidate?.tradeoffs||[]).map(item=>typeof item==='string'?cleanSummaryText(item):{...item,summary:cleanSummaryText(item.summary||'')})},status=blockers||planNeedsRevision?'Needs revision':'Ready to publish';
    const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
    decision.replaceChildren();
    decision.append(node('div','planner-eyebrow','FINAL PLANNING DECISION'));
    decision.append(node('h2','','Sprint plan'));
    decision.append(node('p','agent-purpose',agentPurpose('Orchestrator Agent')));
    decision.append(node('h4','agent-output-label','Orchestrator Agent'));
    const summaryList=node('ul','decision-summary-list');
    blueprint.forEach(line=>summaryList.append(node('li','',cleanSummaryText(line))));
    decision.append(summaryList);
  }
  const snapshotIds=(plan.snapshot?.team||[]).map(member=>member.id).sort(),currentIds=(window.team||[]).map(member=>member.id).sort();
  const rosterChanged=snapshotIds.length&&currentIds.length&&(snapshotIds.length!==currentIds.length||snapshotIds.some((id,index)=>id!==currentIds[index]));
  if(rosterChanged&&!items.some(item=>item.id==='release-plan')){const notice=document.createElement('aside');notice.className='plan-context-notice';const copy=document.createElement('div'),title=document.createElement('strong'),message=document.createElement('p'),button=document.createElement('button');title.textContent='This saved draft predates the current team setup.';message.textContent='Create a fresh plan with one end-to-end QA task and one release-readiness plan assigned to the current team.';copy.append(title,message);button.type='button';button.className='secondary-button';button.textContent='Replan with current team';button.addEventListener('click',()=>window.newPlan());notice.append(copy,button);document.querySelector('#plannerContent .review-hero')?.after(notice);}
  const outputsByAgent=new Map(safeSourceOutputs.map(output=>[output.agent,output]));
  document.querySelectorAll('#plannerContent .agent-output-card').forEach(card=>{
    const name=card.querySelector('summary b')?.textContent||card.querySelector(':scope > strong')?.textContent||'';
      const output=outputsByAgent.get(name)||(name==='Jira Publisher Agent'?{agent:name,summary:plan.publication?.summary||'Waiting for plan approval.',details:{status:plan.publication?.status||'Waiting for plan approval',issues:plan.publication?.issues||[]}}:{agent:name,summary:card.querySelector('summary small')?.textContent||'',details:{}});
    if(card.nextElementSibling?.classList.contains('agent-output-preview'))card.nextElementSibling.remove();
    if(card.matches('details')){
      card.open=true;
      const purpose=card.querySelector('summary small');if(purpose)purpose.textContent=agentPurpose(name);
      const body=card.querySelector('.agent-output-body');if(body)body.innerHTML=renderCompactAgentOutput(name,name==='Sprint Planner Agent'?{...(output.details||{}),recommendedCandidate:plan.candidate?.name||output.details?.recommendedCandidate}:output.details||{},output.summary||'No detailed output was saved for this run.',false);
      const toggle=card.querySelector('summary>span:last-child');if(toggle){const update=()=>{toggle.textContent=card.open?'Hide details':'View details';};card.removeEventListener('toggle',update);card.addEventListener('toggle',update);update();}
    }else{
      const heading=card.querySelector(':scope > strong');card.replaceChildren(...[heading,document.createRange().createContextualFragment(renderCompactAgentOutput(name,name==='Sprint Planner Agent'?{...(output.details||{}),recommendedCandidate:plan.candidate?.name||output.details?.recommendedCandidate}:output.details||{},output.summary||'No detailed output was saved for this run.',false))].filter(Boolean));
    }
  });
  return rendered;
};
// Add the report action to every rendered review, including history reopen and saved updates.
const reportObserver=new MutationObserver(()=>{const hero=document.querySelector('#plannerContent .review-hero');if(hero&&!hero.querySelector('#downloadPlanReport')){const button=document.createElement('button');button.id='downloadPlanReport';button.className='secondary-button report-download-button';button.type='button';button.innerHTML='<span aria-hidden="true">↓</span> Download task list';button.addEventListener('click',()=>window.downloadPlanReport(activePlannerPlan));hero.append(button);}});
reportObserver.observe(document.querySelector('#plannerContent'),{childList:true,subtree:true});

window.trackCurrentPlan=async function(button){if(!activePlannerPlan?.id||button?.disabled)return;if(button){button.disabled=true;button.textContent='Checking Jira…';}try{const result=await api(`/plans/${encodeURIComponent(activePlannerPlan.id)}/track`,{method:'POST',body:JSON.stringify({})});activePlannerPlan=result.plan;const index=plans.findIndex(plan=>plan.id===result.plan.id);if(index>=0)plans[index]=result.plan;window.showPlan(result.plan);showToast('Monitor Agent refreshed Jira progress.');}catch(error){if(button){button.disabled=false;button.textContent='Track Jira progress';}showToast(error.message||'Could not check Jira progress.');}};

window.savePlanEdits = async function(plan) {
  const updates = (plan.selectedItems || []).map(item => ({ id: item.id, acceptanceCriteria: (document.querySelector(`[data-criteria="${CSS.escape(item.id)}"]`)?.value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean), assigneeId: document.querySelector(`[data-assignee="${CSS.escape(item.id)}"]`)?.value || '' }));
  try { const result = await api(`/plans/${encodeURIComponent(plan.id)}`, { method: 'PUT', body: JSON.stringify({ items: updates }) }); const index = plans.findIndex(x => x.id === plan.id); if (index >= 0) plans[index] = result.plan; window.showPlan(result.plan); showToast('Plan changes saved.'); }
  catch (error) { showToast(error.message); }
};
window.createDraftIssues = async function(id) {
  const button = document.querySelector('#createDraftIssues'); if (button) { button.disabled = true; button.textContent = 'Creating Jira drafts…'; }
  try { const result = await api(`/plans/${encodeURIComponent(id)}/draft-issues`, { method: 'POST', body: JSON.stringify({}) }); const index = plans.findIndex(p => p.id === id); if (index >= 0) plans[index] = result.plan; renderHistory(); window.showPlan(result.plan); showToast(`${result.issues.length} Jira draft task(s) ready.`); }
  catch (error) { showToast(error.message); if (button) { button.disabled = false; button.textContent = 'Create Jira draft tasks'; } }
};
window.approvePlan = async function(id) {
  const buttons = [...document.querySelectorAll('#approvePlan')]; buttons.forEach(b => { b.disabled = true; b.textContent = 'Publishing…'; });
  try { const result = await api(`/plans/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ approvedBy: 'PO/team' }) }); const index = plans.findIndex(p => p.id === id); if (index >= 0) plans[index] = result.plan; renderHistory(); window.showPlan(result.plan); showToast(result.publication?.summary || 'Approval recorded.'); }
  catch (error) { showToast(error.message); buttons.forEach(b => { b.disabled = false; b.textContent = 'Approve plan'; }); }
};
window.rejectPlan=async function(id){const button=document.querySelector('#rejectPlan');if(button){button.disabled=true;button.textContent='Rejecting…'}try{const result=await api(`/plans/${encodeURIComponent(id)}/reject`,{method:'POST',body:JSON.stringify({rejectedBy:'PO/team'})});const index=plans.findIndex(p=>p.id===id);if(index>=0)plans[index]=result.plan;renderHistory();window.showPlan(result.plan);showToast('Plan rejected. No Jira issues were created.')}catch(error){showToast(error.message);if(button){button.disabled=false;button.textContent='Reject'}}};
