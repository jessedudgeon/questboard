const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{database}=require('./database-helper.cjs');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
function app(){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
 dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadDemo,handleClick,handleForm,render,weeklyWorkload,taskAbsences,calendarData,availabilityImpact,invalidateWorkspace,workloadCSV,deliveryData};'));
 const q=dom.window.qa;q.loadDemo();q.s.nav='calendar';q.s.calendarMonth='2027-01-01';q.s.workloadWeek='2027-01-04';q.s.tasks=[{id:'a',project_id:'p1',title:'Scheduled work',status:'ready',assignee_id:'demo-user',start_date:'2027-01-04',due_date:'2027-01-08',estimated_hours:40}];q.s.staffCapacity=[{owner_key:'user:demo-user',weekly_hours:40}];return{dom,q,doc:dom.window.document};
}
const absence=(id,kind,start,end,user=null)=>({id,kind,title:kind==='pto'?'PTO':'Holiday',start_date:start,end_date:end,user_id:user,non_working:true,revision:1});
test('PTO and holiday overlap reduce capacity once, retain scheduled effort and flag conflicts',()=>{
 const {dom,q}=app();try{
  q.s.availability=[absence('h','holiday','2027-01-04','2027-01-04'),absence('p','pto','2027-01-04','2027-01-08','demo-user')];
  const row=q.weeklyWorkload('2027-01-01').rows.find(r=>r.key==='demo-user');
  assert.equal(row.baseCapacity,40);assert.equal(row.capacity,0);assert.equal(row.hours,40);assert.equal(row.unavailableDays.length,5);
  assert.equal(q.taskAbsences(q.s.tasks[0]).length,2);assert.equal(q.s.tasks[0].status,'ready');assert.equal(q.s.tasks[0].due_date,'2027-01-08');
  assert.match(q.availabilityImpact('p1'),/Scheduled work/);assert(q.deliveryData(new Date('2027-01-01T12:00:00')).find(r=>r.project.id==='p1').signals.some(text=>text.includes('Availability conflict: Scheduled work')&&text.includes('2027-01-04')));assert.match(q.workloadCSV(),/Unavailable working days/);
  q.s.availability=[absence('p','pto','2027-01-05','2027-01-06','demo-user')];
  assert.equal(q.weeklyWorkload('2027-01-01').rows.find(r=>r.key==='demo-user').capacity,24);
 }finally{dom.window.close();}
});
test('Workweek, observances, reviewer dates, closed work and undated tasks are respected',()=>{
 const {dom,q}=app();try{
  q.s.availability=[absence('p','pto','2027-01-09','2027-01-10','demo-user'),{...absence('o','holiday','2027-01-04','2027-01-08'),non_working:false}];
  assert.equal(q.weeklyWorkload('2027-01-01').rows.find(r=>r.key==='demo-user').capacity,40);assert.equal(q.taskAbsences(q.s.tasks[0]).length,0);
  q.s.planningSettings=[{scope_type:'organization',scope_id:q.s.org.id,values:{workdays:[0,1,2,3,4,5,6]}}];
  assert(Math.abs(q.weeklyWorkload('2027-01-01').rows.find(r=>r.key==='demo-user').capacity-40*5/7)<1e-8);
  q.s.tasks[0].reviewer_id='sam';q.s.availability=[absence('review','pto','2027-01-08','2027-01-08','sam')];assert.equal(q.taskAbsences(q.s.tasks[0]).length,1);
  q.s.tasks[0].due_date=null;assert.equal(q.taskAbsences(q.s.tasks[0]).length,0);
  q.s.tasks[0].due_date='2027-01-08';q.s.tasks[0].status='complete';assert.equal(q.taskAbsences(q.s.tasks[0]).length,0);
 }finally{dom.window.close();}
});
test('Calendar expands ranges across month boundaries and My view only includes own PTO',()=>{
 const {dom,q,doc}=app();try{
  q.s.availability=[absence('h','holiday','2026-12-31','2027-01-02'),absence('p','pto','2027-01-01','2027-01-03','sam')];q.s.availability[0].title='<img src=x>';
  assert.equal(q.calendarData().events.filter(e=>e.kind==='holiday').length,2);
  q.render();assert.equal(doc.querySelectorAll('.availability-event img').length,0);assert.equal(doc.querySelectorAll('.availability-event').length,5);
  q.s.calendarScope='mine';assert.equal(q.calendarData().events.filter(e=>e.kind==='pto').length,0);
  q.invalidateWorkspace();assert.equal(q.s.availability.length,0);assert.equal(q.s.availabilityError,null);
 }finally{dom.window.close();}
});
test('Calendar forms create, edit and explicitly remove PTO; stale forms cannot cross organizations',async()=>{
 const {dom,q,doc}=app();try{
  await q.handleClick({dataset:{action:'availability-new',value:'pto'}});
  let f=doc.querySelector('[data-form="availability"]');f.elements.user_id.value='demo-user';f.elements.start_date.value='2027-01-04';f.elements.end_date.value='2027-01-08';await q.handleForm(f);
  assert.equal(q.s.availability.length,1);const row=q.s.availability[0];assert.equal(row.title,'PTO');
  await q.handleClick({dataset:{action:'availability-edit',id:row.id}});f=doc.querySelector('[data-form="availability"]');f.elements.end_date.value='2027-01-07';await q.handleForm(f);assert.equal(row.revision,2);
  await q.handleClick({dataset:{action:'availability-edit',id:row.id}});f=doc.querySelector('[data-form="availability"]');await q.handleClick({dataset:{action:'availability-remove',id:row.id,value:'2'}});assert.equal(q.s.availability.length,1);
  f.elements.confirm_remove.checked=true;await q.handleClick({dataset:{action:'availability-remove',id:row.id,value:'2'}});assert.equal(q.s.availability.length,0);
  await q.handleClick({dataset:{action:'availability-new',value:'holiday'}});f=doc.querySelector('[data-form="availability"]');f.elements.title.value='Old organization holiday';q.invalidateWorkspace();await q.handleForm(f);assert.equal(q.s.availability.length,0);
 }finally{dom.window.close();}
});
test('Non-admins cannot open availability forms and missing availability warns rather than claiming full coverage',async()=>{
 const {dom,q,doc}=app();try{
  q.s.demo=false;q.s.orgMembership={role:'member'};await q.handleClick({dataset:{action:'availability-new',value:'holiday'}});assert.notEqual(q.s.modal,'availability');
  q.s.availabilityError=true;q.render();assert.match(doc.body.textContent,/Capacity and absence warnings may be incomplete/);assert.equal(doc.querySelector('[data-action="availability-new"]'),null);
 }finally{dom.window.close();}
});
test('Availability table isolates organizations and enforces admin writes, valid members, dates and revisions',async()=>{
 const db=await database();try{
  await db.exec(fs.readFileSync(__dirname+'/permissions.sql','utf8').split('create function pg_temp.must_deny')[0]);
  const actor=who=>db.exec(`reset role;set local role authenticated;select set_config('request.jwt.claim.sub',(select ${who}::text from qa_ids),true);`);
  const one=async(sql)=>Object.values((await db.query(sql)).rows[0])[0];
  async function deny(sql){await db.exec('savepoint denied');try{await assert.rejects(()=>db.exec(sql));}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
  assert.equal(await one("select relrowsecurity from pg_class where oid='public.qb_calendar_availability'::regclass"),true);
  assert.equal(await one("select prosecdef from pg_proc where oid='qb_private.guard_calendar_availability()'::regprocedure"),false);
  assert.equal(await one("select has_table_privilege('anon','public.qb_calendar_availability','select')"),false);
  await actor('admin');
  await db.exec("insert into qb_calendar_availability(org_id,kind,title,start_date,end_date) select org,'holiday','Winter break','2027-01-04','2027-01-05' from qa_ids");
  await db.exec("insert into qb_calendar_availability(org_id,kind,title,user_id,start_date,end_date) select org,'pto','PTO',viewer,'2027-01-04','2027-01-08' from qa_ids");
  await deny("insert into qb_calendar_availability(org_id,kind,title,user_id,start_date,end_date) select other_org,'pto','PTO',viewer,'2027-01-04','2027-01-08' from qa_ids");
  await deny("insert into qb_calendar_availability(org_id,kind,title,user_id,start_date,end_date) select org,'pto','PTO',gen_random_uuid(),'2027-01-04','2027-01-08' from qa_ids");
  await deny("insert into qb_calendar_availability(org_id,kind,title,start_date,end_date) select org,'holiday','Bad dates','2027-01-08','2027-01-04' from qa_ids");
  await db.exec("reset role;update qb_org_members set role='admin' where org_id=(select other_org from qa_ids) and user_id=(select admin from qa_ids)");await actor('admin');
  await deny("insert into qb_calendar_availability(org_id,kind,title,user_id,start_date,end_date) select other_org,'pto','PTO',viewer,'2027-01-04','2027-01-08' from qa_ids");
  await db.exec("insert into qb_calendar_availability(org_id,kind,title,start_date,end_date) select other_org,'holiday','Other org holiday','2027-01-01','2027-01-01' from qa_ids");
  await deny("update qb_calendar_availability set org_id=(select other_org from qa_ids)");
  await db.exec("update qb_calendar_availability set end_date='2027-01-07' where kind='pto' and revision=1");assert.equal(await one("select revision from qb_calendar_availability where kind='pto'"),2);
  assert.equal((await db.query("update qb_calendar_availability set end_date='2027-01-06' where kind='pto' and revision=1 returning id")).rows.length,0);
  await actor('viewer');assert.equal(await one('select count(*)::int from qb_calendar_availability'),2);
  await deny("insert into qb_calendar_availability(org_id,kind,title,start_date,end_date) select org,'holiday','Unauthorized','2027-01-01','2027-01-01' from qa_ids");
  assert.equal((await db.query("update qb_calendar_availability set title='Changed' where kind='holiday' returning id")).rows.length,0);
  assert.equal((await db.query('delete from qb_calendar_availability returning id')).rows.length,0);
  await db.exec("reset role;update qb_org_members set status='suspended' where user_id=(select viewer from qa_ids)");await actor('viewer');assert.equal(await one('select count(*)::int from qb_calendar_availability'),0);
  await actor('admin');await deny("update qb_calendar_availability set end_date='2027-01-09' where kind='pto'");
  await db.exec('reset role;set local role anon');await deny('select * from qb_calendar_availability');
 }finally{await db.exec('rollback');await db.close();}
});
