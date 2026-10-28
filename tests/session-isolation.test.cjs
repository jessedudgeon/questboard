const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{installFakeSupabase}=require('./session-fixture.cjs');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out waiting for application');}
async function app(){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});const f=installFakeSupabase(dom.window);dom.window.eval(source.replace('  init();','  globalThis.qa={s,membership,loadLive,switchOrganization,receiveSession,signOut,loadAssignmentCandidates,loadMemberships,handleForm,handleClick};\n  init();'));const q=dom.window.qa;await until(()=>q.s.org?.id==='a'&&!q.s.loading);return{dom,f,q};}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};}
test('Organization switch clears navigation, admin caches and scopes every child query',async()=>{const {dom,f,q}=await app();try{
 q.s.modal='task';q.s.query='secret';q.s.taskId='ta';q.membership.rows=[{secret:true}];q.s.candidateRows=[{secret:true}];
 await q.switchOrganization('b');assert.equal(q.s.org.id,'b');assert.equal(q.s.orgMembership.role,'member');assert.equal(q.s.modal,null);assert.equal(q.s.query,'');assert.equal(q.s.taskId,null);assert.equal(q.s.orgMembers.length,0);assert.equal(q.membership.rows.length,0);assert.equal(q.s.candidateRows.length,0);
 assert.deepEqual(Array.from(q.s.tasks,t=>t.id),['tb']);assert.equal(q.s.updates.length,0);assert(!dom.window.document.body.textContent.includes('Alpha secret'));
 for(const c of f.calls.filter(c=>['qb_tasks','qb_checklist','qb_task_updates','qb_task_events','qb_xp_events','qb_department_members','qb_project_members'].includes(c.table)))assert(c.filters.length>0,c.table);
 assert.equal(dom.window.sessionStorage.getItem('qb-organization:u1'),'b');
 }finally{dom.window.close();}});
test('Overlapping org loads: stale replies are aborted and cannot replace the latest org',async()=>{const {dom,f,q}=await app();try{
 const gate=deferred();let waiting=false;f.before=c=>{if(c.table==='qb_projects'&&c.filters.some(([k,v])=>k==='org_id'&&v[0]==='b')){waiting=true;return gate.promise;}};
 const b=q.switchOrganization('b');await until(()=>waiting);const a=q.switchOrganization('a');await a;gate.resolve();await b;
 assert.equal(q.s.org.id,'a');assert(f.calls.some(c=>c.signal?.aborted));assert.deepEqual(Array.from(q.s.tasks,t=>t.id),['ta']);
 }finally{dom.window.close();}});
test('Account change clears immediately and late prior-account load cannot publish',async()=>{const {dom,f,q}=await app();try{
 const gate=deferred();let waiting=false;f.before=c=>{if(c.table==='qb_projects'&&c.user==='u1'){waiting=true;return gate.promise;}};
 const old=q.loadLive();await until(()=>waiting);f.emit('SIGNED_IN','u2');assert.equal(q.s.tasks.length,0);assert.equal(q.s.org,null);assert.equal(q.s.organizations.length,0);
 await until(()=>q.s.org?.id==='b'&&!q.s.loading);gate.resolve();await old;assert.equal(q.s.user.id,'u2');assert.equal(q.s.org.id,'b');assert(!q.s.profiles.some(p=>p.user_id==='u1'&&p.secret));
 }finally{dom.window.close();}});
test('Sign-out wins over delayed load and failed sign-out never restores cached data',async()=>{const {dom,f,q}=await app();try{
 const gate=deferred();let waiting=false;f.before=c=>{if(c.table==='qb_tasks'){waiting=true;return gate.promise;}};
 const load=q.loadLive();await until(()=>waiting);f.signOutError=true;await q.signOut();assert.equal(q.s.user,null);assert.equal(q.s.tasks.length,0);assert.equal(q.s.orgMembers.length,0);
 f.emit('TOKEN_REFRESHED','u1');gate.resolve();await load;assert.equal(q.s.user,null);assert.equal(q.s.org,null);assert.equal(f.calls.find(c=>c.signOut).signOut.scope,'local');
 }finally{dom.window.close();}});
test('Suspended org excluded on reload; suspension during load prevents snapshot commit',async()=>{const {dom,f,q}=await app();try{
 f.tables.qb_org_members.find(m=>m.org_id==='a'&&m.user_id==='u1').status='suspended';await q.loadLive('a');assert.equal(q.s.org.id,'b');assert.deepEqual(Array.from(q.s.organizations,o=>o.id),['b']);
 f.before=c=>{if(c.table==='qb_profiles'&&c.operation==='select')f.tables.qb_org_members.find(m=>m.org_id==='b'&&m.user_id==='u1').status='suspended';};
 await q.loadLive('b');assert.equal(q.s.org,null);assert.equal(q.s.tasks.length,0);assert.match(q.s.lastError,/access changed/);
 }finally{dom.window.close();}});
test('Candidate and membership directory replies cannot repopulate after sign-out',async()=>{const {dom,f,q}=await app();try{
 const gate=deferred();f.before=c=>c.rpc&&['qb_assignment_candidates','qb_membership_directory'].includes(c.rpc)?gate.promise:undefined;
 const a=q.loadAssignmentCandidates('pa'),b=q.loadMemberships('department:da');await q.signOut();gate.resolve();await Promise.all([a,b]);assert.equal(q.s.candidateRows.length,0);assert.equal(q.membership.rows.length,0);assert.equal(q.membership.loaded,false);
 }finally{dom.window.close();}});
test('No active membership shows onboarding without prior org data',async()=>{const {dom,f,q}=await app();try{
 f.tables.qb_org_members.forEach(m=>m.status='suspended');await q.loadLive();assert.equal(q.s.org,null);assert.equal(q.s.tasks.length,0);assert.equal(q.s.profiles.length,0);assert.equal(q.s.organizations.length,0);
 }finally{dom.window.close();}});
test('Old mutation completion cannot navigate or refresh a different organization',async()=>{const {dom,f,q}=await app();try{
 const gate=deferred();let waiting=false;f.before=c=>{if(c.rpc==='qb_transition_task'){waiting=true;return gate.promise;}};
 const action=q.handleClick({dataset:{action:'status',id:'ta',value:'ready'}});await until(()=>waiting);await q.switchOrganization('b');gate.resolve();await action;assert.equal(q.s.org.id,'b');assert.equal(q.s.nav,'home');assert.equal(q.s.busy,false);assert(!dom.window.document.getElementById('toast').textContent.includes('Task updated'));
 }finally{dom.window.close();}});
test('Startup getSession cannot undo a newer sign-out auth event',async()=>{
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
 try{const f=installFakeSupabase(dom.window),gate=deferred();f.api.auth.getSession=()=>gate.promise;
 dom.window.eval(source.replace('  init();','  globalThis.qa={s};\n  init();'));
 f.emit('SIGNED_OUT',null);gate.resolve({data:{session:{user:{id:'u1'}}}});await new Promise(r=>setTimeout(r,10));assert.equal(dom.window.qa.s.user,null);assert.equal(dom.window.qa.s.tasks.length,0);
 }finally{dom.window.close();}
});
test('A detached previous-org form cannot submit after switching',async()=>{const {dom,f,q}=await app();try{
 await q.handleClick({dataset:{action:'modal',value:'department'}});const form=dom.window.document.querySelector('form[data-form="department"]');form.querySelector('[name="name"]').value='Stale department';
 await q.switchOrganization('b');const before=f.calls.length;await q.handleForm(form);assert.equal(f.calls.length,before);
 }finally{dom.window.close();}});
test('Remembered org is identity-scoped and validated against active memberships',async()=>{const {dom,f,q}=await app();try{
 dom.window.sessionStorage.setItem('qb-organization:u2','a');await q.switchOrganization('b');f.emit('SIGNED_IN','u2');await until(()=>q.s.org?.id==='b'&&!q.s.loading);
 assert.equal(dom.window.sessionStorage.getItem('qb-organization:u2'),'b');assert.equal(q.s.orgMembership.user_id,'u2');
 }finally{dom.window.close();}});
