const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{installFakeSupabase}=require('./session-fixture.cjs');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
function demo(){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadDemo,handleClick,handleForm,setDependency,taskActions,dependencyPanel,render,readAuthReturn};'));const q=dom.window.qa;q.loadDemo();return{dom,q};}
test('Demo linking blocks work, navigates in both directions, and removal unblocks it',async()=>{
 const {dom,q}=demo();try{q.s.taskId='t3';q.s.nav='task';await q.setDependency('t3','t1',true);q.render();assert(!q.taskActions(q.s.tasks.find(t=>t.id==='t3')).some(([st])=>st==='in_progress'));assert.match(q.dependencyPanel(q.s.tasks.find(t=>t.id==='t3')),/Waiting for prerequisites/);assert.match(q.dependencyPanel(q.s.tasks.find(t=>t.id==='t1')),/Upgrade Lafayette core firmware/);await q.handleClick({dataset:{action:'task',id:'t1'}});assert.equal(q.s.taskId,'t1');await q.setDependency('t3','t1',false);assert(q.taskActions(q.s.tasks.find(t=>t.id==='t3')).some(([st])=>st==='in_progress'));}finally{dom.window.close();}
});
test('Demo refuses self/circular/cross-project links and permits completed prerequisites',async()=>{
 const {dom,q}=demo();try{await assert.rejects(()=>q.setDependency('t3','t3',true),/circular/);await assert.rejects(()=>q.setDependency('t3','t5',true),/same project/);q.s.tasks.find(t=>t.id==='t1').status='ready';await q.setDependency('t3','t1',true);await assert.rejects(()=>q.setDependency('t1','t3',true),/circular/);q.s.tasks.find(t=>t.id==='t1').status='complete';assert(q.taskActions(q.s.tasks.find(t=>t.id==='t3')).some(([st])=>st==='in_progress'));}finally{dom.window.close();}
});
test('Readiness blocks hidden prerequisites without rendering their identifiers or controls',()=>{
 const {dom,q}=demo();try{q.s.demo=false;q.s.departmentMembers=[];q.s.projectMembers=[];q.s.dependencyReadiness=[{task_id:'t3',waiting:true}];q.s.dependencies=[];q.s.tasks.find(t=>t.id==='t3').assignee_id=q.s.user.id;const html=q.dependencyPanel(q.s.tasks.find(t=>t.id==='t3'));assert.match(html,/Waiting for prerequisites/);assert(!html.includes('data-form="dependency"'));assert(!q.taskActions(q.s.tasks.find(t=>t.id==='t3')).some(([st])=>st==='in_progress'));}finally{dom.window.close();}
});
async function linkedApp(url,setup=()=>{}){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url,runScripts:'outside-only'});const f=installFakeSupabase(dom.window);
 const org='10000000-0000-0000-0000-000000000001',task='20000000-0000-0000-0000-000000000001';
 for(const table of Object.values(f.tables))for(const row of table){if(row.org_id==='a')row.org_id=org;if(row.id==='a')row.id=org;if(row.id==='ta')row.id=task;if(row.task_id==='ta')row.task_id=task;}
 setup(dom.window,f);dom.window.eval(source.replace('  init();','  globalThis.qa={s,readAuthReturn};\n  init();'));
 for(let i=0;i<200&&dom.window.qa.s.loading;i++)await new Promise(r=>setTimeout(r,5));return{dom,f,q:dom.window.qa,org,task};
}
const url='https://projects.dudgeon.io/?org=10000000-0000-0000-0000-000000000001&task=20000000-0000-0000-0000-000000000001';
test('Direct task link selects an authorized organization and opens the task',async()=>{const {dom,q,org,task}=await linkedApp(url);try{assert.equal(q.s.org.id,org);assert.equal(q.s.taskId,task);assert.equal(q.s.nav,'task');assert.equal(dom.window.sessionStorage.getItem('qb-task-link'),null);}finally{dom.window.close();}});
test('Task navigation intent survives a clean OAuth redirect but never grants access',async()=>{
 const intent={org:'10000000-0000-0000-0000-000000000001',task:'20000000-0000-0000-0000-000000000001'};
 const {dom,q}=await linkedApp('https://projects.dudgeon.io/',(w,f)=>{w.sessionStorage.setItem('qb-task-link',JSON.stringify(intent));f.tables.qb_tasks=f.tables.qb_tasks.filter(t=>t.id!==intent.task);});try{assert.equal(q.s.nav,'home');assert.equal(q.s.taskId,null);assert.match(dom.window.document.getElementById('toast').textContent,/unavailable to your account/);}finally{dom.window.close();}
});
