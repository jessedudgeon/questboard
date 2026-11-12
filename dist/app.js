(() => {
  'use strict';
  const cfg = window.QUESTBOARD_CONFIG || {};
  const root = document.getElementById('app');
  const statusNames = {backlog:'Backlog',ready:'Ready',in_progress:'In Progress',blocked:'Blocked',in_review:'In Review',complete:'Complete',cancelled:'Cancelled'};
  const rpgStatusNames = {backlog:'Unclaimed',ready:'Available',in_progress:'In Battle',blocked:'Obstructed',in_review:'Verification',complete:'Victorious',cancelled:'Abandoned'};
  const priorityNames = {low:'Low',normal:'Normal',high:'High',critical:'Critical'};
  const navDefs = [
    {id:'home',icon:'▦',pro:'Dashboard',rpg:'Guild Hall'},
    {id:'mywork',icon:'☷',pro:'My Work',rpg:'Quest Journal'},
    {id:'projects',icon:'◫',pro:'Projects',rpg:'Campaigns'},
    {id:'calendar',icon:'▦',pro:'Calendar',rpg:'Quest Calendar'},
    {id:'team',icon:'♧',pro:'Team',rpg:'Party'},
    {id:'reports',icon:'◷',pro:'Reports',rpg:'Chronicle'},
    {id:'meetings',icon:'▤',pro:'Meetings',rpg:'Council'},
    {id:'admin',icon:'⚙',pro:'Administration',rpg:'Administration'}
  ];
  let api = null;
  let epoch=0, requestController=null, authRevision=0, signedOutLocally=false, signingOut=false, signOutFailed=false;
  let signupMode=false;
  let authError=null,authPending=false,inviteIntent=null,taskLinkIntent=null;
  const inviteKey='qb-pending-invitation';
  const validInvite=id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'');
  const providerEnabled=provider=>['google','azure'].includes(provider)&&cfg.authProviders?.[provider]!==false;
  function readAuthReturn(){
    const query=new URLSearchParams(location.search),fragment=new URLSearchParams((location.hash||'').replace(/^#/,''));
    const incoming=query.get('invite');
    try{
      const saved=JSON.parse(sessionStorage.getItem('qb-task-link')||'null');
      const candidate=query.has('task')?{task:query.get('task'),org:query.get('org')}:saved;
      if(candidate&&validInvite(candidate.task)&&validInvite(candidate.org)){taskLinkIntent=candidate;sessionStorage.setItem('qb-task-link',JSON.stringify(candidate));}
    }catch{}

    try{inviteIntent=validInvite(incoming)?incoming:sessionStorage.getItem(inviteKey);if(!validInvite(inviteIntent))inviteIntent=null;if(inviteIntent)sessionStorage.setItem(inviteKey,inviteIntent);}catch{inviteIntent=validInvite(incoming)?incoming:null;}
    if(['error','error_code','error_description'].some(key=>query.has(key)||fragment.has(key))){
      authError='Sign-in was not completed. Try again, or contact your administrator if it keeps happening.';
      // Provider text is untrusted and may contain sensitive details. Never display it.
      for(const key of ['error','error_code','error_description']){query.delete(key);fragment.delete(key);}
      try{history.replaceState(history.state,'',location.pathname+(query.size?'?'+query:'')+(fragment.size?'#'+fragment:''));}catch{}
    }
  }
  function invitationNotice(){
    if(!inviteIntent||s.demo)return '';
    const available=s.pendingInvitations.some(i=>i.id===inviteIntent);
    const message=!s.user?'Sign in with the email address that received this invitation.':available?'Your invitation is listed below. Review it and choose Accept invitation.':'This invitation is not available to this account. It may have expired, been revoked or already accepted. Check that you signed in with the invited email address.';
    return `<div class="invite-box" role="status"><strong>Organization invitation</strong><p>${esc(message)}</p><button class="btn sm" data-action="dismiss-invite">Dismiss notice</button></div>`;
  }
  function clearInviteIntent(){inviteIntent=null;try{sessionStorage.removeItem(inviteKey);const url=new URL(location.href);url.searchParams.delete('invite');history.replaceState(history.state,'',url.pathname+url.search+url.hash);}catch{}}
  async function startSignIn(provider){
    if(authPending||s.user)return;
    if(signingOut||signOutFailed){authError='Complete sign out before signing in.';render();return;}
    if(!providerEnabled(provider)){authError='This sign-in option is not available yet. Use an available option or contact your administrator.';render();return;}
    if(!api){authError='Sign-in could not load. Reload this page and try again.';render();return;}
    signedOutLocally=false;authError=null;authPending=true;render();const generation=epoch;
    try{
      const redirectTo=location.origin+location.pathname;
      const {error}=await api.auth.signInWithOAuth({provider,options:{redirectTo,scopes:provider==='azure'?'email':undefined}});
      if(error)throw error;
    }catch{if(generation===epoch)authError='Unable to start sign-in. Check your connection and try again. If it continues, contact your administrator.';}
    finally{authPending=false;if(generation===epoch)render();}
  }
  let inboxRequest=0,inboxTimer=null;
  const inbox={rows:[],unread:0,onlyUnread:false,loading:false,error:null,more:false,cursors:[null],demoRows:[]};
  const notificationLabels={assigned:'Assigned to you',review_requested:'Ready for your review',completed:'Task approved',changes_requested:'Changes requested',task_update:'New journal update',schedule_changed:'Due date changed',reopened:'Task reopened'};
  function resetInbox(resetFilters){
    inboxRequest++;clearTimeout(inboxTimer);
    Object.assign(inbox,{rows:[],unread:0,loading:false,error:null,more:false,cursors:[null],demoRows:[]});
    if(resetFilters)inbox.onlyUnread=false;
  }
  function inboxPage(){
    const controls=`<button class="btn sm" data-action="inbox-refresh" ${inbox.loading?'disabled':''}>Refresh inbox</button><button class="btn sm" data-action="inbox-read-page" ${inbox.loading||!inbox.rows.some(n=>!n.read_at)?'disabled':''}>Mark this page read</button>`;
    return pageTitle('Inbox','Assignments, reviews, and updates for this organization.',controls)+
      `<div class="filter-row" role="group" aria-label="Notification filter">${[['all','All'],['unread','Unread']].map(([value,label])=>`<button class="filter-pill ${inbox.onlyUnread===(value==='unread')?'active':''}" data-action="inbox-filter" data-value="${value}" aria-pressed="${inbox.onlyUnread===(value==='unread')}">${label}</button>`).join('')}<span role="status">${inbox.unread===null?'Unread count unavailable':inbox.unread+' unread in this organization'}</span></div>
      ${inbox.error?`<div class="auth-error" role="alert">Unable to load notifications. Use Refresh inbox to retry.</div>`:''}
      <section class="panel inbox-list" aria-busy="${inbox.loading}" aria-label="Notifications">${inbox.loading?'<div class="panel-body" role="status">Loading notifications…</div>':inbox.rows.length?inbox.rows.map(n=>`<article class="inbox-item ${n.read_at?'':'is-unread'}"><button class="inbox-open" data-action="inbox-open" data-id="${esc(n.id)}"><span>${esc(notificationLabels[n.kind]||'Task update')} · ${n.read_at?'Read':'Unread'}</span><strong>${esc(n.task_title)}</strong><span>${esc(n.project_title)} · ${esc(new Date(n.created_at).toLocaleString())}</span></button><button class="btn sm" data-action="inbox-read" data-id="${esc(n.id)}" data-value="${n.read_at?'false':'true'}">Mark ${n.read_at?'unread':'read'}</button></article>`).join(''):empty('✓','No notifications here','Try All or adjust your workspace and search filters. New notifications appear after assignments, reviews, or task updates.')}</section>
      <div class="inbox-pagination"><button class="btn sm" data-action="inbox-newer" ${inbox.loading||inbox.cursors.length===1?'disabled':''}>Newer</button><span>Page ${inbox.cursors.length}</span><button class="btn sm" data-action="inbox-older" ${inbox.loading||!inbox.more?'disabled':''}>Older</button></div>`;
  }
  function renderInbox(){
    const input=document.activeElement,searching=input?.id==='search',caret=searching?input.selectionStart:null;
    render();
    if(searching){const search=document.getElementById('search');search?.focus();search?.setSelectionRange(caret,caret);}
  }
  async function loadInbox(mode='reset'){
    if(!s.org||s.loading||s.nav!=='inbox')return;
    if(mode==='older'){
      const last=inbox.rows.at(-1);if(!inbox.more||!last)return;
      inbox.cursors.push({created_at:last.created_at,id:last.id});
    }else if(mode==='newer'){
      if(inbox.cursors.length===1)return;inbox.cursors.pop();
    }else if(mode==='reset')inbox.cursors=[null];
    const generation=epoch,request=++inboxRequest,cursor=inbox.cursors.at(-1);
    inbox.loading=true;inbox.error=null;inbox.rows=[];inbox.more=false;renderInbox();
    try{
      let rows,summary;
      if(s.demo){
        const query=s.query.trim().toLowerCase();
        const all=inbox.demoRows.filter(n=>taskFor(n.task_id)).map(n=>({...n,task_title:taskFor(n.task_id).title,project_title:projectFor(taskFor(n.task_id).project_id).title,project_id:taskFor(n.task_id).project_id}));
        summary=[{unread_count:all.filter(n=>!n.read_at).length}];
        rows=all.filter(n=>(!inbox.onlyUnread||!n.read_at)&&deptVisible(projectFor(n.project_id).department_id)&&(!query||(n.task_title+' '+n.project_title).toLowerCase().includes(query))&&(!cursor||n.created_at<cursor.created_at||n.created_at===cursor.created_at&&n.id<cursor.id)).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id)).slice(0,51);
      }else [rows,summary]=await Promise.all([
        getResult(api.rpc('qb_notification_page',{p_org:s.org.id,p_unread:inbox.onlyUnread,p_department:s.workspace==='all'?null:s.workspace,p_query:s.query.trim(),p_before:cursor?.created_at||null,p_before_id:cursor?.id||null})),
        getResult(api.rpc('qb_notification_summary',{p_org:s.org.id}))
      ]);
      if(generation!==epoch||request!==inboxRequest||s.nav!=='inbox')return;
      if(!Array.isArray(rows))throw Error('Invalid notification response');
      inbox.rows=rows.slice(0,50);inbox.more=rows.length>50;inbox.unread=Number(summary?.[0]?.unread_count||0);
    }catch(error){if(generation===epoch&&request===inboxRequest&&!error.stale)inbox.error=true;}
    finally{if(generation===epoch&&request===inboxRequest){inbox.loading=false;renderInbox();}}
  }
  function scheduleInboxSearch(){
    clearTimeout(inboxTimer);inboxRequest++;
    inboxTimer=setTimeout(()=>{if(s.nav==='inbox')loadInbox();},250);
  }
  async function readNotifications(ids,read){
    if(s.demo){for(const n of inbox.demoRows)if(ids.includes(n.id))n.read_at=read?new Date().toISOString():null;inbox.unread=inbox.demoRows.filter(n=>!n.read_at).length;}
    else await getResult(api.rpc('qb_read_notifications',{p_ids:ids,p_read:read}));
  }
  const projectStatuses={planned:'Planned',active:'Active',paused:'Paused',complete:'Complete',archived:'Archived'};
  let historyRequest=0;
  const projectHistory={projectId:null,rows:[],loading:false,error:false};
  function resetProjectHistory(){historyRequest++;Object.assign(projectHistory,{projectId:null,rows:[],loading:false,error:false});}
  function projectSettingsForm(){
    const p=projectFor(s.projectId);if(!p||!canManage(p.id))return '';
    const open=s.tasks.filter(t=>t.project_id===p.id&&!['complete','cancelled'].includes(t.status)).length;
    return `<form data-form="project-settings" data-project="${esc(p.id)}" data-revision="${p.revision||1}"><div class="modal-body"><div class="form-field"><label for="project-settings-title">Project name</label><input id="project-settings-title" name="title" required maxlength="160" value="${esc(p.title)}"></div><div class="form-field"><label for="project-settings-summary">Desired outcome</label><textarea id="project-settings-summary" name="summary" maxlength="5000">${esc(p.summary)}</textarea></div><div class="form-grid"><div class="form-field"><label for="project-settings-status">Project status</label><select id="project-settings-status" name="status">${Object.entries(projectStatuses).map(([id,label])=>`<option value="${id}" ${p.status===id?'selected':''}>${label}</option>`).join('')}</select></div><div class="form-field"><label for="project-settings-date">Target date</label><input id="project-settings-date" type="date" name="target_date" value="${esc(p.target_date||'')}"></div></div><p class="field-hint">${open} open tasks visible to you. Project status does not complete, freeze, or delete tasks. Archived projects remain accessible and can be restored by changing their status.</p><p class="field-hint">Department and access permissions are managed separately.</p><p data-project-settings-error role="alert"></p></div>${modalFooter('Save project')}</form>`;
  }
  async function loadProjectHistory(){
    const project=projectFor(s.projectId);if(!project||s.loading||s.nav!=='project-history')return;
    const generation=epoch,request=++historyRequest,id=project.id;
    Object.assign(projectHistory,{projectId:id,rows:[],loading:true,error:false});render();
    try{
      const rows=s.demo?s.projectChanges.filter(e=>e.project_id===id).sort((a,b)=>b.revision-a.revision).slice(0,50):await getResult(api.from('qb_project_changes').select('*').eq('project_id',id).order('revision',{ascending:false}).limit(50));
      if(generation!==epoch||request!==historyRequest||s.nav!=='project-history'||s.projectId!==id)return;
      if(!Array.isArray(rows))throw Error('Invalid history response');
      projectHistory.rows=rows;
    }catch(e){if(generation===epoch&&request===historyRequest&&!e.stale)projectHistory.error=true;}
    finally{if(generation===epoch&&request===historyRequest){projectHistory.loading=false;render();}}
  }
  function projectHistoryPage(){
    const p=projectFor(s.projectId);if(!p)return projectsPage();
    const labels={title:'Project name',summary:'Desired outcome',status:'Status',target_date:'Target date'};
    const value=(key,val)=>val===null||val===''?'Not set':key==='status'?(projectStatuses[val]||val):val;
    return `<div class="breadcrumb"><button data-action="project" data-id="${esc(p.id)}">${esc(p.title)}</button><span>›</span>Change history</div>`+pageTitle('Project change history',p.title,`<button class="btn" data-action="project-history" ${projectHistory.loading?'disabled':''}>Refresh history</button>`)+`<p class="muted">Latest 50 settings changes, newest first. History begins when this feature was enabled. Task activity remains in each task’s journal.</p><section class="panel project-history" aria-busy="${projectHistory.loading}"><div class="panel-body">${projectHistory.loading?'<p role="status">Loading project history…</p>':projectHistory.error?'<p role="alert">Unable to load history. Use Refresh history to retry.</p>':projectHistory.rows.map(e=>`<article class="project-change"><header><strong>${esc(e.actor_id?nameFor(e.actor_id):'System update')}</strong><span>${esc(new Date(e.created_at).toLocaleString())} · Revision ${esc(e.revision)}</span></header><dl>${Object.entries(labels).filter(([key])=>e.before_data?.[key]!==e.after_data?.[key]).map(([key,label])=>`<div><dt>${label}</dt><dd><span class="muted">Before:</span> ${esc(value(key,e.before_data?.[key]??null))}</dd><dd><span class="muted">After:</span> ${esc(value(key,e.after_data?.[key]??null))}</dd></div>`).join('')}</dl></article>`).join('')||'<p>No project settings changes recorded yet.</p>'}</div></section>`;
  }
  const taskViewDefaults={project:'all',owner:'all',status:'open',priority:'all',deadline:'all',dependency:'all',sort:'due'};
  const taskDeadlineNames={all:'Any deadline',overdue:'Overdue (open)',today:'Due today (open)',week:'Next 7 days (open)',undated:'No due date'};
  const taskExplorer={...taskViewDefaults,page:1,selected:''};
  let demoTaskViews=[];
  function resetTaskExplorer(){Object.assign(taskExplorer,taskViewDefaults,{page:1,selected:''});demoTaskViews=[];}
  function validTaskViewFilters(value){
    if(!value||typeof value!=='object')return null;
    const f={};
    for(const key of ['project','owner']){if(typeof value[key]!=='string'||value[key].length>128||!value[key])return null;f[key]=value[key];}
    const options={status:['all','open',...Object.keys(statusNames)],priority:['all',...Object.keys(priorityNames)],deadline:Object.keys(taskDeadlineNames),dependency:['all','waiting','clear'],sort:['due','priority','title','project']};
    for(const [key,allowed] of Object.entries(options)){if(!allowed.includes(value[key]))return null;f[key]=value[key];}
    if(typeof value.query!=='string'||value.query.length>200)return null;f.query=value.query;return f;
  }
  function taskViewsKey(){return s.user?.id&&s.org?.id?'qb-task-views:v1:'+s.user.id+':'+s.org.id:null;}
  function savedTaskViews(){
    if(s.demo)return {rows:demoTaskViews,error:null};
    const key=taskViewsKey();if(!key)return {rows:[],error:null};
    try{
      const raw=localStorage.getItem(key);if(!raw)return {rows:[],error:null};
      if(raw.length>40000)throw Error('Stored views are too large');
      const data=JSON.parse(raw);if(data.version!==1||!Array.isArray(data.views)||data.views.length>12)throw Error('Invalid stored views');
      const rows=data.views.map(v=>{
        if(!v||typeof v.id!=='string'||v.id.length>128||!v.id||typeof v.name!=='string'||!v.name.trim()||v.name.length>60)throw Error('Invalid stored view');
        const filters=validTaskViewFilters(v.filters);if(!filters)throw Error('Invalid filters');
        return {id:v.id,name:v.name,filters};
      });
      if(new Set(rows.map(v=>v.id)).size!==rows.length)throw Error('Duplicate stored views');
      return {rows,error:null};
    }catch{return {rows:[],error:'Saved views are unavailable in this browser. Filters still work. You can reset saved views to try again.'};}
  }
  function writeTaskViews(rows){
    if(s.loading||!taskViewsKey())throw Error('Open an organization before saving a view');
    if(s.demo){demoTaskViews=rows;return;}
    try{localStorage.setItem(taskViewsKey(),JSON.stringify({version:1,views:rows}));}catch{throw Error('Unable to save views in this browser. Your filters have been kept.');}
  }
  function saveTaskView(name){
    name=name.trim();if(!name||name.length>60)throw Error('Enter a view name up to 60 characters');
    const stored=savedTaskViews();if(stored.error)throw Error(stored.error);
    const filters=validTaskViewFilters({...taskExplorer,query:s.query.trim()});if(!filters)throw Error('Search must be 200 characters or fewer');
    const existing=stored.rows.find(v=>v.name.toLowerCase()===name.toLowerCase());
    if(!existing&&stored.rows.length>=12)throw Error('You can save up to 12 views. Remove a view first.');
    const view={id:existing?.id||uid(),name,filters};writeTaskViews([...stored.rows.filter(v=>v.id!==view.id),view]);taskExplorer.selected=view.id;return view;
  }
  function applyTaskView(id){
    const view=savedTaskViews().rows.find(v=>v.id===id);if(!view)return;
    const {query,...filters}=view.filters;Object.assign(taskExplorer,filters,{page:1,selected:id});s.query=query;
  }
  function allTasksData(today=new Date()){
    const projects=s.projects.filter(p=>deptVisible(p.department_id)),projectMap=new Map(projects.map(p=>[p.id,p]));
    const available=s.tasks.filter(t=>projectMap.has(t.project_id));
    const owners=[...new Set(available.map(t=>t.assignee_id).filter(Boolean))].sort((a,b)=>nameFor(a).localeCompare(nameFor(b))||a.localeCompare(b));
    const day=dateKey(today),end=dateKey(new Date(today.getFullYear(),today.getMonth(),today.getDate()+6,12)),query=s.query.trim().toLowerCase();
    const open=t=>!['complete','cancelled'].includes(t.status);
    const missingProject=taskExplorer.project!=='all'&&!projectMap.has(taskExplorer.project);
    const rows=available.filter(t=>taskExplorer.project==='all'||t.project_id===taskExplorer.project)
      .filter(t=>!query||(t.title+' '+(t.description||'')+' '+projectMap.get(t.project_id).title).toLowerCase().includes(query))
      .filter(t=>taskExplorer.owner==='all'||(taskExplorer.owner==='mine'?t.assignee_id===s.user?.id:taskExplorer.owner==='review'?t.reviewer_id===s.user?.id&&t.status==='in_review':taskExplorer.owner==='unassigned'?!t.assignee_id:taskExplorer.owner==='user:'+t.assignee_id))
      .filter(t=>taskExplorer.status==='all'||(taskExplorer.status==='open'?open(t):t.status===taskExplorer.status))
      .filter(t=>taskExplorer.priority==='all'||t.priority===taskExplorer.priority)
      .filter(t=>taskExplorer.dependency==='all'||(taskExplorer.dependency==='waiting'?dependencyWaiting(t.id):!dependencyWaiting(t.id)))
      .filter(t=>{const date=calendarDate(t.due_date);switch(taskExplorer.deadline){case'overdue':return open(t)&&date&&t.due_date<day;case'today':return open(t)&&date&&t.due_date===day;case'week':return open(t)&&date&&t.due_date>=day&&t.due_date<=end;case'undated':return !date;default:return true;}});
    const priority={critical:0,high:1,normal:2,low:3},due=t=>calendarDate(t.due_date)?t.due_date:'9999-99-99';
    rows.sort((a,b)=>(taskExplorer.sort==='priority'?(priority[a.priority]??4)-(priority[b.priority]??4):taskExplorer.sort==='title'?a.title.localeCompare(b.title):taskExplorer.sort==='project'?projectMap.get(a.project_id).title.localeCompare(projectMap.get(b.project_id).title):0)||due(a).localeCompare(due(b))||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
    const pages=Math.max(1,Math.ceil(rows.length/50));taskExplorer.page=Math.max(1,Math.min(pages,Number(taskExplorer.page)||1));
    return {rows,pageRows:rows.slice((taskExplorer.page-1)*50,taskExplorer.page*50),pages,projects,owners,missingProject,overdue:rows.filter(t=>open(t)&&calendarDate(t.due_date)&&t.due_date<day).length,waiting:rows.filter(t=>open(t)&&dependencyWaiting(t.id)).length};
  }
  function allTasksCSV(rows){
    const cell=v=>{let text=String(v??'');if(/^[\s]*[=+@-]|^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
    return [['Project','Department','Task','Assignee','Reviewer','Status','Priority','Due date','Waiting for prerequisites'],...rows.map(t=>[projectFor(t.project_id)?.title,deptFor(projectFor(t.project_id)?.department_id)?.name,t.title,nameFor(t.assignee_id),nameFor(t.reviewer_id),fmtStatus(t.status),priorityNames[t.priority],t.due_date,dependencyWaiting(t.id)?'Yes':'No'])].map(row=>row.map(cell).join(',')).join('\r\n');
  }
  function downloadAllTasks(){
    if(s.nav!=='alltasks'||s.loading||s.lastError||!s.org)return;
    const rows=allTasksData().rows;if(!rows.length)return;
    const url=URL.createObjectURL(new Blob(['\uFEFF',allTasksCSV(rows)],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='questboard-tasks-'+dateKey(new Date())+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function allTasksPage(){
    const data=allTasksData(),stored=savedTaskViews();
    const active=stored.rows.find(v=>v.id===taskExplorer.selected);
    if(active&&JSON.stringify(active.filters)!==JSON.stringify(validTaskViewFilters({...taskExplorer,query:s.query.trim()})))taskExplorer.selected='';
    const picker=(key,label,options)=>`<label for="tasks-${key}">${label}<select id="tasks-${key}" aria-label="${label}">${options.map(([id,title])=>`<option value="${esc(id)}" ${taskExplorer[key]===id?'selected':''}>${esc(title)}</option>`).join('')}</select></label>`;
    const ownerOptions=[['all','Anyone'],['mine','Assigned to me'],['review','Awaiting my review'],['unassigned','Unassigned'],...data.owners.map(id=>['user:'+id,nameFor(id)])];
    if(!ownerOptions.some(([id])=>id===taskExplorer.owner))ownerOptions.push([taskExplorer.owner,'Saved owner — no visible assignments']);
    const projectOptions=[['all','All projects'],...data.projects.map(p=>[p.id,p.title])];if(data.missingProject)projectOptions.push([taskExplorer.project,'Saved project — unavailable in this workspace']);
    return pageTitle(term('All tasks','Quest explorer'),'Find and follow up on work across your accessible projects.',`<button class="btn" data-action="tasks-refresh">Refresh tasks</button><button class="btn" data-action="tasks-export" ${data.rows.length?'':'disabled'}>Export matching tasks</button>`)+
      `<section class="panel task-explorer-controls"><div class="panel-body"><div class="task-view-toolbar"><label for="tasks-view">Saved view<select id="tasks-view" aria-label="Saved view"><option value="">Custom filters</option>${stored.rows.map(v=>`<option value="${esc(v.id)}" ${taskExplorer.selected===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></label><button class="btn sm" data-action="modal" data-value="task-view">Save current view</button><button class="btn sm" data-action="tasks-delete-view" ${stored.rows.some(v=>v.id===taskExplorer.selected)?'':'disabled'}>Remove saved view</button></div><p class="field-hint">Views save these filters and search text on this browser for your account and organization. The current workspace still applies. ${s.demo?'Demo views are temporary.':''}</p>${stored.error?`<p role="alert">${esc(stored.error)}</p><button class="btn sm" data-action="tasks-reset-storage">Reset saved views</button>`:''}
      <div class="task-explorer-filters">${picker('project','Project',projectOptions)}${picker('owner','Assignee or review',ownerOptions)}${picker('status','Task status',[['open','Open tasks'],['all','All statuses'],...Object.keys(statusNames).map(id=>[id,fmtStatus(id)])])}${picker('priority','Priority',[['all','Any priority'],...Object.entries(priorityNames)])}${picker('deadline','Deadline',Object.entries(taskDeadlineNames))}${picker('dependency','Dependencies',[['all','Any dependency state'],['waiting','Waiting for prerequisites'],['clear','No outstanding prerequisites']])}${picker('sort','Sort tasks',[['due','Due date'],['priority','Priority, then due date'],['title','Task name'],['project','Project, then due date']])}<button class="btn sm" data-action="tasks-clear">Clear filters</button></div></div></section>
      <p class="muted task-explorer-summary" role="status">${data.rows.length} matching tasks · ${data.overdue} overdue · ${data.waiting} waiting for prerequisites. Export includes all matches; pages show up to 50.</p>${data.missingProject?'<p class="auth-error" role="alert">The selected project is outside this workspace or no longer available. Choose another project or clear filters.</p>':''}
      <section class="panel task-explorer-list" aria-label="Matching tasks"><div class="panel-body">${data.pageRows.length?data.pageRows.map(t=>taskRow(t,true)).join(''):empty('◇','No matching tasks','Try another filter, workspace, or search. Only work you can currently access appears here.')}</div></section>
      <div class="inbox-pagination"><button class="btn sm" data-action="tasks-page" data-value="-1" ${taskExplorer.page===1?'disabled':''}>Previous tasks</button><span>Page ${taskExplorer.page} of ${data.pages}</span><button class="btn sm" data-action="tasks-page" data-value="1" ${taskExplorer.page===data.pages?'disabled':''}>Next tasks</button></div>`;
  }
  const activityDefaults={project:'all',person:'all',kind:'all',period:'7',from:'',to:'',task:null,page:1};
  const activity={...activityDefaults};
  const activityKinds={journal:'Journal updates',status:'Status changes',checklist:'Checklist changes',metadata:'Task details',dependency:'Dependencies',other:'Other activity'};
  const journalKinds={note:'Note',action:'Action taken',blocker:'Blocker reported',resolution:'Resolution',next_step:'Next step'};
  function demoTaskEvent(taskId,type,before,after){s.events.unshift({id:uid(),task_id:taskId,actor_id:s.user.id,event_type:type,before_data:before,after_data:after,created_at:new Date().toISOString()});}
  function resetActivity(){Object.assign(activity,activityDefaults);}
  function describeTaskEvent(event){
    const before=event.before_data||{},after=event.after_data||{};
    const status=value=>statusNames[value]?fmtStatus(value):'Unknown status';
    if(event.event_type==='status')return {kind:'status',label:'Status changed',text:(before.status?status(before.status)+' → ':'')+status(after.status)};
    if(event.event_type==='dependency_linked'||event.event_type==='dependency_unlinked')return {kind:'dependency',label:'Dependencies changed',text:event.event_type==='dependency_linked'?'Prerequisite linked':'Prerequisite removed'};
    if(event.event_type==='checklist'){
      const title=after.title||s.checklist.find(c=>c.id===after.item_id&&c.task_id===event.task_id)?.title||'Checklist item';
      const action=!event.before_data?'Checklist activity recorded':typeof before.done==='boolean'&&typeof after.done==='boolean'&&before.done!==after.done?(after.done?'Checklist item completed':'Checklist item reopened'):'Checklist item updated';
      return {kind:'checklist',label:action,text:title};
    }
    if(event.event_type==='metadata'){
      const format=(key,value)=>key==='assignee'?nameFor(value):key==='due'?(value?niceDate(value):'No due date'):key==='priority'?(priorityNames[value]||'Unknown priority'):String(value??'Not set');
      const labels={title:'Title',priority:'Priority',assignee:'Assignee',due:'Due date'};
      const changes=Object.entries(labels).filter(([key])=>Object.hasOwn(before,key)&&Object.hasOwn(after,key)&&before[key]!==after[key]).map(([key,label])=>label+': '+format(key,before[key])+' → '+format(key,after[key]));
      return {kind:'metadata',label:'Task details updated',text:changes.join('\n')||'Task details updated. Earlier history may not include the changed field values.'};
    }
    return {kind:'other',label:'Task activity',text:'An activity record was added to this task.'};
  }
  function activityData(now=new Date()){
    const projects=s.projects.filter(p=>deptVisible(p.department_id)),projectMap=new Map(projects.map(p=>[p.id,p]));
    const taskMap=new Map(s.tasks.filter(t=>projectMap.has(t.project_id)).map(t=>[t.id,t]));
    const source=[...s.updates.map((u,index)=>({key:'journal:'+String(u.id||index),taskId:u.task_id,actor:u.author_id,createdAt:u.created_at,kind:'journal',label:journalKinds[u.kind]||'Journal update',text:String(u.body||'')})),...s.events.map((e,index)=>({key:'event:'+String(e.id||index),taskId:e.task_id,actor:e.actor_id,createdAt:e.created_at,...describeTaskEvent(e)}))]
      .filter(row=>taskMap.has(row.taskId)&&row.createdAt&&Number.isFinite(new Date(row.createdAt).getTime()))
      .map(row=>({...row,task:taskMap.get(row.taskId),project:projectMap.get(taskMap.get(row.taskId).project_id),day:dateKey(new Date(row.createdAt))}));
    const people=[...new Set(source.map(r=>r.actor).filter(Boolean))].sort((a,b)=>nameFor(a).localeCompare(nameFor(b))||a.localeCompare(b));
    let from='',to='',error=null;
    if(activity.period==='custom'){
      from=activity.from;to=activity.to;
      if(from&&!calendarDate(from)||to&&!calendarDate(to))error='Enter valid dates for the activity range.';
      else if(from&&to&&from>to)error='The start date must be on or before the end date.';
    }else if(activity.period!=='all'){
      const days=activity.period==='today'?1:activity.period==='30'?30:7;
      from=dateKey(new Date(now.getFullYear(),now.getMonth(),now.getDate()-days+1,12));to=dateKey(now);
    }
    const query=s.query.trim().toLowerCase();
    const rows=error?[]:source.filter(r=>(activity.project==='all'||r.project.id===activity.project)&&(!activity.task||r.taskId===activity.task))
      .filter(r=>activity.kind==='all'||r.kind===activity.kind)
      .filter(r=>activity.person==='all'||(activity.person==='mine'?r.actor===s.user?.id:activity.person==='system'?!r.actor:activity.person==='user:'+r.actor))
      .filter(r=>(!from||r.day>=from)&&(!to||r.day<=to))
      .filter(r=>!query||(r.task.title+' '+r.project.title+' '+r.label+' '+r.text).toLowerCase().includes(query))
      .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)||a.key.localeCompare(b.key));
    const pages=Math.max(1,Math.ceil(rows.length/50));activity.page=Math.max(1,Math.min(pages,Number(activity.page)||1));
    return {rows,pageRows:rows.slice((activity.page-1)*50,activity.page*50),pages,projects,people,error,task:activity.task?taskMap.get(activity.task):null};
  }
  function activityCSV(rows){
    const cell=value=>{let text=String(value??'');if(/^[\s]*[=+@-]|^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
    return [['Timestamp (UTC)','Project','Task','Person','Activity type','Summary'],...rows.map(r=>[new Date(r.createdAt).toISOString(),r.project.title,r.task.title,r.actor?nameFor(r.actor):'System',r.label,r.text])].map(row=>row.map(cell).join(',')).join('\r\n');
  }
  function downloadActivity(){
    if(s.nav!=='activity'||s.loading||s.lastError||!s.org)return;
    const rows=activityData().rows;if(!rows.length)return;
    const url=URL.createObjectURL(new Blob(['\uFEFF',activityCSV(rows)],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='questboard-activity-'+dateKey(new Date())+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function activityPage(){
    const data=activityData();
    const select=(key,label,options)=>`<label for="activity-${key}">${label}<select id="activity-${key}" aria-label="${label}">${options.map(([id,title])=>`<option value="${esc(id)}" ${activity[key]===id?'selected':''}>${esc(title)}</option>`).join('')}</select></label>`;
    const projects=[['all','All projects'],...data.projects.map(p=>[p.id,p.title])];if(!projects.some(([id])=>id===activity.project))projects.push([activity.project,'Project unavailable in this workspace']);
    const people=[['all','Everyone'],['mine','My activity'],['system','System'],...data.people.map(id=>['user:'+id,nameFor(id)])];if(!people.some(([id])=>id===activity.person))people.push([activity.person,'Person has no visible activity']);
    const groups=[];for(const row of data.pageRows){if(groups.at(-1)?.day!==row.day)groups.push({day:row.day,rows:[]});groups.at(-1).rows.push(row);}
    return pageTitle(term('Activity','Guild activity'),'Catch up on recorded changes across the work you can access.',`<button class="btn" data-action="activity-refresh">Refresh activity</button><button class="btn" data-action="activity-export" ${data.rows.length?'':'disabled'}>Export activity</button>`)+
      `<section class="panel"><div class="panel-body activity-filters">${select('project','Activity project',projects)}${select('person','Person',people)}${select('kind','Activity type',[['all','All activity'],...Object.entries(activityKinds)])}${select('period','Date range',[['today','Today'],['7','Last 7 days'],['30','Last 30 days'],['all','All recorded history'],['custom','Custom dates']])}${activity.period==='custom'?`<label for="activity-from">From<input id="activity-from" type="date" value="${esc(activity.from)}"></label><label for="activity-to">Through<input id="activity-to" type="date" value="${esc(activity.to)}"></label>`:''}<button class="btn sm" data-action="activity-clear">Clear activity filters</button></div></section>
      ${activity.task?`<div class="invite-box">Task filter: <strong>${esc(data.task?.title||'Task no longer available in this workspace')}</strong> <button class="btn sm" data-action="activity-all-tasks">Show all tasks</button></div>`:''}
      <p class="muted activity-scope" role="status">${data.rows.length} matching records across ${new Set(data.rows.map(r=>r.taskId)).size} tasks. Dates use your browser’s local time; CSV timestamps use UTC. Search matches task names, projects, and activity text. Current workspace applies.</p>
      <p class="muted activity-scope">This is recorded task history, not a complete audit of every field. Counts show records, not unique actions. Refresh to fetch new activity.</p>
      ${data.error?`<p class="auth-error" role="alert">${esc(data.error)}</p>`:''}
      <section class="activity-feed" aria-label="Task activity">${groups.map(group=>`<section class="activity-day"><h2>${niceDate(group.day)}</h2><div class="panel">${group.rows.map(r=>`<article class="activity-record"><header><strong>${esc(r.actor?nameFor(r.actor):'System')}</strong><span>${esc(r.label)}</span><time datetime="${esc(r.createdAt)}">${esc(new Date(r.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}</time></header><button class="activity-task" data-action="task" data-id="${esc(r.taskId)}">${esc(r.task.title)}</button><p class="muted">${esc(r.project.title)}</p>${r.text.length>320?`<details><summary>Read full update</summary><p class="activity-text">${esc(r.text)}</p></details>`:`<p class="activity-text">${esc(r.text)}</p>`}</article>`).join('')}</div></section>`).join('')||empty('↻','No matching activity','Try another date range, project, person, or search. Only currently accessible tasks appear.')}</section>
      <div class="inbox-pagination"><button class="btn sm" data-action="activity-page" data-value="-1" ${activity.page===1?'disabled':''}>Newer activity</button><span>Page ${activity.page} of ${data.pages}</span><button class="btn sm" data-action="activity-page" data-value="1" ${activity.page===data.pages?'disabled':''}>Older activity</button></div>`;
  }
  const formEpoch=new WeakMap();
  const workspaceArrays=['projectChanges','departments','departmentMembers','orgMembers','projects','projectMembers','tasks','checklist','updates','events','xp','invitations','profiles','pendingInvitations','dependencies','dependencyReadiness','templates','milestones','briefs'];
  function invalidateWorkspace(resetNavigation=true){
    resetInbox(resetNavigation);resetProjectHistory();if(resetNavigation){resetTaskExplorer();resetActivity();}
    epoch++;requestController?.abort();requestController=typeof AbortController==='undefined'?null:new AbortController();
    candidateRequest++;membershipRequest++;
    Object.assign(membership,{scope:null,rows:[],events:[],loading:false,error:null,loaded:false});
    for(const key of workspaceArrays)s[key]=[];
    Object.assign(s,{org:null,requestedOrg:null,orgMembership:null,modal:null,menuOpen:false,busy:false,lastError:null,candidateRows:[],candidateProject:null,candidateTask:null,candidatesLoading:false,candidateError:null,creationTemplate:null,taskRequest:null,editMilestoneId:null,milestoneRequest:null,creationMilestone:null});
    if(resetNavigation)Object.assign(s,{reportView:'outlook',reportPeriod:'30',reportHealth:'all',reportClosed:false,reportProject:null,reportSignal:'all',workspace:'all',nav:'home',projectId:null,taskId:null,filter:'all',query:'',milestoneId:null,projectMilestone:'all',projectView:'board',projectOwner:'all',projectPriority:'all',projectReadiness:'all',projectSort:'due',projectClosed:false,dashboardView:'overview',plannerGroup:'owner',plannerSignal:'all',plannerCell:null,calendarMonth:null,calendarProject:'all',calendarScope:'all',calendarClosed:false});
    const notifications=document.getElementById('toast');if(notifications)notifications.innerHTML='';
    return epoch;
  }
  const stale=()=>Object.assign(new Error('Workspace changed'),{stale:true});
  const preferenceKey=id=>'qb-organization:'+id;
  function rememberedOrg(id){try{return sessionStorage.getItem(preferenceKey(id));}catch{return null;}}
  function rememberOrg(id,org){try{if(org)sessionStorage.setItem(preferenceKey(id),org);else sessionStorage.removeItem(preferenceKey(id));}catch{}}
  let candidateRequest = 0;
  let membershipRequest=0;
  const membership={scope:null,rows:[],events:[],loading:false,error:null,loaded:false};
  const s = { projectChanges:[], reportView:'outlook',reportPeriod:'30',reportHealth:'all',reportClosed:false,reportProject:null,reportSignal:'all', briefs:[],milestones:[],milestoneId:null,projectMilestone:'all',editMilestoneId:null,milestoneRequest:null,creationMilestone:null,templates:[],creationTemplate:null,taskRequest:null,projectView:'board',projectOwner:'all',projectPriority:'all',projectReadiness:'all',projectSort:'due',projectClosed:false,dashboardView:'overview',plannerGroup:'owner',plannerSignal:'all',plannerCell:null,calendarMonth:null,calendarProject:'all',calendarScope:'all',calendarClosed:false,user:null,loading:true,demo:false,organizations:[],org:null,orgMembership:null,departments:[],departmentMembers:[],projects:[],projectMembers:[],tasks:[],checklist:[],updates:[],events:[],xp:[],invitations:[],pendingInvitations:[],profiles:[],dependencies:[],dependencyReadiness:[],workspace:'all',nav:'home',projectId:null,taskId:null,modal:null,filter:'all',query:'',mode:localStorage.getItem('qb-mode')||'professional',menuOpen:false,busy:false,candidateRows:[],candidateProject:null,candidateTask:null,candidatesLoading:false,candidateError:null };
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const initials = v => String(v||'Q').trim().split(/\s+/).map(x=>x[0]||'').slice(0,2).join('').toUpperCase();
  const uid = () => (crypto?.randomUUID?.() || 'demo-'+Math.random().toString(36).slice(2));
  const niceDate = v => v ? new Date(String(v).length===10?v+'T12:00:00':v).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'No due date';
  const relative = v => { if(!v)return ''; const n=Math.round((Date.now()-new Date(v).getTime())/86400000); return n===0?'Today':n===1?'Yesterday':n<0?`${Math.abs(n)} days away`:`${n} days ago`; };
  const rpg = () => s.mode==='rpg';
  const term = (a,b) => rpg()?b:a;
  const tag = (name,label) => `<span class="tag ${esc(name)}">${esc(label||statusNames[name]||name)}</span>`;
  const pct = (project) => {const ts=s.tasks.filter(t=>t.project_id===project.id);return ts.length?Math.round(ts.filter(t=>t.status==='complete').length/ts.length*100):0;};
  const projectFor = id=>s.projects.find(x=>x.id===id);
  const taskFor = id=>s.tasks.find(x=>x.id===id);
  const deptFor = id=>s.departments.find(x=>x.id===id);
  const nameFor = id=>{if(!id)return 'Unassigned';if(s.demo)return ({'demo-user':'Jesse','sam':'Sam','eve':'Eve'})[id]||'Team member';const p=s.profiles.find(x=>x.user_id===id);return p?.display_name||'Team member';};
  const deptVisible = d => s.workspace==='all'||d===s.workspace;
  const visibleProjects = () => s.projects.filter(p=>deptVisible(p.department_id)).filter(p=>!s.query||(p.title+' '+p.summary).toLowerCase().includes(s.query.toLowerCase()));
  const visibleTasks = () => s.tasks.filter(t=>{const p=projectFor(t.project_id);return p&&deptVisible(p.department_id);}).filter(t=>!s.query||(t.title+' '+t.description).toLowerCase().includes(s.query.toLowerCase()));
  const myTasks = () => visibleTasks().filter(t=>t.assignee_id===s.user?.id||t.reviewer_id===s.user?.id&&t.status==='in_review');
  const isAdmin = () => s.demo||s.orgMembership?.role==='admin';
  const isDeptManager = deptId => s.demo||isAdmin()||s.departmentMembers.some(m=>m.department_id===deptId&&m.user_id===s.user?.id&&m.role==='manager'&&m.status==='active');
  const canManage = projectId => {const p=projectFor(projectId);return !!p&&(s.demo||s.departmentMembers.some(m=>m.department_id===p.department_id&&m.user_id===s.user?.id&&m.role==='manager'&&m.status==='active')||s.projectMembers.some(m=>m.project_id===projectId&&m.user_id===s.user?.id&&m.role==='lead'&&m.status==='active'));};
  const isReviewer = task => !!task&&(canManage(task.project_id)||task.reviewer_id===s.user?.id);
  const managedDepartments = () => s.departments.filter(d=>isDeptManager(d.id));
  const managedProjects = () => s.projects.filter(p=>canManage(p.id));
  const taskActions = t => {
    const worker=s.demo||t.assignee_id===s.user?.id||canManage(t.project_id),reviewer=isReviewer(t),independent=s.demo||t.assignee_id!==s.user?.id;
    if(!worker&&!reviewer)return [];
    const a=[];
    if(t.status==='backlog'&&canManage(t.project_id))a.push(['ready','Mark Ready']);
    if(t.status==='ready'&&worker)a.push(['in_progress',term('Start Work','Begin Quest')]);
    if(t.status==='in_progress'&&worker)a.push(['blocked','Mark Blocked'],['in_review','Submit for Review']);
    if(t.status==='blocked'&&worker)a.push(['in_progress','Resume Work']);
    if(t.status==='in_review'&&reviewer)a.push(['in_progress','Request Changes']);
    if(t.status==='in_review'&&reviewer&&independent)a.push(['complete',term('Approve & Complete','Declare Victory')]);
    if(t.status==='complete'&&canManage(t.project_id))a.push(['in_progress','Reopen']);
    return a.filter(([status])=>!(['in_progress','in_review','complete'].includes(status)&&dependencyWaiting(t.id))&&!(t.status==='complete'&&status==='in_progress'&&dependents(t.id).some(d=>['in_progress','in_review','complete'].includes(taskFor(d.task_id)?.status))));
  };
  const iconForProject = (title) => /network|technology|system|security|firewall/i.test(title)?'⌘':/facility|building|campus/i.test(title)?'⌂':/admission|student/i.test(title)?'◈':'✦';
  const fmtStatus = st=>rpg()?(rpgStatusNames[st]||st):(statusNames[st]||st);
  const toast=(message,error=false)=>{const d=document.createElement('div');d.className='toast'+(error?' error':'');d.textContent=message;document.getElementById('toast').appendChild(d);setTimeout(()=>d.remove(),4200);};
  const getResult=async p=>{const generation=epoch;
    if(requestController&&typeof p?.abortSignal==='function')p=p.abortSignal(requestController.signal);
    const {data,error}=await p;if(generation!==epoch)throw stale();
    if(error)throw new Error(error.message||'Unable to save');return data;
  };
  const pageSize=250,maxCollectionRows=20000;
  const rowKeys={qb_profiles:['user_id'],qb_org_members:['org_id','user_id'],qb_department_members:['department_id','user_id'],qb_project_members:['project_id','user_id']};
  async function pagedRows(makeQuery,keys=['id'],isCurrent=()=>true){
    const generation=epoch,rows=[],seen=new Set();
    for(let page=0;page<200;page++){
      if(generation!==epoch||!isCurrent())throw stale();
      let query=makeQuery();for(const key of keys)query=query.order(key,{ascending:true});
      const batch=await getResult(query.range(rows.length,rows.length+pageSize-1));
      if(generation!==epoch||!isCurrent())throw stale();
      if(!Array.isArray(batch))throw Error('Unable to read the complete workspace. Please retry.');
      if(!batch.length)return rows;
      if(rows.length+batch.length>maxCollectionRows)throw Error('This workspace is too large to load at once. Contact your administrator. No partial results are shown.');
      for(const row of batch){const key=JSON.stringify(keys.map(k=>row[k]));if(seen.has(key))throw Error('Workspace records changed while loading. Please retry.');seen.add(key);}
      rows.push(...batch);
      if(s.loading){s.loadedRows=(s.loadedRows||0)+batch.length;const progress=document.getElementById('load-progress');if(progress)progress.textContent=`${s.loadedRows.toLocaleString()} records loaded…`;}
    }
    throw Error('Unable to finish loading this workspace. Please retry.');
  }
  async function scopedRows(table,column,ids,select='*',configure=q=>q){
    const generation=epoch,uniqueIds=[...new Set(ids)],chunks=[];
    for(let i=0;i<uniqueIds.length;i+=100)chunks.push(uniqueIds.slice(i,i+100));
    // Requests for unrelated ID batches need not wait on one another. Keep a
    // small concurrency limit so large organizations do not flood the API.
    const results=new Array(chunks.length);let next=0;
    await Promise.all(Array.from({length:Math.min(3,chunks.length)},async()=>{
      while(next<chunks.length){
        if(generation!==epoch)throw stale();
        const index=next++;
        results[index]=await pagedRows(()=>configure(api.from(table).select(select).in(column,chunks[index])),rowKeys[table]||['id']);
      }
    }));
    const rows=results.flat();
    if(rows.length>maxCollectionRows)throw Error('This workspace is too large to load at once. Contact your administrator. No partial results are shown.');
    return rows;
  }
  async function loadDependencyReadiness(ids){
    const generation=epoch,rows=[];
    for(let i=0;i<ids.length;i+=100){
      if(generation!==epoch)throw stale();
      const batch=ids.slice(i,i+100),result=await pagedRows(()=>api.rpc('qb_dependency_readiness',{p_tasks:batch}),['task_id']);
      if(result.length!==batch.length)throw Error('Task access changed while loading. Please retry.');
      rows.push(...result);
    }
    return rows;
  }
  const prerequisites=id=>s.dependencies.filter(d=>d.task_id===id);
  const dependents=id=>s.dependencies.filter(d=>d.prerequisite_id===id);
  const dependencyWaiting=id=>s.demo?prerequisites(id).some(d=>taskFor(d.prerequisite_id)?.status!=='complete'):s.dependencyReadiness.some(r=>r.task_id===id&&r.waiting);
  function dependencyCycle(taskId,prerequisiteId){
    const queue=[prerequisiteId],seen=new Set();while(queue.length){const id=queue.pop();if(id===taskId)return true;if(seen.has(id))continue;seen.add(id);queue.push(...prerequisites(id).map(d=>d.prerequisite_id));}return false;
  }
  async function setDependency(taskId,prerequisiteId,link){
    const t=taskFor(taskId),p=taskFor(prerequisiteId);
    if(!t||!p||t.project_id!==p.project_id||!canManage(t.project_id))throw Error('Choose an available task in the same project');
    if(['complete','cancelled'].includes(t.status))throw Error('Reopen the task before changing dependencies');
    if(link&&dependencyCycle(taskId,prerequisiteId))throw Error('This link would create a circular dependency');
    if(link&&['in_progress','in_review'].includes(t.status)&&p.status!=='complete')throw Error('Mark this task blocked before linking an unfinished prerequisite');
    if(s.demo){
      const existed=prerequisites(taskId).some(d=>d.prerequisite_id===prerequisiteId);
      if(link&&!existed)s.dependencies.push({id:uid(),project_id:t.project_id,task_id:taskId,prerequisite_id:prerequisiteId});
      if(!link)s.dependencies=s.dependencies.filter(d=>d.task_id!==taskId||d.prerequisite_id!==prerequisiteId);
      if(link!==existed)demoTaskEvent(taskId,link?'dependency_linked':'dependency_unlinked',null,{});
    }else await getResult(api.rpc('qb_set_task_dependency',{p_task:taskId,p_prerequisite:prerequisiteId,p_link:link}));
  }
  function dependencyPanel(t){
    const editable=canManage(t.project_id)&&!['complete','cancelled'].includes(t.status),before=prerequisites(t.id),after=dependents(t.id);
    const candidates=s.tasks.filter(p=>p.project_id===t.project_id&&p.id!==t.id&&!before.some(d=>d.prerequisite_id===p.id)&&!dependencyCycle(t.id,p.id));
    const item=(d,incoming)=>{const other=taskFor(incoming?d.prerequisite_id:d.task_id);if(!other)return '';return `<li class="dependency-item"><button class="btn ghost" data-action="task" data-id="${esc(other.id)}">${esc(other.title)}</button>${tag(other.status,fmtStatus(other.status))}${incoming&&editable?`<button class="btn sm" data-action="unlink-dependency" data-id="${esc(d.prerequisite_id)}" aria-label="Remove prerequisite: ${esc(other.title)}">Remove link</button>`:''}</li>`;};
    return `<section class="panel"><div class="panel-head"><h3>Task dependencies</h3><button class="btn sm" data-action="copy-task-link" data-id="${esc(t.id)}" ${s.demo?'disabled':''}>Copy task link</button></div><div class="panel-body"><p>${dependencyWaiting(t.id)?'<strong>Waiting for prerequisites.</strong> Finish them before starting, resuming, reviewing or completing this task.':'All prerequisites are complete, or none are linked.'}</p><p class="muted">Links stay within this project. Only tasks you can access are shown.</p><h4>Depends on</h4><ul class="dependency-list">${before.map(d=>item(d,true)).join('')||'<li>No visible prerequisites.</li>'}</ul><h4>Needed by</h4><ul class="dependency-list">${after.map(d=>item(d,false)).join('')||'<li>No visible dependent tasks.</li>'}</ul>${editable?`<form data-form="dependency" class="dependency-form"><label for="dependency-task">Add prerequisite</label><select id="dependency-task" name="prerequisite_id" required><option value="">Choose a task that must finish first</option>${candidates.map(p=>`<option value="${esc(p.id)}">${esc(p.title)} — ${esc(fmtStatus(p.status))}</option>`).join('')}</select><button class="btn" type="submit">Link prerequisite</button></form>`:''}</div></section>`;
  }
  function loadDemo(){
    invalidateWorkspace();s.organizations=[];
    s.demo=true;s.user={id:'demo-user',email:'demo@questboard.test',user_metadata:{full_name:'Jesse'}};
    s.org={id:'demo-org',name:'University of Saint Francis'};s.orgMembership={role:'admin',status:'active'};
    s.departments=[{id:'it',name:'Information Technology',color:'#6585e5'},{id:'fac',name:'Facilities',color:'#32a89b'},{id:'adm',name:'Admissions',color:'#bb89e2'}];
    s.departmentMembers=[{department_id:'it',user_id:'demo-user',role:'manager',status:'active'}];
    s.orgMembers=[{org_id:'demo-org',user_id:'demo-user',role:'admin',status:'active'}];
    s.departmentMembers.push({department_id:'it',user_id:'sam',role:'contributor',status:'active'},{department_id:'it',user_id:'eve',role:'contributor',status:'active'});s.projectMembers=[{project_id:'p3',user_id:'demo-user',role:'lead',status:'active'},{project_id:'p3',user_id:'sam',role:'contributor',status:'active'}];s.profiles=[{user_id:'demo-user',display_name:'Jesse'},{user_id:'sam',display_name:'Sam'},{user_id:'eve',display_name:'Eve'}];
    s.projects=[
      {id:'p1',org_id:'demo-org',department_id:'it',title:'Network Infrastructure Modernization',summary:'Refresh aging switches, audit network assets, and standardize configurations.',status:'active',visibility:'department',target_date:'2026-12-15',lead_id:'demo-user'},
      {id:'p2',org_id:'demo-org',department_id:'it',title:'Critical Vulnerability Remediation',summary:'Close and verify high-impact findings across campus systems.',status:'active',visibility:'department',target_date:'2026-11-30',lead_id:'demo-user'},
      {id:'p3',org_id:'demo-org',department_id:'fac',title:'Campus Facilities Improvements',summary:'Coordinate shared technology and facility improvements.',status:'active',visibility:'invited',target_date:'2027-01-20',lead_id:'demo-user'}
    ];
    const task=(id,project_id,title,status,priority,assignee_id,due_date,xp_reward=30)=>({id,project_id,title,status,priority,assignee_id,due_date,xp_reward,description:'Document the work performed, identify blockers, and include verification before closing.',created_at:'2026-10-23T12:00:00Z',visibility:'inherit',reviewer_id:'demo-user'});
    s.tasks=[task('t1','p1','Complete Trinity switch inventory','in_progress','high','sam','2026-10-30',50),task('t2','p1','Document network naming standards','complete','normal','demo-user','2026-10-24',30),task('t3','p1','Upgrade Lafayette core firmware','ready','high','demo-user','2026-11-04',75),task('t4','p1','Identify unused wireless bridge','complete','low','sam','2026-10-20',25),task('t5','p2','Resolve PA-3220 image authentication issue','blocked','critical','demo-user','2026-11-02',100),task('t6','p2','Disable legacy SSH protocols','in_review','high','sam','2026-10-29',60),task('t7','p2','Verify Tenable critical findings','in_progress','high','eve','2026-10-31',55),task('t8','p2','Rescan remediated systems','complete','normal','demo-user','2026-10-23',40),task('t9','p3','Inspect network closets and UPS devices','ready','normal','sam','2026-11-06',40)];
    s.checklist=[{id:'c1',task_id:'t1',title:'Record model and serial',done:true},{id:'c2',task_id:'t1',title:'Record IP and firmware',done:true},{id:'c3',task_id:'t1',title:'Verify uplink ports',done:false},{id:'c4',task_id:'t5',title:'Validate image and license state',done:false},{id:'c5',task_id:'t5',title:'Document maintenance plan',done:false}];
    s.updates=[{id:'u1',task_id:'t5',author_id:'demo-user',kind:'blocker',body:'Image authentication is failing. Next action: validate download and licensing state.',created_at:'2026-10-24T15:00:00Z'},{id:'u2',task_id:'t1',author_id:'sam',kind:'action',body:'Completed physical inspection of the first closet. Uplinks still need verification.',created_at:'2026-10-25T14:00:00Z'}];
    s.briefs=[{id:'brief-demo-1',project_id:'p1',author_id:'demo-user',health:'at_risk',accomplishments:'Completed the first round of network closet inspections and documented the switch baseline.',next_steps:'Review upgrade plans and schedule the next maintenance window.',risks:'Legacy hardware may require additional replacement funding.',decisions:'Confirm which network closets receive priority.',created_at:new Date().toISOString()}];
    s.events=[{id:'demo-status',task_id:'t6',actor_id:'sam',event_type:'status',before_data:{status:'in_progress'},after_data:{status:'in_review'},created_at:new Date().toISOString()},{id:'demo-check',task_id:'t1',actor_id:'sam',event_type:'checklist',before_data:{done:false},after_data:{item_id:'c1',title:'Record model and serial',done:true},created_at:new Date(Date.now()-3600000).toISOString()}];s.xp=[{task_id:'t2',user_id:'demo-user',amount:30},{task_id:'t8',user_id:'demo-user',amount:40}];s.invitations=[];s.pendingInvitations=[];
    inbox.demoRows=[{id:'sample-review',task_id:'t6',kind:'review_requested',created_at:'2026-11-07T12:00:00Z',read_at:null},{id:'sample-assignment',task_id:'t3',kind:'assigned',created_at:'2026-11-07T11:00:00Z',read_at:null},{id:'sample-update',task_id:'t5',kind:'task_update',created_at:'2026-11-07T10:00:00Z',read_at:'2026-11-07T10:05:00Z'}];inbox.unread=2;
    s.loading=false;s.nav='home';s.workspace='all';render();
  }
  async function loadLive(requestedOrg=s.org?.id||s.requestedOrg||rememberedOrg(s.user?.id),resetNavigation=false){
    if(!api||!s.user||s.demo)return;
    const user=s.user,generation=invalidateWorkspace(resetNavigation);
    s.requestedOrg=requestedOrg;s.loadedRows=0;s.loading=true;render();
    try{
      const profile={user_id:user.id,display_name:user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split('@')[0]||'Member',preferred_mode:s.mode};
      await getResult(api.from('qb_profiles').upsert(profile,{onConflict:'user_id'}));
      const [pendingInvitations,memberships]=await Promise.all([
        pagedRows(()=>api.rpc('qb_my_invitations')),
        pagedRows(()=>api.from('qb_org_members').select('*').eq('user_id',user.id).eq('status','active'),rowKeys.qb_org_members)
      ]);
      const organizations=await scopedRows('qb_organizations','id',memberships.map(m=>m.org_id),'id,name',q=>q.order('name'));
      const orgMembership=memberships.find(m=>m.org_id===requestedOrg&&organizations.some(o=>o.id===m.org_id))||memberships.find(m=>organizations.some(o=>o.id===m.org_id))||null;
      const org=organizations.find(o=>o.id===orgMembership?.org_id)||null;
      if(!org){taskLinkIntent=null;try{sessionStorage.removeItem('qb-task-link');}catch{}s.organizations=[];s.pendingInvitations=pendingInvitations;rememberOrg(user.id,null);s.loading=false;render();return;}
      const [departments,projects]=await Promise.all([
        pagedRows(()=>api.from('qb_departments').select('*').eq('org_id',org.id).order('name')),
        pagedRows(()=>api.from('qb_projects').select('*').eq('org_id',org.id).order('created_at',{ascending:false}))
      ]);
      const projectIds=projects.map(p=>p.id),departmentIds=departments.map(d=>d.id);
      const [departmentMembers,projectMembers,tasks,orgMembers,invitations,templates,milestones,briefs,notificationSummary]=await Promise.all([
        scopedRows('qb_department_members','department_id',departmentIds),
        scopedRows('qb_project_members','project_id',projectIds),
        scopedRows('qb_tasks','project_id',projectIds,'*',q=>q.order('created_at',{ascending:false})),
        orgMembership.role==='admin'?pagedRows(()=>api.from('qb_org_members').select('*').eq('org_id',org.id),rowKeys.qb_org_members):Promise.resolve([]),
        orgMembership.role==='admin'?pagedRows(()=>api.from('qb_invitations').select('*').eq('org_id',org.id).order('created_at',{ascending:false})):Promise.resolve([]),
        scopedRows('qb_task_templates','project_id',projectIds),
        scopedRows('qb_milestones','project_id',projectIds),
        scopedRows('qb_project_briefs','project_id',projectIds,'*',q=>q.order('created_at',{ascending:false})),
        getResult(api.rpc('qb_notification_summary',{p_org:org.id})).catch(()=>null)
      ]);
      const taskIds=tasks.map(t=>t.id);
      const [checklist,updates,events,xp,dependencies,dependencyReadiness]=await Promise.all([
        scopedRows('qb_checklist','task_id',taskIds,'*',q=>q.order('position')),
        scopedRows('qb_task_updates','task_id',taskIds,'*',q=>q.order('created_at',{ascending:false})),
        scopedRows('qb_task_events','task_id',taskIds,'*',q=>q.order('created_at',{ascending:false})),
        scopedRows('qb_xp_events','task_id',taskIds),
        scopedRows('qb_task_dependencies','project_id',projectIds),
        loadDependencyReadiness(taskIds)
      ]);
      // Batches are individually ordered; restore one global chronology for feeds.
      const newest=(a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||String(a.id).localeCompare(String(b.id));
      tasks.sort(newest);updates.sort(newest);events.sort(newest);
      const people=[...new Set([user.id,...orgMembers.map(m=>m.user_id),...departmentMembers.map(m=>m.user_id),...projectMembers.map(m=>m.user_id),...tasks.flatMap(t=>[t.assignee_id,t.reviewer_id,t.created_by]),...updates.map(u=>u.author_id),...events.map(e=>e.actor_id)].filter(Boolean))];
      const profiles=await scopedRows('qb_profiles','user_id',people,'user_id,display_name');
      // Recheck membership at commit: suspension during the load must not publish its snapshot.
      const current=await getResult(api.from('qb_org_members').select('org_id,role,status').eq('org_id',org.id).eq('user_id',user.id).eq('status','active'));
      if(!current.length||current[0].role!==orgMembership.role){s.organizations=[];rememberOrg(user.id,null);throw Error('Organization access changed. Reload your workspace.');}
      if(generation!==epoch)return;
      Object.assign(s,{organizations,orgMembership,org,pendingInvitations,departments,departmentMembers,projects,projectMembers,tasks,checklist,updates,events,xp,profiles,orgMembers,invitations,dependencies,dependencyReadiness,templates,milestones,briefs});
      inbox.unread=notificationSummary===null?null:Number(notificationSummary?.[0]?.unread_count||0);
      rememberOrg(user.id,org.id);
      if(requestedOrg&&requestedOrg!==org.id)Object.assign(s,{workspace:'all',nav:'home',projectId:null,taskId:null,filter:'all',query:''});
      if(!departments.some(d=>d.id===s.workspace))s.workspace='all';
    }catch(e){if(generation!==epoch||e.stale)return;s.lastError=e.message;}
    if(generation!==epoch)return;s.loading=false;
    let linkUnavailable=false;
    if(!s.lastError&&taskLinkIntent){
      const intent=taskLinkIntent;taskLinkIntent=null;try{sessionStorage.removeItem('qb-task-link');}catch{}
      const linked=s.org?.id===intent.org?taskFor(intent.task):null;
      if(linked){s.taskId=linked.id;s.projectId=linked.project_id;s.nav='task';}else linkUnavailable=true;
    }
    render();if(linkUnavailable)toast('This task link is unavailable to your account.',true);if(!s.lastError&&s.nav==='inbox')await loadInbox();if(!s.lastError&&s.nav==='project-history')await loadProjectHistory();return !s.lastError;
  }
  async function switchOrganization(id){
    if(s.demo||!s.user)return;
    if(!s.organizations.some(o=>o.id===id))return;
    await loadLive(id,true);
  }
  function organizationSelector(){return !s.demo&&s.organizations.length?`<select class="workspace-select" id="organization-select" aria-label="Organization">${s.organizations.map(o=>`<option value="${esc(o.id)}" ${o.id===(s.org?.id||s.requestedOrg)?'selected':''}>${esc(o.name)}</option>`).join('')}<option value="__create__">＋ Create organization</option></select>`:'';}
  function receiveSession(event,session){
    authRevision++;
    if(s.demo)return;
    const user=session?.user||null;
    if(signedOutLocally&&user)return;
    if(user)authError=null;
    if(!user){invalidateWorkspace();s.user=null;s.organizations=[];s.loading=false;render();return;}
    if(user.id===s.user?.id&&event!=='INITIAL_SESSION'){s.user=user;if(event==='TOKEN_REFRESHED'){const generation=epoch,org=s.org?.id;setTimeout(()=>{if(generation===epoch&&!s.demo)loadLive(org);},0);}return;}
    invalidateWorkspace();s.organizations=[];s.user=user;s.loading=true;render();
    const generation=epoch;
    // Do not await Supabase requests within its synchronous auth callback.
    setTimeout(()=>{if(generation===epoch&&!s.demo)loadLive(taskLinkIntent?.org||rememberedOrg(user.id),true);},0);
  }
  async function signOut(){
    if(signingOut)return;
    signingOut=true;signOutFailed=false;signedOutLocally=true;const user=s.user;
    invalidateWorkspace();s.user=null;s.organizations=[];s.loading=false;render();
    if(user)rememberOrg(user.id,null);
    try{if(api){const {error}=await api.auth.signOut({scope:'local'});if(error)throw error;}}
    catch(e){signOutFailed=true;toast('Workspace cleared. Sign-out could not be confirmed; retry Sign out before signing in.',true);}
    finally{signingOut=false;render();}
  }
  function header(){
    const name=s.user?.user_metadata?.full_name||s.user?.user_metadata?.name||s.user?.email?.split('@')[0]||'Member';
    const defs=[...navDefs];
    return `<div class="shell ${s.menuOpen?'menu-open':''}"><aside class="sidebar"><div class="brand"><span class="logo">✦</span><span>QuestBoard<small>WORK, REIMAGINED</small></span></div>
      <div class="sidebar-label">Workspace</div>${defs.slice(0,4).map(x=>navItem(x)).join('')}${navItem({id:'alltasks',icon:'☷',pro:'All tasks',rpg:'Quest explorer'})}
      <div class="sidebar-label">Collaboration</div>${defs.slice(4,7).map(x=>navItem(x)).join('')}${navItem({id:'inbox',icon:'✉',pro:'Inbox',rpg:'Inbox'})}${navItem({id:'activity',icon:'↻',pro:'Activity',rpg:'Guild activity'})}
      <div class="side-bottom">${membershipScopes().length?navItem(defs[7]):''}<div class="sidebar-note"><strong>${term('Keep momentum visible','Every quest matters')}</strong>${term('Own the work, document the progress, celebrate verified results.','Complete objectives, help your party, and grow your mastery.')}</div><div class="account"><span class="avatar">${esc(initials(name))}</span><div><strong>${esc(name)}</strong><small>${s.demo?'Demo administrator':isAdmin()?'Organization administrator':'Team member'}</small></div></div></div></aside>
      <main class="main">${s.demo?`<div class="demo-banner">✦ You are exploring sample data. Changes are temporary and are not saved. <button data-action="exit-demo">Exit demo</button></div>`:''}
      <header class="topbar"><div class="top-left">${organizationSelector()}<button class="mobile-menu" data-action="menu" aria-label="Open menu">☰</button><select class="workspace-select" id="workspace-select" ${s.loading?'disabled':''} aria-label="Current workspace"><option value="all">All workspaces</option>${s.departments.map(d=>`<option value="${esc(d.id)}" ${s.workspace===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div><div class="top-right">${managedDepartments().length||managedProjects().length?`<button class="btn primary sm" data-action="modal" data-value="quick-task">＋ Quick task</button>`:""}<label class="search"><span>⌕</span><input id="search" placeholder="Search work…" value="${esc(s.query)}" aria-label="Search projects and tasks"></label><div class="mode-switch"><button data-action="mode" data-value="professional" class="${!rpg()?'active':''}">◫ Work</button><button data-action="mode" data-value="rpg" class="${rpg()?'active':''}">✦ Quest</button></div>${!s.demo?`<button class="btn sm" data-action="logout">Sign out</button>`:''}<span class="user-dot" title="${esc(s.user?.email)}">${esc(initials(name))}</span></div></header>
      <div class="page" aria-busy="${s.loading}">${s.loading?loadingContent():s.lastError?loadError():`${invitationNotice()}${s.pendingInvitations.map(i=>`<div class="invite-box"><strong>${esc(i.org_name)}: ${esc(i.invite_role.replace(/_/g,' '))}</strong> <button class="btn sm" data-action="accept-invite" data-id="${i.id}">Accept invitation</button></div>`).join('')}${pageContent()}`}</div></main></div>${s.loading||s.lastError?'':modalHTML()}`;
  }
  function navItem(x){return `<button class="nav-link ${s.nav===x.id?'active':''}" data-action="nav" data-value="${x.id}"><span class="nav-icon">${x.icon}</span><span>${esc(rpg()?x.rpg:x.pro)}</span>${x.id==='inbox'&&inbox.unread>0?`<span class="pill-count" aria-label="${inbox.unread} unread notifications">${inbox.unread}</span>`:''}${x.id==='mywork'?`<span class="pill-count">${myTasks().filter(t=>!['complete','cancelled'].includes(t.status)).length}</span>`:''}</button>`;}
  function pageContent(){switch(s.nav){case'home':return dashboard();case'inbox':return inboxPage();case'mywork':return workPage();case'alltasks':return allTasksPage();case'activity':return activityPage();case'calendar':return calendarPage();case'projects':return projectsPage();case'project':return projectPage();case'project-history':return projectHistoryPage();case'milestone':return milestonePage();case'task':return taskPage();case'team':return teamPage();case'reports':return reportsPage();case'meetings':return meetingsPage();case'admin':return adminPage();default:return dashboard();}}
  const pageTitle=(title,desc,actions='')=>`<div class="page-heading"><div><div class="eyebrow">${esc(s.org?.name||'QuestBoard')}</div><h1>${esc(title)}</h1><p class="lead">${esc(desc)}</p></div><div class="buttons">${actions}</div></div>`;
  const empty=(icon,title,desc,button='')=>`<div class="empty"><span class="empty-icon">${icon}</span><h3>${esc(title)}</h3><p>${esc(desc)}</p>${button}</div>`;
  function projectCard(p){const progress=pct(p),department=deptFor(p.department_id);return `<article class="project-card" data-action="project" data-id="${p.id}"><div class="project-icon">${iconForProject(p.title)}</div><div class="overline">${esc(department?.name||'Workspace')} · ${esc(p.status)}</div><h3>${esc(rpg()?questProjectName(p):p.title)}</h3><p class="desc">${esc(p.summary||'A place for meaningful work and shared progress.')}</p><div class="project-meta"><strong>${progress}% ${term('complete','conquered')}</strong><span>${niceDate(p.target_date)}</span></div><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div><div class="project-meta"><span>${s.tasks.filter(t=>t.project_id===p.id).length} ${term('tasks','quests')}</span><div class="tiny-avatars"><span class="tiny-avatar">${esc(initials(nameFor(p.lead_id)))}</span></div></div></article>`;}
  function questProjectName(p){return p.title.replace('Critical Vulnerability Remediation','The Vulnerability Hydra').replace('Network Infrastructure Modernization','The Great Network Renewal').replace('Campus Facilities Improvements','Restoration of the Halls');}
  const quickStatusAction=t=>taskActions(t).find(([status])=>['ready','in_progress'].includes(status));
  const quickStatusButton=t=>{const action=quickStatusAction(t);return action?`<button class="btn sm task-inline-action" data-action="status" data-value="${action[0]}" data-id="${esc(t.id)}" aria-label="${esc(action[1])}: ${esc(t.title)}">${esc(action[1])}</button>`:'';};
  function taskRow(t,details=false){const p=projectFor(t.project_id);return `<div class="task-item" data-action="task" data-id="${t.id}"><div class="task-check">${t.status==='complete'?'✓':'◇'}</div><div class="task-grow"><div class="task-title">${esc(t.title)}</div><div class="task-sub">${esc(p?.title||'Project')} · ${esc(nameFor(t.assignee_id))} · ${esc(niceDate(t.due_date))}</div>${details===true&&dependencyWaiting(t.id)?'<small class="dependency-waiting">Waiting for prerequisites</small>':''}</div><div class="task-right">${details===true?tag(t.priority,priorityNames[t.priority]):''}${tag(t.status,fmtStatus(t.status))}${quickStatusButton(t)}<span style="color:var(--muted)">›</span></div></div>`;}
  const managedWork=t=>canManage(t.project_id)||isDeptManager(projectFor(t.project_id)?.department_id);
  function dashboardData(view=s.dashboardView,today=new Date()){
    const start=dateKey(today),endDate=new Date(today.getFullYear(),today.getMonth(),today.getDate()+6,12),end=dateKey(endDate);
    const tasks=visibleTasks().filter(t=>view==='personal'?(t.assignee_id===s.user?.id||t.reviewer_id===s.user?.id&&t.status==='in_review'):view==='manager'?managedWork(t):true);
    const open=tasks.filter(t=>!['complete','cancelled'].includes(t.status));
    const dated=t=>!!calendarDate(t.due_date);
    const sort=rows=>rows.slice().sort((a,b)=>(dated(a)?a.due_date:'9999').localeCompare(dated(b)?b.due_date:'9999')||String(a.title).localeCompare(String(b.title)));
    const groups=new Map();
    for(const t of open){const id=t.assignee_id||null;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(t);}
    return {open:sort(open),overdue:sort(open.filter(t=>dated(t)&&t.due_date<start)),due:sort(open.filter(t=>dated(t)&&t.due_date>=start&&t.due_date<=end)),blocked:sort(open.filter(t=>t.status==='blocked')),review:sort(open.filter(t=>t.status==='in_review'&&(view!=='personal'||t.reviewer_id===s.user?.id))),unassigned:sort(open.filter(t=>!t.assignee_id)),workload:[...groups].map(([id,tasks])=>({id,tasks:sort(tasks)})).sort((a,b)=>b.tasks.length-a.tasks.length||nameFor(a.id).localeCompare(nameFor(b.id)))};
  }
  const hasManagerDashboard=()=>managedDepartments().length>0||managedProjects().length>0;
  function dashboardTabs(){return `<div class="filter-row" aria-label="Dashboard view">${[['overview','Overview'],['personal','My dashboard'],...(hasManagerDashboard()?[['manager','Manager dashboard'],['planner','Workload planner']]:[])].map(([value,label])=>`<button class="filter-pill ${s.dashboardView===value?'active':''}" data-action="dashboard-view" data-value="${value}" aria-pressed="${s.dashboardView===value}">${label}</button>`).join('')}</div>`;}
  const planningWindows=[
    ['overdue','Overdue'],['week','Next 7 days'],['month','Days 8–30'],['later','Later'],['undated','No due date']
  ];
  const planningSignals={all:'All open work',blocked:'Marked blocked',waiting:'Waiting for prerequisites',unassigned:'Unassigned',review:'In review'};
  function plannerReport(today=new Date()){
    const start=dateKey(today);
    const through=days=>dateKey(new Date(today.getFullYear(),today.getMonth(),today.getDate()+days,12));
    const weekEnd=through(6),monthEnd=through(29);
    const windowFor=task=>{
      if(!calendarDate(task.due_date))return 'undated';
      if(task.due_date<start)return 'overdue';
      if(task.due_date<=weekEnd)return 'week';
      return task.due_date<=monthEnd?'month':'later';
    };
    const waiting=new Set(s.demo?s.dependencies.filter(link=>taskFor(link.prerequisite_id)?.status!=='complete').map(link=>link.task_id):s.dependencyReadiness.filter(row=>row.waiting).map(row=>row.task_id));
    const open=visibleTasks().filter(t=>managedWork(t)&&!['complete','cancelled'].includes(t.status));
    const signals={all:()=>true,blocked:t=>t.status==='blocked',waiting:t=>waiting.has(t.id),unassigned:t=>!t.assignee_id,review:t=>t.status==='in_review'};
    const tasks=open.filter(signals[s.plannerSignal]).sort((a,b)=>(calendarDate(a.due_date)?a.due_date:'9999-99').localeCompare(calendarDate(b.due_date)?b.due_date:'9999-99')||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
    const groups=new Map(),totals=Object.fromEntries(planningWindows.map(([key])=>[key,0]));
    const records=tasks.map(task=>{
      const project=projectFor(task.project_id);
      const byProject=s.plannerGroup==='project';
      const groupId=byProject?project.id:task.assignee_id||'_unassigned';
      const label=byProject?project.title:nameFor(task.assignee_id);
      if(!groups.has(groupId))groups.set(groupId,{id:groupId,label,count:0,buckets:Object.fromEntries(planningWindows.map(([key])=>[key,0]))});
      const window=windowFor(task),group=groups.get(groupId);
      group.count++;group.buckets[window]++;totals[window]++;
      return {task,project,groupId,window,waiting:waiting.has(task.id)};
    });
    const ordered=[...groups.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
    const selection=s.plannerCell;
    const selectedGroup=selection&&groups.get(selection.groupId);
    const detail=records.filter(row=>(!selection?.groupId||row.groupId===selection.groupId)&&(!selection||selection.window==='all'||row.window===selection.window));
    return {records,groups:ordered,totals,detail,selectedGroup};
  }
  function plannerCSV(rows){
    const cell=value=>{
      let str=String(value??'');
      if(/^[\s]*[=+@-]|^[\t\r\n]/.test(str))str="'"+str;
      return '"'+str.replaceAll('"','""')+'"';
    };
    const data=[['Project','Task','Assignee','Status','Priority','Due date','Deadline window','Waiting for prerequisites'],...rows.map(({task,project,window,waiting})=>[project.title,task.title,nameFor(task.assignee_id),fmtStatus(task.status),priorityNames[task.priority]||task.priority,task.due_date,Object.fromEntries(planningWindows)[window],waiting?'Yes':'No'])];
    return data.map(row=>row.map(cell).join(',')).join('\r\n');
  }
  function downloadPlanner(){
    if(!hasManagerDashboard()||s.dashboardView!=='planner')return;
    const {detail}=plannerReport();
    if(!detail.length)return;
    const url=URL.createObjectURL(new Blob(['\uFEFF',plannerCSV(detail)],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='questboard-workload-'+dateKey(new Date())+'.csv';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function workloadPlanner(){
    const report=plannerReport(),cell=s.plannerCell;
    const groupLabel=s.plannerGroup==='project'?'Project':'Assignee';
    const number=(groupId,window,count,label)=>{
      if(!count)return '<span class="muted">0</span>';
      const selected=cell?.groupId===groupId&&cell?.window===window;
      return `<button class="planner-count" data-action="planner-cell" data-id="${esc(groupId)}" data-value="${window}" aria-label="${esc(label)}: ${count} tasks" aria-pressed="${selected}">${count}</button>`;
    };
    const matrixRow=(id,label,buckets,count)=>`<tr><th scope="row">${esc(label)}</th>${planningWindows.map(([key,title])=>`<td>${number(id,key,buckets[key],label+' · '+title)}</td>`).join('')}<td>${number(id,'all',count,label+' · All dates')}</td></tr>`;
    const windowLabel=planningWindows.find(([key])=>key===cell?.window)?.[1]||'All dates';
    const detailLabel=(report.selectedGroup?.label||(cell?.groupId?'Selected group':'All groups'))+' · '+windowLabel;
    return pageTitle('Workload planner','Plan open work across the projects you manage.')+dashboardTabs()+
      `<section class="panel planner-panel"><div class="panel-head"><h3>Deadline distribution</h3></div><div class="panel-body">
      <div class="calendar-filters"><label for="planner-group"><span id="planner-group-label">Group by</span><select id="planner-group" aria-labelledby="planner-group-label"><option value="owner" ${s.plannerGroup==='owner'?'selected':''}>Assignee</option><option value="project" ${s.plannerGroup==='project'?'selected':''}>Project</option></select></label>
      <label for="planner-signal"><span id="planner-signal-label">Show</span><select id="planner-signal" aria-labelledby="planner-signal-label">${Object.entries(planningSignals).map(([key,label])=>`<option value="${key}" ${key===s.plannerSignal?'selected':''}>${label}</option>`).join('')}</select></label></div>
      ${report.records.length?`<div class="planner-scroll" tabindex="0" role="region" aria-label="Scrollable deadline distribution"><table class="planner-table"><caption>Select a count to see its tasks. The next 7 days include today.</caption><thead><tr><th scope="col">${groupLabel}</th>${planningWindows.map(([,label])=>`<th scope="col">${label}</th>`).join('')}<th scope="col">Total</th></tr></thead><tbody>${report.groups.map(g=>matrixRow(g.id,g.label,g.buckets,g.count)).join('')}</tbody><tfoot>${matrixRow('','All groups',report.totals,report.records.length)}</tfoot></table></div>`:empty('✓','No matching open work','Try a different department, search, or work filter.')}</div></section>
      <section class="panel planner-detail"><div class="panel-head"><div><h3>Task detail (${report.detail.length})</h3><p role="status">${esc(detailLabel)}</p></div><div class="buttons">${cell?'<button class="btn sm" data-action="planner-clear">Show all dates and groups</button>':''}<button class="btn sm" data-action="planner-export" ${report.detail.length?'':'disabled'}>Export CSV</button></div></div><div class="panel-body">${report.detail.map(({task})=>`<div class="planner-task">${taskRow(task,true)}${canManage(task.project_id)?`<button class="btn sm" data-action="modal" data-value="edit-task" data-id="${esc(task.id)}" aria-label="Edit ${esc(task.title)}">Edit</button>`:''}</div>`).join('')||'<p class="muted">No matching tasks.</p>'}</div></section>`;
  }
  function focusDashboard(){
    const manager=s.dashboardView==='manager',data=dashboardData();
    const panel=(key,title,description,rows)=>`<section class="panel" data-dashboard-section="${key}"><div class="panel-head"><div><h3>${title} (${rows.length})</h3><p>${description}</p></div></div><div class="panel-body">${rows.length?rows.map(taskRow).join(''):empty('✓','Nothing here','No matching open tasks.')}</div></section>`;
    const cards=[['Overdue',data.overdue.length,'Earlier than today'],['Due in 7 days',data.due.length,'Today and the next six days'],['Blocked',data.blocked.length,'Tasks marked blocked'],[manager?'Unassigned':'Awaiting my review',manager?data.unassigned.length:data.review.length,manager?'Open tasks without an owner':'Submitted to you for review']];
    return pageTitle(manager?'Manager dashboard':'My dashboard',manager?'Open work in the projects and departments you manage.':'Your assignments and tasks awaiting your review.')+dashboardTabs()+
      `<div class="kpi-grid">${cards.map(([label,count,hint],i)=>`<div class="kpi ${['','purple','amber','green'][i]}"><div class="label">${label}</div><div class="value">${count}</div><div class="hint">${hint}</div></div>`).join('')}</div><div class="dashboard-focus-grid">${panel('overdue','Overdue','Follow up on missed deadlines.',data.overdue)}${panel('due','Due in 7 days','Plan the coming week.',data.due)}${panel('blocked','Blocked work','Help remove obstacles.',data.blocked)}${panel('review',manager?'Ready for review':'Awaiting my review','Keep completed work moving toward verification.',data.review)}${manager?panel('unassigned','Needs an owner','Assign these tasks to keep work moving.',data.unassigned):''}</div>`+
      (manager?`<section class="panel dashboard-workload"><div class="panel-head"><div><h3>Open workload (${data.open.length})</h3><p>Task counts show assignments, not effort or capacity. Includes current workspace and search filters.</p></div></div><div class="panel-body">${data.workload.length?data.workload.map(group=>`<details class="workload-person"><summary>${esc(nameFor(group.id))} <span class="tag">${group.tasks.length} open</span></summary><div>${group.tasks.map(taskRow).join('')}</div></details>`).join(''):empty('✓','No open work','There are no matching open tasks in your managed projects.')}</div></section>`:'');
  }
  function dashboard(){
    if(!['overview','personal','manager','planner'].includes(s.dashboardView)||['manager','planner'].includes(s.dashboardView)&&!hasManagerDashboard())s.dashboardView='overview';
    if(s.dashboardView==='planner')return workloadPlanner();
    if(s.dashboardView!=='overview')return focusDashboard();
    const tasks=visibleTasks(),projects=visibleProjects(),open=tasks.filter(t=>!['complete','cancelled'].includes(t.status)),blocked=tasks.filter(t=>t.status==='blocked'),review=tasks.filter(t=>t.status==='in_review'),done=tasks.filter(t=>t.status==='complete');
    const urgent=[...blocked,...review,...open.filter(t=>t.priority==='critical'||t.priority==='high')].filter((x,i,a)=>a.findIndex(z=>z.id===x.id)===i).slice(0,5);
    return pageTitle(term('Good morning, '+(s.user?.user_metadata?.full_name||s.user?.email?.split('@')[0]||'there').split(' ')[0],'Welcome to the Guild Hall'),term('Here is the work that matters this week.','Your party has unfinished adventures. Every contribution counts.'),managedDepartments().length?`<button class="btn primary" data-action="modal" data-value="project">＋ ${term('New Project','New Campaign')}</button>`:'')+
    dashboardTabs()+`<div class="kpi-grid"><div class="kpi"><div class="label">${term('Active projects','Active campaigns')}</div><div class="value">${projects.filter(p=>p.status==='active').length}</div><div class="bubble">◈</div><div class="hint">Across authorized workspaces</div></div>
    <div class="kpi purple"><div class="label">${term('Open tasks','Open quests')}</div><div class="value">${open.length}</div><div class="bubble">☷</div><div class="hint">${open.filter(t=>t.status==='in_progress').length} in progress</div></div>
    <div class="kpi amber"><div class="label">${term('Blocked work','Obstacles')}</div><div class="value">${blocked.length}</div><div class="bubble">⚑</div><div class="hint">Need attention or help</div></div>
    <div class="kpi green"><div class="label">${term('Verified completions','Victories')}</div><div class="value">${done.length}</div><div class="bubble">✓</div><div class="hint">${review.length} awaiting review</div></div></div>
    <div class="layout-2"><section class="panel"><div class="panel-head"><div><h3>${term('Priority queue','The quest board')}</h3><p>Blocks, reviews, and high-priority work</p></div><button class="panel-link" data-action="nav" data-value="mywork">View all ›</button></div><div class="panel-body">${urgent.length?urgent.map(taskRow).join(''):empty('✓','All clear','There are no pressing tasks right now.')}</div></section>
    <section class="panel"><div class="panel-head"><div><h3>${term('Project momentum','Campaign momentum')}</h3><p>Verified completion across your workspaces</p></div><button class="panel-link" data-action="nav" data-value="projects">Explore ›</button></div><div class="panel-body">${projects.slice(0,4).map(p=>`<div style="margin-bottom:25px;cursor:pointer" data-action="project" data-id="${p.id}"><div class="section-row"><strong style="font-size:12px">${esc(rpg()?questProjectName(p):p.title)}</strong><small>${pct(p)}%</small></div><div class="progress-track"><div class="progress-fill" style="width:${pct(p)}%"></div></div></div>`).join('')||empty('◈','No projects yet','Create your first project to track meaningful work.')}</div></section></div>
    <div style="margin-top:26px"><div class="section-row"><h2>${term('Your current projects','Campaigns in progress')}</h2><button class="panel-link" data-action="nav" data-value="projects">See all ›</button></div><div class="project-grid">${projects.slice(0,3).map(projectCard).join('')||''}</div></div>`;
  }
  function workPage(){let ts=myTasks();if(s.filter!=='all')ts=ts.filter(t=>t.status===s.filter);return pageTitle(term('My Work','Quest Journal'),term('Your assignments and work awaiting your review.','Your personal adventures, obstacles, and victories.'))+
    `<div class="filter-row">${[['all','All work'],['backlog','Backlog'],['ready','Ready'],['in_progress','In progress'],['blocked','Blocked'],['in_review','In review'],['complete','Completed']].map(([v,l])=>`<button class="filter-pill ${s.filter===v?'active':''}" data-action="filter" data-value="${v}">${esc(rpg()?((rpgStatusNames[v]||l)):l)}</button>`).join('')}</div><div class="panel"><div class="panel-head"><h3>${ts.length} ${term('tasks','quests')}</h3><small>Sorted by due date and status</small></div><div class="panel-body">${ts.length?ts.slice().sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999')).map(taskRow).join(''):empty('◇','Nothing here yet','Assigned work will appear as soon as your team adds it.')}</div></div>`;}
  function projectsPage(){const ps=visibleProjects(),canCreate=managedDepartments().length>0;return pageTitle(term('Projects','Campaigns'),term('Track the initiatives moving your departments forward.','See every active campaign and the quests required to complete it.'),canCreate?`<button class="btn primary" data-action="modal" data-value="project">＋ ${term('New Project','New Campaign')}</button>`:'')+`<div class="project-grid">${ps.map(projectCard).join('')}</div>${ps.length?'':empty('◈','A fresh start',canCreate?'Create a project to organize milestones, owners, and tasks.':'You can see projects once your department manager grants access.',canCreate?`<button class="btn primary" data-action="modal" data-value="project">Create project</button>`:'')}`;}

  // Calendar dates are date-only values. Never parse them as UTC instants.
  const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function calendarDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;
    const date=new Date(value+'T12:00:00');
    return Number.isFinite(date.getTime())&&dateKey(date)===value?date:null;
  }
  function calendarData(){
    const projects=s.projects.filter(p=>deptVisible(p.department_id));
    if(!projects.some(p=>p.id===s.calendarProject))s.calendarProject='all';
    const selected=p=>s.calendarProject==='all'||p.id===s.calendarProject;
    const tasks=visibleTasks().filter(t=>selected(projectFor(t.project_id)))
      .filter(t=>s.calendarScope!=='mine'||t.assignee_id===s.user?.id)
      .filter(t=>s.calendarClosed||!['complete','cancelled'].includes(t.status));
    const targets=s.calendarScope==='mine'?[]:visibleProjects().filter(selected)
      .filter(p=>s.calendarClosed||!['complete','archived'].includes(p.status));
    const milestones=s.calendarScope==='mine'?[]:s.milestones.filter(m=>projects.some(p=>p.id===m.project_id)&&selected(projectFor(m.project_id))&&(s.calendarClosed||!m.archived&&!['complete','archived'].includes(projectFor(m.project_id).status))&&(!s.query||(m.title+' '+m.description).toLowerCase().includes(s.query.toLowerCase())));
    const events=[...milestones.map(m=>({kind:'milestone',id:m.id,title:m.title,date:m.due_date,item:m})),...tasks.filter(t=>calendarDate(t.due_date)).map(t=>({kind:'task',id:t.id,title:t.title,date:t.due_date,item:t})),
      ...targets.filter(p=>calendarDate(p.target_date)).map(p=>({kind:'project',id:p.id,title:p.title,date:p.target_date,item:p}))]
      .sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
    const today=dateKey(new Date());
    return {projects,tasks,events,overdue:tasks.filter(t=>calendarDate(t.due_date)&&t.due_date<today&&!['complete','cancelled'].includes(t.status)).sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.title.localeCompare(b.title)),undated:tasks.filter(t=>!calendarDate(t.due_date))};
  }
  function calendarEvent(event){
    if(event.kind==='milestone')return `<button class="calendar-event milestone-target ${event.item.archived?'closed':''}" data-action="milestone" data-id="${esc(event.id)}"><span class="calendar-event-kind">Milestone</span><strong>${esc(event.title)}</strong><small>${esc(projectFor(event.item.project_id)?.title||'')}</small></button>`;
    const task=event.kind==='task',item=event.item,closed=task?['complete','cancelled'].includes(item.status):['complete','archived'].includes(item.status);
    return `<button class="calendar-event ${task?'':'project-target'} ${closed?'closed':''}" data-action="${event.kind}" data-id="${esc(event.id)}"><span class="calendar-event-kind">${task?term('Task due','Quest due'):'Project target'}</span><strong>${esc(event.title)}</strong><small>${task?esc(projectFor(item.project_id)?.title||'')+' · '+esc(nameFor(item.assignee_id)):esc(deptFor(item.department_id)?.name||'')}</small><small>${esc(task?fmtStatus(item.status):item.status)}${task&&dependencyWaiting(item.id)?' · Waiting for prerequisites':''}</small></button>`;
  }
  function calendarPage(){
    const today=dateKey(new Date()),month=calendarDate(s.calendarMonth)||new Date(new Date().getFullYear(),new Date().getMonth(),1,12);
    s.calendarMonth=dateKey(month);
    const {projects,events,overdue,undated}=calendarData(),prefix=s.calendarMonth.slice(0,7),monthEvents=events.filter(e=>e.date.startsWith(prefix));
    const days=new Date(month.getFullYear(),month.getMonth()+1,0,12).getDate(),label=month.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    const byDate=new Map();for(const event of monthEvents){if(!byDate.has(event.date))byDate.set(event.date,[]);byDate.get(event.date).push(event);}
    const cells=Array.from({length:month.getDay()},()=>'<div class="calendar-pad" aria-hidden="true"></div>').join('')+Array.from({length:days},(_,index)=>{
      const key=prefix+'-'+String(index+1).padStart(2,'0'),entries=byDate.get(key)||[];
      return `<section class="calendar-day ${entries.length?'has-events':'no-events'} ${key===today?'is-today':''}" aria-label="${esc(niceDate(key))}"><h3><time datetime="${key}" ${key===today?'aria-current="date"':''}><span class="calendar-day-number">${index+1}</span><span class="calendar-mobile-date">${esc(niceDate(key))}</span></time>${key===today?'<small>Today</small>':''}</h3>${entries.map(calendarEvent).join('')}</section>`;
    }).join('');
    return pageTitle(term('Work calendar','Quest Calendar'),'Task due dates, milestones, and project targets across your visible workspaces.')+`
      <div class="calendar-filters"><label>Project<select id="calendar-project" aria-label="Calendar project"><option value="all">All projects</option>${projects.map(p=>`<option value="${esc(p.id)}" ${p.id===s.calendarProject?'selected':''}>${esc(p.title)}</option>`).join('')}</select></label><label>Show<select id="calendar-scope" aria-label="Calendar work scope"><option value="all">All visible work</option><option value="mine" ${s.calendarScope==='mine'?'selected':''}>My assigned tasks</option></select></label><label class="calendar-closed"><input id="calendar-closed" type="checkbox" ${s.calendarClosed?'checked':''}> Include finished work</label></div>
      <section class="panel calendar-panel"><div class="panel-head calendar-toolbar"><div><h2 id="calendar-month-label" aria-live="polite">${esc(label)}</h2><small>${monthEvents.length} dated items${s.calendarScope==='mine'?' · Project targets hidden':''}</small></div><div class="buttons"><button class="btn sm" data-action="calendar-month" data-value="-1" aria-label="Previous month">←</button><button class="btn sm" data-action="calendar-month" data-value="today">Today</button><button class="btn sm" data-action="calendar-month" data-value="1" aria-label="Next month">→</button></div></div>
      ${!monthEvents.length?'<p class="calendar-empty" role="status">No matching deadlines this month. Try another month or adjust your filters.</p>':''}
      <div class="calendar-grid" aria-labelledby="calendar-month-label">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>`<div class="calendar-weekday" aria-hidden="true">${day}</div>`).join('')}${cells}</div></section>
      <div class="calendar-followup"><section class="panel"><div class="panel-head"><h3>Overdue tasks · ${overdue.length}</h3><small>Across all months</small></div><div class="panel-body">${overdue.length?`<details><summary>View overdue tasks</summary>${overdue.map(taskRow).join('')}</details>`:'<p class="muted">No overdue tasks match these filters.</p>'}</div></section><section class="panel"><div class="panel-head"><h3>Tasks without a date · ${undated.length}</h3></div><div class="panel-body">${undated.length?`<details><summary>View tasks without a due date</summary>${undated.map(taskRow).join('')}</details>`:'<p class="muted">All matching tasks have a due date.</p>'}</div></section></div>`;
  }

  function projectTaskData(projectId){
    const all=projectFor(projectId)?s.tasks.filter(t=>t.project_id===projectId):[];
    const owners=[...new Set(all.map(t=>t.assignee_id).filter(Boolean))];
    if(!['all','mine','unassigned',...owners.map(id=>'user:'+id)].includes(s.projectOwner))s.projectOwner='all';
    if(s.projectMilestone!=='all'&&!s.milestones.some(m=>m.id===s.projectMilestone&&m.project_id===projectId))s.projectMilestone='all';
    const query=s.query.trim().toLowerCase();
    const tasks=all.filter(t=>s.projectMilestone==='all'||t.milestone_id===s.projectMilestone).filter(t=>!query||(t.title+' '+(t.description||'')).toLowerCase().includes(query))
      .filter(t=>s.projectOwner==='all'||(s.projectOwner==='mine'?t.assignee_id===s.user?.id:s.projectOwner==='unassigned'?!t.assignee_id:'user:'+t.assignee_id===s.projectOwner))
      .filter(t=>s.projectPriority==='all'||t.priority===s.projectPriority)
      .filter(t=>s.projectReadiness==='all'||(s.projectReadiness==='waiting'?dependencyWaiting(t.id):!dependencyWaiting(t.id)))
      .filter(t=>s.projectClosed||!['complete','cancelled'].includes(t.status));
    const rank={critical:0,high:1,normal:2,low:3};
    const due=t=>calendarDate(t.due_date)?t.due_date:'9999-99-99';
    tasks.sort((a,b)=>(s.projectSort==='priority'?(rank[a.priority]??4)-(rank[b.priority]??4):0)||due(a).localeCompare(due(b))||String(a.title).localeCompare(String(b.title))||String(a.id).localeCompare(String(b.id)));
    return {all,tasks,owners};
  }
  const projectViews={board:'Board',list:'List',dependencies:'Dependencies'};
  function projectDependencies(data){
    const byId=new Map(data.all.map(task=>[task.id,{task,before:[],after:[]}]));
    for(const link of s.dependencies){
      const prerequisite=byId.get(link.prerequisite_id);
      const dependent=byId.get(link.task_id);
      if(prerequisite&&dependent){
        dependent.before.push(prerequisite.task);
        prerequisite.after.push(dependent.task);
      }
    }
    const taskButton=task=>`<button class="btn ghost" data-action="task" data-id="${esc(task.id)}">${esc(task.title)}</button>`;
    const neighbors=(label,tasks)=>`<div><strong>${label}</strong>${tasks.length?`<ul>${tasks.map(task=>`<li>${taskButton(task)} ${tag(task.status,fmtStatus(task.status))}</li>`).join('')}</ul>`:'<p class="muted">None visible</p>'}</div>`;
    return `<section class="panel project-dependencies" aria-label="Task dependencies">${data.tasks.map(task=>{
      const {before,after}=byId.get(task.id);
      return `<article><header><h3>${taskButton(task)}</h3>${tag(task.status,fmtStatus(task.status))}${dependencyWaiting(task.id)?'<small class="dependency-waiting">Waiting for prerequisites</small>':''}</header><div class="dependency-neighbors">${neighbors('Depends on',before)}${neighbors('Needed by',after)}</div></article>`;
    }).join('')}</section>`;
  }
  function projectTaskControls(data){
    const options=(items,value)=>items.map(([id,label])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(label)}</option>`).join('');
    return `<div class="project-task-toolbar"><div class="buttons" role="group" aria-label="Task display">${Object.keys(projectViews).map(view=>`<button class="btn sm ${s.projectView===view?'primary':''}" data-action="project-view" data-value="${view}" aria-pressed="${s.projectView===view}">${projectViews[view]}</button>`).join('')}</div>
      <div class="calendar-filters project-task-filters">
      <label for="project-owner">Assigned to<select id="project-owner">${options([['all','Anyone'],['mine','Assigned to me'],['unassigned','Unassigned'],...data.owners.map(id=>['user:'+id,nameFor(id)])],s.projectOwner)}</select></label>
      <label for="project-milestone">Milestone<select id="project-milestone">${options([['all','All milestones'],...s.milestones.filter(m=>m.project_id===s.projectId).map(m=>[m.id,m.title+(m.archived?' (archived)':'')])],s.projectMilestone)}</select></label><label for="project-priority">Priority<select id="project-priority">${options([['all','Any priority'],...Object.entries(priorityNames)],s.projectPriority)}</select></label>
      <label for="project-readiness">Dependencies<select id="project-readiness">${options([['all','Any dependency state'],['waiting','Waiting for prerequisites'],['clear','No outstanding prerequisites']],s.projectReadiness)}</select></label>
      <label for="project-sort">Sort by<select id="project-sort">${options([['due','Due date'],['priority','Priority, then due date']],s.projectSort)}</select></label>
      <label class="calendar-closed"><input id="project-closed" type="checkbox" ${s.projectClosed?'checked':''}> Include finished work</label>
      <button class="btn sm" data-action="project-filters-reset">Clear filters</button></div>
      <p class="muted" role="status">Showing ${data.tasks.length} of ${data.all.length} tasks. Project totals above include all tasks.</p></div>`;
  }
  function templateLibrary(projectId){
    const templates=s.templates.filter(t=>t.project_id===projectId);
    const card=t=>`<article class="template-card"><h3>${esc(t.name)}</h3><p>${esc(t.title)}</p><small>${t.checklist.length} checklist items · ${t.due_days===null?'Choose due date when creating':t.due_days===0?'Due on creation day':'Due '+t.due_days+' days after creation'}</small>
      ${t.checklist.length?`<details><summary>Preview checklist</summary><ul>${t.checklist.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></details>`:''}
      <div class="buttons">${!t.archived?`<button class="btn sm primary" data-action="use-template" data-id="${esc(t.id)}">Create task</button>`:''}<button class="btn sm" data-action="archive-template" data-id="${esc(t.id)}" data-value="${t.archived?'false':'true'}">${t.archived?'Restore':'Archive'}</button></div></article>`;
    const active=templates.filter(t=>!t.archived),archived=templates.filter(t=>t.archived);
    return `<section class="panel template-library"><div class="panel-head"><h3>Task templates</h3></div><div class="panel-body">${active.length?`<div class="template-grid">${active.map(card).join('')}</div>`:'<p class="muted">Open a task and choose Save as template to reuse its instructions and checklist.</p>'}
      ${archived.length?`<details class="archived-templates"><summary>Archived templates (${archived.length})</summary><div class="template-grid">${archived.map(card).join('')}</div></details>`:''}</div></section>`;
  }
  function creationTemplate(){
    return s.templates.find(t=>t.id===s.creationTemplate&&!t.archived&&canManage(t.project_id));
  }
  function templateDefaults(){
    const template=creationTemplate(),form=root.querySelector('form[data-form="task"]');
    if(!template||!form)return;
    for(const key of ['title','description','priority','xp_reward']){
      const field=form.elements.namedItem(key);
      if(key==='xp_reward'&&![...field.options].some(option=>option.value===String(template[key]))){
        const option=document.createElement('option');option.value=template[key];option.textContent=template[key]+' XP';field.append(option);
      }
      field.value=template[key];
    }
    if(template.due_days!==null){
      const now=new Date();
      form.elements.namedItem('due_date').value=dateKey(new Date(now.getFullYear(),now.getMonth(),now.getDate()+template.due_days,12));
    }
  }
  function milestoneData(milestone,today=dateKey(new Date())){
    const tasks=s.tasks.filter(t=>t.project_id===milestone.project_id&&t.milestone_id===milestone.id);
    const completed=tasks.filter(t=>t.status==='complete');
    const cancelled=tasks.filter(t=>t.status==='cancelled');
    const open=tasks.filter(t=>!['complete','cancelled'].includes(t.status));
    const overdue=open.filter(t=>calendarDate(t.due_date)&&t.due_date<today);
    const late=open.filter(t=>calendarDate(t.due_date)&&t.due_date>milestone.due_date);
    const undated=open.filter(t=>!calendarDate(t.due_date));
    const blocked=open.filter(t=>t.status==='blocked'||dependencyWaiting(t.id));
    const progress=tasks.length?Math.round(completed.length/tasks.length*100):0;
    const signals=[...(milestone.due_date<today&&open.length?['Target date passed']:[]),...[[overdue,'overdue'],[late,'scheduled past target'],[undated,'without a due date'],[blocked,'blocked or waiting']].filter(([rows])=>rows.length).map(([rows,label])=>rows.length+' '+label)];
    return {tasks,completed,cancelled,open,progress,signals};
  }
  function milestoneOptions(projectId,selected=''){
    return '<option value="">No milestone</option>'+s.milestones.filter(m=>m.project_id===projectId&&(!m.archived||m.id===selected)).map(m=>`<option value="${esc(m.id)}" ${m.id===selected?'selected':''}>${esc(m.title)}${m.archived?' (archived)':''}</option>`).join('');
  }
  function projectMilestones(projectId){
    const milestones=s.milestones.filter(m=>m.project_id===projectId).sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.title.localeCompare(b.title));
    const card=m=>{const data=milestoneData(m);return `<button class="milestone-card" data-action="milestone" data-id="${esc(m.id)}"><strong>${esc(m.title)}</strong><span>${esc(niceDate(m.due_date))}</span><span>${data.completed.length} of ${data.tasks.length} visible tasks complete</span><span class="progress-track"><span class="progress-fill" style="width:${data.progress}%"></span></span>${data.signals.length?`<small>${esc(data.signals.join(' · '))}</small>`:''}</button>`;};
    const active=milestones.filter(m=>!m.archived),archived=milestones.filter(m=>m.archived);
    return `<section class="panel milestone-panel"><div class="panel-head"><h3>Milestones</h3>${canManage(projectId)?'<button class="btn sm" data-action="modal" data-value="milestone">Add milestone</button>':''}</div><div class="panel-body">${active.length?`<div class="milestone-grid">${active.map(card).join('')}</div>`:'<p class="muted">No milestones yet.</p>'}${archived.length?`<details class="archived-milestones"><summary>Archived milestones (${archived.length})</summary><div class="milestone-grid">${archived.map(card).join('')}</div></details>`:''}</div></section>`;
  }
  const briefHealth={on_track:'On track',at_risk:'At risk',blocked:'Blocked',complete:'Complete'};
  function projectBriefs(projectId){return s.briefs.filter(b=>b.project_id===projectId).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id)));}
  function latestBrief(projectId){return projectBriefs(projectId)[0]||null;}
  function briefText(value){return value?`<p class="brief-prose">${esc(value)}</p>`:'<p class="muted">Not reported.</p>';}
  function projectBriefPanel(projectId){
    const items=projectBriefs(projectId),latest=items[0],manager=canManage(projectId);
    const section=(label,key)=>`<div><h4>${label}</h4>${briefText(latest?.[key])}</div>`;
    return `<section class="panel project-briefs" aria-label="Project status updates"><div class="panel-head"><div><h3>Project status & delivery story</h3><p>One short check-in feeds both leadership reports. Individual technical tasks stay in Planner.</p></div></div><div class="panel-body">
      ${latest?`<div class="brief-heading"><span class="brief-health ${esc(latest.health)}">${esc(briefHealth[latest.health]||'Not set')}</span><small>Delivery owner: ${esc(latest.delivery_owner||nameFor(projectFor(projectId).lead_id))} · Last update ${esc(niceDate(latest.created_at))} · ${esc(nameFor(latest.author_id))}</small></div><div class="brief-grid">${section('Accomplished','accomplishments')}${section('Next steps','next_steps')}${section('Risks / blockers','risks')}${section('Decisions needed','decisions')}</div>`:'<p class="muted">No project-level check-in yet. Add one to begin the accomplishment and next-steps history.</p>'}
      ${manager?`<details class="brief-entry"><summary>＋ Post a project check-in</summary><form data-form="project-brief" data-project="${esc(projectId)}" class="brief-form"><label>Delivery owner (for reporting)<input name="delivery_owner" maxlength="120" value="${esc(latest?.delivery_owner||nameFor(projectFor(projectId).lead_id))}" placeholder="Technician leading this work"></label><p class="field-hint">Reporting ownership does not change app permissions.</p><label>Delivery health<select name="health" required>${Object.entries(briefHealth).map(([key,label])=>`<option value="${key}" ${latest?.health===key?'selected':''}>${label}</option>`).join('')}</select></label><label>What did we accomplish?<textarea name="accomplishments" maxlength="4000" placeholder="Milestones reached, outcomes delivered, completed work"></textarea></label><label>What happens next?<textarea name="next_steps" maxlength="4000" placeholder="Next meaningful deliverables and expected dates"></textarea></label><label>Risks or blockers<textarea name="risks" maxlength="2500" placeholder="What threatens delivery? Leave blank if none."></textarea></label><label>Decisions or help needed<textarea name="decisions" maxlength="2500" placeholder="Approvals, resources, or leadership decisions needed"></textarea></label><p class="field-hint">Dated updates are permanent. Save a new check-in each week; past reports retain the original story.</p><button class="btn primary" type="submit">Save check-in</button></form></details>`:''}
      ${items.length>1?`<details class="brief-history"><summary>Previous check-ins (${items.length-1})</summary>${items.slice(1,11).map(b=>`<article><strong>${esc(niceDate(b.created_at))} · ${esc(briefHealth[b.health]||'Update')}</strong><small>${esc(nameFor(b.author_id))}</small><p>${esc(b.accomplishments||b.next_steps||b.risks||b.decisions)}</p></article>`).join('')}${items.length>11?'<p class="muted">Older check-ins are retained for reporting.</p>':''}</details>`:''}
    </div></section>`;
  }
  function milestonePage(){
    const milestone=s.milestones.find(m=>m.id===s.milestoneId),project=projectFor(milestone?.project_id);
    if(!milestone||!project)return projectsPage();
    const data=milestoneData(milestone),manager=canManage(project.id);
    return `<div class="breadcrumb"><button data-action="project" data-id="${esc(project.id)}">${esc(project.title)}</button><span>›</span>Milestone</div>`+
      pageTitle(milestone.title,milestone.description,manager?`<button class="btn" data-action="modal" data-value="milestone" data-id="${esc(milestone.id)}">Edit milestone</button>`:'')+
      `<div class="kpi-grid"><div class="kpi"><div class="label">Target date</div><div class="value" style="font-size:20px">${esc(niceDate(milestone.due_date))}</div><div class="hint">${milestone.archived?'Archived milestone':'Active milestone'}</div></div><div class="kpi"><div class="label">Visible tasks complete</div><div class="value">${data.completed.length} / ${data.tasks.length}</div><div class="hint">${data.cancelled.length} cancelled</div></div><div class="kpi"><div class="label">Open tasks</div><div class="value">${data.open.length}</div></div><div class="kpi"><div class="label">Progress</div><div class="value">${data.progress}%</div><div class="hint">Based on visible tasks</div></div></div>
      ${data.signals.length?`<section class="panel milestone-signals"><div class="panel-head"><h3>Schedule attention</h3></div><div class="panel-body"><ul>${data.signals.map(signal=>`<li>${esc(signal)}</li>`).join('')}</ul></div></section>`:''}
      <section class="panel milestone-tasks"><div class="panel-head"><h3>Linked tasks</h3>${manager&&!milestone.archived?`<button class="btn sm" data-action="milestone-add-task" data-id="${esc(milestone.id)}">Add task</button>`:''}</div><div class="panel-body">${data.tasks.length?data.tasks.map(task=>`<div class="planner-task">${taskRow(task,true)}${manager?`<button class="btn sm" data-action="modal" data-value="edit-task" data-id="${esc(task.id)}" aria-label="Edit ${esc(task.title)}">Edit</button>`:''}</div>`).join(''):'<p class="muted">Assign a milestone in task details, or create a task here.</p>'}</div></section>`;
  }
  function milestoneForm(){
    const milestone=s.milestones.find(m=>m.id===s.editMilestoneId);
    return `<form data-form="milestone" data-id="${esc(milestone?.id||s.milestoneRequest)}" data-project="${esc(milestone?.project_id||s.projectId)}" data-revision="${milestone?.revision||''}"><div class="modal-body"><div class="form-field"><label for="milestone-title">Milestone name</label><input id="milestone-title" name="title" required maxlength="160" value="${esc(milestone?.title||'')}"></div><div class="form-field"><label for="milestone-description">Delivery goal</label><textarea id="milestone-description" name="description" maxlength="2500">${esc(milestone?.description||'')}</textarea></div><div class="form-field"><label for="milestone-date">Target date</label><input id="milestone-date" name="due_date" type="date" required value="${esc(milestone?.due_date||'')}"></div>${milestone?`<label><input name="archived" type="checkbox" ${milestone.archived?'checked':''}> Archive milestone</label>`:''}</div>${modalFooter('Save milestone')}</form>`;
  }
  function projectPage(){const p=projectFor(s.projectId);if(!p)return projectsPage();const data=projectTaskData(p.id),ts=data.tasks,all=data.all,progress=pct(p),manager=canManage(p.id);
    const statuses=['backlog','ready','in_progress','blocked','in_review',...(s.projectClosed?['complete','cancelled']:[])];
    return `<div class="breadcrumb"><button data-action="nav" data-value="projects">${term('Projects','Campaigns')}</button><span>›</span>${esc(p.title)}</div><div class="detail-banner">${tag(p.status,p.status.toUpperCase())}<h1>${esc(rpg()?questProjectName(p):p.title)}</h1><p>${esc(p.summary)}</p><div class="banner-actions">${manager?`<button class="btn" data-action="modal" data-value="task">＋ ${term('Add task','Add quest')}</button><button class="btn" data-action="modal" data-value="project-settings">Project settings</button>`:''}<button class="btn" data-action="modal" data-value="project-export">Export for staff</button><button class="btn" data-action="nav" data-value="team">♧ Team</button><button class="btn" data-action="project-history">Change history</button><button class="btn" data-action="project-refresh">Refresh project</button></div></div>
    <div class="kpi-grid"><div class="kpi"><div class="label">Progress</div><div class="value">${progress}%</div><div class="hint">Verified completions</div></div><div class="kpi"><div class="label">${term('Tasks','Quests')}</div><div class="value">${all.length}</div><div class="hint">${all.filter(t=>t.status==='complete').length} complete</div></div><div class="kpi amber"><div class="label">Blocked</div><div class="value">${all.filter(t=>t.status==='blocked').length}</div><div class="hint">Require attention</div></div><div class="kpi green"><div class="label">Target date</div><div class="value" style="font-size:19px">${niceDate(p.target_date)}</div><div class="hint">${esc(deptFor(p.department_id)?.name||'Department')}</div></div></div>
    ${projectBriefPanel(p.id)}${projectMilestones(p.id)}${manager?templateLibrary(p.id):''}<div class="section-row"><h2>${term('Project tasks','Campaign quests')}</h2>${manager?`<button class="btn sm" data-action="modal" data-value="task">＋ Add</button>`:''}</div>${projectTaskControls(data)}
    ${!ts.length?empty('◇','No matching tasks','Try clearing the filters or including finished work.'):s.projectView==='dependencies'?projectDependencies(data):s.projectView==='list'?`<section class="panel project-task-list"><div class="panel-body">${ts.map(t=>taskRow(t,true)).join('')}</div></section>`:
    `<div class="board" style="grid-template-columns:repeat(${statuses.length},minmax(225px,1fr))">${statuses.map(st=>`<div class="board-col"><div class="board-col-head">${esc(fmtStatus(st))} <span>${ts.filter(t=>t.status===st).length}</span></div>${ts.filter(t=>t.status===st).map(t=>`<div class="board-task" data-action="task" data-id="${esc(t.id)}"><h4>${esc(t.title)}</h4>${dependencyWaiting(t.id)?'<small class="dependency-waiting">Waiting for prerequisites</small>':''}<p>${esc(nameFor(t.assignee_id))} · ${esc(niceDate(t.due_date))}</p><div class="meta">${tag(t.priority,priorityNames[t.priority])}<small>✦ ${t.xp_reward||0} XP</small></div>${quickStatusButton(t)}</div>`).join('')||'<small class="board-empty">No matching work</small>'}</div>`).join('')}</div>`}`;
  }
  function taskPage(){const t=taskFor(s.taskId);if(!t)return workPage();const p=projectFor(t.project_id),checks=s.checklist.filter(c=>c.task_id===t.id),updates=s.updates.filter(x=>x.task_id===t.id),events=s.events.filter(x=>x.task_id===t.id).slice(0,8),manager=canManage(t.project_id),actions=taskActions(t),xp=t.xp_reward||0;
    return `<div class="breadcrumb"><button data-action="nav" data-value="projects">${term('Projects','Campaigns')}</button><span>›</span><button data-action="project" data-id="${p?.id}">${esc(p?.title||'Project')}</button><span>›</span>${term('Task','Quest')}</div>
    <div class="page-heading"><div><div class="eyebrow">${esc(p?.title||'Project')} / ${term('Task','Quest')}</div><h1>${esc(t.title)}</h1><p class="lead">${esc(t.description||'No description yet.')}</p></div><div class="buttons">${tag(t.priority,priorityNames[t.priority])}${tag(t.status,fmtStatus(t.status))}</div></div>
    <div class="detail-grid"><div class="detail-content"><section class="panel"><div class="panel-head"><h3>${term('Objectives','Quest objectives')}</h3><small>${checks.filter(x=>x.done).length}/${checks.length} complete</small></div><div class="panel-body">${checks.length?checks.map(c=>`<label class="checkline"><input type="checkbox" data-action="check" data-id="${c.id}" ${c.done?'checked':''} ${['in_review','complete','cancelled'].includes(t.status)||!(s.demo||manager||t.assignee_id===s.user?.id)?'disabled':''}><span style="${c.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(c.title)}</span></label>`).join(''):empty('☑','No checklist items','Add objectives to define what completion means.')}${manager&&!['in_review','complete','cancelled'].includes(t.status)?`<form data-form="checklist" class="journal-form" style="display:flex"><input type="text" name="title" required maxlength="180" placeholder="Add a checklist item…" style="flex:1;min-width:0;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:8px;padding:10px"><button class="btn sm" type="submit">Add</button></form>`:''}</div></section>
    ${dependencyPanel(t)}
    <section class="panel"><div class="panel-head"><div><h3>${term('Work journal','Adventure journal')}</h3><p>A living record of what was done, learned, or blocked</p></div></div><div class="panel-body">${updates.length?updates.map(u=>`<div class="journal-item"><span class="avatar">${esc(initials(nameFor(u.author_id)))}</span><div><strong>${esc(nameFor(u.author_id))} ${tag(u.kind,u.kind.replace('_',' '))}</strong><p>${esc(u.body)}</p><small>${niceDate(u.created_at)} · ${relative(u.created_at)}</small></div></div>`).join(''):empty('✎','No journal entries','Document work as it happens, so your next meeting has real context.')}
    <form data-form="update" class="journal-form"><textarea name="body" required maxlength="8000" placeholder="What did you do? What happened? What's next?"></textarea><div class="submit-row"><select name="kind"><option value="note">General note</option><option value="action">Action taken</option><option value="blocker">Blocker</option><option value="resolution">Resolution</option><option value="next_step">Next step</option></select><button class="btn primary" type="submit">Post update</button></div></form></div></section>
    <section class="panel"><div class="panel-head"><h3>Activity history</h3><button class="btn sm" data-action="task-activity" data-id="${esc(t.id)}">View all task activity</button></div><div class="panel-body">${events.map(e=>{const description=describeTaskEvent(e);return `<div class="journal-item"><span class="task-check">↻</span><div><strong>${esc(description.label)}</strong><p class="activity-text">${esc(description.text)}</p><small>${esc(e.actor_id?nameFor(e.actor_id):'System')} · ${esc(niceDate(e.created_at))}</small></div></div>`;}).join('')||'<p class="muted">No recorded task changes yet.</p>'}</div></section></div>
    <aside><section class="panel"><div class="panel-head"><h3>${term('Task details','Quest details')}</h3></div><div class="panel-body"><div class="info-list"><div class="info-pair"><span class="key">Status</span>${tag(t.status,fmtStatus(t.status))}</div><div class="info-pair"><span class="key">Assigned to</span><span class="val">${esc(nameFor(t.assignee_id))}</span></div><div class="info-pair"><span class="key">Reviewer</span><span class="val">${esc(nameFor(t.reviewer_id))}</span></div><div class="info-pair"><span class="key">Due date</span><span class="val">${niceDate(t.due_date)}</span></div><div class="info-pair"><span class="key">Milestone</span><span class="val">${s.milestones.some(m=>m.id===t.milestone_id)?`<button class="btn sm" data-action="milestone" data-id="${esc(t.milestone_id)}">${esc(s.milestones.find(m=>m.id===t.milestone_id).title)}</button>`:'None'}</span></div><div class="info-pair"><span class="key">Priority</span>${tag(t.priority,priorityNames[t.priority])}</div><div class="info-pair"><span class="key">Experience</span><span class="val">✦ ${xp} XP</span></div></div>
    <div style="border-top:1px solid var(--border);margin-top:20px;padding-top:18px;display:grid;gap:8px">${actions.length?actions.map(([st,label],i)=>`<button class="btn ${i===0?'primary':''} block" data-action="status" data-value="${st}" data-id="${t.id}">${esc(label)}</button>`).join(''):`<small style="text-align:center">No available transitions</small>`}${manager?`<button class="btn block" data-action="modal" data-value="edit-task">✎ Edit details</button>${t.visibility!=='restricted'?`<button class="btn block" data-action="modal" data-value="save-template">Save as template</button>`:''}`:''}</div></div></section>
    <div class="panel" style="margin-top:20px"><div class="panel-head"><h3>What counts as done?</h3></div><div class="panel-body"><p class="muted" style="font-size:12px">Complete the objectives, log verification, then submit for review. Experience is granted only when work is approved.</p></div></div></aside></div>`;
  }
  function teamPage(){const members=s.orgMembers.filter(m=>m.status==='active');return pageTitle(term('Team workspace','Party management'),'See workload, ownership, and collaboration across your authorized workspaces.',isAdmin()?`<button class="btn primary" data-action="modal" data-value="invite">＋ Invite member</button>`:'')+`<div class="panel"><div class="panel-head"><h3>Department members</h3><small>${s.departmentMembers.length} scoped memberships</small></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Member</th><th>Department</th><th>Role</th><th>Assigned work</th></tr></thead><tbody>${s.departmentMembers.map(m=>`<tr><td class="strong">${esc(nameFor(m.user_id))}</td><td>${esc(deptFor(m.department_id)?.name||'Department')}</td><td>${tag(m.role,m.role)}</td><td>${s.tasks.filter(t=>t.assignee_id===m.user_id&&t.status!=='complete').length} open</td></tr>`).join('')||`<tr><td colspan="4">${empty('♧','No team members','Members will appear once invited.')}</td></tr>`}</tbody></table></div></div>`;}
  const portfolioHealth={attention:'Needs attention',watch:'Watch',clear:'No current flags',empty:'No visible tasks',closed:'Closed'};
  const portfolioSignals={all:'All open tasks',overdue:'Overdue',blocked:'Blocked / waiting',unassigned:'Unassigned',review:'Awaiting review',undated:'No due date'};
  function portfolioReport(today=new Date(),healthFilter=s.reportHealth){
    const day=dateKey(today),soon=dateKey(new Date(today.getFullYear(),today.getMonth(),today.getDate()+14,12));
    const rows=visibleProjects().filter(p=>s.reportClosed||!['complete','archived'].includes(p.status)).map(project=>{
      const tasks=s.tasks.filter(t=>t.project_id===project.id),open=tasks.filter(t=>!['complete','cancelled'].includes(t.status));
      const done=tasks.filter(t=>t.status==='complete').length,cancelled=tasks.filter(t=>t.status==='cancelled').length;
      const overdue=open.filter(t=>calendarDate(t.due_date)&&t.due_date<day),blocked=open.filter(t=>t.status==='blocked'||dependencyWaiting(t.id));
      const unassigned=open.filter(t=>!t.assignee_id),review=open.filter(t=>t.status==='in_review'),undated=open.filter(t=>!calendarDate(t.due_date));
      const milestones=s.milestones.filter(m=>m.project_id===project.id&&!m.archived).map(m=>({milestone:m,data:milestoneData(m,day)}));
      const missed=milestones.filter(({milestone:m,data:d})=>calendarDate(m.due_date)&&m.due_date<day&&(d.open.length||!d.tasks.length));
      const upcoming=milestones.filter(({milestone:m,data:d})=>calendarDate(m.due_date)&&m.due_date>=day&&m.due_date<=soon&&(d.open.length||!d.tasks.length)).sort((a,b)=>a.milestone.due_date.localeCompare(b.milestone.due_date));
      const targetLate=!!calendarDate(project.target_date)&&project.target_date<day&&!['complete','archived'].includes(project.status);
      const closed=['complete','archived'].includes(project.status);
      const health=closed?'closed':overdue.length||blocked.length||missed.length||targetLate?'attention':!tasks.length?'empty':unassigned.length||undated.length||review.length||project.status==='paused'?'watch':'clear';
      return {project,tasks,open,done,cancelled,overdue,blocked,unassigned,review,undated,missed,upcoming,targetLate,health,progress:tasks.length-cancelled?Math.round(100*done/(tasks.length-cancelled)):0};
    });
    const order={attention:0,watch:1,empty:2,clear:3,closed:4};
    rows.sort((a,b)=>order[a.health]-order[b.health]||b.overdue.length-a.overdue.length||(a.project.target_date||'9999').localeCompare(b.project.target_date||'9999')||a.project.title.localeCompare(b.project.title)||a.project.id.localeCompare(b.project.id));
    const filtered=rows.filter(r=>healthFilter==='all'||r.health===healthFilter);
    const selected=filtered.find(r=>r.project.id===s.reportProject);
    const detail=selected?(selected[s.reportSignal]||selected.open):[];
    return {rows:filtered,selected,detail,day,soon};
  }
  function portfolioCSV(rows,day=dateKey(new Date())){
    const cell=value=>{let str=String(value??'');if(/^[\s]*[=+@-]|^[\t\r\n]/.test(str))str="'"+str;return '"'+str.replaceAll('"','""')+'"';};
    const matrix=[['As of','Project','Department','Lead','Project status','Health','Target date','Visible tasks','Complete','Cancelled','Completion percent (excludes cancelled)','Open','Overdue','Blocked or waiting','Unassigned','Awaiting review','No due date','Missed milestones','Upcoming milestones (14 days)'],...rows.map(r=>[day,r.project.title,deptFor(r.project.department_id)?.name||'Unavailable',nameFor(r.project.lead_id),r.project.status,portfolioHealth[r.health],r.project.target_date,r.tasks.length,r.done,r.cancelled,r.progress,r.open.length,r.overdue.length,r.blocked.length,r.unassigned.length,r.review.length,r.undated.length,r.missed.length,r.upcoming.length])];
    return matrix.map(row=>row.map(cell).join(',')).join('\r\n');
  }
  function downloadPortfolio(){
    if(s.nav!=='reports'||s.loading||s.lastError||!s.org)return;
    const report=portfolioReport();if(!report.rows.length)return;
    const url=URL.createObjectURL(new Blob(['\uFEFF',portfolioCSV(report.rows,report.day)],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='questboard-project-health-'+report.day+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function portfolioPage(){
    const report=portfolioReport(),{rows,selected,detail}=report;
    const total=key=>rows.reduce((n,r)=>n+(Array.isArray(r[key])?r[key].length:r[key]||0),0);
    const signal=(r,key,label)=>`<button class="report-signal" data-action="report-detail" data-id="${esc(r.project.id)}" data-value="${key}" aria-label="${esc(label+' for '+r.project.title)}"><strong>${r[key].length}</strong> ${label}</button>`;
    const milestone=({milestone:m})=>`<button class="btn sm" data-action="milestone" data-id="${esc(m.id)}">${esc(m.title)} · ${niceDate(m.due_date)}</button>`;
    return `<div class="buttons report-toolbar"><label>Health<select id="report-health" aria-label="Health"><option value="all">All health states</option>${Object.entries(portfolioHealth).map(([value,label])=>`<option value="${value}" ${s.reportHealth===value?'selected':''}>${label}</option>`).join('')}</select></label><label><input id="report-closed" type="checkbox" ${s.reportClosed?'checked':''}> Include closed projects</label><button class="btn sm" data-action="report-export" ${rows.length?'':'disabled'}>Export project CSV</button></div>
      <p class="muted report-scope">Snapshot as of ${niceDate(report.day)}. Search matches project names and summaries; workspace and health filters apply to all figures and the export. Only authorized tasks are counted, so these may be partial project totals.</p>
      <div class="kpi-grid">${[['Projects',rows.length],['Need attention',rows.filter(r=>r.health==='attention').length],['Open tasks',total('open')],['Overdue tasks',total('overdue')]].map(([label,count])=>`<div class="kpi"><div class="label">${label}</div><div class="value">${count}</div></div>`).join('')}</div>
      <details class="report-rules"><summary>How project health is calculated</summary><p>Needs attention: an overdue task, blocked or waiting task, missed milestone, or passed project target. Watch: unassigned work, missing due dates, pending reviews, or a paused project. Closed projects keep their closed label. Completion excludes cancelled tasks. Milestones with no visible tasks remain unverified. These are current signals, not a delivery forecast.</p></details>
      <section class="portfolio-grid" aria-label="Project health">${rows.map(r=>`<article class="panel portfolio-card"><header><span class="report-health ${r.health}">${portfolioHealth[r.health]}</span><span class="muted">${esc(r.project.status)}</span></header><h2><button class="text-link" data-action="project" data-id="${esc(r.project.id)}">${esc(r.project.title)}</button></h2><p class="muted">${esc(deptFor(r.project.department_id)?.name||'Unavailable department')} · Lead: ${esc(nameFor(r.project.lead_id))}</p><p>${r.project.target_date?'Target '+niceDate(r.project.target_date):'No project target'}${r.targetLate?' · Target has passed':''}</p><div class="section-row"><strong>${r.progress}% complete</strong><small>${r.done} complete · ${r.cancelled} cancelled · ${r.tasks.length} visible</small></div><div class="progress-track"><div class="progress-fill" style="width:${r.progress}%"></div></div><div class="report-signals">${Object.entries(portfolioSignals).map(([key,label])=>signal(r,key==='all'?'open':key,label)).join('')}</div>${r.missed.length?`<p class="report-warning">${r.missed.length} missed milestone${r.missed.length===1?'':'s'}</p><div class="buttons">${r.missed.slice(0,3).map(milestone).join('')}</div>`:''}${r.upcoming.length?`<p>Next 14 days · ${r.upcoming.length} milestone${r.upcoming.length===1?'':'s'}</p><div class="buttons">${r.upcoming.slice(0,3).map(milestone).join('')}</div>`:''}</article>`).join('')||empty('◈','No matching projects','Adjust the search, workspace, health filter, or closed-project option.')}</section>
      ${selected?`<section class="panel report-detail" tabindex="-1" aria-label="Project task details"><div class="panel-head"><h2>${esc(selected.project.title)} · ${esc(portfolioSignals[s.reportSignal]||portfolioSignals.all)}</h2><button class="btn sm" data-action="report-detail-close">Close details</button></div><div class="panel-body"><p>${detail.length} matching tasks</p>${detail.map(t=>`<article class="report-task"><button class="text-link" data-action="task" data-id="${esc(t.id)}">${esc(t.title)}</button><span>${esc(nameFor(t.assignee_id))}</span><span>${esc(fmtStatus(t.status))}</span><span>${t.due_date?niceDate(t.due_date):'No due date'}</span></article>`).join('')||'<p class="muted">No tasks match this signal.</p>'}</div></section>`:''}`;
  }
  function leadershipReport(){
    const projects=visibleProjects().filter(p=>s.reportClosed||!['complete','archived'].includes(p.status));
    const cutoff=new Date();cutoff.setDate(cutoff.getDate()-Number(s.reportPeriod||30));
    const rows=projects.map(project=>{
      const updates=projectBriefs(project.id),recent=updates.filter(b=>new Date(b.created_at)>=cutoff);
      const upcoming=s.milestones.filter(m=>m.project_id===project.id&&!m.archived).sort((a,b)=>a.due_date.localeCompare(b.due_date))[0]||null;
      const latest=updates[0]||null;
      return {project,latest,recent,upcoming,needsUpdate:!latest||(Date.now()-new Date(latest.created_at).getTime())>14*86400000};
    });
    if(s.reportView==='accomplishments')return rows.filter(r=>r.recent.some(b=>b.accomplishments.trim()));
    return rows;
  }
  function exceptionReport(){
    const health=new Map(portfolioReport(new Date(),'all').rows.map(r=>[r.project.id,r]));
    return leadershipReport().filter(r=>!['complete','archived'].includes(r.project.status)).map(r=>{
      const h=health.get(r.project.id),signals=[];
      if(r.latest?.decisions?.trim())signals.push('Decision / support requested');
      if(r.latest?.health==='blocked')signals.push('Reported blocked');
      else if(r.latest?.health==='at_risk')signals.push('Reported at risk');
      if(h?.blocked.length)signals.push(h.blocked.length+' blocked / waiting tasks');
      if(h?.overdue.length)signals.push(h.overdue.length+' overdue tasks');
      if(h?.missed.length)signals.push(h.missed.length+' past-due milestones requiring verification');
      if(h?.targetLate)signals.push('Project target has passed');
      if(r.project.status==='paused')signals.push('Project paused');
      if(r.latest?.risks?.trim())signals.push('Risk / blocker note recorded');
      if(r.needsUpdate)signals.push(r.latest?'Check-in over 14 days old':'No check-in recorded');
      const priority=r.latest?.decisions?.trim()?0:r.latest?.health==='blocked'||h?.blocked.length?1:signals.some(x=>/overdue|past-due|passed|at risk/.test(x))?2:3;
      return {...r,signals,priority};
    }).filter(r=>r.signals.length).sort((a,b)=>a.priority-b.priority||a.project.title.localeCompare(b.project.title));
  }
  function exceptionReportBody(rows,interactive=false){
    return rows.map(r=>`<article class="leadership-card"><h3>${esc(r.project.title)}</h3><p class="muted">Delivery owner: ${esc(r.latest?.delivery_owner||nameFor(r.project.lead_id))} · ${esc(deptFor(r.project.department_id)?.name||'Department')} · Target: ${esc(niceDate(r.project.target_date))}</p><ul>${r.signals.map(signal=>`<li>${esc(signal)}</li>`).join('')}</ul><div class="brief-grid"><div><h4>Decision / support requested</h4>${briefText(r.latest?.decisions)}</div><div><h4>Next steps</h4>${briefText(r.latest?.next_steps)}</div><div><h4>Risks / blockers</h4>${briefText(r.latest?.risks)}</div><div><h4>Latest accomplishment</h4>${briefText(r.latest?.accomplishments)}</div></div><p class="muted">Last check-in: ${r.latest?esc(niceDate(r.latest.created_at)):'Never'}. Notes reflect that check-in, not a new confirmation.</p>${interactive?`<button class="btn sm" data-action="project" data-id="${esc(r.project.id)}">Open project / check-in</button>`:''}</article>`).join('')||'<p class="muted">No exceptions found in the visible active projects. This is not a guarantee that delivery is on track.</p>';
  }
  function exceptionReportPage(){
    const rows=exceptionReport(),active=leadershipReport().filter(r=>!['complete','archived'].includes(r.project.status));
    return `<div class="buttons report-toolbar"><button class="btn sm" data-action="leadership-print">Print / Save PDF</button><button class="btn sm" data-action="leadership-download">Download HTML</button></div><section class="leadership-report" aria-label="Weekly exception report"><div class="leadership-report-head"><div><h2>Weekly exception report</h2><p>Current snapshot · ${esc(niceDate(dateKey(new Date())))}</p></div></div><div class="kpi-grid">${[['Active projects in view',active.length],['Projects needing attention',rows.length],['Decision / support requested',rows.filter(r=>r.latest?.decisions?.trim()).length],['Missing / stale check-ins',rows.filter(r=>r.needsUpdate).length]].map(([label,value])=>`<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div></div>`).join('')}</div><p class="muted">Use this snapshot for your weekly review. Decisions first, then blockers and schedule concerns. Counts include only visible QuestBoard work, not Teams Planner. Milestones with no visible tasks require verification; they are not assumed complete. Update the project check-in to resolve old notes.</p><div class="leadership-cards">${exceptionReportBody(rows,true)}</div></section>`;
  }
  function leadershipReportBody(rows,mode=s.reportView){
    if(mode==='exceptions')return exceptionReportBody(rows);
    if(mode==='accomplishments')return rows.map(r=>`<article class="leadership-card"><h3>${esc(r.project.title)}</h3><p class="muted">${esc(deptFor(r.project.department_id)?.name||'Department')} · Delivery owner: ${esc(r.latest?.delivery_owner||nameFor(r.project.lead_id))}</p><ul>${r.recent.filter(b=>b.accomplishments.trim()).map(b=>`<li><time datetime="${esc(b.created_at)}">${esc(niceDate(b.created_at))}</time> · <span class="brief-prose">${esc(b.accomplishments)}</span></li>`).join('')}</ul></article>`).join('')||'<p class="muted">No accomplishments recorded in this period. Add project check-ins to build the report.</p>';
    return rows.map(r=>`<article class="leadership-card"><div class="brief-heading"><h3>${esc(r.project.title)}</h3><span class="brief-health ${esc(r.latest?.health||'unknown')}">${esc(r.latest?briefHealth[r.latest.health]||'Not reported':'Not reported')}</span></div><p class="muted">Delivery owner: ${esc(r.latest?.delivery_owner||nameFor(r.project.lead_id))} · Target: ${esc(niceDate(r.project.target_date))} · Last check-in: ${r.latest?esc(niceDate(r.latest.created_at)):'Never'}${r.needsUpdate?' · Check-in overdue':''}</p><div class="brief-grid"><div><h4>Next steps</h4>${briefText(r.latest?.next_steps)}</div><div><h4>Next milestone</h4>${r.upcoming?`<p>${esc(r.upcoming.title)} · ${esc(niceDate(r.upcoming.due_date))}</p>`:'<p class="muted">No active milestone recorded.</p>'}</div><div><h4>Risks / blockers</h4>${briefText(r.latest?.risks)}</div><div><h4>Decisions / support needed</h4>${briefText(r.latest?.decisions)}</div></div></article>`).join('')||'<p class="muted">No matching projects.</p>';
  }
  function leadershipReportPage(){
    const rows=leadershipReport(),accomplishments=s.reportView==='accomplishments',title=accomplishments?'Accomplishments & delivered value':'Status, risks & next steps';
    const count=rows.filter(r=>r.latest?.health==='at_risk'||r.latest?.health==='blocked').length;
    return `<div class="buttons report-toolbar">${accomplishments?`<label>Reporting period<select id="report-period">${[['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days'],['365','Last 12 months']].map(([value,label])=>`<option value="${value}" ${s.reportPeriod===value?'selected':''}>${label}</option>`).join('')}</select></label>`:''}<label><input id="report-closed" type="checkbox" ${s.reportClosed?'checked':''}> Include completed / archived projects</label><button class="btn sm" data-action="leadership-print">Print / Save PDF</button><button class="btn sm" data-action="leadership-download">Download HTML</button></div>
      <section class="leadership-report" aria-label="${esc(title)}"><div class="leadership-report-head"><div><h2>${esc(title)}</h2><p>University project portfolio · As of ${esc(niceDate(dateKey(new Date())))}</p></div><strong>${rows.length} project${rows.length===1?'':'s'} reported</strong></div>
      ${!accomplishments?`<div class="kpi-grid"><div class="kpi"><div class="label">Projects in view</div><div class="value">${rows.length}</div></div><div class="kpi amber"><div class="label">Reported at risk / blocked</div><div class="value">${count}</div></div><div class="kpi"><div class="label">Check-ins missing / over 14 days old</div><div class="value">${rows.filter(r=>r.needsUpdate).length}</div></div></div>`:''}
      ${accomplishments?`<p class="muted">Based on dated project check-ins from the last ${esc(s.reportPeriod)} days. This is a delivery summary, not a count of Planner tasks.</p>`:'<p class="muted">Latest recorded check-in per project. A missing or old check-in is not evidence that work is on track. Risks and decisions are reproduced as entered by project leads.</p>'}
      <div class="leadership-cards">${leadershipReportBody(rows)}</div></section>`;
  }
  function standaloneLeadershipHTML(){
    const title=s.reportView==='exceptions'?'Weekly exception report':s.reportView==='accomplishments'?'Accomplishments & delivered value':'Status, risks & next steps',rows=s.reportView==='exceptions'?exceptionReport():leadershipReport();
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · QuestBoard</title><style>body{font:14px/1.55 system-ui,Arial,sans-serif;color:#152238;max-width:920px;margin:36px auto;padding:0 24px}h1{font-size:25px}h2{font-size:19px}h3{font-size:17px;margin:0 0 5px}h4{margin:0 0 5px;font-size:13px}.muted{color:#64748b}.leadership-card{padding:20px 0;border-top:1px solid #cbd5e1;break-inside:avoid}.brief-heading{display:flex;justify-content:space-between;align-items:center;gap:15px}.brief-health{font-weight:700;padding:4px 8px;background:#e2e8f0;border-radius:20px}.brief-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.brief-prose{white-space:pre-wrap}.leadership-card li{margin:8px 0;white-space:pre-wrap}@media print{body{margin:0;max-width:none}.leadership-card{break-inside:avoid}}</style></head><body><h1>${esc(title)}</h1><p class="muted">QuestBoard · ${esc(s.org?.name||'Organization')} · Generated ${esc(new Date().toLocaleString())}${s.workspace==='all'?'':' · '+esc(deptFor(s.workspace)?.name||'Department')} · ${s.reportView==='accomplishments'?'Last '+esc(s.reportPeriod)+' days':'Current outlook'}</p><p>${rows.length} project${rows.length===1?'':'s'} in this report. Content is limited to projects visible to the generating user.</p>${s.reportView==='exceptions'?'<p>Current snapshot for weekly review, not changes over the last week. Only visible QuestBoard work is counted; Teams Planner is not synchronized. Past-due milestones require verification. Notes reflect the latest check-in and may be stale.</p>':''}${leadershipReportBody(rows)}<p class="muted">Generated from recorded project check-ins. This document may contain internal project information.</p></body></html>`;
  }
  function downloadLeadership(){
    const url=URL.createObjectURL(new Blob([standaloneLeadershipHTML()],{type:'text/html;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='questboard-'+(s.reportView==='exceptions'?'weekly-exceptions':s.reportView==='accomplishments'?'accomplishments':'project-outlook')+'-'+dateKey(new Date())+'.html';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function printLeadership(){
    const win=window.open('','_blank');if(!win){toast('Allow pop-ups to print this report, or download the HTML file.',true);return;}
    win.opener=null;win.document.open();win.document.write(standaloneLeadershipHTML());win.document.close();win.focus();win.print();
  }
  // Staff exports are copies of work already visible to the signed-in user. They do
  // not inherit QuestBoard's access controls after leaving the application.
  function staffExportData(projectId,options={}){
    const project=projectFor(projectId);if(!project)return null;
    const includeFinished=options.includeFinished===true,includeRestricted=options.includeRestricted===true;
    const assignee=options.assignee||'all';
    const all=s.tasks.filter(task=>task.project_id===projectId);
    const tasks=all.filter(task=>includeRestricted||task.visibility!=='restricted')
      .filter(task=>includeFinished||!['complete','cancelled'].includes(task.status))
      .filter(task=>assignee==='all'||(assignee==='unassigned'?!task.assignee_id:task.assignee_id===assignee))
      .sort((a,b)=>String(a.due_date||'9999-99-99').localeCompare(String(b.due_date||'9999-99-99'))||
        ({critical:0,high:1,normal:2,low:3}[a.priority]??4)-({critical:0,high:1,normal:2,low:3}[b.priority]??4)||
        String(a.title).localeCompare(String(b.title)));
    const included=new Map(tasks.map(task=>[task.id,task]));
    return {project,tasks,milestones:s.milestones.filter(m=>m.project_id===projectId&&!m.archived)
      .sort((a,b)=>String(a.due_date||'').localeCompare(String(b.due_date||''))),
      brief:latestBrief(projectId),includeChecklists:options.includeChecklists!==false,
      restrictedOmitted:all.filter(task=>task.visibility==='restricted'&&!includeRestricted).length,
      assignee,dependencies:task=>s.dependencies.filter(link=>link.task_id===task.id&&included.has(link.prerequisite_id))
        .map(link=>included.get(link.prerequisite_id).title),
      checklist:task=>s.checklist.filter(item=>item.task_id===task.id)};
  }
  function staffExportHTML(report){
    if(!report)return '';
    const {project,tasks,milestones,brief}=report;
    const taskHTML=task=>{
      const checks=report.includeChecklists?report.checklist(task):[],depends=report.dependencies(task);
      return `<article class="task"><div class="task-head"><h3>${esc(task.title)}</h3><span class="status">${esc(fmtStatus(task.status))}</span></div>
        <p class="meta"><strong>Owner:</strong> ${esc(nameFor(task.assignee_id))} · <strong>Due:</strong> ${esc(niceDate(task.due_date))} · <strong>Priority:</strong> ${esc(priorityNames[task.priority]||task.priority||'Not set')}${task.milestone_id&&milestones.some(m=>m.id===task.milestone_id)?' · <strong>Milestone:</strong> '+esc(milestones.find(m=>m.id===task.milestone_id).title):''}</p>
        ${task.description?`<p class="description">${esc(task.description)}</p>`:''}
        ${depends.length?`<p class="meta"><strong>Depends on:</strong> ${esc(depends.join(', '))}</p>`:''}
        ${checks.length?`<h4>Checklist (${checks.filter(c=>c.done).length}/${checks.length})</h4><ul class="checklist">${checks.map(c=>`<li>${c.done?'☑':'☐'} ${esc(c.title)}</li>`).join('')}</ul>`:''}
      </article>`;
    };
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(project.title)} · Staff handoff</title>
      <style>body{font:14px/1.5 system-ui,Arial,sans-serif;color:#17253a;max-width:920px;margin:35px auto;padding:0 24px}h1{font-size:27px;margin-bottom:5px}h2{font-size:19px;margin:28px 0 10px}h3{font-size:16px;margin:0}h4{margin:12px 0 5px}p{margin:7px 0}.meta,.subtle{color:#52627a}.description,.summary,.check-in{white-space:pre-wrap}.task{padding:17px 0;border-top:1px solid #d3dae5;break-inside:avoid}.task-head{display:flex;justify-content:space-between;gap:15px}.status{font-size:12px;font-weight:600;white-space:nowrap;background:#e9eff9;border-radius:12px;padding:3px 9px}.checklist{list-style:none;padding-left:10px}.checklist li{margin:4px 0}.milestones{padding-left:20px}.milestones li{margin:7px 0}.note{border-left:3px solid #5674aa;padding-left:12px}.footer{margin-top:28px;border-top:1px solid #d3dae5;padding-top:14px;font-size:12px;color:#52627a}@media print{body{margin:0;max-width:none}.task{break-inside:avoid}}</style></head><body>
      <h1>${esc(project.title)}</h1><p class="subtle">Staff project handoff · ${esc(s.org?.name||'Organization')} · Prepared ${esc(new Date().toLocaleDateString())}</p>
      <p class="meta"><strong>Project lead:</strong> ${esc(brief?.delivery_owner||nameFor(project.lead_id))} · <strong>Project status:</strong> ${esc(project.status||'Not set')} · <strong>Target:</strong> ${esc(niceDate(project.target_date))}</p>
      <h2>Project goal</h2><p class="summary">${esc(project.summary||'No goal recorded.')}</p>
      ${brief?.next_steps?`<section class="note"><h2>Current next steps</h2><p class="check-in">${esc(brief.next_steps)}</p><p class="subtle">From project check-in on ${esc(niceDate(brief.created_at))}</p></section>`:''}
      <h2>Milestones</h2>${milestones.length?`<ul class="milestones">${milestones.map(m=>`<li><strong>${esc(m.title)}</strong> — ${esc(niceDate(m.due_date))}${m.description?`<p class="description">${esc(m.description)}</p>`:''}</li>`).join('')}</ul>`:'<p class="subtle">No active milestones recorded.</p>'}
      <h2>Tasks to work on (${tasks.length})</h2>${tasks.map(taskHTML).join('')||'<p class="subtle">No tasks match these export choices.</p>'}
      <p class="footer">Prepared from the project and tasks visible to the exporter, independent of their board filters. This file is a snapshot; updates in QuestBoard will not change it. Verify recipients before sharing, as downloaded files are outside QuestBoard permissions.</p></body></html>`;
  }
  function staffExportCSV(report){
    if(!report)return '';
    const csvCell=value=>{let valueText=String(value??'');if(/^[\s]*[=+@-]|^[\t\r\n]/.test(valueText))valueText="'"+valueText;return '"'+valueText.replaceAll('"','""')+'"';};
    const {project,brief,milestones,tasks}=report;
    const headers=['Record type','Project','Project goal','Project status','Project target','Project lead','Title','Description','Milestone','Owner','Task status','Priority','Due date','Checklist progress','Checklist items','Depends on'];
    const base=[project.title,project.summary,project.status,project.target_date,brief?.delivery_owner||nameFor(project.lead_id)];
    const rows=[['Project',...base,project.title,brief?.next_steps||'', '', '', '', '', '', '', '', '']];
    for(const m of milestones)rows.push(['Milestone',...base,m.title,m.description||'','','','','',m.due_date,'','','']);
    for(const task of tasks){
      const checks=report.includeChecklists?report.checklist(task):[],milestone=milestones.find(m=>m.id===task.milestone_id);
      rows.push(['Task',...base,task.title,task.description||'',milestone?.title||'',nameFor(task.assignee_id),
        fmtStatus(task.status),priorityNames[task.priority]||task.priority||'',task.due_date||'',
        checks.length?`${checks.filter(c=>c.done).length}/${checks.length}`:'',
        checks.map(c=>(c.done?'[x] ':'[ ] ')+c.title).join('\n'),report.dependencies(task).join('; ')]);
    }
    return [headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
  }
  function currentStaffExport(){
    if(s.nav!=='project'||s.modal!=='project-export'||s.loading||s.lastError)return null;
    const chosen=root.querySelector('#staff-export-assignee')?.value||'all';
    const options={assignee:chosen,includeFinished:!!root.querySelector('#staff-export-finished')?.checked,
      includeRestricted:!!root.querySelector('#staff-export-restricted')?.checked,
      includeChecklists:!!root.querySelector('#staff-export-checklists')?.checked};
    return staffExportData(s.projectId,options);
  }
  function downloadStaffExport(format){
    const report=currentStaffExport();if(!report)return;
    const csv=format==='csv',content=csv?'\uFEFF'+staffExportCSV(report):staffExportHTML(report);
    const filename='questboard-staff-handoff-'+dateKey(new Date())+(csv?'.csv':'.html');
    const url=URL.createObjectURL(new Blob([content],{type:csv?'text/csv;charset=utf-8':'text/html;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function printStaffExport(){
    const report=currentStaffExport();if(!report)return;
    const win=window.open('','_blank');if(!win){toast('Allow pop-ups to print, or download the HTML handoff.',true);return;}
    win.opener=null;win.document.open();win.document.write(staffExportHTML(report));win.document.close();win.focus();win.print();
  }
  function reportsPage(){
    const tabs=`<div class="filter-row" role="group" aria-label="Report view">${[['exceptions','Weekly exceptions'],['accomplishments','What we accomplished'],['outlook','Where we stand & next steps'],['portfolio','Task health'],['progression','Progress & recognition']].map(([value,label])=>`<button class="filter-pill ${s.reportView===value?'active':''}" data-action="report-view" data-value="${value}" aria-pressed="${s.reportView===value}">${label}</button>`).join('')}</div>`;
    return pageTitle(term('Reports','Chronicle'),'Turn short project check-ins into leadership-ready updates.')+tabs+(s.reportView==='progression'?progressionReport():s.reportView==='portfolio'?portfolioPage():s.reportView==='exceptions'?exceptionReportPage():leadershipReportPage());
  }
  function progressionReport(){const total=s.xp.filter(x=>s.demo||x.user_id===s.user?.id).reduce((n,x)=>n+(x.amount||0),0),level=Math.min(20,1+Math.floor(Math.sqrt(total/65))),next=65*level*level,ts=visibleTasks(),done=ts.filter(t=>t.status==='complete').length;
    return `<div class="kpi-grid"><div class="kpi green"><div class="label">Verified tasks</div><div class="value">${done}</div><div class="hint">Of ${ts.length} authorized tasks</div></div><div class="kpi"><div class="label">Experience earned</div><div class="value">${total}</div><div class="hint">From approved work</div></div><div class="kpi purple"><div class="label">${term('Progression level','Guild level')}</div><div class="value">${level}</div><div class="hint">20-level journey</div></div><div class="kpi amber"><div class="label">Next level</div><div class="value">${level===20?'MAX':Math.max(0,next-total)}</div><div class="hint">XP remaining</div></div></div>
    <div class="layout-2"><div class="panel"><div class="panel-head"><h3>${term('Project health','Campaign progress')}</h3></div><div class="panel-body">${visibleProjects().map(p=>`<div style="margin-bottom:24px" data-action="project" data-id="${p.id}"><div class="section-row"><strong>${esc(p.title)}</strong><small>${pct(p)}%</small></div><div class="progress-track"><div class="progress-fill" style="width:${pct(p)}%"></div></div></div>`).join('')||empty('◈','No project data','Create a project to start tracking progress.')}</div></div><div class="panel"><div class="panel-head"><h3>Progression principles</h3></div><div class="panel-body"><p class="muted">✦ XP only after verified completion.</p><p class="muted" style="margin-top:18px">✦ No penalty for reporting blockers.</p><p class="muted" style="margin-top:18px">✦ Shared success matters more than individual rankings.</p><p class="muted" style="margin-top:18px">✦ Talent trees and mastery tracks are planned for the next release.</p></div></div></div>`;
  }
  function meetingsPage(){return pageTitle(term('Meeting follow-ups','Council Chamber'),'Carry decisions into action without losing the story of the work.')+`<div class="layout-2"><div class="panel"><div class="panel-head"><h3>Minutes integration</h3></div><div class="panel-body"><div style="font-size:32px;margin-bottom:15px">▤</div><h2>Keep decisions and execution connected</h2><p class="lead" style="margin-bottom:22px">Minutes remains the record of meetings. QuestBoard holds the projects, tasks, and work journals. A scoped action-link workflow is planned after the existing Minutes JSON structure is upgraded.</p><a class="btn primary" href="${esc(cfg.minutesUrl||'https://minutes.dudgeon.io')}" target="_blank" rel="noopener">Open Minutes ↗</a></div></div><div class="panel"><div class="panel-head"><h3>Weekly standup workflow</h3></div><div class="panel-body"><div class="info-list"><p>01 · Capture decisions and assignments in Minutes.</p><p>02 · Create the corresponding task in QuestBoard.</p><p>03 · Staff log work, blockers, and evidence here.</p><p>04 · Review verified progress at the next standup.</p></div></div></div></div>`;}
  function membershipScopes(){return [
    ...(isAdmin()&&s.org?[{value:'organization:'+s.org.id,label:'Organization'}]:[]),
    ...managedDepartments().map(d=>({value:'department:'+d.id,label:'Department · '+d.name})),
    ...managedProjects().map(p=>({value:'project:'+p.id,label:'Project · '+p.title}))];}
  function membershipRoles(type){return type==='organization'?['member','admin']:type==='department'?(isAdmin()?['viewer','contributor','manager']:['viewer','contributor']):(isAdmin()?['viewer','contributor','lead']:['viewer','contributor']);}
  function membershipPanel(){
    const scopes=membershipScopes();if(!scopes.length)return empty('⚿','Access restricted','No membership administration scope is available.');
    const selected=scopes.some(x=>x.value===membership.scope)?membership.scope:scopes[0].value;
    const type=selected.split(':')[0],roles=membershipRoles(type),ready=membership.loaded&&membership.scope===selected&&!membership.loading&&!membership.error;
    const roleOptions=current=>roles.map(r=>`<option value="${r}" ${r===current?'selected':''}>${esc(r)}</option>`).join('');
    return `<section class="panel" style="margin-bottom:22px"><div class="panel-head"><h3>Membership controls</h3></div><div style="padding:20px">
      <label for="membership-scope">Scope</label><select id="membership-scope">${scopes.map(x=>`<option value="${esc(x.value)}" ${x.value===selected?'selected':''}>${esc(x.label)}</option>`).join('')}</select>
      <button class="btn" data-action="load-memberships">${membership.loading?'Loading…':'Load / refresh members'}</button>
      <p role="status">${esc(membership.error||(!ready?'Load members to administer this scope.':'Suspension preserves work history. Other active scopes may still grant access. Organization suspension overrides them.'))}</p>
      ${s.demo?'<p>Membership administration requires a signed-in workspace.</p>':''}
      ${ready?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Member</th><th>Role / status</th><th>Action</th></tr></thead><tbody>${membership.rows.filter(m=>m.role).map(m=>{
        const allowed=roles.includes(m.role);return `<tr><td>${esc(m.display_name)}<small> · organization ${esc(m.org_status)}</small></td><td>${esc(m.role)} · ${esc(m.status)}</td><td>${allowed?`<form data-form="membership" data-user="${esc(m.user_id)}"><input type="hidden" name="scope" value="${esc(selected)}"><select name="role" aria-label="Membership role">${roleOptions(m.role)}</select><select name="action" aria-label="Membership action"><option value="role">Change role</option><option value="${m.status==='active'?'suspend':'reinstate'}">${m.status==='active'?'Suspend':'Reinstate'}</option></select><button class="btn sm" type="submit">Apply</button></form>`:'Leadership requires an organization administrator'}</td></tr>`;}).join('')}</tbody></table></div>
      ${type!=='organization'?`<form data-form="membership"><input type="hidden" name="scope" value="${esc(selected)}"><input type="hidden" name="action" value="grant"><label>Grant scoped access <select name="user_id" required><option value="">Choose a person</option>${membership.rows.filter(m=>!m.role&&m.org_status==='active').map(m=>`<option value="${esc(m.user_id)}">${esc(m.display_name)}</option>`).join('')}</select></label><select name="role" aria-label="Membership role">${roleOptions('viewer')}</select><button class="btn" type="submit">Grant access</button></form>`:'<p>New organization members must accept an invitation.</p>'}
      <h4>Recent membership history</h4><p>Latest 50 changes in this scope. No history is backfilled.</p><ul>${membership.events.map(e=>`<li>${esc(niceDate(e.created_at))} · ${esc(membership.rows.find(m=>m.user_id===e.user_id)?.display_name||nameFor(e.user_id))} · ${esc(e.before_data?e.before_data.role+' / '+e.before_data.status:'new')} → ${esc(e.after_data?e.after_data.role+' / '+e.after_data.status:'removed')} · actor ${esc(e.actor_id?nameFor(e.actor_id):'system')}</li>`).join('')||'<li>No recorded changes.</li>'}</ul>`:''}
    </div></section>`;
  }
  async function loadMemberships(scope){
    const request=++membershipRequest,user=s.user?.id,org=s.org?.id;
    Object.assign(membership,{scope,rows:[],events:[],loading:true,error:null,loaded:false});render();
    try{
      if(s.demo)throw Error('Sign in to manage memberships');
      if(!membershipScopes().some(x=>x.value===scope))throw Error('Scope unavailable');
      const [type,id]=scope.split(':');
      const [rows,events]=await Promise.all([pagedRows(()=>api.rpc('qb_membership_directory',{p_type:type,p_scope:id}).order('display_name'),['user_id'],()=>request===membershipRequest),getResult(api.from('qb_membership_events').select('user_id,actor_id,before_data,after_data,created_at').eq('scope_type',type).eq('scope_id',id).order('created_at',{ascending:false}).order('id').limit(50))]);
      if(request!==membershipRequest||user!==s.user?.id||org!==s.org?.id)return;
      Object.assign(membership,{rows,events,loaded:true});
    }catch(e){if(request!==membershipRequest)return;membership.error=e.message;}
    if(request!==membershipRequest)return;membership.loading=false;render();
  }
  function adminPage(){if(!isAdmin())return pageTitle('Membership administration','Manage people within your authorized scopes.')+membershipPanel();
    return pageTitle('Organization administration','Manage departments, invitations, and the people who can collaborate.',`<button class="btn primary" data-action="modal" data-value="invite">＋ Invite people</button><button class="btn" data-action="modal" data-value="department">＋ Department</button>`)+
    membershipPanel()+`<div class="kpi-grid"><div class="kpi"><div class="label">Departments</div><div class="value">${s.departments.length}</div><div class="bubble">▦</div></div><div class="kpi purple"><div class="label">Active members</div><div class="value">${s.orgMembers.filter(m=>m.status==='active').length}</div><div class="bubble">♧</div></div><div class="kpi amber"><div class="label">Pending invites</div><div class="value">${s.invitations.filter(i=>i.status==='pending').length}</div><div class="bubble">✉</div></div><div class="kpi green"><div class="label">SSO options</div><div class="value">2</div><div class="bubble">⚿</div><div class="hint">Microsoft / Google · provider setup required</div></div></div>
    <div class="panel" style="margin-bottom:22px"><div class="panel-head"><div><h3>Department workspaces</h3><p>Membership and project visibility are scoped to each department</p></div><button class="btn sm" data-action="modal" data-value="department">Add department</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Department</th><th>Projects</th><th>Members</th></tr></thead><tbody>${s.departments.map(d=>`<tr><td class="strong"><span class="small-dot" style="background:${esc(d.color)}"></span>${esc(d.name)}</td><td>${s.projects.filter(p=>p.department_id===d.id).length}</td><td>${s.departmentMembers.filter(m=>m.department_id===d.id).length}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><div class="panel-head"><div><h3>Invitations</h3><p>One-time invitations are tied to verified email accounts</p></div><button class="btn sm" data-action="modal" data-value="invite">Invite member</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Email</th><th>Scope</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>${s.invitations.map(i=>`<tr><td class="strong">${esc(i.invited_email)}</td><td>${esc(i.scope_type)}</td><td>${esc(i.invite_role.replace(/_/g,' '))}</td><td>${tag(i.status)}</td><td><div class="inline-actions">${i.status==='pending'?`<button class="btn sm" data-action="copy-invite" data-id="${i.id}">Copy link</button><button class="btn sm danger" data-action="revoke-invite" data-id="${i.id}">Revoke</button>`:'—'}</div></td></tr>`).join('')||`<tr><td colspan="5" style="text-align:center;padding:25px;color:var(--muted)">No invitations yet</td></tr>`}</tbody></table></div></div>`;
  }
  function organizationForm(){return `<form data-form="organization" data-request="${uid()}"><div class="form-field"><label>Organization name</label><input name="name" required minlength="2" maxlength="120" placeholder="e.g. University of Saint Francis"></div><p class="field-hint">You will be this organization's administrator. Next, add departments and invite your team.</p><p data-organization-status role="status"></p><button class="btn primary block" type="submit">Create organization</button></form>`;}
  function onboarding(){return `<div class="login-page"><div class="login-left"><div class="login-brand"><span class="logo">✦</span> QuestBoard</div><div class="login-content"><div class="eyebrow">Step 2 · Create your organization</div><h1>Your next chapter <em>starts here.</em></h1><p>Create a home for your team, then organize its work into departments. Joining an existing team? Accept an invitation below.</p></div><div class="login-foot">Your organizations stay separate</div></div><div class="login-right"><div class="auth-card"><div class="mini">✦</div><h2>Create your organization</h2><p>Signed in as ${esc(s.user.email)}.</p>${organizationForm()}<div class="auth-divider">OR JOIN YOUR TEAM</div>${invitationNotice()}${s.pendingInvitations.length?s.pendingInvitations.map(i=>`<div class="invite-box"><strong>${esc(i.org_name)}</strong><p>${esc(i.invite_role.replace(/_/g,' '))} · expires ${niceDate(i.expires_at)}</p><button class="btn primary block" style="margin-top:15px" data-action="accept-invite" data-id="${i.id}">Accept invitation</button></div>`).join(''):`<div class="invite-box"><strong>No pending invitations</strong><p>Ask your organization administrator to invite ${esc(s.user.email)}.</p></div>`}<button class="btn block" style="margin-top:20px" data-action="logout">Sign out</button></div></div></div>`;}
  function login(){return `<div class="login-page"><div class="login-left"><div class="login-brand"><span class="logo">✦</span> QuestBoard</div><div class="login-content"><div class="eyebrow">Meaningful work, real progress</div><h1>Your work is an <em>adventure.</em></h1><p>Plan projects. Rally your team. Make every accomplishment count. One workspace, two ways to experience progress.</p><div class="login-points"><span>✓ Department workspaces</span><span>✓ Verified progress</span><span>✓ Optional RPG mode</span></div></div><div class="login-foot">QuestBoard · ${esc(cfg.buildLabel||'Pilot')}</div></div><div class="login-right"><div class="auth-card"><div class="mini">✦</div><h2>${signupMode?'Create your account':'Welcome to QuestBoard'}</h2><p>${signupMode?'Step 1 · Continue with Google to create your account. Then create an organization and add its departments.':'Sign in to your organizations, or create an account to start your own.'}</p><button class="btn block" data-action="signup-mode">${signupMode?'Already have an account? Sign in':'New here? Sign up'}</button>${invitationNotice()}${authError?`<div class="auth-error" role="alert">${esc(authError)}</div>`:''}<button class="auth-provider" data-action="login" data-value="azure" ${!providerEnabled('azure')||authPending?'disabled':''}><span class="provider-icon ms">▦</span>${providerEnabled('azure')?'Continue with Microsoft':'Microsoft sign-in unavailable'}</button><button class="auth-provider" data-action="login" data-value="google" ${!providerEnabled('google')||authPending?'disabled':''}><span class="provider-icon google">G</span>${providerEnabled('google')?'Continue with Google':'Google sign-in unavailable'}</button>${authPending?'<p role="status">Opening sign-in…</p>':''}<div class="auth-divider">OR EXPLORE FIRST</div><button class="btn demo-btn" data-action="demo">✦ Explore sample workspace</button>${signOutFailed?'<button class="btn" data-action="logout">Retry sign out</button>':''}<div class="auth-fine">Google handles your sign-in securely. To accept an invitation, use the invited email address. Demo data is fictional and not saved.</div></div></div></div>`;}
  function modalHTML(){if(!s.modal)return '';let content='',title='';
    if(s.modal==='task-view'){title='Save task view';content=`<form data-form="task-view"><div class="modal-body"><div class="form-field"><label for="task-view-name">View name</label><input id="task-view-name" name="name" required maxlength="60" placeholder="e.g. My overdue tasks"></div><p class="field-hint">Up to 12 views per organization on this browser. Using an existing name replaces its filters.</p></div>${modalFooter('Save view')}</form>`;}
    if(s.modal==='project-export'){
      const project=projectFor(s.projectId),all=s.tasks.filter(task=>task.project_id===s.projectId);
      const ids=[...new Set(all.map(task=>task.assignee_id).filter(Boolean))];
      title='Export project for staff';
      content=`<div class="modal-body">
        <p>Prepare a handoff for <strong>${esc(project?.title||'this project')}</strong>. Exports use all project tasks you can access, regardless of board filters or search.</p>
        <div class="form-field"><label for="staff-export-assignee">Tasks for</label><select id="staff-export-assignee"><option value="all">Everyone (all tasks)</option><option value="unassigned">Unassigned tasks only</option>${ids.map(id=>`<option value="${esc(id)}">${esc(nameFor(id))}</option>`).join('')}</select></div>
        <label class="checkline"><input id="staff-export-checklists" type="checkbox" checked> Include task checklists</label>
        <label class="checkline"><input id="staff-export-finished" type="checkbox"> Include completed and cancelled tasks</label>
        ${all.some(task=>task.visibility==='restricted')?`<label class="checkline"><input id="staff-export-restricted" type="checkbox"> Include restricted tasks I can access (${all.filter(task=>task.visibility==='restricted').length})</label>`:'<input id="staff-export-restricted" type="checkbox" hidden disabled>'}
        <p class="field-hint">The handoff includes the project goal, next steps, milestones, owners, dates, task instructions, and any selected checklists. CSV opens in spreadsheet apps; HTML can be attached to an email or printed to PDF.</p>
        <p class="field-hint" role="note"><strong>Sharing caution:</strong> Downloads are outside QuestBoard permissions. Review the content and recipients before sending, especially for restricted projects or tasks.</p>
      </div><div class="modal-footer staff-export-actions"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="button" class="btn" data-action="staff-export-csv">Download CSV</button><button type="button" class="btn" data-action="staff-export-html">Download handoff</button><button type="button" class="btn primary" data-action="staff-export-print">Print / Save PDF</button></div>`;
    }
    if(s.modal==='project-settings'){title='Project settings';content=projectSettingsForm();}
    if(s.modal==='organization'){title='Create organization';content=`<div class="modal-body">${organizationForm()}</div>`;}
    if(s.modal==='milestone'){title=s.editMilestoneId?'Edit milestone':'Add milestone';content=milestoneForm();}
    if(s.modal==='save-template'){const task=taskFor(s.taskId);title='Save task template';content=`<form data-form="save-template" data-request="${esc(s.taskRequest)}"><div class="modal-body"><p>Reuse this task’s instructions, priority, XP, and checklist in this project. Choose an owner when creating each task.</p><div class="form-field"><label for="template-name">Template name</label><input id="template-name" name="name" required maxlength="120" value="${esc(task.title.slice(0,120))}"></div><div class="form-field"><label for="template-days">Due after how many days?</label><input id="template-days" type="number" name="due_days" min="0" max="3650" step="1"><small>Leave blank to choose a due date each time. Enter 0 for the creation day.</small></div></div>${modalFooter('Save template')}</form>`;}
    if(s.modal==='project'){title=term('Create a project','Begin a campaign');content=`<form data-form="project"><div class="modal-body"><div class="form-field"><label>Project name</label><input name="title" required maxlength="140" placeholder="e.g. Network Infrastructure Modernization"></div><div class="form-field"><label>Goal / description</label><textarea name="summary" maxlength="1200" placeholder="What outcome are we trying to achieve?"></textarea></div><div class="form-grid"><div class="form-field"><label>Department</label><select name="department_id" required>${managedDepartments().map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div><div class="form-field"><label>Target date</label><input type="date" name="target_date"></div></div><div class="form-field"><label>Visibility</label><select name="visibility"><option value="department">Department private</option><option value="invited">Invited project members</option><option value="restricted">Restricted project</option></select><small class="field-hint">Cross-department access requires explicit project membership.</small></div></div>${modalFooter('Create project')}</form>`;}
    if(s.modal==='quick-task'){title='Quick task';content=`<form data-form="quick-task" data-request="${esc(s.taskRequest)}"><div class="modal-body"><div class="form-field"><label for="quick-title">Task title</label><input id="quick-title" name="title" required maxlength="160" placeholder="What needs to get done?"></div><div class="form-field"><label for="quick-destination">Project (optional)</label><select id="quick-destination" name="destination" required>${managedDepartments().map(d=>`<option value="department:${d.id}">No project · ${esc(d.name)}</option>`).join('')}${managedProjects().filter(p=>!p.is_quick_queue).map(p=>`<option value="project:${p.id}" ${p.id===s.projectId?'selected':''}>${esc(p.title)}</option>`).join('')}</select><small>No-project tasks go in the department’s shared quick-task queue.</small></div><div class="form-field"><label for="quick-due">Due date (optional)</label><input id="quick-due" name="due_date" type="date"></div><p class="field-hint">Starts unassigned with 15 XP on approval. Open the task to assign an owner and add details.</p></div>${modalFooter('Create task')}</form>`;}
    if(s.modal==='task'){const selectedProject=s.candidateProject||s.projectId||managedProjects()[0]?.id;title=term('Add a task','Post a quest');content=`<form data-form="task" data-request="${esc(s.taskRequest)}" data-template="${esc(s.creationTemplate||'')}"><div class="modal-body">${creationTemplate()?`<p class="template-notice">Using ${esc(creationTemplate().name)} · ${creationTemplate().checklist.length} checklist items will be added.</p>`:''}<div class="form-field"><label>Task title</label><input name="title" required maxlength="160" placeholder="What needs to get done?"></div><div class="form-field"><label>Expected outcome</label><textarea name="description" maxlength="2500" placeholder="What does success look like?"></textarea></div><div class="form-field"><label>Project</label><select name="project_id" id="task-project-select" required>${managedProjects().filter(p=>!creationTemplate()||p.id===creationTemplate().project_id).map(p=>`<option value="${p.id}" ${p.id===selectedProject?'selected':''}>${esc(p.title)}</option>`).join('')}</select></div><div class="form-field"><label for="creation-milestone">Milestone</label><select id="creation-milestone" name="milestone_id">${milestoneOptions(selectedProject,s.creationMilestone||'')}</select></div><div class="form-field"><label for="creation-prerequisite">Depends on (optional)</label><select id="creation-prerequisite" name="prerequisite_id">${creationDependencyOptions(selectedProject)}</select><small class="field-hint">Choose a task that must finish first. You can add more prerequisites after creation.</small></div><div class="form-grid"><div class="form-field"><label>Priority</label><select name="priority"><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option><option value="critical">Critical</option></select></div><div class="form-field"><label>Due date</label><input type="date" name="due_date"></div><div class="form-field"><label>Assign to</label><select name="assignee_id"><option value="">Unassigned</option>${memberOptions(selectedProject)}</select></div><div class="form-field"><label>XP on approval</label><select name="xp_reward"><option value="15">15 · Small</option><option value="30" selected>30 · Standard</option><option value="60">60 · Complex</option><option value="100">100 · Major</option></select></div></div></div>${candidateNotice()}${modalFooter('Create task')}</form>`;}
    if(s.modal==='edit-task'){const t=taskFor(s.taskId);title='Edit task';content=`<form data-form="edit-task"><div class="modal-body"><div class="form-field"><label>Title</label><input name="title" required maxlength="160" value="${esc(t.title)}"></div><div class="form-field"><label>Description</label><textarea name="description">${esc(t.description)}</textarea></div><div class="form-grid"><div class="form-field"><label>Priority</label><select name="priority">${Object.entries(priorityNames).map(([k,v])=>`<option value="${k}" ${t.priority===k?'selected':''}>${v}</option>`).join('')}</select></div><div class="form-field"><label>Due date</label><input type="date" name="due_date" value="${esc(t.due_date||'')}"></div><div class="form-field"><label>Assignee</label><select name="assignee_id"><option value="">Unassigned</option>${memberOptions(t.project_id,t.assignee_id,t.id)}</select></div><div class="form-field"><label for="edit-milestone">Milestone</label><select id="edit-milestone" name="milestone_id">${milestoneOptions(t.project_id,t.milestone_id)}</select></div><div class="form-field"><label>Reviewer</label><select name="reviewer_id"><option value="">Project lead</option>${memberOptions(t.project_id,t.reviewer_id,t.id)}</select></div></div></div>${candidateNotice()}${modalFooter('Save changes')}</form>`;}
    if(s.modal==='department'){title=s.departments.length?'Create department':'Step 3 · Add your first department';content=`<form data-form="department"><div class="modal-body"><div class="form-field"><label>Department name</label><input name="name" required maxlength="120" placeholder="e.g. Facilities"></div><div class="form-field"><label>Color</label><input name="color" type="color" value="#658be7" style="height:45px"></div></div>${modalFooter('Create department')}</form>`;}
    if(s.modal==='invite'){title='Invite a team member';content=`<form data-form="invite"><div class="modal-body"><div class="form-field"><label>Email address</label><input name="invited_email" type="email" required placeholder="person@university.edu"></div><div class="form-field"><label>Access scope</label><select name="scope" id="invite-scope"><option value="organization">Organization member</option>${s.departments.map(d=>`<option value="dept:${d.id}">Department · ${esc(d.name)}</option>`).join('')}${s.projects.map(p=>`<option value="project:${p.id}">Project · ${esc(p.title)}</option>`).join('')}</select></div><div class="form-field"><label>Role</label><select name="invite_role" id="invite-role"><option value="member">Organization member</option></select></div><div class="invite-box"><p>After creating the invitation, copy its secure link to share with the recipient. Automatic invitation emails are not enabled in this pilot.</p></div></div>${modalFooter('Create invitation')}</form>`;}
    return `<div class="modal-cover" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></div>${content}</div></div>`;
  }
  const modalFooter=text=>`<div class="modal-footer">${['task','quick-task'].includes(s.modal)?`<label class="creation-state">After creating<select name="initial_status"><option value="ready" selected>Ready to work</option><option value="in_progress">Start work now</option><option value="backlog">Save to backlog</option></select></label>`:''}<button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn primary" ${['task','edit-task'].includes(s.modal)&&(s.candidatesLoading||s.candidateError)?'disabled':''}>${esc(text)}</button></div>`;
  function demoCandidates(projectId){
    const project=projectFor(projectId);if(!project)return [];
    const ids=new Set(s.projectMembers.filter(m=>m.project_id===projectId&&m.status==='active').map(m=>m.user_id));
    if(project.visibility==='department')s.departmentMembers.filter(m=>m.department_id===project.department_id&&m.status==='active').forEach(m=>ids.add(m.user_id));
    return [...ids].map(user_id=>({user_id,display_name:nameFor(user_id)}));
  }
  function creationDependencyOptions(projectId){
    return '<option value="">None — independent task</option>'+s.tasks.filter(t=>t.project_id===projectId).map(t=>`<option value="${esc(t.id)}">${esc(t.title)} — ${esc(fmtStatus(t.status))}</option>`).join('');
  }
  function memberOptions(projectId,selected='',taskId=null){
    const rows=s.demo?demoCandidates(projectId):s.candidateProject===projectId&&s.candidateTask===taskId?s.candidateRows:[];
    const options=rows.map(p=>`<option value="${esc(p.user_id)}" ${selected===p.user_id?'selected':''}>${esc(p.display_name)}</option>`);
    // Preserve historical references on unrelated edits; never offer them for new assignments.
    if(taskId&&selected&&!rows.some(p=>p.user_id===selected))options.push(`<option value="${esc(selected)}" selected>Unavailable — keep existing assignment</option>`);
    return options.join('');
  }
  const candidateMessage=()=>s.candidatesLoading?'Loading eligible people…':s.candidateError?'Unable to load eligible people. Retry without closing this form.':'Only people with access to this work are listed.';
  const candidateNotice=()=>`<p id="candidate-status" class="field-hint" role="status">${esc(candidateMessage())}</p><button id="candidate-retry" type="button" class="btn sm" data-action="retry-candidates" ${s.candidateError?'':'hidden'}>Retry loading people</button>`;
  function updateAssignmentControls(){
    const form=document.querySelector?.('form[data-form="task"],form[data-form="edit-task"]');if(!form)return;
    const task=s.candidateTask?taskFor(s.candidateTask):null;
    for(const field of ['assignee_id','reviewer_id']){
      const select=form.querySelector(`[name="${field}"]`);if(!select)continue;
      const selected=task?task[field]:select.value;
      const rows=s.demo?demoCandidates(s.candidateProject):s.candidateRows;
      const keep=task?selected:rows.some(p=>p.user_id===selected)?selected:'';
      select.innerHTML=`<option value="">${field==='assignee_id'?'Unassigned':'Project lead'}</option>`+memberOptions(s.candidateProject,keep,s.candidateTask);
      select.disabled=!!(s.candidatesLoading||s.candidateError);
    }
    const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=!!(s.candidatesLoading||s.candidateError);
    const status=document.getElementById('candidate-status');if(status)status.textContent=candidateMessage();
    const retry=document.getElementById('candidate-retry');if(retry)retry.hidden=!s.candidateError;
  }
  async function loadAssignmentCandidates(projectId,taskId=null){
    const request=++candidateRequest;
    s.candidateProject=projectId;s.candidateTask=taskId;s.candidateRows=[];s.candidatesLoading=true;s.candidateError=null;
    updateAssignmentControls();
    try{
      if(!projectId)throw Error('Choose a project');
      const rows=s.demo?demoCandidates(projectId):await pagedRows(()=>api.rpc('qb_assignment_candidates',{p_project:projectId,p_task:taskId}).order('display_name'),['user_id'],()=>request===candidateRequest);
      if(request!==candidateRequest)return;
      s.candidateRows=rows;
    }catch(e){if(request!==candidateRequest)return;s.candidateError=e.message;}
    if(request!==candidateRequest)return;
    s.candidatesLoading=false;updateAssignmentControls();
  }
  function loadingContent(){return `<section class="panel"><div class="empty" role="status"><span class="empty-icon" aria-hidden="true">◷</span><h2>Loading workspace…</h2><p id="load-progress">${s.loadedRows?`${s.loadedRows.toLocaleString()} records loaded…`:'Gathering your workspace…'}</p></div></section>`;}
  function loadError(){return `<section class="panel"><div class="empty" role="alert"><h2>Unable to load your workspace</h2><p>${esc(s.lastError)}</p><button class="btn primary" data-action="retry">Try again</button></div></section>`;}
  function render(){
    document.body.classList.toggle('mode-rpg',rpg());
    const html=s.user&&(s.loading||s.lastError||s.org)?header():s.loading?`<div class="boot"><div class="brand-symbol">✦</div><p role="status">Loading QuestBoard…</p></div>`:!s.user?login():onboarding();
    // Keep the surrounding shell mounted when only the content region changes.
    const current=root.querySelector?.('.shell');
    if(current&&s.user&&(s.loading||s.lastError||s.org)){
      const template=document.createElement('template');template.innerHTML=html;
      const next=template.content.querySelector('.shell');current.className=next.className;
      for(const selector of ['.sidebar','.topbar','.page']){
        const before=current.querySelector(selector),after=next.querySelector(selector);
        if(before.innerHTML!==after.innerHTML)before.innerHTML=after.innerHTML;
        if(selector==='.page')before.setAttribute('aria-busy',String(s.loading));
      }
      while(current.nextSibling)current.nextSibling.remove();
      while(next.nextSibling)root.append(next.nextSibling);
    }else root.innerHTML=html;
    root.querySelectorAll('form[data-form]').forEach(form=>formEpoch.set(form,epoch));
    root.querySelectorAll('.project-card,.task-item,.board-task,[data-action="project"]:not(button)').forEach(el=>{el.setAttribute('role','button');el.tabIndex=0;});
    root.querySelectorAll('.form-field').forEach((field,i)=>{const label=field.querySelector('label'),input=field.querySelector('input,select,textarea');if(label&&input){if(!input.id)input.id='field-'+i;label.htmlFor=input.id;}});}
  async function refresh(){if(s.demo){render();return;}const user=s.user?.id,org=s.org?.id;const loaded=await loadLive();if(!loaded||user!==s.user?.id||org!==s.org?.id)throw stale();}
  // Ordinary task edits affect only a handful of records. Re-reading the entire
  // organization after each click was downloading all projects, history and
  // memberships, and replacing the task page with a loading screen.
  async function refreshTask(taskId,{checklist=false,updates=false,events=true,xp=false,dependencies=false}={}){
    if(s.demo){render();return;}
    const generation=epoch,orgId=s.org?.id;
    const related=[taskId,...dependents(taskId).map(d=>d.task_id)];
    const [tasks,checks,journal,history,rewards,links,readiness]=await Promise.all([
      getResult(api.from('qb_tasks').select('*').eq('id',taskId)),
      checklist?pagedRows(()=>api.from('qb_checklist').select('*').eq('task_id',taskId).order('position')):null,
      updates?pagedRows(()=>api.from('qb_task_updates').select('*').eq('task_id',taskId).order('created_at',{ascending:false})):null,
      events?getResult(api.from('qb_task_events').select('*').eq('task_id',taskId).order('created_at',{ascending:false}).limit(25)):null,
      xp?getResult(api.from('qb_xp_events').select('*').eq('task_id',taskId)):null,
      dependencies?getResult(api.from('qb_task_dependencies').select('*').eq('task_id',taskId)):null,
      loadDependencyReadiness(related)
    ]);
    if(generation!==epoch||s.org?.id!==orgId)throw stale();
    if(tasks.length!==1||!projectFor(tasks[0].project_id))throw Error('Task access or destination changed');
    const replace=(key,rows)=>{if(rows!==null){s[key]=s[key].filter(row=>row.task_id!==taskId).concat(rows);}};
    const current=s.tasks.findIndex(t=>t.id===taskId);
    if(current<0)s.tasks.unshift(tasks[0]);else s.tasks[current]=tasks[0];
    replace('checklist',checks);replace('updates',journal);replace('xp',rewards);replace('dependencies',links);
    if(history!==null){
      const merged=new Map(s.events.filter(row=>row.task_id===taskId).map(row=>[row.id,row]));
      for(const row of history)merged.set(row.id,row);
      replace('events',[...merged.values()].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||String(a.id).localeCompare(String(b.id))));
    }
    const ready=new Map(readiness.map(row=>[row.task_id,row]));
    s.dependencyReadiness=s.dependencyReadiness.filter(row=>!ready.has(row.task_id)).concat(readiness);
    render();
  }
  async function syncTask(taskId,options){
    try{await refreshTask(taskId,options);}catch(error){
      if(error.stale)throw error;
      // A missing task or changed scope is a reason to revalidate membership,
      // not to trust the old task snapshot.
      await refresh();
    }
  }
  async function activateCreatedTask(taskId,requestedStatus){
    if(!['ready','in_progress'].includes(requestedStatus))return null;
    if(s.demo){
      const task=taskFor(taskId);task.status='ready';
      if(requestedStatus==='in_progress'&&!dependencyWaiting(taskId))task.status='in_progress';
      return requestedStatus==='in_progress'&&task.status!=='in_progress'?'A prerequisite must finish before this task can start.':null;
    }
    try{
      await getResult(api.rpc('qb_transition_task',{p_task:taskId,p_new_status:'ready'}));
      if(requestedStatus==='in_progress')await getResult(api.rpc('qb_transition_task',{p_task:taskId,p_new_status:'in_progress'}));
      return null;
    }catch(e){if(e.stale)throw e;return 'Task saved, but its status could not be fully updated. Open the task to review its status.';}
  }
  async function withBusy(work){if(s.busy)return;const generation=epoch;s.busy=true;try{await work();}catch(e){if(generation===epoch&&!e.stale)toast(e.message||'Something went wrong',true);}finally{if(generation===epoch)s.busy=false;}}
  async function handleClick(a){const action=a.dataset.action,v=a.dataset.value,id=a.dataset.id;
    if(action==='project-view'){if(Object.hasOwn(projectViews,v)){s.projectView=v;render();root.querySelector(`[data-action="project-view"][data-value="${v}"]`)?.focus();}return;}
    if(action==='project-filters-reset'){Object.assign(s,{projectMilestone:'all',projectOwner:'all',projectPriority:'all',projectReadiness:'all',projectSort:'due',projectClosed:false,query:''});render();root.querySelector('[data-action="project-filters-reset"]')?.focus();return;}
    if(action==='signup-mode'){if(!authPending){signupMode=!signupMode;render();}return;}
    if(action==='retry-candidates'){await loadAssignmentCandidates(s.candidateProject,s.candidateTask);return;}
    if(action==='load-memberships'){await loadMemberships(document.getElementById('membership-scope').value);return;}
    if(action==='planner-export'){downloadPlanner();return;}
    if(action==='planner-clear'||action==='planner-cell'){
      if(!hasManagerDashboard()||s.dashboardView!=='planner')return;
      s.plannerCell=action==='planner-clear'?null:{groupId:id,window:v};
      render();
      const detail=root.querySelector('.planner-detail h3');
      if(detail){detail.tabIndex=-1;detail.focus();}
      return;
    }
    if(action==='dashboard-view'){if(['overview','personal','manager','planner'].includes(v)&&(!['manager','planner'].includes(v)||hasManagerDashboard())){s.dashboardView=v;render();root.querySelector(`[data-action="dashboard-view"][data-value="${v}"]`)?.focus();}return;}
    if(action==='nav'){inboxRequest++;clearTimeout(inboxTimer);s.nav=v;s.filter='all';s.projectId=null;s.taskId=null;s.menuOpen=false;render();if(v==='inbox')await loadInbox();return;}
    if(action==='calendar-month'){const current=calendarDate(s.calendarMonth)||new Date();const next=v==='today'?new Date():new Date(current.getFullYear(),current.getMonth()+Number(v),1,12);s.calendarMonth=dateKey(new Date(next.getFullYear(),next.getMonth(),1,12));render();const control=root.querySelector(`[data-action="calendar-month"][data-value="${v}"]`);control?.focus();return;}
    if(action==='menu'){s.menuOpen=!s.menuOpen;render();return;}
    if(action==='mode'){s.mode=v;localStorage.setItem('qb-mode',v);if(!s.demo&&s.user){api?.from('qb_profiles').update({preferred_mode:v}).eq('user_id',s.user.id).then(()=>{});}render();return;}
    if(action==='demo'){loadDemo();return;}
    if(action==='exit-demo'){location.reload();return;}
    if(action==='login'){await startSignIn(v);return;}
    if(action==='dismiss-invite'){clearInviteIntent();render();return;}
    if(action==='unlink-dependency'){await withBusy(async()=>{const taskId=s.taskId;await setDependency(taskId,id,false);await syncTask(taskId,{dependencies:true});toast('Dependency removed');});return;}
    if(action==='copy-task-link'){const task=taskFor(id);if(!task||s.demo)return;const generation=epoch;const link=location.origin+location.pathname+'?org='+encodeURIComponent(s.org.id)+'&task='+encodeURIComponent(id);try{await navigator.clipboard.writeText(link);if(generation===epoch)toast('Task link copied');}catch{if(generation===epoch)prompt('Copy task link',link);}return;}
    if(action==='logout'){await signOut();return;}
    if(action==='retry'){await loadLive();return;}
    if(action==='project'){if(s.projectId!==id)Object.assign(s,{projectMilestone:'all',projectOwner:'all',projectPriority:'all',projectReadiness:'all'});s.projectId=id;s.nav='project';s.menuOpen=false;render();return;}
    if(action==='task'){s.taskId=id;s.nav='task';s.menuOpen=false;render();return;}
    if(action==='filter'){s.filter=v;render();return;}
    if(action==='activity-refresh'){await withBusy(async()=>{await refresh();toast('Activity refreshed');});return;}
    if(action==='activity-export'){downloadActivity();return;}
    if(action==='activity-page'){activity.page+=Number(v);render();root.querySelector('.activity-feed')?.scrollIntoView?.({block:'start'});return;}
    if(action==='activity-clear'){resetActivity();s.query='';render();return;}
    if(action==='activity-all-tasks'){activity.task=null;activity.page=1;render();return;}
    if(action==='task-activity'){if(!taskFor(id))return;resetActivity();activity.task=id;activity.period='all';s.query='';s.workspace='all';s.nav='activity';render();return;}
    if(action==='tasks-refresh'){await withBusy(async()=>{await refresh();toast('Tasks refreshed');});return;}
    if(action==='tasks-export'){downloadAllTasks();return;}
    if(action==='tasks-page'){taskExplorer.page+=Number(v);render();root.querySelector('.task-explorer-summary')?.scrollIntoView?.({block:'nearest'});return;}
    if(action==='tasks-clear'){Object.assign(taskExplorer,taskViewDefaults,{page:1,selected:''});s.query='';render();return;}
    if(action==='tasks-delete-view'){const views=savedTaskViews();if(views.error)throw Error(views.error);writeTaskViews(views.rows.filter(view=>view.id!==taskExplorer.selected));taskExplorer.selected='';render();toast('Saved view removed');return;}
    if(action==='tasks-reset-storage'){if(s.demo)demoTaskViews=[];else if(taskViewsKey()){try{localStorage.removeItem(taskViewsKey());}catch{throw Error('Browser storage is unavailable');}}taskExplorer.selected='';render();return;}
    if(action==='project-history'){s.nav='project-history';await loadProjectHistory();return;}
    if(action==='project-refresh'){await withBusy(async()=>{await refresh();toast('Project refreshed');});return;}
    if(action==='staff-export-csv'){downloadStaffExport('csv');return;}
    if(action==='staff-export-html'){downloadStaffExport('html');return;}
    if(action==='staff-export-print'){printStaffExport();return;}
    if(action==='report-view'){if(['portfolio','progression','accomplishments','outlook','exceptions'].includes(v)){s.reportView=v;if(v==='accomplishments')s.reportClosed=true;if(['outlook','exceptions'].includes(v))s.reportClosed=false;render();}return;}
    if(action==='report-export'){downloadPortfolio();return;}
    if(action==='leadership-download'&&s.nav==='reports'&&['accomplishments','outlook','exceptions'].includes(s.reportView)){downloadLeadership();return;}
    if(action==='leadership-print'&&s.nav==='reports'&&['accomplishments','outlook','exceptions'].includes(s.reportView)){printLeadership();return;}
    if(action==='report-detail'){s.reportProject=id;s.reportSignal=v==='open'?'all':v;render();root.querySelector('.report-detail')?.focus();return;}
    if(action==='report-detail-close'){s.reportProject=null;render();return;}
    if(action==='inbox-filter'){
      inbox.onlyUnread=v==='unread';await loadInbox();return;
    }
    if(action==='inbox-refresh'||action==='inbox-older'||action==='inbox-newer'){
      await loadInbox(action==='inbox-older'?'older':action==='inbox-newer'?'newer':'reset');return;
    }
    if(action==='inbox-read'||action==='inbox-read-page'){
      const ids=action==='inbox-read-page'?inbox.rows.filter(n=>!n.read_at).map(n=>n.id):inbox.rows.filter(n=>n.id===id).map(n=>n.id);
      if(!ids.length)return;
      await withBusy(async()=>{await readNotifications(ids,action==='inbox-read-page'||v==='true');await loadInbox('current');});return;
    }
    if(action==='inbox-open'){
      const notification=inbox.rows.find(n=>n.id===id);if(!notification)return;
      await withBusy(async()=>{
        await readNotifications([id],true);await refresh();
        const task=taskFor(notification.task_id);
        if(!task){toast('This task is no longer available.',true);return;}
        s.taskId=task.id;s.projectId=task.project_id;s.nav='task';render();
      });return;
    }
    if(action==='milestone'){
      const milestone=s.milestones.find(m=>m.id===id&&projectFor(m.project_id));
      if(!milestone)return;
      s.milestoneId=id;s.projectId=milestone.project_id;s.nav='milestone';s.menuOpen=false;render();return;
    }
    if(action==='milestone-add-task'){
      const milestone=s.milestones.find(m=>m.id===id&&!m.archived&&canManage(m.project_id));
      if(!milestone)return;
      s.projectId=milestone.project_id;
      await handleClick({dataset:{action:'modal',value:'task',milestone:id}});return;
    }
    if(action==='use-template'){
      const template=s.templates.find(t=>t.id===id&&!t.archived&&canManage(t.project_id));
      if(!template)return;
      s.creationTemplate=id;s.projectId=template.project_id;
      await handleClick({dataset:{action:'modal',value:'task',template:id}});
      return;
    }
    if(action==='archive-template'){
      const template=s.templates.find(t=>t.id===id&&canManage(t.project_id));
      if(!template)return;
      await withBusy(async()=>{
        if(s.demo)template.archived=v==='true';
        else await getResult(api.from('qb_task_templates').update({archived:v==='true'}).eq('id',id));
        await refresh();toast(v==='true'?'Template archived':'Template restored');
      });return;
    }
    if(action==='modal'){
      if(v==='task-view'&&(!s.org||s.loading||s.nav!=='alltasks'))return;
      if(v==='project-export'&&(s.nav!=='project'||!projectFor(s.projectId)||s.loading||s.lastError))return;
      if(v==='project-settings'&&!canManage(s.projectId))return;
      if(v==='organization'&&(!s.user||s.demo||s.loading))return;
      if(v==='edit-task'&&id){
        const task=taskFor(id);
        if(!task||!canManage(task.project_id))return;
        s.taskId=id;
      }
      if(v==='milestone'){
        const milestone=id?s.milestones.find(m=>m.id===id):null;
        if(id&&!milestone||!canManage(milestone?.project_id||s.projectId))return;
        s.editMilestoneId=id||null;s.milestoneRequest=uid();
      }
      if(v==='save-template'){
        const task=taskFor(s.taskId);
        if(!task||!canManage(task.project_id)||task.visibility==='restricted')return;
      }
      if(v==='quick-task')s.taskRequest=uid();
      if(v==='task'){s.creationMilestone=a.dataset.milestone||null;s.creationTemplate=a.dataset.template||null;s.taskRequest=uid();}
      if(v==='save-template')s.taskRequest=uid();
      s.modal=v;
      if(['task','edit-task'].includes(v)){
        const task=v==='edit-task'?taskFor(s.taskId):null;
        const projectId=task?.project_id||managedProjects().find(p=>p.id===s.projectId)?.id||managedProjects()[0]?.id;
        s.candidateProject=projectId;s.candidateTask=task?.id||null;s.candidateRows=[];s.candidateError=null;s.candidatesLoading=true;
        render();if(v==='task')templateDefaults();await loadAssignmentCandidates(projectId,task?.id||null);
      }else{candidateRequest++;render();}
      return;
    }
    if(action==='close-modal'){candidateRequest++;s.modal=null;render();return;}
    if(action==='status'){await withBusy(async()=>{if(s.demo){const t=taskFor(id);if(!t||!taskActions(t).some(([st])=>st===v))throw Error('Invalid status change');if(v==='in_review'&&s.checklist.some(c=>c.task_id===id&&!c.done))throw Error('Finish the checklist first');const priorStatus=t.status;t.status=v;if(v!=='complete')t.completed_at=null;if(v==='complete'){t.completed_at=new Date().toISOString();if(!s.xp.some(x=>x.task_id===id))s.xp.push({task_id:id,user_id:t.assignee_id,amount:t.xp_reward});}s.events.unshift({id:uid(),task_id:id,actor_id:s.user.id,event_type:'status',before_data:{status:priorStatus},after_data:{status:v},created_at:new Date().toISOString()});}else await getResult(api.rpc('qb_transition_task',{p_task:id,p_new_status:v}));await syncTask(id,{xp:v==='complete'||v==='in_progress'});toast('Task updated');});return;}
    if(action==='check'){await withBusy(async()=>{const item=s.checklist.find(c=>c.id===id);if(!item)return;if(s.demo){const before={item_id:item.id,title:item.title,done:item.done};item.done=!item.done;demoTaskEvent(item.task_id,'checklist',before,{...before,done:item.done});}else await getResult(api.rpc('qb_toggle_checklist',{p_item:id,p_done:!item.done}));await syncTask(item.task_id,{checklist:true});});return;}
    if(action==='copy-invite'){const generation=epoch;const link=location.origin+location.pathname+'?invite='+encodeURIComponent(id);try{await navigator.clipboard.writeText(link);if(generation!==epoch)return;toast('Invitation link copied');}catch{if(generation!==epoch)return;prompt('Copy invitation link',link);}return;}
    if(action==='revoke-invite'){await withBusy(async()=>{if(s.demo)s.invitations.find(i=>i.id===id).status='revoked';else await getResult(api.rpc('qb_revoke_invitation',{p_invitation:id}));toast('Invitation revoked');await refresh();});return;}
    if(action==='accept-invite'){await withBusy(async()=>{const orgId=await getResult(api.rpc('qb_accept_invitation',{p_invitation:id}));if(inviteIntent===id)clearInviteIntent();toast('Welcome to your new workspace');await loadLive(orgId,true);});return;}
  }
  async function createOrganization(form){
    if(s.busy||!s.user||s.demo)return;
    const name=String(new FormData(form).get('name')||'').trim();
    const status=form.querySelector('[data-organization-status]'),button=form.querySelector('[type="submit"]');
    if(name.length<2||name.length>120){status.textContent='Enter an organization name between 2 and 120 characters.';return;}
    const generation=epoch,user=s.user.id;s.busy=true;button.disabled=true;status.textContent='Creating your organization…';
    try{
      const org=await getResult(api.rpc('qb_create_organization',{p_name:name,p_request:form.dataset.request}));
      rememberOrg(user,org);
      await loadLive(org,true);
      if(s.user?.id!==user||s.org?.id!==org)return;
      s.nav='admin';s.modal='department';render();toast('Organization created. Add your first department.');
    }catch(e){if(generation===epoch&&!e.stale){status.textContent=e.message||'Unable to create organization. Please retry.';status.setAttribute('role','alert');}}
    finally{if(generation===epoch){s.busy=false;button.disabled=false;}}
  }
  async function handleForm(form){if(formEpoch.has(form)&&formEpoch.get(form)!==epoch)return;
    if(form.dataset.form==='organization'){await createOrganization(form);return;}
const fd=new FormData(form),type=form.dataset.form,get=k=>String(fd.get(k)||'').trim();
    await withBusy(async()=>{
      let creationNotice=null;
      for(const field of form.querySelectorAll('[required]')){if(!String(fd.get(field.name)||'').trim())throw Error('Please complete all required fields');}
      if(['task','edit-task'].includes(type)&&!s.demo){
        const existing=type==='edit-task'?taskFor(s.taskId):null;
        if(s.candidatesLoading||s.candidateError||s.candidateProject!==(existing?.project_id||get('project_id'))||s.candidateTask!==(existing?.id||null))throw Error('Load eligible people before saving');
        for(const key of ['assignee_id','reviewer_id']){
          const id=type==='task'&&key==='reviewer_id'?s.user.id:get(key);
          if(id&&id!==existing?.[key]&&!s.candidateRows.some(p=>p.user_id===id))throw Error('Selected person no longer has access to this work');
        }
      }
      if(type==='membership'){
        const scope=get('scope'),user=form.dataset.user||get('user_id');
        if(!membership.loaded||membership.loading||membership.error||scope!==membership.scope||!membershipScopes().some(x=>x.value===scope))throw Error('Reload members before saving');
        const row=membership.rows.find(m=>m.user_id===user);if(!row)throw Error('Select an eligible person');
        const [scopeType,scopeId]=scope.split(':');
        await getResult(api.rpc('qb_manage_membership',{p_type:scopeType,p_scope:scopeId,p_user:user,p_action:get('action'),p_role:get('role'),p_expected_role:row.role,p_expected_status:row.status}));
        membership.loaded=false;membership.rows=[];membership.events=[];
        await refresh();
        if(membershipScopes().some(x=>x.value===scope))await loadMemberships(scope);
        toast('Membership updated');return;
      }
      if(type==='task-view'){if(s.nav!=='alltasks')return;saveTaskView(get('name'));s.modal=null;render();toast('Task view saved');return;}
      if(type==='project-settings'){
        const project=projectFor(form.dataset.project),revision=Number(form.dataset.revision);
        if(!project||!canManage(project.id))throw Error('Project settings unavailable');
        const row={title:get('title'),summary:get('summary'),status:get('status'),target_date:get('target_date')||null};
        if(!row.title||row.title.length>160||row.summary.length>5000||!projectStatuses[row.status]||row.target_date&&!calendarDate(row.target_date))throw Error('Check the project name, outcome, status, and target date');
        try{
          if(s.demo){
            if((project.revision||1)!==revision)throw Error('Project changed. Close settings, refresh the project, and review your changes before saving again.');
            const before=Object.fromEntries(Object.keys(row).map(key=>[key,project[key]??null]));
            if(Object.keys(row).some(key=>before[key]!==row[key])){project.revision=revision+1;s.projectChanges.unshift({id:uid(),project_id:project.id,actor_id:s.user.id,revision:project.revision,before_data:before,after_data:{...row},created_at:new Date().toISOString()});Object.assign(project,row);}
          }else await getResult(api.rpc('qb_save_project_settings',{p_project:project.id,p_revision:revision,p_title:row.title,p_summary:row.summary,p_status:row.status,p_target_date:row.target_date}));
        }catch(e){const error=form.querySelector('[data-project-settings-error]');if(error&&!e.stale)error.textContent=e.message;throw e;}
        s.modal=null;await refresh();toast('Project settings saved');return;
      }
      if(type==='project-brief'){
        const project=projectFor(form.dataset.project);
        if(!project||!canManage(project.id))throw Error('Project check-in unavailable');
        const row={project_id:project.id,author_id:s.user.id,delivery_owner:get('delivery_owner'),health:get('health'),accomplishments:get('accomplishments'),next_steps:get('next_steps'),risks:get('risks'),decisions:get('decisions')};
        if(!briefHealth[row.health]||row.delivery_owner.length>120||!['accomplishments','next_steps','risks','decisions'].some(key=>row[key])||row.accomplishments.length>4000||row.next_steps.length>4000||row.risks.length>2500||row.decisions.length>2500)throw Error('Choose a health status and enter at least one update');
        if(s.demo)s.briefs.unshift({...row,id:uid(),created_at:new Date().toISOString()});
        else{
          const saved=await getResult(api.from('qb_project_briefs').insert(row).select('*').single());
          if(!saved||saved.project_id!==project.id)throw Error('Check-in saved but could not be reloaded. Refresh the project.');
          s.briefs.unshift(saved);
        }
        render();toast('Project check-in saved for leadership reporting');return;
      }
      if(type==='project'){
        if(!get('title'))throw Error('Project name is required');
        const row={org_id:s.org.id,department_id:get('department_id'),title:get('title'),summary:get('summary'),target_date:get('target_date')||null,visibility:get('visibility'),lead_id:s.user.id,created_by:s.user.id};
        if(s.demo){row.id=uid();row.status='active';s.projects.unshift(row);s.projectMembers.push({project_id:row.id,user_id:s.user.id,role:'lead',status:'active'});s.projectId=row.id;}
        else{row.id=uid();await getResult(api.from('qb_projects').insert(row));s.projectId=row.id;}
        s.nav='project';toast('Project created');
      }else if(type==='quick-task'){
        const [kind,id]=get('destination').split(':');
        if(kind==='department'&&!managedDepartments().some(d=>d.id===id)||kind==='project'&&!canManage(id))throw Error('Destination unavailable');
        if(s.demo){let project=kind==='project'?projectFor(id):s.projects.find(p=>p.department_id===id&&p.is_quick_queue);if(!project){project={id:uid(),org_id:s.org.id,department_id:id,title:'No project · '+deptFor(id).name,summary:'Shared quick tasks',status:'active',visibility:'department',is_quick_queue:true};s.projects.push(project);}s.taskId=form.dataset.request;s.tasks.push({id:s.taskId,project_id:project.id,title:get('title'),description:'',due_date:get('due_date')||null,priority:'normal',status:'backlog',xp_reward:15,reviewer_id:s.user.id,created_by:s.user.id});}
        else s.taskId=await getResult(api.rpc('qb_create_quick_task',{p_request:form.dataset.request,p_project:kind==='project'?id:null,p_department:kind==='department'?id:null,p_title:get('title'),p_description:'',p_due_date:get('due_date')||null,p_assignee:null,p_xp_reward:15}));
        creationNotice=await activateCreatedTask(s.taskId,get('initial_status'));
        s.nav='task';
      }else if(type==='task'){
        const row={milestone_id:get('milestone_id')||null,project_id:get('project_id'),title:get('title'),description:get('description'),priority:get('priority'),due_date:get('due_date')||null,assignee_id:get('assignee_id')||null,reviewer_id:s.user.id,xp_reward:get('xp_reward')===''?30:Number(get('xp_reward')),created_by:s.user.id};
        if(row.milestone_id&&!s.milestones.some(m=>m.id===row.milestone_id&&m.project_id===row.project_id&&!m.archived))throw Error('Choose an active milestone in this project');
        const prerequisite=get('prerequisite_id');
        if(prerequisite&&!s.tasks.some(t=>t.id===prerequisite&&t.project_id===row.project_id))throw Error('Choose a prerequisite from this project');
        const template=form.dataset.template?s.templates.find(t=>t.id===form.dataset.template&&!t.archived&&t.project_id===row.project_id):null;
        if(form.dataset.template&&!template)throw Error('Template unavailable. Close this form and try again.');
        if(s.demo){row.id=uid();row.status='backlog';row.created_at=new Date().toISOString();s.tasks.unshift(row);if(template){row.source_template_id=template.id;s.checklist.push(...template.checklist.map((title,position)=>({id:uid(),task_id:row.id,title,position,done:false})));}if(prerequisite)await setDependency(row.id,prerequisite,true);s.taskId=row.id;}
        else if(row.milestone_id){s.taskId=await getResult(api.rpc('qb_create_milestone_task',{p_project:row.project_id,p_request:form.dataset.request,p_milestone:row.milestone_id,p_template:template?.id||null,p_title:row.title,p_description:row.description,p_priority:row.priority,p_due_date:row.due_date,p_assignee:row.assignee_id,p_xp_reward:row.xp_reward,p_prerequisite:prerequisite||null}));}
        else if(template){s.taskId=await getResult(api.rpc('qb_create_template_task',{p_template:template.id,p_request:form.dataset.request,p_title:row.title,p_description:row.description,p_priority:row.priority,p_due_date:row.due_date,p_assignee:row.assignee_id,p_xp_reward:row.xp_reward,p_prerequisite:prerequisite||null}));}
        else{s.taskId=await getResult(api.rpc('qb_create_task',{p_project:row.project_id,p_title:row.title,p_description:row.description,p_priority:row.priority,p_due_date:row.due_date,p_assignee:row.assignee_id,p_xp_reward:row.xp_reward,p_prerequisite:prerequisite||null}));}
        creationNotice=await activateCreatedTask(s.taskId,get('initial_status'));
        s.nav='task';
      }else if(type==='milestone'){
        const projectId=form.dataset.project,id=form.dataset.id,revision=form.dataset.revision?Number(form.dataset.revision):null;
        if(!canManage(projectId)||!calendarDate(get('due_date')))throw Error('Choose a target date in a project you manage');
        const row={title:get('title'),description:get('description'),due_date:get('due_date'),archived:fd.has('archived')};
        if(s.demo){
          const existing=s.milestones.find(m=>m.id===id);
          if(existing)Object.assign(existing,row,{revision:existing.revision+1});
          else s.milestones.push({...row,id,project_id:projectId,revision:1});
        }else await getResult(api.rpc('qb_save_milestone',{p_id:id,p_project:projectId,p_title:row.title,p_description:row.description,p_due_date:row.due_date,p_archived:row.archived,p_revision:revision}));
        s.milestoneId=id;s.projectId=projectId;s.nav='milestone';toast('Milestone saved');
      }else if(type==='save-template'){
        const task=taskFor(s.taskId),days=get('due_days')===''?null:Number(get('due_days'));
        if(!task||!canManage(task.project_id)||task.visibility==='restricted')throw Error('Task unavailable');
        if(days!==null&&(!Number.isInteger(days)||days<0||days>3650))throw Error('Enter a whole number of days from 0 to 3650');
        if(s.demo)s.templates.push({id:uid(),project_id:task.project_id,name:get('name'),title:task.title,description:task.description,priority:task.priority,xp_reward:task.xp_reward,due_days:days,checklist:s.checklist.filter(c=>c.task_id===task.id).map(c=>c.title),archived:false});
        else await getResult(api.rpc('qb_save_task_template',{p_task:task.id,p_name:get('name'),p_due_days:days,p_request:form.dataset.request}));
        toast('Template saved. Find it on the project page.');
      }else if(type==='edit-task'){
        const row={milestone_id:get('milestone_id')||null,title:get('title'),description:get('description'),priority:get('priority'),due_date:get('due_date')||null,assignee_id:get('assignee_id')||null,reviewer_id:get('reviewer_id')||null,updated_at:new Date().toISOString()};
        if(s.demo){const task=taskFor(s.taskId),snapshot=t=>({title:t.title,priority:t.priority,assignee:t.assignee_id,due:t.due_date});const before=snapshot(task);Object.assign(task,row);demoTaskEvent(task.id,'metadata',before,snapshot(task));}else await getResult(api.from('qb_tasks').update(row).eq('id',s.taskId));toast('Task updated');
      }else if(type==='dependency'){
        await setDependency(s.taskId,get('prerequisite_id'),true);toast('Prerequisite linked');
      }else if(type==='checklist'){
        const row={task_id:s.taskId,title:get('title'),position:s.checklist.filter(c=>c.task_id===s.taskId).length};
        if(s.demo){row.id=uid();row.done=false;s.checklist.push(row);demoTaskEvent(row.task_id,'checklist',null,{item_id:row.id,title:row.title,done:false,position:row.position});}else await getResult(api.from('qb_checklist').insert(row));toast('Objective added');
      }else if(type==='update'){
        const row={task_id:s.taskId,author_id:s.user.id,kind:get('kind'),body:get('body')};
        if(s.demo){row.id=uid();row.created_at=new Date().toISOString();s.updates.unshift(row);}else await getResult(api.from('qb_task_updates').insert(row));toast('Journal entry added');
      }else if(type==='department'){
        const row={org_id:s.org.id,name:get('name'),color:get('color')};if(s.demo){row.id=uid();s.departments.push(row);}else await getResult(api.from('qb_departments').insert(row));toast('Department created');
      }else if(type==='invite'){
        const scope=get('scope'),scope_type=scope==='organization'?'organization':scope.split(':')[0]==='dept'?'department':'project',scope_id=scope_type==='organization'?null:scope.split(':')[1];
        const row={org_id:s.org.id,invited_email:get('invited_email'),scope_type,scope_id,invite_role:get('invite_role'),created_by:s.user.id};
        if(s.demo){row.id=uid();row.status='pending';row.created_at=new Date().toISOString();s.invitations.unshift(row);}else await getResult(api.from('qb_invitations').insert(row));toast('Invitation created. Copy its link to share with the recipient.');
      }
      s.modal=null;
      if(['quick-task','task','edit-task','checklist','update','dependency'].includes(type)){
        await syncTask(s.taskId,{checklist:['task','quick-task','checklist'].includes(type),updates:type==='update',dependencies:['task','quick-task','dependency'].includes(type)});
        if(['quick-task','task'].includes(type))toast(creationNotice||'Task created',!!creationNotice);
      }else await refresh();
    });
  }
  function updateInviteRoles(scope){const roles=scope==='organization'?[['member','Member']]:scope.startsWith('dept:')?[['department_manager','Department manager'],['department_contributor','Contributor'],['department_viewer','Viewer']]:[['project_lead','Project lead'],['project_contributor','Contributor'],['project_viewer','Viewer']];const sel=document.getElementById('invite-role');if(sel)sel.innerHTML=roles.map(([k,v])=>`<option value="${k}">${v}</option>`).join('');}
  document.addEventListener('click',e=>{const a=e.target.closest('[data-action]');if(a){if(a.classList.contains('modal-cover')&&e.target!==a)return;e.preventDefault();handleClick(a).catch(x=>toast(x.message,true));}});
  document.addEventListener('submit',e=>{const f=e.target.closest('[data-form]');if(f){e.preventDefault();handleForm(f);}});
  document.addEventListener('change',e=>{
    const activityFields={'activity-project':'project','activity-person':'person','activity-kind':'kind','activity-period':'period','activity-from':'from','activity-to':'to'};
    if(activityFields[e.target?.id]){const id=e.target.id;activity[activityFields[id]]=e.target.value;activity.page=1;render();document.getElementById(id)?.focus();return;}

    if(e.target?.id==='tasks-view'){if(e.target.value)applyTaskView(e.target.value);else taskExplorer.selected='';render();document.getElementById('tasks-view')?.focus();return;}
    const taskFields={'tasks-project':'project','tasks-owner':'owner','tasks-status':'status','tasks-priority':'priority','tasks-deadline':'deadline','tasks-dependency':'dependency','tasks-sort':'sort'};
    if(taskFields[e.target?.id]){const id=e.target.id;taskExplorer[taskFields[id]]=e.target.value;taskExplorer.page=1;taskExplorer.selected='';render();document.getElementById(id)?.focus();return;}
if(['planner-signal','planner-group'].includes(e.target?.id)){
      const id=e.target.id;
      if(id==='planner-signal')s.plannerSignal=e.target.value;else s.plannerGroup=e.target.value;
      s.plannerCell=null;render();document.getElementById(id)?.focus();return;
    }
    if(['report-health','report-closed','report-period'].includes(e.target?.id)){const id=e.target.id;if(id==='report-health')s.reportHealth=e.target.value;else if(id==='report-closed')s.reportClosed=e.target.checked;else if(['7','30','90','365'].includes(e.target.value))s.reportPeriod=e.target.value;s.reportProject=null;render();document.getElementById(id)?.focus();return;}
    const projectFields={'project-milestone':'projectMilestone','project-owner':'projectOwner','project-priority':'projectPriority','project-readiness':'projectReadiness','project-sort':'projectSort','project-closed':'projectClosed'};if(projectFields[e.target?.id]){const id=e.target.id;s[projectFields[id]]=id==='project-closed'?e.target.checked:e.target.value;render();document.getElementById(id)?.focus();return;}if(['calendar-project','calendar-scope','calendar-closed'].includes(e.target?.id)){const id=e.target.id;if(id==='calendar-project')s.calendarProject=e.target.value;if(id==='calendar-scope')s.calendarScope=e.target.value;if(id==='calendar-closed')s.calendarClosed=e.target.checked;render();document.getElementById(id)?.focus();return;}if(e.target?.id==='organization-select'){if(e.target.value==='__create__'){e.target.value=s.org?.id||s.requestedOrg;handleClick({dataset:{action:'modal',value:'organization'}});}else switchOrganization(e.target.value);}if(e.target?.id==='membership-scope')loadMemberships(e.target.value);if(e.target?.id==='workspace-select'){s.workspace=e.target.value;s.plannerCell=null;taskExplorer.page=1;activity.page=1;render();if(s.nav==='inbox')loadInbox();}if(e.target?.id==='task-project-select'){const milestonePicker=document.getElementById('creation-milestone');if(milestonePicker)milestonePicker.innerHTML=milestoneOptions(e.target.value);s.creationMilestone=null;const picker=document.getElementById('creation-prerequisite');if(picker)picker.innerHTML=creationDependencyOptions(e.target.value);loadAssignmentCandidates(e.target.value);}if(e.target?.id==='invite-scope')updateInviteRoles(e.target.value);});
  document.addEventListener('input',e=>{if(e.target?.id==='search'){const v=e.target.value;s.query=v;s.plannerCell=null;if(s.nav==='alltasks'){taskExplorer.page=1;taskExplorer.selected='';}if(s.nav==='activity')activity.page=1;if(s.nav==='inbox')scheduleInboxSearch();const caret=e.target.selectionStart;render();const input=document.getElementById('search');if(input){input.focus();input.setSelectionRange(caret,caret);}}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role="button"][data-action]')){e.preventDefault();handleClick(e.target).catch(x=>toast(x.message,true));}if(e.key==='Escape'&&s.modal){candidateRequest++;s.modal=null;render();}});
  async function init(){
    readAuthReturn();
    if(window.supabase?.createClient&&cfg.supabaseUrl&&cfg.supabasePublishableKey){api=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});}
    if(!api){s.loading=false;render();return;}
    api.auth.onAuthStateChange(receiveSession);
    const revision=authRevision;
    try{const {data,error}=await api.auth.getSession();if(revision!==authRevision)return;if(error)throw error;receiveSession('INITIAL_SESSION',data.session);}
    catch(e){if(revision!==authRevision)return;invalidateWorkspace();s.user=null;s.organizations=[];s.loading=false;authError='Unable to restore your sign-in. Reload this page and try again.';render();}

  }
  init();
})();
