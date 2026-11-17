const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{installFakeSupabase}=require('./session-fixture.cjs');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
async function app(){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
 const f=installFakeSupabase(dom.window);f.current=null;
 dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadDemo,handleClick,visibleProjects,visibleTasks,calendarData,leadershipReport,allTasksData};\n  init();'));
 await new Promise(r=>setTimeout(r,0));const q=dom.window.qa;q.loadDemo();
 q.s.projects[0].status='archived';q.s.projects[1].status='complete';
 return {dom,q};
}
test('Past projects are separated from daily work, remain searchable and open with their tasks',async()=>{
 const {dom,q}=await app();try{
  const archived=q.s.projects[0],complete=q.s.projects[1],active=q.s.projects[2];
  await q.handleClick({dataset:{action:'nav',value:'projects'}});
  assert.equal(dom.window.document.querySelectorAll('.project-card').length,1);
  assert.equal(dom.window.document.querySelector('.project-card').dataset.id,active.id);
  assert(dom.window.document.querySelector('[data-value="past-projects"]'));
  assert(q.visibleTasks().every(t=>t.project_id===active.id));
  assert(q.allTasksData().projects.every(p=>p.id===active.id));
  assert(q.visibleProjects(true).some(p=>p.id===archived.id));
  await q.handleClick({dataset:{action:'nav',value:'past-projects'}});
  assert.equal(dom.window.document.querySelectorAll('.project-card').length,2);
  await q.handleClick({dataset:{action:'project',id:archived.id}});
  assert.equal(q.s.projectId,archived.id);assert(q.s.tasks.some(t=>t.project_id===archived.id));
  q.s.query=complete.title;await q.handleClick({dataset:{action:'nav',value:'past-projects'}});
  assert.equal(dom.window.document.querySelectorAll('.project-card').length,1);
  assert.equal(dom.window.document.querySelector('.project-card').dataset.id,complete.id);
  q.s.query='';q.s.workspace=archived.department_id;
  assert(q.visibleProjects(true).every(p=>p.department_id===archived.department_id));
 }finally{dom.window.close();}
});
test('Calendar and reports can explicitly include past work without removing historical records',async()=>{
 const {dom,q}=await app();try{
  const archived=q.s.projects[0];
  assert(!q.calendarData().projects.some(p=>p.id===archived.id));
  q.s.calendarClosed=true;assert(q.calendarData().projects.some(p=>p.id===archived.id));
  assert(!q.leadershipReport().some(r=>r.project.id===archived.id));
  q.s.reportClosed=true;assert(q.leadershipReport().some(r=>r.project.id===archived.id));
  archived.status='active';assert(q.visibleProjects().some(p=>p.id===archived.id));
 }finally{dom.window.close();}
});
