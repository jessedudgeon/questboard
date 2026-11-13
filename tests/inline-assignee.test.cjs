const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function setup(){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});dom.window.eval(fs.readFileSync(__dirname+'/../dist/app.js','utf8').replace('  init();','  globalThis.qa={s,loadDemo,render,prepareInlineAssignee,changeInlineAssignee,milestoneOptions};'));const q=dom.window.qa;q.loadDemo();q.s.nav='project';q.s.projectId='p1';return {dom,q,d:dom.window.document};}
test('Inline assignment saves real and invited owners without opening tasks; read-only roles have no picker',async()=>{
const {dom,q,d}=setup();try{
q.s.invitations=[{id:'pending',scope_type:'organization',status:'pending',invited_email:'invite@example.invalid'}];
q.render();let select=d.querySelector('[data-task-assignee]');await q.prepareInlineAssignee(select);const id=select.dataset.taskAssignee;
select.click();assert.equal(q.s.nav,'project');select.value='invite:pending';await q.changeInlineAssignee(select);assert.equal(q.s.tasks.find(t=>t.id===id).assignee_invitation_id,'pending');assert.equal(q.s.nav,'project');
select=Array.from(d.querySelectorAll('[data-task-assignee]')).find(el=>el.dataset.taskAssignee===id);await q.prepareInlineAssignee(select);select.value='';await q.changeInlineAssignee(select);assert.equal(q.s.tasks.find(t=>t.id===id).assignee_id,null);assert.equal(q.s.tasks.find(t=>t.id===id).assignee_invitation_id,null);
q.s.projectView='list';q.render();assert(d.querySelector('.project-task-list [data-task-assignee]'));
q.s.demo=false;q.s.departmentMembers=[];q.s.projectMembers=[];q.render();assert.equal(d.querySelector('[data-task-assignee]'),null);assert.match(d.body.textContent,/Assigned to:/);
}finally{dom.window.close();}});
test('Milestone task pickers and project filter sort by date then name without mutating stored order',()=>{
const {dom,q,d}=setup();try{
q.s.milestones=[{id:'z',project_id:'p1',title:'Zulu',due_date:'2027-01-02'},{id:'late',project_id:'p1',title:'A late step',due_date:'2027-02-01'},{id:'a',project_id:'p1',title:'Alpha',due_date:'2027-01-02'}];
const select=d.createElement('select');select.innerHTML=q.milestoneOptions('p1');assert.deepEqual(Array.from(select.options,o=>o.value),['','a','z','late']);q.render();assert.deepEqual(Array.from(d.querySelector('#project-milestone').options,o=>o.value),['all','a','z','late']);assert.equal(q.s.milestones[0].id,'z');
}finally{dom.window.close();}});
