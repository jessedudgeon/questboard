const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function app(){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io/',runScripts:'outside-only'});
 const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8').replace('  init();','  globalThis.qa={s,loadDemo,handleClick,handleForm,loadAssignmentCandidates,memberOptions,setApi(value){api=value;}};');
 dom.window.eval(source);
 const qa=dom.window.qa;qa.loadDemo();qa.s.demo=false;qa.s.projectId='p1';
 return {dom,qa,doc:dom.window.document};
}
function modal(value){return {dataset:{action:'modal',value}};}
test('Project change preserves draft text, clears old assignee and refreshes eligible choices',async()=>{
 const {dom,qa,doc}=app();
 try{
  const calls=[];qa.setApi({rpc:async(name,args)=>{calls.push([name,args]);return {data:[{user_id:args.p_project==='p1'?'sam':'eve',display_name:args.p_project==='p1'?'Sam':'Eve'}]};}});
  await qa.handleClick(modal('task'));
  const title=doc.querySelector('[name="title"]'),description=doc.querySelector('[name="description"]');
  title.value='Preserve my draft';description.value='Unfinished notes';doc.querySelector('[name="assignee_id"]').value='sam';
  const project=doc.getElementById('task-project-select');project.value='p2';project.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,0));
  assert.equal(title.value,'Preserve my draft');assert.equal(description.value,'Unfinished notes');
  const assignee=doc.querySelector('[name="assignee_id"]');assert.equal(assignee.value,'');
  assert.deepEqual([...assignee.options].map(o=>o.value),['','eve']);
  assert.equal(calls.at(-1)[1].p_project,'p2');assert.equal(doc.querySelector('[type="submit"]').disabled,false);
 }finally{dom.window.close();}
});
test('Out-of-order directory replies cannot restore candidates from a previous project',async()=>{
 const {dom,qa,doc}=app();
 try{
  const replies={};qa.setApi({rpc:(name,args)=>new Promise(resolve=>{replies[args.p_project]=resolve;})});
  const first=qa.handleClick(modal('task'));
  const second=qa.loadAssignmentCandidates('p2');
  replies.p2({data:[{user_id:'eve',display_name:'Eve'}]});await second;
  replies.p1({data:[{user_id:'sam',display_name:'Sam'}]});await first;
  assert.equal(qa.s.candidateProject,'p2');assert.deepEqual(Array.from(qa.s.candidateRows,p=>p.user_id),['eve']);
  assert(!doc.querySelector('[name="assignee_id"]').innerHTML.includes('sam'));
 }finally{dom.window.close();}
});
test('Directory failure blocks save and does not fall back to an organization-wide list',async()=>{
 const {dom,qa,doc}=app();
 try{
  qa.setApi({rpc:async()=>({error:{message:'Unavailable'}})});await qa.handleClick(modal('task'));
  assert.equal(doc.querySelector('[type="submit"]').disabled,true);
  assert.deepEqual([...doc.querySelector('[name="assignee_id"]').options].map(o=>o.value),['']);
  assert.match(doc.getElementById('candidate-status').textContent,/Unable to load/);
 }finally{dom.window.close();}
});
test('Restricted-task edit sends task scope, escapes names and preserves an unavailable historical assignment',async()=>{
 const {dom,qa,doc}=app();
 try{
  qa.s.taskId='t1';let argsSeen;
  qa.setApi({rpc:async(name,args)=>{argsSeen=args;return {data:[{user_id:'demo-user',display_name:'<script>bad()</script>'}]};}});
  await qa.handleClick(modal('edit-task'));
  assert.equal(argsSeen.p_task,'t1');assert.equal(argsSeen.p_project,'p1');
  assert.equal(doc.querySelector('[name="assignee_id"]').value,'sam');
  assert.match(doc.querySelector('[name="assignee_id"]').textContent,/Unavailable/);
  assert.equal(doc.querySelectorAll('script').length,0);
  const fd=new dom.window.FormData(doc.querySelector('form'));
  assert.equal(fd.get('assignee_id'),'sam','unavailable existing value must not silently clear');
 }finally{dom.window.close();}
});
test('Closing modal invalidates a pending directory response',async()=>{
 const {dom,qa,doc}=app();
 try{
  let reply;qa.setApi({rpc:()=>new Promise(resolve=>{reply=resolve;})});
  const opening=qa.handleClick(modal('task'));await qa.handleClick({dataset:{action:'close-modal'}});
  reply({data:[{user_id:'sam',display_name:'Sam'}]});await opening;
  assert.equal(qa.s.modal,null);assert.equal(doc.querySelector('form'),null);assert.equal(qa.s.candidateRows.length,0);
 }finally{dom.window.close();}
});
