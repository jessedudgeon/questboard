const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{installFakeSupabase}=require('./session-fixture.cjs');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
const invitation='10000000-0000-0000-0000-000000000001';
async function app(url='https://projects.dudgeon.io/',setup=()=>{}){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url,runScripts:'outside-only'});
 const f=installFakeSupabase(dom.window);f.current=null;dom.window.QUESTBOARD_CONFIG.authProviders={google:true,azure:false};setup(dom.window,f);
 dom.window.eval(source.replace('  init();','  globalThis.qa={s,startSignIn,readAuthReturn,invitationNotice,handleClick,render};\n  init();'));
 await new Promise(r=>setTimeout(r,0));return{dom,f,q:dom.window.qa};
}
test('OAuth failure is persistent, generic and removed from URL without removing invitation',async()=>{
 const {dom,q}=await app(`https://projects.dudgeon.io/?invite=${invitation}&error_description=secret# error`.replace('# error','#error=access_denied&error_description=%3Cscript%3Esecret%3C/script%3E'));
 try{q.render();assert.match(dom.window.document.querySelector('[role="alert"]').textContent,/Sign-in was not completed/);assert(!dom.window.document.body.textContent.includes('secret'));assert(!dom.window.location.href.includes('error'));assert.equal(new URL(dom.window.location.href).searchParams.get('invite'),invitation);assert.match(dom.window.document.body.textContent,/email address that received/);}finally{dom.window.close();}
});
test('Successful OAuth callback tokens are untouched for SDK processing',async()=>{
 const hash='#access_token=synthetic&refresh_token=synthetic&type=bearer';const {dom}=await app('https://projects.dudgeon.io/'+hash);
 try{assert.equal(dom.window.location.hash,hash);assert.equal(dom.window.document.querySelector('[role="alert"]'),null);}finally{dom.window.close();}
});
test('Unavailable and unknown providers cannot initiate OAuth',async()=>{
 const {dom,f,q}=await app();try{let calls=0;f.api.auth.signInWithOAuth=async()=>{calls++;return{};};assert(dom.window.document.querySelector('[data-value="azure"]').disabled);await q.startSignIn('azure');await q.startSignIn('untrusted');assert.equal(calls,0);assert.match(dom.window.document.body.textContent,/not available yet/);}finally{dom.window.close();}
});
test('Google redirect stays on QuestBoard, pending attempts are deduplicated, and failures permit retry',async()=>{
 const {dom,f,q}=await app('https://projects.dudgeon.io/?redirect=https://evil.invalid');try{
  let release,calls=[];f.api.auth.signInWithOAuth=args=>{calls.push(args);return new Promise(r=>release=r);};
  const pending=q.startSignIn('google');assert(dom.window.document.querySelector('[data-value="google"]').disabled);await q.startSignIn('google');assert.equal(calls.length,1);assert.equal(calls[0].options.redirectTo,'https://projects.dudgeon.io/');release({error:{message:'sensitive provider failure'}});await pending;
  assert.match(dom.window.document.querySelector('[role="alert"]').textContent,/Unable to start sign-in/);assert(!dom.window.document.body.textContent.includes('sensitive'));assert(!dom.window.document.querySelector('[data-value="google"]').disabled);
  f.api.auth.signInWithOAuth=async()=>({error:null});await q.startSignIn('google');assert.equal(dom.window.document.querySelector('[role="alert"]'),null);
 }finally{dom.window.close();}
});
test('Invitation intent survives clean callback and does not expose or accept unknown invitations',async()=>{
 const {dom,f,q}=await app(`https://projects.dudgeon.io/?invite=${invitation}`);try{
  dom.window.history.replaceState(null,'','/');q.readAuthReturn();assert.equal(dom.window.sessionStorage.getItem('qb-pending-invitation'),invitation);
  q.s.user={id:'different',email:'different@example.invalid'};assert.match(q.invitationNotice(),/not available to this account/);assert(!q.invitationNotice().includes('data-action="accept-invite"'));assert(!f.calls.some(c=>c.rpc==='qb_accept_invitation'));
  q.s.pendingInvitations=[{id:invitation,invite_role:'member',org_name:'Test organization'}];assert.match(q.invitationNotice(),/listed below/);await q.handleClick({dataset:{action:'dismiss-invite'}});assert.equal(q.invitationNotice(),'');assert.equal(dom.window.sessionStorage.getItem('qb-pending-invitation'),null);
 }finally{dom.window.close();}
});
test('Malformed invitation is ignored and blocked storage does not prevent sign-in',async()=>{
 const {dom,q}=await app('https://projects.dudgeon.io/?invite=%3Cscript%3E',w=>{Object.defineProperty(w,'sessionStorage',{get(){throw Error('blocked');}});});try{assert.equal(q.invitationNotice(),'');assert.match(dom.window.document.body.textContent,/Continue with Google/);}finally{dom.window.close();}
});
test('Startup SDK failure provides persistent recovery without raw error details',async()=>{
 const {dom}=await app(undefined,(w,f)=>{f.api.auth.getSession=async()=>({error:Error('private detail')});});try{assert.match(dom.window.document.querySelector('[role="alert"]').textContent,/Unable to restore/);assert(!dom.window.document.body.textContent.includes('private detail'));}finally{dom.window.close();}
});
