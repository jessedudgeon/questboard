const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
function setup(){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
 dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadDemo,render};'));
 const q=dom.window.qa;q.loadDemo();q.s.projectId=q.s.projects[0].id;q.s.nav='project';
 q.s.tasks=[{id:'test-task',project_id:q.s.projectId,title:'Task <one>',status:'in_progress',assignee_id:'other',priority:'normal'}];
 q.s.dependencies=[];q.s.dependencyReadiness=[];q.s.checklist=[];q.render();
 return {dom,q,d:dom.window.document};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('Board status menu updates through review and completion without navigating into task',async()=>{
 const {dom,q,d}=setup();try{
 let select=d.querySelector('[data-task-status]');
 assert.equal(select.getAttribute('aria-label'),'Change status: Task <one>');
 select.click();assert.equal(q.s.nav,'project');
 assert.deepEqual(Array.from(select.options,o=>o.value),['','blocked','in_review']);
 select.value='in_review';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();
 assert.equal(q.s.tasks[0].status,'in_review');assert.equal(q.s.nav,'project');
 select=d.querySelector('[data-task-status]');assert.equal(d.activeElement,select);
 select.value='complete';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();
 assert.equal(q.s.tasks[0].status,'complete');assert.equal(q.s.nav,'project');
 q.s.projectClosed=true;q.render();assert(d.querySelector('[data-task-status] option[value="in_progress"]'));
 q.s.projectView='list';q.render();assert(d.querySelector('.project-task-list [data-task-status]'));
 }finally{dom.window.close();}
});
test('Status menu respects lead membership, independent review, dependencies, and read-only users',()=>{
 const {dom,q,d}=setup();try{
 q.s.demo=false;q.s.departmentMembers=[];q.s.projectMembers=[{project_id:q.s.projectId,user_id:q.s.user.id,role:'lead',status:'active'}];q.render();
 assert(d.querySelector('[data-task-status] option[value="in_review"]'));
 q.s.tasks[0].status='in_review';q.render();assert(d.querySelector('[data-task-status] option[value="complete"]'));
 q.s.tasks[0].assignee_id=q.s.user.id;q.render();assert(d.querySelector('[data-task-status] option[value="complete"]'));
 q.s.projectMembers=[];q.s.tasks[0].reviewer_id=q.s.user.id;q.render();assert.equal(d.querySelector('[data-task-status] option[value="complete"]'),null);
 q.s.tasks[0].reviewer_id=null;q.s.projectMembers=[{project_id:q.s.projectId,user_id:q.s.user.id,role:'lead',status:'active'}];
 q.s.dependencyReadiness=[{task_id:'test-task',waiting:true}];q.render();assert.equal(d.querySelector('[data-task-status]'),null);
 q.s.dependencyReadiness=[];q.s.tasks[0].assignee_id='other';q.s.projectMembers=[];q.render();assert.equal(d.querySelector('[data-task-status]'),null);
 }finally{dom.window.close();}
});
test('Checklist rejection leaves the board status unchanged and control usable',async()=>{
 const {dom,q,d}=setup();try{
 q.s.checklist=[{task_id:'test-task',done:false}];
 const select=d.querySelector('[data-task-status]');select.value='in_review';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await tick();
 assert.equal(q.s.tasks[0].status,'in_progress');assert.equal(select.disabled,false);assert.equal(select.value,'');
 assert.match(d.querySelector('#toast').textContent,/Finish the checklist first/);
 }finally{dom.window.close();}
});
