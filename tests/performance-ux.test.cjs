const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {installFakeSupabase}=require('./session-fixture.cjs');

const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
async function until(done){for(let i=0;i<100;i++){if(done())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('App did not load');}
async function app(){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
  const fake=installFakeSupabase(dom.window);
  dom.window.eval(source.replace('  init();','  globalThis.qa={s,handleClick,handleForm,loadLive};\n  init();'));
  await until(()=>dom.window.qa.s.org?.id==='a'&&!dom.window.qa.s.loading);
  return {dom,fake,qa:dom.window.qa};
}

test('One-click status changes update just the task without reloading the organization',async()=>{
  const {dom,fake,qa}=await app();
  try{
    const page=dom.window.document.querySelector('.page');
    await qa.handleClick({dataset:{action:'project',id:'pa'}});
    assert.match(page.innerHTML,/Mark Ready/);
    fake.before=call=>{
      if(call.rpc==='qb_transition_task'){
        const task=fake.tables.qb_tasks.find(row=>row.id===call.args.p_task);
        const from=task.status;
        task.status=call.args.p_new_status;
        fake.tables.qb_task_events.push({id:'event-'+fake.tables.qb_task_events.length,task_id:task.id,actor_id:'u1',event_type:'status',before_data:{status:from},after_data:{status:task.status},created_at:new Date().toISOString()});
      }
    };
    const before=fake.calls.length;
    await qa.handleClick({dataset:{action:'status',id:'ta',value:'ready'}});
    const calls=fake.calls.slice(before);
    assert.equal(qa.s.tasks.find(task=>task.id==='ta').status,'ready');
    assert.equal(page.getAttribute('aria-busy'),'false');
    assert.equal(dom.window.document.querySelector('.page'),page);
    assert(!calls.some(call=>['qb_organizations','qb_projects','qb_org_members','qb_profiles'].includes(call.table)));
    assert(calls.some(call=>call.table==='qb_tasks'&&call.filters.some(([key])=>key==='id')));
    assert(calls.some(call=>call.rpc==='qb_dependency_readiness'));
    assert.match(page.innerHTML,/Start Work/);
  }finally{dom.window.close();}
});

test('Quick entry chooses an initial state in the creation form',async()=>{
  const {dom,qa}=await app();
  try{
    await qa.handleClick({dataset:{action:'demo'}});
    await qa.handleClick({dataset:{action:'modal',value:'quick-task'}});
    const form=dom.window.document.querySelector('form[data-form="quick-task"]');
    assert(form);
    assert.equal(form.querySelector('[name="initial_status"]').value,'ready');
    form.querySelector('[name="title"]').value='Quick note for the team';
    form.querySelector('[name="initial_status"]').value='in_progress';
    await qa.handleForm(form);
    assert.equal(qa.s.tasks.find(task=>task.title==='Quick note for the team')?.status,'in_progress');
    assert.equal(qa.s.nav,'task');
  }finally{dom.window.close();}
});

test('Large workspace queries overlap bounded ID batches during full loading',async()=>{
  const {dom,fake,qa}=await app();
  try{
    fake.tables.qb_tasks=Array.from({length:230},(_,i)=>({id:'batch-'+i,project_id:'pa',title:'Batch task '+i,status:'backlog',assignee_id:'u1'}));
    let active=0,maxActive=0;
    fake.before=async call=>{
      if(call.table!=='qb_task_events')return;
      active++;maxActive=Math.max(maxActive,active);
      try{await new Promise(resolve=>setTimeout(resolve,20));}finally{active--;}
    };
    await qa.loadLive();
    assert.equal(qa.s.tasks.length,230);
    assert.equal(qa.s.loading,false);
    assert(maxActive>=2,'separate batches should overlap');
    assert(maxActive<=3,'concurrency should remain bounded');
  }finally{dom.window.close();}
});
