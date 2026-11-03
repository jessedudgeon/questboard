const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
function setup(){
 const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
 dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadDemo,calendarDate,calendarData,calendarPage,handleClick,render,invalidateWorkspace};'));
 const q=dom.window.qa;q.loadDemo();q.s.nav='calendar';q.s.calendarMonth='2028-02-01';q.s.query='';
 q.s.projects=[{id:'p1',department_id:'d1',title:'Project One',status:'active',target_date:'2028-02-29'},{id:'p2',department_id:'d2',title:'Project Two',status:'complete',target_date:'2028-02-28'}];
 q.s.tasks=[{id:'a',project_id:'p1',title:'Leap day task',status:'ready',due_date:'2028-02-29',assignee_id:q.s.user.id},{id:'b',project_id:'p2',title:'Finished task',status:'complete',due_date:'2028-02-28'},{id:'c',project_id:'p1',title:'Needs scheduling',status:'backlog'},{id:'d',project_id:'p1',title:'Overdue task',status:'blocked',due_date:'2000-01-01'},{id:'hidden',project_id:'missing',title:'Not loaded project',due_date:'2028-02-29',status:'ready'}];
 return{dom,q};
}
test('Calendar retains date-only values, validates leap days, and handles year navigation',async()=>{
 const {dom,q}=setup();try{assert.equal(q.calendarDate('2028-02-29').getDate(),29);assert.equal(q.calendarDate('2027-02-29'),null);assert.equal(q.calendarDate('2028-02-31'),null);assert.equal(q.calendarDate('2028-02-29T00:00:00Z'),null);
 q.render();assert.equal(dom.window.document.querySelectorAll('.calendar-day').length,29);assert.equal(dom.window.document.querySelectorAll('.calendar-event').length,2);
 q.s.calendarMonth='2028-12-01';await q.handleClick({dataset:{action:'calendar-month',value:'1'}});assert.equal(q.s.calendarMonth,'2029-01-01');await q.handleClick({dataset:{action:'calendar-month',value:'-1'}});assert.equal(q.s.calendarMonth,'2028-12-01');
 }finally{dom.window.close();}
});
test('Calendar filters respect visible projects, department, assignment, search and finished work',()=>{
 const {dom,q}=setup();try{let data=q.calendarData();assert.equal(data.events.length,3);assert.equal(data.overdue.length,1);assert.equal(data.undated.length,1);assert(!data.tasks.some(t=>t.id==='hidden'));
 q.s.calendarClosed=true;assert.equal(q.calendarData().events.length,5);
 q.s.calendarScope='mine';data=q.calendarData();assert.equal(data.events.length,1);assert.equal(data.events[0].id,'a');
 q.s.calendarScope='all';q.s.workspace='d1';q.s.calendarProject='p2';data=q.calendarData();assert.equal(q.s.calendarProject,'all');assert(!data.events.some(e=>e.id==='p2'||e.id==='b'));
 q.s.query='Leap';data=q.calendarData();assert.equal(data.events.length,1);assert.equal(data.events[0].id,'a');
 }finally{dom.window.close();}
});
test('Calendar controls filter work, escape titles, open records and clear state on identity change',async()=>{
 const {dom,q}=setup();try{q.s.tasks[0].title='<img src=x onerror=alert(1)>';q.render();assert.equal(dom.window.document.querySelectorAll('.calendar-event img').length,0);
 const select=dom.window.document.querySelector('#calendar-scope');select.value='mine';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(dom.window.document.querySelectorAll('.calendar-event').length,1);
 dom.window.document.querySelector('.calendar-event').click();assert.equal(q.s.nav,'task');assert.equal(q.s.taskId,'a');
 q.s.calendarProject='p1';q.s.calendarClosed=true;q.invalidateWorkspace();assert.equal(q.s.calendarProject,'all');assert.equal(q.s.calendarScope,'all');assert.equal(q.s.calendarMonth,null);assert.equal(q.s.calendarClosed,false);assert.equal(q.s.tasks.length,0);
 }finally{dom.window.close();}
});
test('Empty months explain filters; overdue and undated lists retain work outside the current month',()=>{
 const {dom,q}=setup();try{q.s.calendarMonth='2029-01-01';q.render();assert.match(dom.window.document.querySelector('.calendar-empty').textContent,/No matching deadlines/);assert.match(dom.window.document.querySelector('.calendar-followup').textContent,/Overdue task/);assert.match(dom.window.document.querySelector('.calendar-followup').textContent,/Needs scheduling/);
 }finally{dom.window.close();}
});
