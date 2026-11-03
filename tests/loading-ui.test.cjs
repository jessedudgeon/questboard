const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{installFakeSupabase}=require('./session-fixture.cjs');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out waiting for application');}
async function app(){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});const f=installFakeSupabase(dom.window);dom.window.eval(source.replace('  init();','  globalThis.qa={s,membership,loadLive,switchOrganization,receiveSession,signOut,loadAssignmentCandidates,loadMemberships,handleForm,handleClick};\n  init();'));const q=dom.window.qa;await until(()=>q.s.org?.id==='a'&&!q.s.loading);return{dom,f,q};}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};}
test('Refresh stays inside the content region and navigation remains usable',async()=>{const {dom,f,q}=await app();try{
 const doc=dom.window.document,shell=doc.querySelector('.shell'),topbar=doc.querySelector('.topbar'),page=doc.querySelector('.page');
 const gate=deferred();let waiting=false;f.before=c=>{if(c.table==='qb_projects'){waiting=true;return gate.promise;}};
 const pending=q.loadLive();await until(()=>waiting);
 assert.equal(doc.querySelector('.shell'),shell);assert.equal(doc.querySelector('.topbar'),topbar);assert.equal(doc.querySelector('.page'),page);
 assert.equal(doc.querySelector('.boot'),null);assert.equal(page.getAttribute('aria-busy'),'true');assert(page.querySelector('#load-progress'));
 assert(!doc.body.textContent.includes('Alpha secret'));
 await q.handleClick({dataset:{action:'nav',value:'calendar'}});assert.equal(q.s.nav,'calendar');assert(page.querySelector('#load-progress'));
 gate.resolve();await pending;assert.equal(doc.querySelector('.page'),page);assert.equal(page.getAttribute('aria-busy'),'false');assert(doc.querySelector('#calendar-project'));
 }finally{dom.window.close();}});
test('Refresh failure and organization switch retain shell without exposing previous data',async()=>{const {dom,f,q}=await app();try{
 const doc=dom.window.document,shell=doc.querySelector('.shell');
 f.before=c=>{if(c.table==='qb_projects')throw Error('Connection interrupted');};await q.loadLive();
 assert.equal(doc.querySelector('.shell'),shell);assert(doc.querySelector('.page [role="alert"]'));assert(!doc.body.textContent.includes('Alpha secret'));
 f.before=null;await q.switchOrganization('b');assert.equal(doc.querySelector('.shell'),shell);assert.equal(q.s.org.id,'b');assert(!doc.body.textContent.includes('Alpha secret'));
 await q.signOut();assert.equal(doc.querySelector('.shell'),null);
 }finally{dom.window.close();}});
