const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');const {database}=require('./database-helper.cjs');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
function app(){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadDemo,render,handleClick,handleForm,projectTemplateLibrary,templateGroups,templateFilters};'));dom.window.qa.loadDemo();return {dom,q:dom.window.qa,doc:dom.window.document};}
test('Library searches, previews, and creates a complete editable demo plan',async()=>{const {dom,q,doc}=app();try{
 await q.handleClick({dataset:{action:'nav',value:'templates'}});assert.equal(doc.querySelectorAll('.template-card').length,26);
 const search=doc.getElementById('template-search');search.value='phone';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(doc.querySelectorAll('.template-card:not([hidden])').length,1);
 search.value='no such template';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(doc.getElementById('template-empty').hidden,false);
 await q.handleClick({dataset:{action:'start-project-template',id:'equipment'}});const form=doc.querySelector('[data-form="project-template"]');assert(form);form.elements.namedItem('title').value='QA equipment';form.elements.namedItem('start_date').value='2026-11-16';
 await q.handleForm(form);const p=q.s.projects.find(p=>p.title==='QA equipment');assert(p);assert.equal(p.status,'planned');assert.equal(p.target_date,'2026-11-28');
 const milestones=q.s.milestones.filter(m=>m.project_id===p.id),tasks=q.s.tasks.filter(t=>t.project_id===p.id);assert.equal(milestones.length,4);assert.equal(tasks.length,8);assert(tasks.every(t=>t.status==='backlog'&&t.assignee_id===null&&t.schedule_mode==='milestone_deadline'));
 assert.equal(q.s.checklist.filter(c=>tasks.some(t=>t.id===c.task_id)).length,16);assert.equal(q.s.nav,'project');
 }finally{dom.window.close();}});
test('Template RPC is atomic, idempotent, and department-scoped for all starter plans',async()=>{
 const db=await database();const {dom,q}=app();try{
 await db.exec(fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0]);
 const actor=async(who)=>db.exec(`reset role;set local role authenticated;select set_config('request.jwt.claim.sub',(select ${who}::text from qa_ids),true);`);
 const scalar=async(sql,params)=>Object.values((await db.query(sql,params)).rows[0])[0];
 await actor('admin');const dept=await scalar('select dept from qa_ids');
 const create=async(id,plan,department=dept)=>scalar("select qb_create_project_from_template($1,$2,'Template QA','Outcome','restricted','2026-11-16',$3::jsonb)",[id,department,JSON.stringify(plan)]);
 for(const plan of q.projectTemplateLibrary){const id=await scalar('select gen_random_uuid()');assert.equal(await create(id,plan.milestones),id);assert.equal(await create(id,plan.milestones),id);assert.equal(await scalar('select count(*)::int from qb_milestones where project_id=$1',[id]),plan.milestones.length);assert.equal(await scalar('select count(*)::int from qb_tasks where project_id=$1',[id]),plan.milestones.reduce((n,m)=>n+m.tasks.length,0));assert.equal(await scalar("select count(*)::int from qb_tasks where project_id=$1 and (status<>'backlog' or assignee_id is not null or xp_reward<>0 or coin_reward<>0)",[id]),0);}
 const id=await scalar('select gen_random_uuid()');const malformed=JSON.parse(JSON.stringify(q.projectTemplateLibrary[0].milestones));malformed.at(-1).tasks[0].checklist=[null];
 async function deny(fn){await db.exec('savepoint denial');try{await assert.rejects(fn);}finally{await db.exec('rollback to savepoint denial;release savepoint denial');}}
 await deny(()=>create(id,malformed));assert.equal(await scalar('select count(*)::int from qb_projects where id=$1',[id]),0);
 const other=await scalar('select other_dept from qa_ids');await deny(()=>create(id,q.projectTemplateLibrary[0].milestones,other));
 await actor('viewer');await deny(()=>create(id,q.projectTemplateLibrary[0].milestones));
 await db.exec('reset role;set local role anon');await deny(()=>create(id,q.projectTemplateLibrary[0].milestones));
 }finally{dom.window.close();await db.exec('rollback');await db.close();}
});

test('Library groups plans by audience and combines category and search filters across rerenders',async()=>{
 const {dom,q,doc}=app();try{
  await q.handleClick({dataset:{action:'nav',value:'templates'}});
  assert.equal(doc.querySelectorAll('[data-template-group]:not([hidden])').length,6);
  await q.handleClick({dataset:{action:'template-group',value:'home'}});
  assert.equal(doc.querySelectorAll('.template-card:not([hidden])').length,5);
  const input=doc.getElementById('template-search');input.value='moving';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(doc.querySelectorAll('.template-card:not([hidden])').length,1);
  await q.handleClick({dataset:{action:'start-project-template',id:'home-move'}});
  assert.equal(doc.getElementById('template-search').value,'moving');
  assert.equal(doc.querySelectorAll('.template-card:not([hidden])').length,1);
  await q.handleClick({dataset:{action:'template-group',value:'business'}});
  assert.equal(doc.querySelectorAll('.template-card:not([hidden])').length,0);
  assert.equal(doc.getElementById('template-empty').hidden,false);
  await q.handleClick({dataset:{action:'template-clear'}});
  assert.equal(doc.querySelectorAll('.template-card:not([hidden])').length,26);
  assert.equal(doc.querySelector('[data-action="template-group"][data-value="all"]').getAttribute('aria-pressed'),'true');
  assert.equal(doc.activeElement.id,'template-search');
 }finally{dom.window.close();}
});
test('Every audience has concrete plans with valid milestones, task checks, and unique identities',()=>{
 const {dom,q}=app();try{
  assert.equal(new Set(q.projectTemplateLibrary.map(t=>t.id)).size,26);
  for(const group of q.templateGroups){const plans=q.projectTemplateLibrary.filter(t=>t.group===group.id);assert(plans.length>=3);}
  for(const plan of q.projectTemplateLibrary){
   assert(q.templateGroups.some(g=>g.id===plan.group));assert(plan.summary.length>20);
   let last=-1;for(const m of plan.milestones){assert(m.offset>last);last=m.offset;assert(m.tasks.length>=(plan.group==='technology'?1:2));for(const task of m.tasks)assert(task.checklist.length>=2);}
  }
 }finally{dom.window.close();}
});
