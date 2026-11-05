const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
function setup(){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
 dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadDemo,projectTaskData,projectPage,handleClick,render,invalidateWorkspace};'));
 const q=dom.window.qa;q.loadDemo();q.s.projectId=q.s.projects[0].id;q.s.nav='project';q.s.query='';q.s.user.id='me';
 q.s.tasks=[
 {id:'late',project_id:q.s.projectId,title:'Later urgent',status:'ready',priority:'critical',assignee_id:'me',due_date:'2026-12-31'},
 {id:'early',project_id:q.s.projectId,title:'Earlier normal',description:'needle',status:'blocked',priority:'normal',assignee_id:'other',due_date:'2026-01-01'},
 {id:'undated',project_id:q.s.projectId,title:'No date',status:'ready',priority:'high'},
 {id:'invalid',project_id:q.s.projectId,title:'Bad date',status:'ready',priority:'low',due_date:'2026-02-31'},
 {id:'done',project_id:q.s.projectId,title:'Finished',status:'complete',priority:'normal'},
 {id:'cancel',project_id:q.s.projectId,title:'Cancelled',status:'cancelled',priority:'normal'},
 {id:'foreign',project_id:'missing',title:'Hidden',status:'ready',priority:'critical'}];
 q.s.dependencies=[];q.s.dependencyReadiness=[{task_id:'late',is_ready:false,incomplete_count:1}];
 return {dom,q};
}
const ids=(q)=>Array.from(q.projectTaskData(q.s.projectId).tasks,t=>t.id);
test('Project tasks search descriptions, exclude foreign/closed work, and sort valid due dates first',()=>{
 const {dom,q}=setup();try{
 assert.deepEqual(ids(q),['early','late','invalid','undated']);
 q.s.projectSort='priority';assert.deepEqual(ids(q),['late','undated','early','invalid']);
 q.s.query='NEEDLE';assert.deepEqual(ids(q),['early']);
 q.s.query='';q.s.projectClosed=true;assert.equal(ids(q).length,6);
 assert.equal(q.projectTaskData('missing').tasks.length,0);
 }finally{dom.window.close();}
});
test('Owner, priority and dependency filters combine and stale owners reset',()=>{
 const {dom,q}=setup();try{
 q.s.projectOwner='mine';assert.deepEqual(ids(q),['late']);
 q.s.projectPriority='low';assert.deepEqual(ids(q),[]);
 q.s.projectPriority='all';q.s.projectOwner='user:other';assert.deepEqual(ids(q),['early']);
 q.s.projectOwner='unassigned';assert.deepEqual(ids(q),['invalid','undated']);
 q.s.projectOwner='user:no-longer-visible';ids(q);assert.equal(q.s.projectOwner,'all');
 q.s.dependencies=[{task_id:'late',depends_on_task_id:'early'}];q.s.projectReadiness='waiting';assert.deepEqual(ids(q),['late']);
 q.s.projectReadiness='clear';assert(!ids(q).includes('late'));
 }finally{dom.window.close();}
});
test('Project controls update actual UI, preserve focus, keep totals and navigate list tasks',async()=>{
 const {dom,q}=setup();try{
 q.render();const d=dom.window.document;const owner=d.querySelector('#project-owner');owner.value='mine';owner.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 assert.equal(d.activeElement.id,'project-owner');assert.match(d.querySelector('.project-task-toolbar').textContent,/Showing 1 of 6/);
 assert.equal(d.querySelectorAll('.board-task').length,1);
 await q.handleClick({dataset:{action:'project-view',value:'list'}});assert.equal(d.querySelectorAll('.project-task-list .task-item').length,1);
 d.querySelector('.project-task-list [data-action="task"]').click();assert.equal(q.s.taskId,'late');assert.equal(q.s.nav,'task');
 q.s.nav='project';q.render();await q.handleClick({dataset:{action:'project-filters-reset'}});assert.equal(q.s.projectOwner,'all');assert.equal(q.s.projectView,'list');
 q.s.projectClosed=true;q.render();assert.match(d.querySelector('.project-task-list').textContent,/Cancelled/);
 q.invalidateWorkspace();assert.equal(q.s.projectView,'board');assert.equal(q.s.projectClosed,false);assert.equal(q.s.projectOwner,'all');
 }finally{dom.window.close();}
});
test('Project output escapes task and owner content; empty filters give recovery guidance',()=>{
 const {dom,q}=setup();try{
 q.s.tasks[0].title='<img src=x onerror=alert(1)>';q.s.profiles=[{user_id:'me',display_name:'<script>bad</script>'}];q.s.demo=false;q.render();
 assert.equal(dom.window.document.querySelectorAll('.board img,.project-task-toolbar script').length,0);
 q.s.query='no-match';q.render();assert.match(dom.window.document.querySelector('.page').textContent,/No matching tasks/);
 }finally{dom.window.close();}
});
test('Dependencies view preserves link direction, filtered context and project boundaries',()=>{
 const {dom,q}=setup();try{
   q.s.tasks.find(t=>t.id==='done').title='<b>Finished</b>';
   q.s.dependencies=[
     {task_id:'late',prerequisite_id:'done'},
     {task_id:'early',prerequisite_id:'late'},
     {task_id:'late',prerequisite_id:'foreign'},
     {task_id:'late',prerequisite_id:'unavailable'}
   ];
   q.s.projectOwner='mine';
   q.render();
   const d=dom.window.document;
   d.querySelector('[data-value="dependencies"]').click();
   const rows=d.querySelectorAll('.project-dependencies article');
   assert.equal(rows.length,1);
   const [before,after]=rows[0].querySelectorAll('.dependency-neighbors > div');
   assert.match(before.textContent,/Depends on.*<b>Finished<\/b>/);
   assert.equal(before.querySelector('b'),null);
   assert.match(after.textContent,/Needed by.*Earlier normal/);
   assert.doesNotMatch(rows[0].textContent,/Hidden|unavailable/);
   before.querySelector('button').click();
   assert.equal(q.s.taskId,'done');
   assert.equal(q.s.nav,'task');
 }finally{dom.window.close();}
});
