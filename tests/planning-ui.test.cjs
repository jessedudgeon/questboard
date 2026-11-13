const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function setup(){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});dom.window.eval(fs.readFileSync(__dirname+'/../dist/app.js','utf8').replace('  init();','  globalThis.qa={s,loadDemo,weeklyWorkload,effectivePlanning,handleClick,handleForm,render,workloadCSV,deliveryTimeline,deliveryTimelineEntries,portfolioReport,vendorSummary,readPlan};'));const q=dom.window.qa;q.loadDemo();q.s.query='';q.s.workspace='all';q.s.workloadWeek='2027-01-04';q.s.tasks=[];return{dom,q};}
test('Weekly hours split across workweeks, remaining work, invited owners and missing estimates',()=>{
 const {dom,q}=setup();try{
 const user=q.s.user.id;
 q.s.tasks=[{id:'a',project_id:'p1',title:'Two weeks',status:'ready',assignee_id:user,start_date:'2027-01-04',due_date:'2027-01-15',estimated_hours:20},{id:'b',project_id:'p1',title:'Remaining',status:'in_progress',assignee_id:user,start_date:'2027-01-01',due_date:'2027-01-08',estimated_hours:40,remaining_hours:6},{id:'c',project_id:'p1',title:'No estimate',status:'ready',assignee_id:user,due_date:'2027-01-08'},{id:'i',project_id:'p1',title:'Invited work',status:'ready',assignee_invitation_id:'invite1',planned_assignee_label:'<pending>',due_date:'2027-01-05',estimated_hours:5},{id:'u',project_id:'p1',title:'Unscheduled',status:'ready',assignee_id:user,estimated_hours:4},{id:'closed',project_id:'p1',title:'Done',status:'complete',assignee_id:user,due_date:'2027-01-05',estimated_hours:900}];
 let r=q.weeklyWorkload('2027-01-06'),g=r.rows.find(g=>g.key===user);
 assert.equal(g.hours,16);assert.equal(g.days[0],2);assert.equal(g.days[2],4);assert.equal(g.unknown,1);assert.equal(g.unplaced,4);assert.equal(g.unscheduled,1);assert.equal(r.rows.find(g=>g.key==='invite:invite1').hours,5);assert.equal(r.total,21);
 q.s.staffCapacity=[{owner_key:'user:'+user,weekly_hours:12}];assert.equal(q.weeklyWorkload().rows.find(g=>g.key===user).capacity,12);
 q.s.workloadWeek='2027-01-11';assert.equal(q.weeklyWorkload('2027-01-06').rows.find(g=>g.key===user).hours,10);
 assert.match(q.workloadCSV(),/Capacity hours/);
 }finally{dom.window.close();}
});
test('Settings inherit by scope, and real task forms save relative dates and hours in place',async()=>{
 const {dom,q}=setup();try{
 const p=q.s.projects.find(p=>p.id==='p1');p.target_date='2027-01-29';
 q.s.planningSettings=[{scope_type:'organization',scope_id:q.s.org.id,values:{weekly_capacity_hours:24,default_estimated_hours:2}},{scope_type:'department',scope_id:p.department_id,values:{weekly_capacity_hours:20}},{scope_type:'project',scope_id:p.id,values:{default_estimated_hours:4}}];
 assert.equal(q.effectivePlanning('p1').weekly_capacity_hours,20);assert.equal(q.effectivePlanning('p1').default_estimated_hours,4);
 q.s.projectId='p1';q.s.nav='project';await q.handleClick({dataset:{action:'modal',value:'task'}});
 let f=dom.window.document.querySelector('[data-form="task"]');assert.equal(f.elements.estimated_hours.value,'4');f.elements.title.value='Relative task';f.elements.schedule_mode.value='project';f.elements.schedule_mode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));f.elements.schedule_offset.value='-2';f.elements.duration_days.value='5';f.elements.estimated_hours.value='8';await q.handleForm(f);
 const t=q.s.tasks.find(t=>t.title==='Relative task');assert(t,dom.window.document.getElementById('toast').textContent);assert.equal(t.due_date,'2027-01-27');assert.equal(t.start_date,'2027-01-23');assert.equal(t.estimated_hours,8);assert.equal(q.s.nav,'project');
 q.s.nav='settings';q.s.settingsScope='project:p1';q.render();assert.match(dom.window.document.body.textContent,/Effective: 20/);assert.match(dom.window.document.body.textContent,/Department/);
 }finally{dom.window.close();}
});

test('Vendor forms, milestone deadline inheritance and dependency reporting remain distinct',async()=>{
 const {dom,q}=setup();try{
 q.s.nav='vendors';await q.handleClick({dataset:{action:'vendor-edit'}});
 let f=dom.window.document.querySelector('[data-form="vendor"]');f.elements.name.value='Example Carrier';await q.handleForm(f);const vendor=q.s.vendors[0];assert.equal(vendor.name,'Example Carrier');
 await q.handleClick({dataset:{action:'vendor-contact-edit',vendor:vendor.id}});f=dom.window.document.querySelector('[data-form="vendor-contact"]');f.elements.name.value='Porting Specialist';f.elements.email.value='porting@example.invalid';await q.handleForm(f);const contact=q.s.vendorContacts[0];assert.equal(contact.vendor_id,vendor.id);
 q.s.projectId='p1';q.s.projects.find(p=>p.id==='p1').target_date='2027-01-31';q.s.nav='project';q.s.milestones=[{id:'m1',project_id:'p1',title:'Cutover',start_date:'2027-01-04',due_date:'2027-01-15'}];
 await q.handleClick({dataset:{action:'modal',value:'task',milestone:'m1'}});f=dom.window.document.querySelector('[data-form="task"]');
 assert.match(f.querySelector('[data-milestone-frame]').textContent,/Jan 15, 2027/);assert.equal(f.elements.due_date.max,'2027-01-15');
 f.elements.title.value='Port numbers';f.elements.schedule_mode.value='milestone_deadline';f.elements.schedule_mode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));f.elements.start_date.value='2027-01-11';f.elements.estimated_hours.value='8';f.elements.vendor_id.value=vendor.id;f.elements.vendor_id.dispatchEvent(new dom.window.Event('change',{bubbles:true}));f.elements.vendor_contact_id.value=contact.id;f.elements.vendor_followup_date.value='2027-01-12';
 await q.handleForm(f);const task=q.s.tasks.find(t=>t.title==='Port numbers');assert(task,dom.window.document.getElementById('toast').textContent);assert.equal(task.due_date,'2027-01-15');assert.equal(task.start_date,'2027-01-11');assert.equal(task.vendor_contact_id,contact.id);assert.match(q.vendorSummary(task),/porting@example.invalid/);
 q.s.tasks.push({id:'pre',project_id:'p1',title:'Prerequisite',status:'ready',due_date:'2027-01-10',assignee_id:q.s.user.id});q.s.dependencies=[{task_id:task.id,prerequisite_id:'pre'}];task.assignee_id=q.s.user.id;
 const r=q.portfolioReport(new Date('2027-01-01T12:00:00'),'all').rows.find(r=>r.project.id==='p1');assert.equal(r.blocked.length,0);assert.equal(r.waiting.length,1);assert.notEqual(r.health,'attention');
 await q.handleClick({dataset:{action:'modal',value:'edit-task',id:task.id}});f=dom.window.document.querySelector('[data-form="edit-task"]');f.elements.schedule_mode.value='fixed';f.elements.schedule_mode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));f.elements.due_date.value='2027-01-16';assert.throws(()=>q.readPlan(f),/within the milestone/);
 }finally{dom.window.close();}
});
