const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
function setup(){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
 dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadDemo,dashboardData,plannerReport,plannerCSV,dashboard,handleClick,render,invalidateWorkspace};'));
 const q=dom.window.qa;q.loadDemo();q.s.demo=false;q.s.user.id='me';q.s.orgMembership={role:'member'};q.s.workspace='all';q.s.query='';
 q.s.departments=[{id:'d1',name:'Managed'},{id:'d2',name:'Other'}];q.s.departmentMembers=[{department_id:'d1',user_id:'me',role:'manager',status:'active'}];q.s.projectMembers=[];
 q.s.projects=[{id:'p1',department_id:'d1',title:'Managed project'},{id:'p2',department_id:'d2',title:'Other project'}];
 q.s.tasks=[
 {id:'old',project_id:'p1',title:'Overdue assignment',assignee_id:'me',status:'blocked',due_date:'2026-12-30'},
 {id:'today',project_id:'p1',title:'Today assignment',assignee_id:'me',status:'ready',due_date:'2026-12-31'},
 {id:'end',project_id:'p1',title:'End of week',status:'ready',due_date:'2027-01-06'},
 {id:'later',project_id:'p1',title:'Later',status:'ready',due_date:'2027-01-07'},
 {id:'review',project_id:'p1',title:'Review for me',assignee_id:'other',reviewer_id:'me',status:'in_review'},
 {id:'closed',project_id:'p1',title:'Closed',assignee_id:'me',status:'complete',due_date:'2020-01-01'},
 {id:'cancelled',project_id:'p1',title:'Cancelled',status:'cancelled'},
 {id:'invalid',project_id:'p1',title:'Invalid date',status:'ready',due_date:'2026-02-31'},
 {id:'outside',project_id:'p2',title:'Outside management',assignee_id:'other',status:'ready'},
 {id:'hidden',project_id:'missing',title:'Hidden project task',status:'ready'}];
 return{dom,q};
}
test('Dashboard date buckets include today and six days, exclude closed work and invalid dates',()=>{const {dom,q}=setup();try{
 const d=q.dashboardData('manager',new Date(2026,11,31,12));
 assert.deepEqual(Array.from(d.overdue,t=>t.id),['old']);assert.deepEqual(Array.from(d.due,t=>t.id),['today','end']);
 assert.equal(d.open.length,6);assert.equal(d.unassigned.length,3);assert.equal(d.review.length,1);assert.equal(d.workload.reduce((sum,g)=>sum+g.tasks.length,0),6);
 }finally{dom.window.close();}});
test('Personal and manager dashboard respect assignment, management, department and search boundaries',()=>{const {dom,q}=setup();try{
 assert.deepEqual(Array.from(q.dashboardData('personal').open,t=>t.id).sort(),['old','review','today']);
 assert(!q.dashboardData('manager').open.some(t=>['outside','hidden'].includes(t.id)));
 q.s.workspace='d2';assert.equal(q.dashboardData('manager').open.length,0);
 q.s.workspace='all';q.s.query='End of week';assert.equal(q.dashboardData('manager').open.length,1);
 q.s.query='';q.s.departmentMembers[0].status='suspended';assert.equal(q.dashboardData('manager').open.length,0);
 q.s.projectMembers=[{project_id:'p2',user_id:'me',role:'lead',status:'active'}];assert.deepEqual(Array.from(q.dashboardData('manager').open,t=>t.id),['outside']);
 }finally{dom.window.close();}});
test('Dashboard controls navigate tasks, escape content and reset on organization change',async()=>{const {dom,q}=setup();try{
 q.s.tasks[0].title='<img src=x onerror=alert(1)>';q.s.profiles=[{user_id:'me',display_name:'<script>bad</script>'}];
 await q.handleClick({dataset:{action:'dashboard-view',value:'manager'}});const doc=dom.window.document;
 assert(doc.querySelector('.dashboard-workload'));assert.equal(doc.querySelectorAll('.dashboard-focus-grid img,.dashboard-workload script').length,0);
 doc.querySelector('[data-dashboard-section="blocked"] [data-action="task"]').click();assert.equal(q.s.taskId,'old');assert.equal(q.s.nav,'task');
 q.invalidateWorkspace();assert.equal(q.s.dashboardView,'overview');assert.equal(q.s.tasks.length,0);
 }finally{dom.window.close();}});
test('Unauthorized manager view falls back and empty personal dashboard stays useful',async()=>{const {dom,q}=setup();try{
 q.s.departmentMembers=[];q.s.projectMembers=[];q.s.dashboardView='manager';q.dashboard();assert.equal(q.s.dashboardView,'overview');
 q.s.tasks=[];await q.handleClick({dataset:{action:'dashboard-view',value:'personal'}});assert.equal(dom.window.document.querySelectorAll('[data-dashboard-section]').length,4);assert.match(dom.window.document.querySelector('.page').textContent,/No matching open tasks/);
 assert.equal(dom.window.document.querySelector('[data-action="dashboard-view"][data-value="manager"]'),null);
 }finally{dom.window.close();}});
test('Planner groups every authorized open task once across a year boundary',()=>{
 const {dom,q}=setup();try{
   q.s.tasks.push({id:'last',project_id:'p1',title:'Day 30',status:'ready',due_date:'2027-01-29'},
     {id:'after',project_id:'p1',title:'Day 31',status:'ready',due_date:'2027-01-30'});
   const now=new Date(2026,11,31,12),report=q.plannerReport(now);
   assert.deepEqual({...report.totals},{overdue:1,week:2,month:2,later:1,undated:2});
   assert.equal(report.groups.reduce((sum,g)=>sum+g.count,0),8);
   q.s.plannerGroup='project';q.s.plannerCell={groupId:'p1',window:'month'};
   assert.deepEqual(Array.from(q.plannerReport(now).detail,r=>r.task.id),['later','last']);
   q.s.query='End of week';assert.equal(q.plannerReport(now).records.length,1);
   q.s.workspace='d2';assert.equal(q.plannerReport(now).records.length,0);
   q.s.workspace='all';q.s.departmentMembers[0].status='suspended';assert.equal(q.plannerReport(now).records.length,0);
 }finally{dom.window.close();}
});
test('Planner distinguishes a prerequisite wait from a blocked status and exports the drilldown safely',()=>{
 const {dom,q}=setup();try{
   q.s.dependencyReadiness=[{task_id:'today',waiting:true}];
   q.s.tasks[1].title=' =SUM(1,2)"';
   q.s.plannerSignal='waiting';
   const r=q.plannerReport(new Date(2026,11,31,12));assert.equal(r.records.length,1);
   const csv=q.plannerCSV(r.detail);
   assert.match(csv,/"' =SUM\(1,2\)"""/);assert.match(csv,/"Next 7 days","Yes"/);
   assert.doesNotMatch(csv,/Outside management|Overdue assignment/);
   q.s.plannerSignal='blocked';assert.equal(q.plannerReport().detail[0].task.id,'old');
   q.s.plannerSignal='unassigned';assert.equal(q.plannerReport().records.length,3);
   q.s.plannerSignal='review';assert.equal(q.plannerReport().records.length,1);
   q.s.plannerCell={groupId:'missing',window:'all'};assert.equal(q.plannerReport().detail.length,0);
   q.invalidateWorkspace();assert.equal(q.s.plannerCell,null);assert.equal(q.s.plannerSignal,'all');
   q.s.dashboardView='planner';q.dashboard();assert.equal(q.s.dashboardView,'overview');
 }finally{dom.window.close();}
});
