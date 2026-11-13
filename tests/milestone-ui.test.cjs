const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
function setup(){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
 dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadDemo,milestoneData,milestoneOptions,projectTaskData,calendarData,handleClick,render,invalidateWorkspace};'));
 const q=dom.window.qa;q.loadDemo();q.s.query='';q.s.projectId='p1';
 q.s.milestones=[{id:'m1',project_id:'p1',title:'Delivery',description:'Goal',due_date:'2027-01-10',archived:false,revision:1}];
 q.s.tasks=[{id:'a',project_id:'p1',milestone_id:'m1',title:'Overdue',status:'ready',due_date:'2027-01-01'},
 {id:'b',project_id:'p1',milestone_id:'m1',title:'Past target',status:'blocked',due_date:'2027-01-11'},
 {id:'c',project_id:'p1',milestone_id:'m1',title:'No date',status:'ready'},
 {id:'d',project_id:'p1',milestone_id:'m1',title:'Complete',status:'complete'},
 {id:'e',project_id:'p1',milestone_id:'m1',title:'Cancelled',status:'cancelled'},
 {id:'foreign',project_id:'p2',milestone_id:'m1',title:'Wrong project',status:'ready'},
 {id:'unlinked',project_id:'p1',title:'Unlinked',status:'ready'}];
 return {dom,q};
}
test('Milestone progress and risk use linked visible tasks and exclude closed work from risk',()=>{
 const {dom,q}=setup();try{
  const data=q.milestoneData(q.s.milestones[0],'2027-01-05');
  assert.equal(data.tasks.length,5);assert.equal(data.progress,20);assert.equal(data.cancelled.length,1);assert.equal(data.open.length,3);
  assert.deepEqual(Array.from(data.signals),['1 overdue','1 scheduled past target','1 without a due date','1 blocked']);
  q.s.projectMilestone='m1';assert.deepEqual(Array.from(q.projectTaskData('p1').tasks,t=>t.id).sort(),['a','b','c']);
  q.s.projectClosed=true;assert.equal(q.projectTaskData('p1').tasks.length,5);
  q.s.milestones[0].archived=true;assert.doesNotMatch(q.milestoneOptions('p1'),/Delivery/);assert.match(q.milestoneOptions('p1','m1'),/archived/);
 }finally{dom.window.close();}
});
test('Milestone calendar navigation, filters, escaping and workspace reset',async()=>{
 const {dom,q}=setup();try{
  q.s.milestones[0].title='<img src=x>';q.s.calendarMonth='2027-01-01';q.s.nav='calendar';q.render();
  assert.equal(dom.window.document.querySelectorAll('.milestone-target img').length,0);
  dom.window.document.querySelector('.milestone-target').click();assert.equal(q.s.nav,'milestone');
  assert.match(dom.window.document.querySelector('.page').textContent,/Based on visible tasks/);
  q.s.calendarScope='mine';assert(!q.calendarData().events.some(e=>e.kind==='milestone'));
  q.s.calendarScope='all';q.s.workspace='fac';assert(!q.calendarData().events.some(e=>e.kind==='milestone'));
  q.s.workspace='all';q.s.milestones[0].archived=true;assert(!q.calendarData().events.some(e=>e.kind==='milestone'));
  q.s.calendarClosed=true;assert(q.calendarData().events.some(e=>e.kind==='milestone'));
  q.invalidateWorkspace();assert.equal(q.s.milestones.length,0);assert.equal(q.s.milestoneId,null);assert.equal(q.s.projectMilestone,'all');
 }finally{dom.window.close();}
});
