const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom'),{installFakeSupabase}=require('./session-fixture.cjs');
function setup(){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});const f=installFakeSupabase(dom.window);dom.window.eval(fs.readFileSync(__dirname+'/../dist/app.js','utf8').replace('  init();','  api=window.fixture.api;globalThis.qa={s,loadLive,pagedRows,withRequestDeadline,receiveSession};'));const q=dom.window.qa;q.s.user=f.current;return{dom,f,q};}
test('Exact totals remove terminal page requests without truncating capped responses',async()=>{
 const {dom,f,q}=setup();try{
 await q.loadLive('a');const baseline=f.calls.length;f.calls=[];f.includeCounts=true;await q.loadLive('a');const optimized=f.calls.length;
 assert.equal(q.s.lastError,null);assert(optimized<baseline,`${optimized} vs ${baseline}`);assert.equal(q.s.tasks.length,1);
 console.log(`Workspace requests: ${baseline} → ${optimized}`);
 f.tables.qb_tasks=Array.from({length:101},(_,i)=>({id:'task-'+i,project_id:'pa',title:'Work',status:'backlog'}));f.rowCap=25;f.calls=[];await q.loadLive('a');assert.equal(q.s.tasks.length,101);assert.equal(f.calls.filter(c=>c.table==='qb_tasks').length,5);
 }finally{dom.window.close();}
});
test('A stalled request fails within its deadline and a later request can succeed',async()=>{
 const {dom,q}=setup();try{await assert.rejects(q.withRequestDeadline(new Promise(()=>{}),10),/connection took too long/);assert.equal(await q.withRequestDeadline(Promise.resolve('recovered'),10),'recovered');}finally{dom.window.close();}
});
test('Token refresh during an existing load does not restart and discard that load',async()=>{
 const {dom,f,q}=setup();try{
 // Install the actual auth callback without starting a separate initial load.
 let release;const gate=new Promise(r=>release=r);let queries=0;
 f.before=call=>{if(call.table==='qb_projects'){queries++;return gate;}};
 const load=q.loadLive('a');await new Promise(r=>setTimeout(r,20));
 // receiveSession is exported by the test harness below.
 q.receiveSession('TOKEN_REFRESHED',{user:f.current});release();await load;
 assert.equal(q.s.org.id,'a');assert.equal(q.s.loading,false);assert.equal(queries,2,'one data page and one terminal page with legacy fixture counts');
 }finally{dom.window.close();}
});
