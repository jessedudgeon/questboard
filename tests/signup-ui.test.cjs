const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{installFakeSupabase}=require('./session-fixture.cjs');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out');}
async function setup(){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'}),f=installFakeSupabase(dom.window);f.tables.qb_org_members=[];
 dom.window.eval(source.replace('  init();','  globalThis.qa={s,handleForm,handleClick,signOut};\n  init();'));
 await until(()=>!dom.window.qa.s.loading);return{dom,f,q:dom.window.qa};
}
test('New user creates organization, receives department setup and retries without duplicate requests',async()=>{const {dom,f,q}=await setup();try{
 const doc=dom.window.document,form=doc.querySelector('[data-form="organization"]');assert(form);form.querySelector('[name="name"]').value='New team';
 const rpc=f.api.rpc,calls=[];let fail=true;
 f.api.rpc=(name,args)=>{if(name!=='qb_create_organization')return rpc(name,args);calls.push(args);if(fail)return Promise.resolve({error:{message:'Temporary connection problem'}});f.tables.qb_organizations.push({id:'new',name:args.p_name});f.tables.qb_org_members.push({org_id:'new',user_id:'u1',role:'admin',status:'active'});return Promise.resolve({data:'new'});};
 await q.handleForm(form);assert.match(form.textContent,/Temporary connection/);assert.equal(form.querySelector('[name="name"]').value,'New team');assert.equal(form.querySelector('button').disabled,false);
 fail=false;await q.handleForm(form);assert.equal(calls[0].p_request,calls[1].p_request);assert.equal(q.s.org.id,'new');assert.equal(q.s.orgMembership.role,'admin');assert.equal(q.s.nav,'admin');assert.equal(q.s.modal,'department');assert(doc.querySelector('[data-form="department"]'));
 assert.match(doc.body.textContent,/Add your first department/);
 }finally{dom.window.close();}});
test('Duplicate clicks are held and late signup completion cannot restore a signed-out account',async()=>{const {dom,f,q}=await setup();try{
 const form=dom.window.document.querySelector('[data-form="organization"]');form.querySelector('[name="name"]').value='New team';let release,calls=0;
 f.api.rpc=()=>{calls++;return new Promise(r=>release=r);};const pending=q.handleForm(form);await q.handleForm(form);assert.equal(calls,1);assert(form.querySelector('button').disabled);
 await q.signOut();release({data:'new'});await pending;assert.equal(q.s.user,null);assert.equal(q.s.org,null);
 }finally{dom.window.close();}});
test('Signed-out signup uses existing OAuth and an existing user can create another organization',async()=>{const {dom,f,q}=await setup();try{
 f.tables.qb_org_members=[{org_id:'a',user_id:'u1',role:'admin',status:'active'}];f.emit('TOKEN_REFRESHED','u1');await until(()=>q.s.org?.id==='a'&&!q.s.loading);
 const select=dom.window.document.getElementById('organization-select');select.value='__create__';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert(dom.window.document.querySelector('.modal-cover [data-form="organization"]'));
 await q.signOut();await q.handleClick({dataset:{action:'signup-mode'}});assert.match(dom.window.document.body.textContent,/Create your account/);assert.match(dom.window.document.body.textContent,/Continue with Google/);
 }finally{dom.window.close();}});
