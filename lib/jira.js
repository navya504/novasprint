const jiraBase = () => (process.env.JIRA_BASE_URL || '').replace(/\/+$/, '');
const jiraEmail = () => process.env.JIRA_EMAIL || '';
const jiraToken = () => process.env.JIRA_API_TOKEN || '';
export function jiraConfigured() { return Boolean(jiraBase() && jiraEmail() && jiraToken()); }

function headers() {
  const auth = Buffer.from(`${jiraEmail()}:${jiraToken()}`).toString('base64');
  return { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json', 'Content-Type': 'application/json' };
}
export async function jiraRequest(route, options = {}) {
  if (!jiraConfigured()) throw new Error('Jira connection is not configured on the server.');
  const response = await fetch(`${jiraBase()}${route}`, { ...options, headers: { ...headers(), ...(options.headers || {}) }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`Jira returned ${response.status}: ${detail.slice(0, 400)}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}
export async function testJira() {
  const user = await jiraRequest('/rest/api/3/myself');
  return { displayName: user.displayName, accountId: user.accountId, baseUrl: jiraBase() };
}
export async function listBoards(projectKey) {
  const query = new URLSearchParams({ maxResults: '50' });
  if (projectKey) query.set('projectKeyOrId', projectKey);
  const result = await jiraRequest(`/rest/agile/1.0/board?${query}`);
  return result.values || [];
}
export async function listSprints(boardId) {
  try {
    const result = await jiraRequest(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint?state=active,future,closed&maxResults=100`);
    return result.values || [];
  } catch (error) {
    // Kanban boards do not expose Jira sprint APIs; planning can still use their live issues.
    if (error.status === 400 && /board does not support sprints/i.test(error.message)) return [];
    throw error;
  }
}
export async function boardIssues(boardId) {
  const fields = 'summary,description,status,assignee,issuetype,components,labels,created,updated,resolutiondate,priority,project,issuelinks';
  const result = await jiraRequest(`/rest/agile/1.0/board/${encodeURIComponent(boardId)}/issue?maxResults=100&fields=${encodeURIComponent(fields)}`);
  return result.issues || [];
}
export async function projectIssues(projectKey) {
  if (!/^[A-Z][A-Z0-9_]*$/i.test(String(projectKey || ''))) throw new Error('Jira project key is invalid.');
  const result = await jiraRequest('/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({
      jql: `project = "${String(projectKey).replace(/"/g, '\\"')}" AND statusCategory != Done ORDER BY updated DESC`,
      maxResults: 100,
      fields: ['summary', 'status', 'assignee', 'issuetype', 'priority', 'updated', 'project']
    })
  });
  return result.issues || [];
}
export async function createIssue(projectKey, item, planId, { draft = false } = {}) {
  const criteria=(item.acceptanceCriteria||[]).map(value=>`• ${String(value).slice(0,500)}`).join('\n');
  const description = [draft ? 'NOVASPRINT DRAFT — PO confirmation required. This issue is not assigned or committed to a sprint.' : '', item.description || item.summary,criteria?`Acceptance criteria:\n${criteria}`:''].filter(Boolean).join('\n\n');
  const body = {
    fields: {
      project: { key: projectKey },
      summary: item.summary.slice(0, 250),
      description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description.slice(0, 3000) }] }] },
      issuetype: { name: item.issueType || 'Task' },
      labels: [`novasprint-plan-${planId.slice(0, 8)}`, ...(draft ? ['novasprint-draft'] : [])]
    }
  };
  const created = await jiraRequest('/rest/api/3/issue', { method: 'POST', body: JSON.stringify(body) });
  return created;
}
export async function createSubtask(parentKey, item, planId, { draft = false } = {}) {
  const criteria=(item.acceptanceCriteria||[]).map(value=>`• ${String(value).slice(0,500)}`).join('\n');
  const description=[draft?'NOVASPRINT DRAFT — PO confirmation required.':'',item.description||item.summary,criteria?`Acceptance criteria:\n${criteria}`:''].filter(Boolean).join('\n\n');
  return jiraRequest('/rest/api/3/issue',{method:'POST',body:JSON.stringify({fields:{project:{key:parentKey.split('-')[0]},parent:{key:parentKey},summary:String(item.summary||'').slice(0,250),description:{type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text:description.slice(0,3000)}]}]},issuetype:{name:'Sub-task'},labels:[`novasprint-plan-${planId.slice(0,8)}`,...(draft?['novasprint-draft']:[])]}})});
}
export async function findPlanIssue(projectKey, planId, summary) {
  const label = `novasprint-plan-${planId.slice(0, 8)}`;
  const jql = `project = "${projectKey.replace(/"/g, '\\"')}" AND labels = "${label}"`;
    const result = await jiraRequest('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql, maxResults: 100, fields: ['summary', 'status', 'assignee', 'labels', 'parent', 'updated', 'resolutiondate', 'duedate', 'priority'] }) });
  return result.issues || [];
}
export async function assignIssue(issueKey, accountId) {
  await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/assignee`, { method: 'PUT', body: JSON.stringify({ accountId }) });
}
export async function moveIssueToTodo(issueKey) {
  const key=encodeURIComponent(issueKey);
  const issue=await jiraRequest(`/rest/api/3/issue/${key}?fields=status`);
  const current=String(issue.fields?.status?.name||'').replace(/[\s_-]/g,'').toLowerCase();
  if(current==='todo')return {status:issue.fields.status.name,transitioned:false};
  const result=await jiraRequest(`/rest/api/3/issue/${key}/transitions`);
  const transition=(result.transitions||[]).find(item=>String(item.to?.name||'').replace(/[\s_-]/g,'').toLowerCase()==='todo');
  if(!transition)throw new Error(`Jira has no available transition from “${issue.fields?.status?.name||'unknown'}” to “To Do” for ${issueKey}.`);
  await jiraRequest(`/rest/api/3/issue/${key}/transitions`,{method:'POST',body:JSON.stringify({transition:{id:transition.id}})});
  return {status:transition.to.name,transitioned:true};
}
export async function addToSprint(sprintId, issueKeys) {
  if (!sprintId || !issueKeys.length) return;
  await jiraRequest(`/rest/agile/1.0/sprint/${encodeURIComponent(sprintId)}/issue`, { method: 'POST', body: JSON.stringify({ issues: issueKeys }) });
}
export async function linkIssues(outwardKey, inwardKey, type = 'Blocks') {
  await jiraRequest('/rest/api/3/issueLink', { method: 'POST', body: JSON.stringify({ type: { name: type }, outwardIssue: { key: outwardKey }, inwardIssue: { key: inwardKey } }) });
}
