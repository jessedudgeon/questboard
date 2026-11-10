const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
test('Quick task creates standalone work and project work from the global control',async()=>{
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'}),w=dom.window;
 try{
 w.eval(fs.readFileSync(__dirname+'/../dist/app.js','utf8').replace('  init();','  globalThis.qa={s,loadDemo,handleClick,handleForm,render};'));
 const q=w.qa;q.loadDemo();assert(w.document.querySelector('[data-value="quick-task"]'));
 await q.handleClick({dataset:{action:'modal',value:'quick-task'}});
 let form=w.document.querySelector('[data-form="quick-task"]');form.querySelector('[name="title"]').value='Call vendor';await q.handleForm(form);
 const task=q.s.tasks.find(t=>t.title==='Call vendor');assert(task);assert.equal(task.xp_reward,15);assert(q.s.projects.find(p=>p.id===task.project_id).is_quick_queue);
 const project=q.s.projects.find(p=>!p.is_quick_queue);q.s.projectId=project.id;
 await q.handleClick({dataset:{action:'modal',value:'quick-task'}});form=w.document.querySelector('[data-form="quick-task"]');assert.equal(form.querySelector('[name="destination"]').value,'project:'+project.id);form.querySelector('[name="title"]').value='Project follow-up';await q.handleForm(form);assert.equal(q.s.tasks.find(t=>t.title==='Project follow-up').project_id,project.id);
 }finally{w.close();}
});
