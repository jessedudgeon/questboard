const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{installFakeSupabase}=require('./session-fixture.cjs');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
async function until(fn){for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Application did not settle');}
async function app(setup=()=>{}){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});const f=installFakeSupabase(dom.window);setup(f);dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadLive,switchOrganization,pagedRows};\n  init();'));const q=dom.window.qa;await until(()=>!q.s.loading);return{dom,f,q};}
const tasks=n=>Array.from({length:n},(_,i)=>({id:'task-'+String(i).padStart(5,'0'),project_id:'pa',title:'Task '+i,status:'backlog',created_at:'2026-11-02T00:00:00Z'}));
test('Loads more than 1,000 tasks and history rows with deterministic ordering and scope filters',async()=>{
 const {dom,f,q}=await app(f=>{f.tables.qb_tasks=tasks(1105);f.tables.qb_task_updates=Array.from({length:1201},(_,i)=>({id:'update-'+String(i).padStart(5,'0'),task_id:'task-00000',body:'History '+i,created_at:'2026-11-02T00:00:00Z'}));});
 try{assert.equal(q.s.lastError,null);assert.equal(q.s.tasks.length,1105);assert.equal(q.s.updates.length,1201);assert.equal(q.s.tasks.at(-1).id,'task-01104');assert.equal(new Set(q.s.tasks.map(t=>t.id)).size,1105);for(const c of f.calls.filter(c=>c.table==='qb_tasks')){assert(c.filters.some(([key])=>key==='project_id'));assert(c.end-c.start<=249);}}finally{dom.window.close();}
});
test('A server cap smaller than page size does not silently truncate collections or invitations',async()=>{
 const {dom,q}=await app(f=>{f.rowCap=37;f.tables.qb_tasks=tasks(1050);f.rpcRows.qb_my_invitations=Array.from({length:1003},(_,i)=>({id:'invite-'+i,org_name:'Invited organization',invite_role:'member'}));});
 try{assert.equal(q.s.lastError,null);assert.equal(q.s.tasks.length,1050);assert.equal(q.s.pendingInvitations.length,1003);}finally{dom.window.close();}
});
test('Compound membership keys and parent batches preserve all rows',async()=>{
 const {dom,q}=await app(f=>{f.tables.qb_departments=Array.from({length:103},(_,i)=>({id:'d'+i,org_id:'a',name:'Department'}));f.tables.qb_department_members=Array.from({length:103},(_,i)=>({department_id:'d'+i,user_id:'u1',role:'manager',status:'active'}));});
 try{assert.equal(q.s.lastError,null);assert.equal(q.s.departments.length,103);assert.equal(q.s.departmentMembers.length,103);}finally{dom.window.close();}
});
test('Mid-page failure publishes no partial snapshot and retry loads everything',async()=>{
 const {dom,f,q}=await app();try{f.tables.qb_tasks=tasks(650);f.before=c=>{if(c.table==='qb_tasks'&&c.start===250)throw Error('Connection interrupted');};await q.loadLive();assert.equal(q.s.tasks.length,0);assert.equal(q.s.org,null);assert.match(q.s.lastError,/Connection interrupted/);assert.match(dom.window.document.body.textContent,/Try again/);f.before=null;await q.loadLive();assert.equal(q.s.tasks.length,650);assert.equal(q.s.lastError,null);}finally{dom.window.close();}
});
for(const change of ['organization','account','signout'])test(`Late second page cannot cross ${change} boundaries`,async()=>{
 const {dom,f,q}=await app();try{f.tables.qb_tasks.push(...tasks(650));let release,waiting=false;const gate=new Promise(r=>release=r);f.before=c=>{if(c.table==='qb_tasks'&&c.start===250&&c.user==='u1'){waiting=true;return gate;}};const old=q.loadLive();await until(()=>waiting);assert.match(dom.window.document.getElementById('load-progress').textContent,/records loaded/);
 if(change==='organization')await q.switchOrganization('b');else if(change==='account'){f.emit('SIGNED_IN','u2');await until(()=>q.s.org?.id==='b'&&!q.s.loading);}else f.emit('SIGNED_OUT',null);
 release();await old;assert.equal(q.s.org?.id,change==='signout'?undefined:'b');assert(!q.s.tasks.some(t=>t.project_id==='pa'));assert(!dom.window.document.body.textContent.includes('Alpha secret'));
 }finally{dom.window.close();}
});
test('Records repeated by a changing page fail visibly instead of inflating counts',async()=>{
 const {dom,f,q}=await app();try{f.tables.qb_tasks=tasks(500);f.before=c=>{if(c.table==='qb_tasks'&&c.start===250)f.tables.qb_tasks.unshift({...f.tables.qb_tasks[0],id:'earlier'});};await q.loadLive();assert.match(q.s.lastError,/changed while loading/);assert.equal(q.s.tasks.length,0);}finally{dom.window.close();}
});
test('Oversized collections fail visibly without publishing truncated results',async()=>{
 const {dom,f,q}=await app();try{f.tables.qb_tasks=tasks(20001);await q.loadLive();assert.match(q.s.lastError,/too large/);assert.equal(q.s.tasks.length,0);}finally{dom.window.close();}
});
