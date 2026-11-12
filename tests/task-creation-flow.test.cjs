const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function setup(){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});dom.window.eval(fs.readFileSync(__dirname+'/../dist/app.js','utf8').replace('  init();','  globalThis.qa={s,loadDemo,handleClick,handleForm,render,taskExplorer,allTasksData};'));dom.window.qa.loadDemo();return {dom,q:dom.window.qa};}
for(const nav of ['project','milestone'])test('Task creation stays on '+nav+' and repeat entry retains context',async()=>{
 const {dom,q}=setup();try{
 q.s.projectId='p1';q.s.nav=nav;q.s.taskId='previous';q.s.milestoneId='m1';q.s.milestones=[{id:'m1',project_id:'p1',title:'Delivery',due_date:'2027-01-01',archived:false}];
 await q.handleClick({dataset:{action:'modal',value:'task',milestone:'m1'}});
 let form=dom.window.document.querySelector('[data-form="task"]');form.elements.title.value='First task';form.elements.due_date.value='2026-12-01';const request=form.dataset.request;
 await q.handleForm(form,{value:'another'});
 assert.equal(q.s.nav,nav);assert.equal(q.s.taskId,'previous');assert.equal(q.s.milestoneId,'m1');
 const task=q.s.tasks.find(t=>t.title==='First task');assert.equal(task.milestone_id,'m1');assert.equal(task.status,'ready');
 form=dom.window.document.querySelector('[data-form="task"]');assert(form);assert.notEqual(form.dataset.request,request);assert.equal(form.elements.title.value,'');assert.equal(form.elements.milestone_id.value,'m1');assert.equal(form.elements.due_date.value,'2026-12-01');assert.equal(dom.window.document.activeElement,form.elements.title);
 form.elements.title.value='Second task';await q.handleForm(form);assert.equal(q.s.nav,nav);assert.equal(q.s.modal,null);assert(q.s.tasks.some(t=>t.title==='Second task'));
 }finally{dom.window.close();}
});
test('Standalone quick tasks can be repeatedly entered and found without project tasks',async()=>{
 const {dom,q}=setup();try{
 q.s.nav='alltasks';q.s.projectId=null;
 await q.handleClick({dataset:{action:'modal',value:'quick-task'}});
 let form=dom.window.document.querySelector('[data-form="quick-task"]');const destination=form.elements.destination.value;form.elements.title.value='Standalone follow-up';await q.handleForm(form,{value:'another'});
 assert.equal(q.s.nav,'alltasks');form=dom.window.document.querySelector('[data-form="quick-task"]');assert.equal(form.elements.destination.value,destination);assert.equal(form.elements.title.value,'');
 q.taskExplorer.project='standalone';const rows=q.allTasksData().rows;assert.equal(rows.length,1);assert.equal(rows[0].title,'Standalone follow-up');assert.equal(q.allTasksData().missingProject,false);
 }finally{dom.window.close();}
});
