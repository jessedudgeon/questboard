const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
function app(){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
  dom.window.eval(fs.readFileSync(__dirname+'/../dist/app.js','utf8').replace('  init();','  globalThis.qa={s,loadDemo,deliveryData,deliveryHTML,deliveryTimeline,deliveryTaskGroups,deliveryDateSort};'));
  dom.window.qa.loadDemo();
  dom.window.qa.s.deliveryProject='p1';
  dom.window.qa.s.milestones=[
    {id:'later',project_id:'p1',title:'Final cutover',due_date:'2026-12-20',archived:false},
    {id:'undated',project_id:'p1',title:'Unscheduled follow-up',due_date:null,archived:false},
    {id:'earlier',project_id:'p1',title:'Restore service',due_date:'2026-12-05',archived:false},
    {id:'archived',project_id:'p1',title:'Archived milestone',due_date:'2026-11-30',archived:true},
    {id:'foreign',project_id:'p2',title:'Other project milestone',due_date:'2026-11-01',archived:false}
  ];
  dom.window.qa.s.tasks=[
    {id:'step-b',project_id:'p1',milestone_id:'earlier',title:'B: Reconnect',due_date:'2026-12-04',status:'ready'},
    {id:'step-a',project_id:'p1',milestone_id:'earlier',title:'A: Verify',due_date:'2026-12-01',status:'complete'},
    {id:'step-z',project_id:'p1',milestone_id:'later',title:'Cutover phones',due_date:'2026-12-10',status:'blocked'},
    {id:'step-missing',project_id:'p1',milestone_id:'later',title:'Missing due date',due_date:null,status:'ready'},
    {id:'unlinked',project_id:'p1',milestone_id:null,title:'Unlinked task',due_date:'2026-12-08',status:'ready'},
    {id:'archived-task',project_id:'p1',milestone_id:'archived',title:'Archived-milestone task',due_date:'2026-12-07',status:'ready'},
    {id:'secret',project_id:'p2',milestone_id:'earlier',title:'DO NOT SHOW FOREIGN TASK',due_date:'2026-12-01',status:'ready'}
  ];
  return {dom,q:dom.window.qa};
}
test('Report milestones sort by end date and tasks group chronologically within each milestone',()=>{
  const {dom,q}=app();try{
    const r=q.deliveryData(new Date('2026-12-02T12:00:00'))[0];
    assert.deepEqual(Array.from(r.milestones,m=>m.id),['earlier','later','undated']);
    assert.deepEqual(Array.from(r.taskGroups,g=>g.milestone?.id||null),['earlier','later','undated',null]);
    assert.deepEqual(Array.from(r.taskGroups[0].tasks,t=>t.id),['step-a','step-b']);
    assert.deepEqual(Array.from(r.taskGroups[1].tasks,t=>t.id),['step-z','step-missing']);
    assert.deepEqual(Array.from(r.taskGroups[3].tasks,t=>t.id),['archived-task','unlinked']);
    assert(!r.taskGroups.some(g=>g.tasks.some(t=>t.id==='secret')));
  }finally{dom.window.close();}
});
test('Schedule and detailed HTML nest tasks under ordered milestone steps and keep other work last',()=>{
  const {dom,q}=app();try{
    q.s.deliveryType='schedule';
    const doc=new JSDOM(q.deliveryHTML()).window.document;
    assert.deepEqual(Array.from(doc.querySelectorAll('.dr-task-group h4'),h=>h.textContent),[
      'Step 1: Restore service','Step 2: Final cutover',
      'Step 3: Unscheduled follow-up','Other tasks · No active milestone'
    ]);
    assert.deepEqual(Array.from(doc.querySelectorAll('.dr-task-group')[0].querySelectorAll('tbody tr'),tr=>tr.cells[0].textContent),[
      'A: Verify','B: Reconnect'
    ]);
    assert.match(doc.querySelectorAll('.dr-task-group')[1].textContent,/Milestone end:/);
    assert.match(doc.querySelectorAll('.dr-task-group')[2].textContent,/Not scheduled/);
    assert.match(doc.querySelectorAll('.dr-task-group')[2].textContent,/No tasks linked/);
    assert(!doc.body.textContent.includes('DO NOT SHOW FOREIGN TASK'));
    q.s.deliveryType='detailed';
    const detailed=new JSDOM(q.deliveryHTML()).window.document;
    assert.equal(detailed.querySelectorAll('.dr-task-group').length,4);
    assert.match(detailed.body.textContent,/Project update history/);
  }finally{dom.window.close();}
});
test('Executive stays concise and timeline respects milestone-group sequence',()=>{
  const {dom,q}=app();try{
    q.s.deliveryType='executive';
    const executive=new JSDOM(q.deliveryHTML()).window.document;
    assert.equal(executive.querySelectorAll('.dr-task-group').length,0);
    assert.deepEqual(Array.from(executive.querySelectorAll('.dr-project .dr-table tbody tr'),tr=>tr.cells[0].textContent),[
      'Restore service','Final cutover','Unscheduled follow-up'
    ]);
    q.s.deliveryType='schedule';
    const r=q.deliveryData()[0];
    const chart=new JSDOM(q.deliveryTimeline(r)).window.document;
    const labels=Array.from(chart.querySelectorAll('svg text'),e=>e.textContent);
    const first=labels.indexOf('A: Verify'),second=labels.indexOf('B: Reconnect'),milestone=labels.indexOf('Restore service');
    assert(first>=0&&second>first&&milestone>second);
    const later=labels.indexOf('Cutover phones');
    assert(later>milestone);
    assert(!labels.includes('DO NOT SHOW FOREIGN TASK'));
  }finally{dom.window.close();}
});
