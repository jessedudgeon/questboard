const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{installFakeSupabase}=require('./session-fixture.cjs');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out');}
async function app(){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});const f=installFakeSupabase(dom.window);dom.window.eval(source.replace('  init();','  globalThis.qa={s,projectHistory,loadProjectHistory,switchOrganization,handleClick,handleForm,render};\n  init();'));const q=dom.window.qa;await until(()=>q.s.org?.id==='a'&&!q.s.loading);q.s.projectId='pa';q.s.nav='project';return{dom,f,q};}
test('Stale project edit retains draft and supplies revision to the save API',async()=>{const {dom,f,q}=await app();try{
 q.s.projects.find(p=>p.id==='pa').revision=4;await q.handleClick({dataset:{action:'modal',value:'project-settings'}});
 const form=dom.window.document.querySelector('form[data-form="project-settings"]');form.elements.title.value='Unsaved outcome';
 f.before=c=>{if(c.rpc==='qb_save_project_settings')throw Error('Project changed. Refresh before saving.');};
 await q.handleForm(form);assert.equal(form.elements.title.value,'Unsaved outcome');assert.equal(q.s.modal,'project-settings');assert.match(form.querySelector('[role="alert"]').textContent,/Project changed/);
 const call=f.calls.find(c=>c.rpc==='qb_save_project_settings');assert.equal(call.args.p_revision,4);assert.equal(call.args.p_project,'pa');assert.equal(call.args.p_title,'Unsaved outcome');
 }finally{dom.window.close();}});
test('Detached settings forms cannot save after organization switch',async()=>{const {dom,f,q}=await app();try{
 await q.handleClick({dataset:{action:'modal',value:'project-settings'}});const form=dom.window.document.querySelector('form[data-form="project-settings"]');await q.switchOrganization('b');await q.handleForm(form);assert(!f.calls.some(c=>c.rpc==='qb_save_project_settings'));
 }finally{dom.window.close();}});
test('History failures retry in place, escape content and discard old-org replies',async()=>{const {dom,f,q}=await app();try{
 q.s.nav='project-history';f.before=c=>{if(c.table==='qb_project_changes')throw Error('offline');};await q.loadProjectHistory();assert.equal(q.projectHistory.error,true);
 f.before=null;f.tables.qb_project_changes=[{id:'e',project_id:'pa',revision:2,actor_id:'u1',created_at:'2026-11-08T12:00:00Z',before_data:{title:'Old'},after_data:{title:'<img src=x>'}}];await q.loadProjectHistory();assert.equal(q.projectHistory.rows.length,1);assert.equal(dom.window.document.querySelector('.project-history img'),null);
 let release,waiting=false;const gate=new Promise(r=>release=r);f.before=c=>{if(c.table==='qb_project_changes'){waiting=true;return gate;}};const pending=q.loadProjectHistory();await until(()=>waiting);await q.switchOrganization('b');release();await pending;assert.equal(q.projectHistory.rows.length,0);assert(!dom.window.document.body.textContent.includes('<img src=x>'));
 }finally{dom.window.close();}});
test('Non-managers cannot open project settings',async()=>{const {dom,q}=await app();try{q.s.departmentMembers=[];q.s.projectMembers=[];await q.handleClick({dataset:{action:'modal',value:'project-settings'}});assert.equal(q.s.modal,null);}finally{dom.window.close();}});
