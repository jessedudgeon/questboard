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
    {id:'team',icon:'♧',pro:'Team',rpg:'Party'},
    {id:'reports',icon:'◷',pro:'Reports',rpg:'Chronicle'},
    {id:'meetings',icon:'▤',pro:'Meetings',rpg:'Council'},
    {id:'admin',icon:'⚙',pro:'Administration',rpg:'Administration'}
  ];
  let api = null;
  let epoch=0, requestController=null, authRevision=0, signedOutLocally=false, signingOut=false, signOutFailed=false;
  const formEpoch=new WeakMap();
  const workspaceArrays=['departments','departmentMembers','orgMembers','projects','projectMembers','tasks','checklist','updates','events','xp','invitations','profiles','pendingInvitations'];
  function invalidateWorkspace(resetNavigation=true){
    epoch++;requestController?.abort();requestController=typeof AbortController==='undefined'?null:new AbortController();
    candidateRequest++;membershipRequest++;
    Object.assign(membership,{scope:null,rows:[],events:[],loading:false,error:null,loaded:false});
    for(const key of workspaceArrays)s[key]=[];
    Object.assign(s,{org:null,requestedOrg:null,orgMembership:null,modal:null,menuOpen:false,busy:false,lastError:null,candidateRows:[],candidateProject:null,candidateTask:null,candidatesLoading:false,candidateError:null});
    if(resetNavigation)Object.assign(s,{workspace:'all',nav:'home',projectId:null,taskId:null,filter:'all',query:''});
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
  const s = { user:null,loading:true,demo:false,organizations:[],org:null,orgMembership:null,departments:[],departmentMembers:[],orgMembers:[],projects:[],projectMembers:[],tasks:[],checklist:[],updates:[],events:[],xp:[],invitations:[],pendingInvitations:[],profiles:[],workspace:'all',nav:'home',projectId:null,taskId:null,modal:null,filter:'all',query:'',mode:localStorage.getItem('qb-mode')||'professional',menuOpen:false,busy:false,candidateRows:[],candidateProject:null,candidateTask:null,candidatesLoading:false,candidateError:null };
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
    return a;
  };
  const iconForProject = (title) => /network|technology|system|security|firewall/i.test(title)?'⌘':/facility|building|campus/i.test(title)?'⌂':/admission|student/i.test(title)?'◈':'✦';
  const fmtStatus = st=>rpg()?(rpgStatusNames[st]||st):(statusNames[st]||st);
  const toast=(message,error=false)=>{const d=document.createElement('div');d.className='toast'+(error?' error':'');d.textContent=message;document.getElementById('toast').appendChild(d);setTimeout(()=>d.remove(),4200);};
  const getResult=async p=>{const generation=epoch;
    if(requestController&&typeof p?.abortSignal==='function')p=p.abortSignal(requestController.signal);
    const {data,error}=await p;if(generation!==epoch)throw stale();
    if(error)throw new Error(error.message||'Unable to save');return data;
  };
  async function scopedRows(table,column,ids,select='*',configure=q=>q){
    const rows=[];for(let i=0;i<ids.length;i+=100)rows.push(...await getResult(configure(api.from(table).select(select).in(column,ids.slice(i,i+100)))));
    return rows;
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
    s.events=[];s.xp=[{task_id:'t2',user_id:'demo-user',amount:30},{task_id:'t8',user_id:'demo-user',amount:40}];s.invitations=[];s.pendingInvitations=[];
    s.loading=false;s.nav='home';s.workspace='all';render();
  }
  async function loadLive(requestedOrg=s.org?.id||s.requestedOrg||rememberedOrg(s.user?.id),resetNavigation=false){
    if(!api||!s.user||s.demo)return;
    const user=s.user,generation=invalidateWorkspace(resetNavigation);
    s.requestedOrg=requestedOrg;s.loading=true;render();
    try{
      const profile={user_id:user.id,display_name:user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split('@')[0]||'Member',preferred_mode:s.mode};
      await getResult(api.from('qb_profiles').upsert(profile,{onConflict:'user_id'}));
      const [pendingInvitations,memberships]=await Promise.all([
        getResult(api.rpc('qb_my_invitations')),
        getResult(api.from('qb_org_members').select('*').eq('user_id',user.id).eq('status','active'))
      ]);
      const organizations=await scopedRows('qb_organizations','id',memberships.map(m=>m.org_id),'id,name',q=>q.order('name'));
      const orgMembership=memberships.find(m=>m.org_id===requestedOrg&&organizations.some(o=>o.id===m.org_id))||memberships.find(m=>organizations.some(o=>o.id===m.org_id))||null;
      const org=organizations.find(o=>o.id===orgMembership?.org_id)||null;
      if(!org){s.organizations=[];s.pendingInvitations=pendingInvitations;rememberOrg(user.id,null);s.loading=false;render();return;}
      const [departments,projects]=await Promise.all([
        getResult(api.from('qb_departments').select('*').eq('org_id',org.id).order('name')),
        getResult(api.from('qb_projects').select('*').eq('org_id',org.id).order('created_at',{ascending:false}))
      ]);
      const projectIds=projects.map(p=>p.id),departmentIds=departments.map(d=>d.id);
      const [departmentMembers,projectMembers,tasks,orgMembers,invitations]=await Promise.all([
        scopedRows('qb_department_members','department_id',departmentIds),
        scopedRows('qb_project_members','project_id',projectIds),
        scopedRows('qb_tasks','project_id',projectIds,'*',q=>q.order('created_at',{ascending:false})),
        orgMembership.role==='admin'?getResult(api.from('qb_org_members').select('*').eq('org_id',org.id)):Promise.resolve([]),
        orgMembership.role==='admin'?getResult(api.from('qb_invitations').select('*').eq('org_id',org.id).order('created_at',{ascending:false})):Promise.resolve([])
      ]);
      const taskIds=tasks.map(t=>t.id);
      const [checklist,updates,events,xp]=await Promise.all([
        scopedRows('qb_checklist','task_id',taskIds,'*',q=>q.order('position')),
        scopedRows('qb_task_updates','task_id',taskIds,'*',q=>q.order('created_at',{ascending:false}).limit(200)),
        scopedRows('qb_task_events','task_id',taskIds,'*',q=>q.order('created_at',{ascending:false}).limit(200)),
        scopedRows('qb_xp_events','task_id',taskIds)
      ]);
      const people=[...new Set([user.id,...orgMembers.map(m=>m.user_id),...departmentMembers.map(m=>m.user_id),...projectMembers.map(m=>m.user_id),...tasks.flatMap(t=>[t.assignee_id,t.reviewer_id,t.created_by]),...updates.map(u=>u.author_id),...events.map(e=>e.actor_id)].filter(Boolean))];
      const profiles=await scopedRows('qb_profiles','user_id',people,'user_id,display_name');
      // Recheck membership at commit: suspension during the load must not publish its snapshot.
      const current=await getResult(api.from('qb_org_members').select('org_id,role,status').eq('org_id',org.id).eq('user_id',user.id).eq('status','active'));
      if(!current.length||current[0].role!==orgMembership.role){s.organizations=[];rememberOrg(user.id,null);throw Error('Organization access changed. Reload your workspace.');}
      if(generation!==epoch)return;
      Object.assign(s,{organizations,orgMembership,org,pendingInvitations,departments,departmentMembers,projects,projectMembers,tasks,checklist,updates,events,xp,profiles,orgMembers,invitations});
      rememberOrg(user.id,org.id);
      if(requestedOrg&&requestedOrg!==org.id)Object.assign(s,{workspace:'all',nav:'home',projectId:null,taskId:null,filter:'all',query:''});
      if(!departments.some(d=>d.id===s.workspace))s.workspace='all';
    }catch(e){if(generation!==epoch||e.stale)return;s.lastError=e.message;}
    if(generation!==epoch)return;s.loading=false;render();return !s.lastError;
  }
  async function switchOrganization(id){
    if(s.demo||!s.user)return;
    if(!s.organizations.some(o=>o.id===id))return;
    await loadLive(id,true);
  }
  function organizationSelector(){return !s.demo&&s.organizations.length?`<select class="workspace-select" id="organization-select" aria-label="Organization">${s.organizations.map(o=>`<option value="${esc(o.id)}" ${o.id===(s.org?.id||s.requestedOrg)?'selected':''}>${esc(o.name)}</option>`).join('')}</select>`:'';}
  function receiveSession(event,session){
    authRevision++;
    if(s.demo)return;
    const user=session?.user||null;
    if(signedOutLocally&&user)return;
    if(!user){invalidateWorkspace();s.user=null;s.organizations=[];s.loading=false;render();return;}
    if(user.id===s.user?.id&&event!=='INITIAL_SESSION'){s.user=user;if(event==='TOKEN_REFRESHED'){const generation=epoch,org=s.org?.id;setTimeout(()=>{if(generation===epoch&&!s.demo)loadLive(org);},0);}return;}
    invalidateWorkspace();s.organizations=[];s.user=user;s.loading=true;render();
    const generation=epoch;
    // Do not await Supabase requests within its synchronous auth callback.
    setTimeout(()=>{if(generation===epoch&&!s.demo)loadLive(rememberedOrg(user.id),true);},0);
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
      <div class="sidebar-label">Workspace</div>${defs.slice(0,3).map(x=>navItem(x)).join('')}
      <div class="sidebar-label">Collaboration</div>${defs.slice(3,6).map(x=>navItem(x)).join('')}
      <div class="side-bottom">${membershipScopes().length?navItem(defs[6]):''}<div class="sidebar-note"><strong>${term('Keep momentum visible','Every quest matters')}</strong>${term('Own the work, document the progress, celebrate verified results.','Complete objectives, help your party, and grow your mastery.')}</div><div class="account"><span class="avatar">${esc(initials(name))}</span><div><strong>${esc(name)}</strong><small>${s.demo?'Demo administrator':isAdmin()?'Organization administrator':'Team member'}</small></div></div></div></aside>
      <main class="main">${s.demo?`<div class="demo-banner">✦ You are exploring sample data. Changes are temporary and are not saved. <button data-action="exit-demo">Exit demo</button></div>`:''}
      <header class="topbar"><div class="top-left">${organizationSelector()}<button class="mobile-menu" data-action="menu" aria-label="Open menu">☰</button><select class="workspace-select" id="workspace-select" aria-label="Current workspace"><option value="all">All workspaces</option>${s.departments.map(d=>`<option value="${esc(d.id)}" ${s.workspace===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div><div class="top-right"><label class="search"><span>⌕</span><input id="search" placeholder="Search work…" value="${esc(s.query)}" aria-label="Search projects and tasks"></label><div class="mode-switch"><button data-action="mode" data-value="professional" class="${!rpg()?'active':''}">◫ Work</button><button data-action="mode" data-value="rpg" class="${rpg()?'active':''}">✦ Quest</button></div>${!s.demo?`<button class="btn sm" data-action="logout">Sign out</button>`:''}<span class="user-dot" title="${esc(s.user?.email)}">${esc(initials(name))}</span></div></header>
      <div class="page">${s.pendingInvitations.map(i=>`<div class="invite-box"><strong>${esc(i.org_name)}: ${esc(i.invite_role.replace(/_/g,' '))}</strong> <button class="btn sm" data-action="accept-invite" data-id="${i.id}">Accept invitation</button></div>`).join('')}${pageContent()}</div></main></div>${modalHTML()}`;
  }
  function navItem(x){return `<button class="nav-link ${s.nav===x.id?'active':''}" data-action="nav" data-value="${x.id}"><span class="nav-icon">${x.icon}</span><span>${esc(rpg()?x.rpg:x.pro)}</span>${x.id==='mywork'?`<span class="pill-count">${myTasks().filter(t=>!['complete','cancelled'].includes(t.status)).length}</span>`:''}</button>`;}
  function pageContent(){switch(s.nav){case'home':return dashboard();case'mywork':return workPage();case'projects':return projectsPage();case'project':return projectPage();case'task':return taskPage();case'team':return teamPage();case'reports':return reportsPage();case'meetings':return meetingsPage();case'admin':return adminPage();default:return dashboard();}}
  const pageTitle=(title,desc,actions='')=>`<div class="page-heading"><div><div class="eyebrow">${esc(s.org?.name||'QuestBoard')}</div><h1>${esc(title)}</h1><p class="lead">${esc(desc)}</p></div><div class="buttons">${actions}</div></div>`;
  const empty=(icon,title,desc,button='')=>`<div class="empty"><span class="empty-icon">${icon}</span><h3>${esc(title)}</h3><p>${esc(desc)}</p>${button}</div>`;
  function projectCard(p){const progress=pct(p),department=deptFor(p.department_id);return `<article class="project-card" data-action="project" data-id="${p.id}"><div class="project-icon">${iconForProject(p.title)}</div><div class="overline">${esc(department?.name||'Workspace')} · ${esc(p.status)}</div><h3>${esc(rpg()?questProjectName(p):p.title)}</h3><p class="desc">${esc(p.summary||'A place for meaningful work and shared progress.')}</p><div class="project-meta"><strong>${progress}% ${term('complete','conquered')}</strong><span>${niceDate(p.target_date)}</span></div><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div><div class="project-meta"><span>${s.tasks.filter(t=>t.project_id===p.id).length} ${term('tasks','quests')}</span><div class="tiny-avatars"><span class="tiny-avatar">${esc(initials(nameFor(p.lead_id)))}</span></div></div></article>`;}
  function questProjectName(p){return p.title.replace('Critical Vulnerability Remediation','The Vulnerability Hydra').replace('Network Infrastructure Modernization','The Great Network Renewal').replace('Campus Facilities Improvements','Restoration of the Halls');}
  function taskRow(t){const p=projectFor(t.project_id);return `<div class="task-item" data-action="task" data-id="${t.id}"><div class="task-check">${t.status==='complete'?'✓':'◇'}</div><div class="task-grow"><div class="task-title">${esc(t.title)}</div><div class="task-sub">${esc(p?.title||'Project')} · ${esc(nameFor(t.assignee_id))} · ${esc(niceDate(t.due_date))}</div></div><div class="task-right">${tag(t.status,fmtStatus(t.status))}<span style="color:var(--muted)">›</span></div></div>`;}
  function dashboard(){
    const tasks=visibleTasks(),projects=visibleProjects(),open=tasks.filter(t=>!['complete','cancelled'].includes(t.status)),blocked=tasks.filter(t=>t.status==='blocked'),review=tasks.filter(t=>t.status==='in_review'),done=tasks.filter(t=>t.status==='complete');
    const urgent=[...blocked,...review,...open.filter(t=>t.priority==='critical'||t.priority==='high')].filter((x,i,a)=>a.findIndex(z=>z.id===x.id)===i).slice(0,5);
    return pageTitle(term('Good morning, '+(s.user?.user_metadata?.full_name||s.user?.email?.split('@')[0]||'there').split(' ')[0],'Welcome to the Guild Hall'),term('Here is the work that matters this week.','Your party has unfinished adventures. Every contribution counts.'),managedDepartments().length?`<button class="btn primary" data-action="modal" data-value="project">＋ ${term('New Project','New Campaign')}</button>`:'')+
    `<div class="kpi-grid"><div class="kpi"><div class="label">${term('Active projects','Active campaigns')}</div><div class="value">${projects.filter(p=>p.status==='active').length}</div><div class="bubble">◈</div><div class="hint">Across authorized workspaces</div></div>
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
  function projectPage(){const p=projectFor(s.projectId);if(!p)return projectsPage();const ts=s.tasks.filter(t=>t.project_id===p.id),progress=pct(p),manager=canManage(p.id);const statuses=[['backlog',term('Backlog','Unclaimed')],['ready',term('To do','Available')],['in_progress',term('In progress','In battle')],['blocked',term('Blocked','Obstructed')],['in_review',term('Review','Verification')]];
    return `<div class="breadcrumb"><button data-action="nav" data-value="projects">${term('Projects','Campaigns')}</button><span>›</span>${esc(p.title)}</div><div class="detail-banner">${tag(p.status,p.status.toUpperCase())}<h1>${esc(rpg()?questProjectName(p):p.title)}</h1><p>${esc(p.summary)}</p><div class="banner-actions">${manager?`<button class="btn" data-action="modal" data-value="task">＋ ${term('Add task','Add quest')}</button>`:''}<button class="btn" data-action="nav" data-value="team">♧ Team</button></div></div>
    <div class="kpi-grid"><div class="kpi"><div class="label">Progress</div><div class="value">${progress}%</div><div class="hint">Verified completions</div></div><div class="kpi"><div class="label">${term('Tasks','Quests')}</div><div class="value">${ts.length}</div><div class="hint">${ts.filter(t=>t.status==='complete').length} complete</div></div><div class="kpi amber"><div class="label">Blocked</div><div class="value">${ts.filter(t=>t.status==='blocked').length}</div><div class="hint">Require attention</div></div><div class="kpi green"><div class="label">Target date</div><div class="value" style="font-size:19px">${niceDate(p.target_date)}</div><div class="hint">${esc(deptFor(p.department_id)?.name||'Department')}</div></div></div>
    <div class="section-row"><h2>${term('Task board','Quest board')}</h2>${manager?`<button class="btn sm" data-action="modal" data-value="task">＋ Add</button>`:''}</div><div class="board">${statuses.map(([st,label])=>`<div class="board-col"><div class="board-col-head">${esc(label)} <span>${ts.filter(t=>t.status===st).length}</span></div>${ts.filter(t=>t.status===st).map(t=>`<div class="board-task" data-action="task" data-id="${t.id}"><h4>${esc(t.title)}</h4><p>${esc(nameFor(t.assignee_id))} · ${esc(niceDate(t.due_date))}</p><div class="meta">${tag(t.priority,priorityNames[t.priority])}<small>✦ ${t.xp_reward||0} XP</small></div></div>`).join('')||`<small style="display:block;text-align:center;padding:25px 0">No work here</small>`}</div>`).join('')}</div>
    ${ts.some(t=>t.status==='complete')?`<div class="panel" style="margin-top:22px"><div class="panel-head"><h3>✓ ${term('Completed work','Victories')}</h3></div><div class="panel-body">${ts.filter(t=>t.status==='complete').map(taskRow).join('')}</div></div>`:''}`;
  }
  function taskPage(){const t=taskFor(s.taskId);if(!t)return workPage();const p=projectFor(t.project_id),checks=s.checklist.filter(c=>c.task_id===t.id),updates=s.updates.filter(x=>x.task_id===t.id),events=s.events.filter(x=>x.task_id===t.id).slice(0,8),manager=canManage(t.project_id),actions=taskActions(t),xp=t.xp_reward||0;
    return `<div class="breadcrumb"><button data-action="nav" data-value="projects">${term('Projects','Campaigns')}</button><span>›</span><button data-action="project" data-id="${p?.id}">${esc(p?.title||'Project')}</button><span>›</span>${term('Task','Quest')}</div>
    <div class="page-heading"><div><div class="eyebrow">${esc(p?.title||'Project')} / ${term('Task','Quest')}</div><h1>${esc(t.title)}</h1><p class="lead">${esc(t.description||'No description yet.')}</p></div><div class="buttons">${tag(t.priority,priorityNames[t.priority])}${tag(t.status,fmtStatus(t.status))}</div></div>
    <div class="detail-grid"><div class="detail-content"><section class="panel"><div class="panel-head"><h3>${term('Objectives','Quest objectives')}</h3><small>${checks.filter(x=>x.done).length}/${checks.length} complete</small></div><div class="panel-body">${checks.length?checks.map(c=>`<label class="checkline"><input type="checkbox" data-action="check" data-id="${c.id}" ${c.done?'checked':''} ${['in_review','complete','cancelled'].includes(t.status)||!(s.demo||manager||t.assignee_id===s.user?.id)?'disabled':''}><span style="${c.done?'text-decoration:line-through;color:var(--muted)':''}">${esc(c.title)}</span></label>`).join(''):empty('☑','No checklist items','Add objectives to define what completion means.')}${manager&&!['in_review','complete','cancelled'].includes(t.status)?`<form data-form="checklist" class="journal-form" style="display:flex"><input type="text" name="title" required maxlength="180" placeholder="Add a checklist item…" style="flex:1;min-width:0;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:8px;padding:10px"><button class="btn sm" type="submit">Add</button></form>`:''}</div></section>
    <section class="panel"><div class="panel-head"><div><h3>${term('Work journal','Adventure journal')}</h3><p>A living record of what was done, learned, or blocked</p></div></div><div class="panel-body">${updates.length?updates.map(u=>`<div class="journal-item"><span class="avatar">${esc(initials(nameFor(u.author_id)))}</span><div><strong>${esc(nameFor(u.author_id))} ${tag(u.kind,u.kind.replace('_',' '))}</strong><p>${esc(u.body)}</p><small>${niceDate(u.created_at)} · ${relative(u.created_at)}</small></div></div>`).join(''):empty('✎','No journal entries','Document work as it happens, so your next meeting has real context.')}
    <form data-form="update" class="journal-form"><textarea name="body" required maxlength="8000" placeholder="What did you do? What happened? What's next?"></textarea><div class="submit-row"><select name="kind"><option value="note">General note</option><option value="action">Action taken</option><option value="blocker">Blocker</option><option value="resolution">Resolution</option><option value="next_step">Next step</option></select><button class="btn primary" type="submit">Post update</button></div></form></div></section>
    ${events.length?`<section class="panel"><div class="panel-head"><h3>Activity history</h3></div><div class="panel-body">${events.map(e=>`<div class="journal-item"><span class="task-check">↻</span><div><strong>${esc(e.event_type)}</strong><p>${esc(JSON.stringify(e.after_data||{}))}</p><small>${niceDate(e.created_at)}</small></div></div>`).join('')}</div></section>`:''}</div>
    <aside><section class="panel"><div class="panel-head"><h3>${term('Task details','Quest details')}</h3></div><div class="panel-body"><div class="info-list"><div class="info-pair"><span class="key">Status</span>${tag(t.status,fmtStatus(t.status))}</div><div class="info-pair"><span class="key">Assigned to</span><span class="val">${esc(nameFor(t.assignee_id))}</span></div><div class="info-pair"><span class="key">Reviewer</span><span class="val">${esc(nameFor(t.reviewer_id))}</span></div><div class="info-pair"><span class="key">Due date</span><span class="val">${niceDate(t.due_date)}</span></div><div class="info-pair"><span class="key">Priority</span>${tag(t.priority,priorityNames[t.priority])}</div><div class="info-pair"><span class="key">Experience</span><span class="val">✦ ${xp} XP</span></div></div>
    <div style="border-top:1px solid var(--border);margin-top:20px;padding-top:18px;display:grid;gap:8px">${actions.length?actions.map(([st,label],i)=>`<button class="btn ${i===0?'primary':''} block" data-action="status" data-value="${st}" data-id="${t.id}">${esc(label)}</button>`).join(''):`<small style="text-align:center">No available transitions</small>`}${manager?`<button class="btn block" data-action="modal" data-value="edit-task">✎ Edit details</button>`:''}</div></div></section>
    <div class="panel" style="margin-top:20px"><div class="panel-head"><h3>What counts as done?</h3></div><div class="panel-body"><p class="muted" style="font-size:12px">Complete the objectives, log verification, then submit for review. Experience is granted only when work is approved.</p></div></div></aside></div>`;
  }
  function teamPage(){const members=s.orgMembers.filter(m=>m.status==='active');return pageTitle(term('Team workspace','Party management'),'See workload, ownership, and collaboration across your authorized workspaces.',isAdmin()?`<button class="btn primary" data-action="modal" data-value="invite">＋ Invite member</button>`:'')+`<div class="panel"><div class="panel-head"><h3>Department members</h3><small>${s.departmentMembers.length} scoped memberships</small></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Member</th><th>Department</th><th>Role</th><th>Assigned work</th></tr></thead><tbody>${s.departmentMembers.map(m=>`<tr><td class="strong">${esc(nameFor(m.user_id))}</td><td>${esc(deptFor(m.department_id)?.name||'Department')}</td><td>${tag(m.role,m.role)}</td><td>${s.tasks.filter(t=>t.assignee_id===m.user_id&&t.status!=='complete').length} open</td></tr>`).join('')||`<tr><td colspan="4">${empty('♧','No team members','Members will appear once invited.')}</td></tr>`}</tbody></table></div></div>`;}
  function reportsPage(){const total=s.xp.filter(x=>s.demo||x.user_id===s.user?.id).reduce((n,x)=>n+(x.amount||0),0),level=Math.min(20,1+Math.floor(Math.sqrt(total/65))),next=65*level*level,ts=visibleTasks(),done=ts.filter(t=>t.status==='complete').length;
    return pageTitle(term('Reports & Recognition','The Chronicle'),term('Measure real completion alongside meaningful recognition.','Celebrate impact, not busywork. Progress is earned through verified quests.'))+`<div class="kpi-grid"><div class="kpi green"><div class="label">Verified tasks</div><div class="value">${done}</div><div class="hint">Of ${ts.length} authorized tasks</div></div><div class="kpi"><div class="label">Experience earned</div><div class="value">${total}</div><div class="hint">From approved work</div></div><div class="kpi purple"><div class="label">${term('Progression level','Guild level')}</div><div class="value">${level}</div><div class="hint">20-level journey</div></div><div class="kpi amber"><div class="label">Next level</div><div class="value">${level===20?'MAX':Math.max(0,next-total)}</div><div class="hint">XP remaining</div></div></div>
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
      const [rows,events]=await Promise.all([getResult(api.rpc('qb_membership_directory',{p_type:type,p_scope:id})),getResult(api.from('qb_membership_events').select('user_id,actor_id,before_data,after_data,created_at').eq('scope_type',type).eq('scope_id',id).order('created_at',{ascending:false}).limit(50))]);
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
  function onboarding(){return `<div class="login-page"><div class="login-left"><div class="login-brand"><span class="logo">✦</span> QuestBoard</div><div class="login-content"><div class="eyebrow">Identity verified</div><h1>Your next chapter <em>starts here.</em></h1><p>Your account is signed in. An organization administrator must invite you before departmental work becomes available.</p></div><div class="login-foot">Private university workspace</div></div><div class="login-right"><div class="auth-card"><div class="mini">✉</div><h2>You're almost in</h2><p>Signed in as ${esc(s.user.email)}. Invitations to this verified address appear below.</p>${s.pendingInvitations.length?s.pendingInvitations.map(i=>`<div class="invite-box"><strong>${esc(i.org_name)}</strong><p>${esc(i.invite_role.replace(/_/g,' '))} · expires ${niceDate(i.expires_at)}</p><button class="btn primary block" style="margin-top:15px" data-action="accept-invite" data-id="${i.id}">Accept invitation</button></div>`).join(''):`<div class="invite-box"><strong>No pending invitations</strong><p>Ask your organization administrator to invite ${esc(s.user.email)}.</p></div>`}<button class="btn block" style="margin-top:20px" data-action="logout">Sign out</button></div></div></div>`;}
  function login(){return `<div class="login-page"><div class="login-left"><div class="login-brand"><span class="logo">✦</span> QuestBoard</div><div class="login-content"><div class="eyebrow">Meaningful work, real progress</div><h1>Your work is an <em>adventure.</em></h1><p>Plan projects. Rally your team. Make every accomplishment count. One workspace, two ways to experience progress.</p><div class="login-points"><span>✓ Department workspaces</span><span>✓ Verified progress</span><span>✓ Optional RPG mode</span></div></div><div class="login-foot">QuestBoard · ${esc(cfg.buildLabel||'Pilot')}</div></div><div class="login-right"><div class="auth-card"><div class="mini">✦</div><h2>Welcome to QuestBoard</h2><p>Sign in with your approved university or Google account. Organization membership is invitation-only.</p><button class="auth-provider" data-action="login" data-value="azure"><span class="provider-icon ms">▦</span>Continue with Microsoft</button><button class="auth-provider" data-action="login" data-value="google"><span class="provider-icon google">G</span>Continue with Google</button><div class="auth-divider">OR EXPLORE FIRST</div><button class="btn demo-btn" data-action="demo">✦ Explore sample workspace</button>${signOutFailed?'<button class="btn" data-action="logout">Retry sign out</button>':''}<div class="auth-fine">Microsoft and Google OAuth require authorized provider configuration and redirect allowlists. Demo data is fictional and not saved.</div></div></div></div>`;}
  function modalHTML(){if(!s.modal)return '';let content='',title='';
    if(s.modal==='project'){title=term('Create a project','Begin a campaign');content=`<form data-form="project"><div class="modal-body"><div class="form-field"><label>Project name</label><input name="title" required maxlength="140" placeholder="e.g. Network Infrastructure Modernization"></div><div class="form-field"><label>Goal / description</label><textarea name="summary" maxlength="1200" placeholder="What outcome are we trying to achieve?"></textarea></div><div class="form-grid"><div class="form-field"><label>Department</label><select name="department_id" required>${managedDepartments().map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div><div class="form-field"><label>Target date</label><input type="date" name="target_date"></div></div><div class="form-field"><label>Visibility</label><select name="visibility"><option value="department">Department private</option><option value="invited">Invited project members</option><option value="restricted">Restricted project</option></select><small class="field-hint">Cross-department access requires explicit project membership.</small></div></div>${modalFooter('Create project')}</form>`;}
    if(s.modal==='task'){const selectedProject=s.candidateProject||s.projectId||managedProjects()[0]?.id;title=term('Add a task','Post a quest');content=`<form data-form="task"><div class="modal-body"><div class="form-field"><label>Task title</label><input name="title" required maxlength="160" placeholder="What needs to get done?"></div><div class="form-field"><label>Expected outcome</label><textarea name="description" maxlength="2500" placeholder="What does success look like?"></textarea></div><div class="form-field"><label>Project</label><select name="project_id" id="task-project-select" required>${managedProjects().map(p=>`<option value="${p.id}" ${p.id===selectedProject?'selected':''}>${esc(p.title)}</option>`).join('')}</select></div><div class="form-grid"><div class="form-field"><label>Priority</label><select name="priority"><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option><option value="critical">Critical</option></select></div><div class="form-field"><label>Due date</label><input type="date" name="due_date"></div><div class="form-field"><label>Assign to</label><select name="assignee_id"><option value="">Unassigned</option>${memberOptions(selectedProject)}</select></div><div class="form-field"><label>XP on approval</label><select name="xp_reward"><option value="15">15 · Small</option><option value="30" selected>30 · Standard</option><option value="60">60 · Complex</option><option value="100">100 · Major</option></select></div></div></div>${candidateNotice()}${modalFooter('Create task')}</form>`;}
    if(s.modal==='edit-task'){const t=taskFor(s.taskId);title='Edit task';content=`<form data-form="edit-task"><div class="modal-body"><div class="form-field"><label>Title</label><input name="title" required maxlength="160" value="${esc(t.title)}"></div><div class="form-field"><label>Description</label><textarea name="description">${esc(t.description)}</textarea></div><div class="form-grid"><div class="form-field"><label>Priority</label><select name="priority">${Object.entries(priorityNames).map(([k,v])=>`<option value="${k}" ${t.priority===k?'selected':''}>${v}</option>`).join('')}</select></div><div class="form-field"><label>Due date</label><input type="date" name="due_date" value="${esc(t.due_date||'')}"></div><div class="form-field"><label>Assignee</label><select name="assignee_id"><option value="">Unassigned</option>${memberOptions(t.project_id,t.assignee_id,t.id)}</select></div><div class="form-field"><label>Reviewer</label><select name="reviewer_id"><option value="">Project lead</option>${memberOptions(t.project_id,t.reviewer_id,t.id)}</select></div></div></div>${candidateNotice()}${modalFooter('Save changes')}</form>`;}
    if(s.modal==='department'){title='Create department';content=`<form data-form="department"><div class="modal-body"><div class="form-field"><label>Department name</label><input name="name" required maxlength="120" placeholder="e.g. Facilities"></div><div class="form-field"><label>Color</label><input name="color" type="color" value="#658be7" style="height:45px"></div></div>${modalFooter('Create department')}</form>`;}
    if(s.modal==='invite'){title='Invite a team member';content=`<form data-form="invite"><div class="modal-body"><div class="form-field"><label>Email address</label><input name="invited_email" type="email" required placeholder="person@university.edu"></div><div class="form-field"><label>Access scope</label><select name="scope" id="invite-scope"><option value="organization">Organization member</option>${s.departments.map(d=>`<option value="dept:${d.id}">Department · ${esc(d.name)}</option>`).join('')}${s.projects.map(p=>`<option value="project:${p.id}">Project · ${esc(p.title)}</option>`).join('')}</select></div><div class="form-field"><label>Role</label><select name="invite_role" id="invite-role"><option value="member">Organization member</option></select></div><div class="invite-box"><p>After creating the invitation, copy its secure link to share with the recipient. Automatic invitation emails are not enabled in this pilot.</p></div></div>${modalFooter('Create invitation')}</form>`;}
    return `<div class="modal-cover" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></div>${content}</div></div>`;
  }
  const modalFooter=text=>`<div class="modal-footer"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn primary" ${['task','edit-task'].includes(s.modal)&&(s.candidatesLoading||s.candidateError)?'disabled':''}>${esc(text)}</button></div>`;
  function demoCandidates(projectId){
    const project=projectFor(projectId);if(!project)return [];
    const ids=new Set(s.projectMembers.filter(m=>m.project_id===projectId&&m.status==='active').map(m=>m.user_id));
    if(project.visibility==='department')s.departmentMembers.filter(m=>m.department_id===project.department_id&&m.status==='active').forEach(m=>ids.add(m.user_id));
    return [...ids].map(user_id=>({user_id,display_name:nameFor(user_id)}));
  }
  function memberOptions(projectId,selected='',taskId=null){
    const rows=s.demo?demoCandidates(projectId):s.candidateProject===projectId&&s.candidateTask===taskId?s.candidateRows:[];
    const options=rows.map(p=>`<option value="${esc(p.user_id)}" ${selected===p.user_id?'selected':''}>${esc(p.display_name)}</option>`);
    // Preserve historical references on unrelated edits; never offer them for new assignments.
    if(taskId&&selected&&!rows.some(p=>p.user_id===selected))options.push(`<option value="${esc(selected)}" selected>Unavailable — keep existing assignment</option>`);
    return options.join('');
  }
  const candidateMessage=()=>s.candidatesLoading?'Loading eligible people…':s.candidateError?'Unable to load eligible people. Close and reopen this dialog to retry.':'Only people with access to this work are listed.';
  const candidateNotice=()=>`<p id="candidate-status" class="field-hint" role="status">${esc(candidateMessage())}</p>`;
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
  }
  async function loadAssignmentCandidates(projectId,taskId=null){
    const request=++candidateRequest;
    s.candidateProject=projectId;s.candidateTask=taskId;s.candidateRows=[];s.candidatesLoading=true;s.candidateError=null;
    updateAssignmentControls();
    try{
      if(!projectId)throw Error('Choose a project');
      const rows=s.demo?demoCandidates(projectId):await getResult(api.rpc('qb_assignment_candidates',{p_project:projectId,p_task:taskId}));
      if(request!==candidateRequest)return;
      s.candidateRows=rows;
    }catch(e){if(request!==candidateRequest)return;s.candidateError=e.message;}
    if(request!==candidateRequest)return;
    s.candidatesLoading=false;updateAssignmentControls();
  }
  function render(){document.body.classList.toggle('mode-rpg',rpg());root.innerHTML=s.loading?`<div class="boot"><div class="brand-symbol">✦</div><p>Loading QuestBoard…</p>${organizationSelector()}${s.user?'<button class="btn" data-action="logout">Sign out</button>':''}</div>`:!s.user?login():s.lastError?`<div class="empty" role="alert"><h2>Unable to load your workspace</h2>${organizationSelector()}<p>${esc(s.lastError)}</p><button class="btn primary" data-action="retry">Try again</button><button class="btn" data-action="logout">Sign out</button></div>`:!s.org?onboarding():header();
    root.querySelectorAll('form[data-form]').forEach(form=>formEpoch.set(form,epoch));
    root.querySelectorAll('.project-card,.task-item,.board-task,[data-action="project"]:not(button)').forEach(el=>{el.setAttribute('role','button');el.tabIndex=0;});
    root.querySelectorAll('.form-field').forEach((field,i)=>{const label=field.querySelector('label'),input=field.querySelector('input,select,textarea');if(label&&input){if(!input.id)input.id='field-'+i;label.htmlFor=input.id;}});}
  async function refresh(){if(s.demo){render();return;}const user=s.user?.id,org=s.org?.id;const loaded=await loadLive();if(!loaded||user!==s.user?.id||org!==s.org?.id)throw stale();}
  async function withBusy(work){if(s.busy)return;const generation=epoch;s.busy=true;try{await work();}catch(e){if(generation===epoch&&!e.stale)toast(e.message||'Something went wrong',true);}finally{if(generation===epoch)s.busy=false;}}
  async function handleClick(a){const action=a.dataset.action,v=a.dataset.value,id=a.dataset.id;
    if(action==='load-memberships'){await loadMemberships(document.getElementById('membership-scope').value);return;}
    if(action==='nav'){s.nav=v;s.filter='all';s.projectId=null;s.taskId=null;s.menuOpen=false;render();return;}
    if(action==='menu'){s.menuOpen=!s.menuOpen;render();return;}
    if(action==='mode'){s.mode=v;localStorage.setItem('qb-mode',v);if(!s.demo&&s.user){api?.from('qb_profiles').update({preferred_mode:v}).eq('user_id',s.user.id).then(()=>{});}render();return;}
    if(action==='demo'){loadDemo();return;}
    if(action==='exit-demo'){location.reload();return;}
    if(action==='login'){if(signingOut||signOutFailed){toast('Complete sign out before signing in.',true);return;}signedOutLocally=false;if(!api){toast('Authentication client unavailable. Try again later.',true);return;}await withBusy(async()=>{const redirectTo=location.origin+location.pathname;const {error}=await api.auth.signInWithOAuth({provider:v,options:{redirectTo,scopes:v==='azure'?'email':undefined}});if(error)throw error;});return;}
    if(action==='logout'){await signOut();return;}
    if(action==='retry'){await loadLive();return;}
    if(action==='project'){s.projectId=id;s.nav='project';s.menuOpen=false;render();return;}
    if(action==='task'){s.taskId=id;s.nav='task';s.menuOpen=false;render();return;}
    if(action==='filter'){s.filter=v;render();return;}
    if(action==='modal'){
      s.modal=v;
      if(['task','edit-task'].includes(v)){
        const task=v==='edit-task'?taskFor(s.taskId):null;
        const projectId=task?.project_id||managedProjects().find(p=>p.id===s.projectId)?.id||managedProjects()[0]?.id;
        s.candidateProject=projectId;s.candidateTask=task?.id||null;s.candidateRows=[];s.candidateError=null;s.candidatesLoading=true;
        render();await loadAssignmentCandidates(projectId,task?.id||null);
      }else{candidateRequest++;render();}
      return;
    }
    if(action==='close-modal'){candidateRequest++;s.modal=null;render();return;}
    if(action==='status'){await withBusy(async()=>{if(s.demo){const t=taskFor(id);if(!taskActions(t).some(([st])=>st===v))throw Error('Invalid status change');if(v==='in_review'&&s.checklist.some(c=>c.task_id===id&&!c.done))throw Error('Finish the checklist first');t.status=v;if(v!=='complete')t.completed_at=null;if(v==='complete'){t.completed_at=new Date().toISOString();if(!s.xp.some(x=>x.task_id===id))s.xp.push({task_id:id,user_id:t.assignee_id,amount:t.xp_reward});}s.events.unshift({task_id:id,event_type:'status',after_data:{status:v},created_at:new Date().toISOString()});}else await getResult(api.rpc('qb_transition_task',{p_task:id,p_new_status:v}));toast('Task updated');await refresh();});return;}
    if(action==='check'){await withBusy(async()=>{const item=s.checklist.find(c=>c.id===id);if(s.demo)item.done=!item.done;else await getResult(api.rpc('qb_toggle_checklist',{p_item:id,p_done:!item.done}));await refresh();});return;}
    if(action==='copy-invite'){const generation=epoch;const link=location.origin+location.pathname+'?invite='+encodeURIComponent(id);try{await navigator.clipboard.writeText(link);if(generation!==epoch)return;toast('Invitation link copied');}catch{if(generation!==epoch)return;prompt('Copy invitation link',link);}return;}
    if(action==='revoke-invite'){await withBusy(async()=>{if(s.demo)s.invitations.find(i=>i.id===id).status='revoked';else await getResult(api.rpc('qb_revoke_invitation',{p_invitation:id}));toast('Invitation revoked');await refresh();});return;}
    if(action==='accept-invite'){await withBusy(async()=>{const orgId=await getResult(api.rpc('qb_accept_invitation',{p_invitation:id}));toast('Welcome to your new workspace');await loadLive(orgId,true);});return;}
  }
  async function handleForm(form){if(formEpoch.has(form)&&formEpoch.get(form)!==epoch)return;const fd=new FormData(form),type=form.dataset.form,get=k=>String(fd.get(k)||'').trim();
    await withBusy(async()=>{
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
      if(type==='project'){
        if(!get('title'))throw Error('Project name is required');
        const row={org_id:s.org.id,department_id:get('department_id'),title:get('title'),summary:get('summary'),target_date:get('target_date')||null,visibility:get('visibility'),lead_id:s.user.id,created_by:s.user.id};
        if(s.demo){row.id=uid();row.status='active';s.projects.unshift(row);s.projectMembers.push({project_id:row.id,user_id:s.user.id,role:'lead',status:'active'});s.projectId=row.id;}
        else{row.id=uid();await getResult(api.from('qb_projects').insert(row));s.projectId=row.id;}
        s.nav='project';toast('Project created');
      }else if(type==='task'){
        const row={project_id:get('project_id'),title:get('title'),description:get('description'),priority:get('priority'),due_date:get('due_date')||null,assignee_id:get('assignee_id')||null,reviewer_id:s.user.id,xp_reward:get('xp_reward')===''?30:Number(get('xp_reward')),created_by:s.user.id};
        if(s.demo){row.id=uid();row.status='backlog';row.created_at=new Date().toISOString();s.tasks.unshift(row);s.taskId=row.id;}
        else{row.id=uid();await getResult(api.from('qb_tasks').insert(row));s.taskId=row.id;}
        s.nav='task';toast('Task created');
      }else if(type==='edit-task'){
        const row={title:get('title'),description:get('description'),priority:get('priority'),due_date:get('due_date')||null,assignee_id:get('assignee_id')||null,reviewer_id:get('reviewer_id')||null,updated_at:new Date().toISOString()};
        if(s.demo)Object.assign(taskFor(s.taskId),row);else await getResult(api.from('qb_tasks').update(row).eq('id',s.taskId));toast('Task updated');
      }else if(type==='checklist'){
        const row={task_id:s.taskId,title:get('title'),position:s.checklist.filter(c=>c.task_id===s.taskId).length};
        if(s.demo){row.id=uid();row.done=false;s.checklist.push(row);}else await getResult(api.from('qb_checklist').insert(row));toast('Objective added');
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
      s.modal=null;await refresh();
    });
  }
  function updateInviteRoles(scope){const roles=scope==='organization'?[['member','Member']]:scope.startsWith('dept:')?[['department_manager','Department manager'],['department_contributor','Contributor'],['department_viewer','Viewer']]:[['project_lead','Project lead'],['project_contributor','Contributor'],['project_viewer','Viewer']];const sel=document.getElementById('invite-role');if(sel)sel.innerHTML=roles.map(([k,v])=>`<option value="${k}">${v}</option>`).join('');}
  document.addEventListener('click',e=>{const a=e.target.closest('[data-action]');if(a){if(a.classList.contains('modal-cover')&&e.target!==a)return;e.preventDefault();handleClick(a).catch(x=>toast(x.message,true));}});
  document.addEventListener('submit',e=>{const f=e.target.closest('[data-form]');if(f){e.preventDefault();handleForm(f);}});
  document.addEventListener('change',e=>{if(e.target?.id==='organization-select')switchOrganization(e.target.value);if(e.target?.id==='membership-scope')loadMemberships(e.target.value);if(e.target?.id==='workspace-select'){s.workspace=e.target.value;render();}if(e.target?.id==='task-project-select')loadAssignmentCandidates(e.target.value);if(e.target?.id==='invite-scope')updateInviteRoles(e.target.value);});
  document.addEventListener('input',e=>{if(e.target?.id==='search'){const v=e.target.value;s.query=v;const caret=e.target.selectionStart;render();const input=document.getElementById('search');if(input){input.focus();input.setSelectionRange(caret,caret);}}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role="button"][data-action]')){e.preventDefault();handleClick(e.target).catch(x=>toast(x.message,true));}if(e.key==='Escape'&&s.modal){candidateRequest++;s.modal=null;render();}});
  async function init(){
    if(window.supabase?.createClient&&cfg.supabaseUrl&&cfg.supabasePublishableKey){api=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});}
    if(!api){s.loading=false;render();return;}
    api.auth.onAuthStateChange(receiveSession);
    const revision=authRevision;
    try{const {data,error}=await api.auth.getSession();if(revision!==authRevision)return;if(error)throw error;receiveSession('INITIAL_SESSION',data.session);}
    catch(e){if(revision!==authRevision)return;invalidateWorkspace();s.user=null;s.organizations=[];s.loading=false;render();toast('Unable to load authentication: '+e.message,true);}

  }
  init();
})();
