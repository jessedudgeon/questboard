const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
function app(){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
 dom.window.eval(fs.readFileSync(__dirname+'/../dist/app.js','utf8').replace('  init();','  globalThis.qa={s,membership,loadDemo,loadMemberships,membershipPanel,handleForm,setApi(x){api=x;}};'));
 const q=dom.window.qa;q.loadDemo();q.s.demo=false;q.s.nav='admin';q.s.orgMembership={role:'admin',status:'active'};return{dom,q};}
function api(rpc){return{rpc,from(){return{select(){return this;},eq(){return this;},order(){return this;},limit(){return Promise.resolve({data:[]});}};}};}
test('Membership controls escape names, include suspended members and offer no removal action',async()=>{
 const {dom,q}=app();try{q.setApi(api(async()=>({data:[{user_id:'sam',display_name:'<img src=x onerror=alert(1)>',role:'viewer',status:'suspended',org_status:'active'}]})));
 await q.loadMemberships('department:it');const html=q.membershipPanel();assert(html.includes('&lt;img'));assert(!html.includes('<img src=x'));assert(html.includes('Reinstate'));assert(!html.includes('value="remove"'));
 }finally{dom.window.close();}
});
test('Old scope response and directory failure cannot expose stale administration controls',async()=>{
 const {dom,q}=app();try{const resolves={};q.setApi(api((name,args)=>new Promise(resolve=>resolves[args.p_scope]=resolve)));
 const a=q.loadMemberships('department:it'),b=q.loadMemberships('project:p1');resolves.p1({data:[],error:{message:'Directory unavailable'}});await b;
 resolves.it({data:[{user_id:'sam',display_name:'Old',role:'viewer',status:'active'}]});await a;
 assert.equal(q.membership.scope,'project:p1');assert.equal(q.membership.rows.length,0);assert(q.membershipPanel().includes('Directory unavailable'));assert(!q.membershipPanel().includes('data-form="membership"'));
 }finally{dom.window.close();}
});
test('Membership submit sends expected state; rejected mutation leaves data unchanged',async()=>{
 const {dom,q}=app();try{const calls=[];q.setApi(api(async(name,args)=>{calls.push({name,args});return name==='qb_membership_directory'?{data:[{user_id:'sam',display_name:'Sam',role:'viewer',status:'active',org_status:'active'}]}:{error:{message:'Membership changed; reload before saving'}};}));
 await q.loadMemberships('department:it');const form=dom.window.document.querySelector('form[data-form="membership"]');form.querySelector('[name="action"]').value='suspend';await q.handleForm(form);
 assert.equal(calls.at(-1).name,'qb_manage_membership');assert.equal(calls.at(-1).args.p_expected_role,'viewer');assert.equal(calls.at(-1).args.p_expected_status,'active');assert.equal(q.membership.rows[0].status,'active');
 }finally{dom.window.close();}
});
