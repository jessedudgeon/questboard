const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function app(){
 const root={innerHTML:'',querySelectorAll:()=>[]};
 const ctx={window:{},document:{getElementById:()=>root,body:{classList:{toggle(){}}},addEventListener(){}},localStorage:{getItem:()=>null},crypto:require('node:crypto').webcrypto,setTimeout,Date,URLSearchParams,location:{origin:'https://projects.dudgeon.io',pathname:'/',search:'?invite=test'}};
 const source=fs.readFileSync(require('node:path').join(__dirname,'../dist/app.js'),'utf8').replace('  init();','  globalThis.qa={s,loadDemo,myTasks,projectPage,taskActions,modalHTML,canManage,render};');
 vm.runInNewContext(source,ctx);return {...ctx.qa,root};
}
test('New backlog tasks are visible on project boards',()=>{const a=app();a.loadDemo();a.s.projectId='p1';a.s.tasks.push({id:'new',project_id:'p1',title:'Newly created',status:'backlog'});assert.match(a.projectPage(),/Newly created/);assert.match(a.projectPage(),/Backlog/);});
test('My Work excludes colleagues assignments except pending review',()=>{const a=app();a.loadDemo();const ids=Array.from(a.myTasks(),t=>t.id);assert(!ids.includes('t1'));assert(!ids.includes('t7'));assert(ids.includes('t3'));assert(ids.includes('t6'));});
test('Organization admin alone does not claim project-management permissions',()=>{const a=app();a.loadDemo();a.s.demo=false;a.s.departmentMembers=[];a.s.projectMembers=[];assert.equal(a.canManage('p1'),false);a.s.projectMembers=[{project_id:'p1',user_id:'demo-user',role:'lead',status:'active'}];assert.equal(a.canManage('p1'),true);});
test('Self approval is unavailable in live mode',()=>{const a=app();a.loadDemo();a.s.demo=false;assert(!a.taskActions({project_id:'p1',status:'in_review',assignee_id:'demo-user',reviewer_id:'demo-user'}).some(([st])=>st==='complete'));});
test('Dialog controls can bubble to delegated handlers',()=>{const a=app();a.loadDemo();a.s.modal='project';assert(!a.modalHTML().includes('stopPropagation'));});
test('Workspace errors provide a retry rather than misleading empty onboarding',()=>{const a=app();a.loadDemo();a.s.org=null;a.s.lastError='<network error>';a.render();assert.match(a.root.innerHTML,/Try again/);assert.match(a.root.innerHTML,/&lt;network error&gt;/);assert(!a.root.innerHTML.includes("almost in"));});
