const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{installFakeSupabase}=require('./session-fixture.cjs');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out');}
async function app(){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});const f=installFakeSupabase(dom.window);dom.window.eval(source.replace('  init();','  globalThis.qa={s,membership,loadMemberships,loadAssignmentCandidates,handleClick};\n  init();'));const q=dom.window.qa;await until(()=>q.s.org&&!q.s.loading);return{dom,f,q};}
const people=n=>Array.from({length:n},(_,i)=>({user_id:'person-'+String(i).padStart(5,'0'),display_name:'Member '+String(i).padStart(5,'0'),role:'viewer',status:'active',org_status:'active'}));
test('Assignment and membership directories retain >1,000 eligible people under smaller server caps',async()=>{
 const {dom,f,q}=await app();try{f.rowCap=47;f.rpcRows.qb_assignment_candidates=people(1105);f.rpcRows.qb_membership_directory=people(1105);await q.handleClick({dataset:{action:'modal',value:'task'}});assert.equal(q.s.candidateRows.length,1105);assert.equal(dom.window.document.querySelectorAll('[name="assignee_id"] option').length,1106);assert.equal(q.s.candidateRows.at(-1).user_id,'person-01104');await q.loadMemberships('department:da');assert.equal(q.membership.rows.length,1105);assert(q.membership.loaded);for(const call of f.calls.filter(c=>c.rpc==='qb_assignment_candidates'))assert.equal(call.args.p_project,'pa');}finally{dom.window.close();}
});
for(const kind of ['assignment','membership']){
 test(`${kind} page failure exposes no partial controls and supports retry`,async()=>{
  const {dom,f,q}=await app();try{const rpc=kind==='assignment'?'qb_assignment_candidates':'qb_membership_directory';f.rpcRows[rpc]=people(601);f.before=c=>{if(c.rpc===rpc&&c.start===250)throw Error('Page unavailable');};
   if(kind==='assignment'){await q.handleClick({dataset:{action:'modal',value:'task'}});assert.equal(q.s.candidateRows.length,0);assert(q.s.candidateError);assert(dom.window.document.querySelector('form[data-form="task"] [type="submit"]').disabled);f.before=null;await q.loadAssignmentCandidates('pa');assert.equal(q.s.candidateRows.length,601);assert(!dom.window.document.querySelector('form[data-form="task"] [type="submit"]').disabled);}
   else{await q.loadMemberships('department:da');assert.equal(q.membership.rows.length,0);assert(!q.membership.loaded);assert.match(q.membership.error,/Page unavailable/);f.before=null;await q.loadMemberships('department:da');assert.equal(q.membership.rows.length,601);assert(q.membership.loaded);}
  }finally{dom.window.close();}
 });
 test(`${kind} scope change cancels remaining pages of the previous request`,async()=>{
  const {dom,f,q}=await app();try{const rpc=kind==='assignment'?'qb_assignment_candidates':'qb_membership_directory';f.rpcRows[rpc]=args=>(args.p_project==='pa'||args.p_scope==='da')?people(751):[];let release,waiting=false;const gate=new Promise(r=>release=r);f.before=c=>{if(c.rpc===rpc&&c.start===250){waiting=true;return gate;}};
   const old=kind==='assignment'?q.loadAssignmentCandidates('pa'):q.loadMemberships('department:da');await until(()=>waiting);
   if(kind==='assignment')await q.loadAssignmentCandidates('pb');else await q.loadMemberships('project:pa');release();await old;
   assert.equal(kind==='assignment'?q.s.candidateRows.length:q.membership.rows.length,0);assert(!f.calls.some(c=>c.rpc===rpc&&c.start===500));
  }finally{dom.window.close();}
 });
}
