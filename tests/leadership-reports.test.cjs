const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
function app(){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
  dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadDemo,projectBriefPanel,leadershipReport,leadershipReportPage,standaloneLeadershipHTML,handleForm,invalidateWorkspace};'));
  dom.window.qa.loadDemo();return{dom,q:dom.window.qa};
}
test('Accomplishment report uses dated check-ins, period and authorized project scope',()=>{
  const {dom,q}=app();try{
    q.s.reportView='accomplishments';q.s.reportPeriod='30';
    const now=new Date().toISOString(),old=new Date(Date.now()-40*86400000).toISOString();
    q.s.briefs=[
      {id:'recent',project_id:'p1',author_id:'demo-user',health:'on_track',accomplishments:'Delivered campus network readiness',next_steps:'',risks:'',decisions:'',created_at:now},
      {id:'old',project_id:'p1',author_id:'demo-user',health:'on_track',accomplishments:'Legacy result',next_steps:'',risks:'',decisions:'',created_at:old},
      {id:'foreign',project_id:'invisible',author_id:'demo-user',health:'on_track',accomplishments:'Secret information',next_steps:'',risks:'',decisions:'',created_at:now}
    ];
    assert.equal(q.leadershipReport().length,1);
    const html=q.standaloneLeadershipHTML();assert.match(html,/Delivered campus network readiness/);assert(!html.includes('Legacy result'));assert(!html.includes('Secret information'));
    q.s.reportPeriod='90';assert(q.standaloneLeadershipHTML().includes('Legacy result'));
    q.s.workspace='fac';assert.equal(q.leadershipReport().length,0);
  }finally{dom.window.close();}
});
test('Outlook reports show latest risk, decisions and milestone; escape untrusted HTML',()=>{
  const {dom,q}=app();try{
    q.s.reportView='outlook';q.s.briefs=[{id:'risk',project_id:'p1',author_id:'demo-user',delivery_owner:'Technician A',health:'blocked',accomplishments:'',next_steps:'Reschedule maintenance',risks:'<img src=x onerror=alert(1)>',decisions:'Approve replacement',created_at:new Date().toISOString()}];
    q.s.milestones=[{id:'m',project_id:'p1',title:'Network readiness',due_date:'2027-01-01',archived:false}];
    dom.window.document.getElementById('app').innerHTML=q.leadershipReportPage();
    assert.equal(dom.window.document.querySelector('.leadership-report img'),null);
    assert.match(dom.window.document.querySelector('.leadership-report').textContent,/Approve replacement/);
    assert.match(dom.window.document.querySelector('.leadership-report').textContent,/Network readiness/);
    assert.match(dom.window.document.querySelector('.leadership-report').textContent,/Technician A/);
    assert.match(q.standaloneLeadershipHTML(),/&lt;img src=x/);
    assert.equal(q.leadershipReport()[0].latest.health,'blocked');
  }finally{dom.window.close();}
});
test('Project check-ins save one immutable demo update and reset on organization invalidation',async()=>{
  const {dom,q}=app();try{
    q.s.projectId='p1';q.s.nav='project';
    dom.window.document.getElementById('app').innerHTML=q.projectBriefPanel('p1');
    const form=dom.window.document.querySelector('form[data-form="project-brief"]');
    assert(form);form.elements.delivery_owner.value='Eve';form.elements.health.value='on_track';form.elements.accomplishments.value='Confirmed project scope';form.elements.next_steps.value='Schedule pilot';
    const prior=q.s.briefs.length;await q.handleForm(form);
    assert.equal(q.s.briefs.length,prior+1);assert.equal(q.s.briefs[0].accomplishments,'Confirmed project scope');assert.equal(q.s.briefs[0].delivery_owner,'Eve');
    q.invalidateWorkspace();assert.equal(q.s.briefs.length,0);
  }finally{dom.window.close();}
});

test('Weekly exceptions prioritize decisions and exclude closed, clear and out-of-scope projects',()=>{
  const {dom,q}=app();try{
    q.s.reportView='exceptions';q.s.reportHealth='clear';q.s.reportClosed=true;q.s.tasks=[];q.s.milestones=[];
    q.s.projects=q.s.projects.filter(p=>p.department_id==='it');
    const base=q.s.projects[0];
    q.s.projects=['decision','blocked','stale','clear','closed'].map(id=>({...base,id,title:id,status:id==='closed'?'complete':'active',target_date:null}));
    const now=new Date().toISOString();
    q.s.briefs=['decision','blocked','clear','closed'].map(id=>({id,project_id:id,created_at:now,health:id==='blocked'?'blocked':'on_track',decisions:id==='decision'?'Approve <script>unsafe</script>':'',next_steps:'Confirm plan',risks:'',accomplishments:''}));
    q.s.briefs.push({id:'foreign',project_id:'invisible',created_at:now,decisions:'Hidden content'});
    const html=q.standaloneLeadershipHTML(),doc=new JSDOM(html).window.document;
    const headings=Array.from(doc.querySelectorAll('article h3'),e=>e.textContent);
    assert.deepEqual(headings,['decision','blocked','stale']);
    assert.equal(doc.querySelector('script'),null);assert.match(html,/&lt;script&gt;/);assert(!html.includes('Hidden content'));
    assert.match(html,/No check-in recorded/);assert.match(html,/Teams Planner is not synchronized/);
    q.s.query='blocked';assert.match(q.standaloneLeadershipHTML(),/Reported blocked/);assert(!q.standaloneLeadershipHTML().includes('Approve'));
    q.s.workspace='fac';assert.match(q.standaloneLeadershipHTML(),/No exceptions found/);
  }finally{dom.window.close();}
});
test('Weekly exception schedule signals omit finished work and distinguish unverified milestones',()=>{
  const {dom,q}=app();try{
    q.s.reportView='exceptions';q.s.projects=q.s.projects.filter(p=>p.id==='p1');q.s.projects[0].target_date='2000-01-01';
    q.s.tasks=[{id:'late',project_id:'p1',status:'ready',due_date:'2000-01-01'},{id:'done',project_id:'p1',status:'complete',due_date:'2000-01-01',milestone_id:'finished'},{id:'cancelled',project_id:'p1',status:'cancelled',due_date:'2000-01-01'}];
    q.s.milestones=[{id:'unverified',project_id:'p1',title:'Unverified',due_date:'2000-01-01'},{id:'finished',project_id:'p1',title:'Finished',due_date:'2000-01-01'}];
    q.s.briefs=[{id:'old',project_id:'p1',health:'on_track',created_at:'2000-01-01',next_steps:'Original plan'}];
    const html=q.standaloneLeadershipHTML();
    assert.match(html,/1 overdue tasks/);assert.match(html,/1 past-due milestones requiring verification/);
    assert.match(html,/Project target has passed/);assert.match(html,/Check-in over 14 days old/);assert.match(html,/Notes reflect that check-in/);
  }finally{dom.window.close();}
});
