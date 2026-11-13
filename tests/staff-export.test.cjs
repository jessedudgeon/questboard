const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
function csvRows(csv){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<csv.length;i++){
    const char=csv[i];
    if(char==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(char===','&&!quoted){row.push(cell);cell='';}
    else if(char==='\r'&&csv[i+1]==='\n'&&!quoted){row.push(cell);rows.push(row);row=[];cell='';i++;}
    else cell+=char;
  }
  row.push(cell);rows.push(row);return rows;
}
function app(){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
  dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadDemo,staffExportData,staffExportHTML,staffExportCSV,currentStaffExport,handleClick,projectPage,modalHTML};'));
  const q=dom.window.qa;q.loadDemo();q.s.nav='project';q.s.projectId='p1';
  return {dom,q};
}
test('Staff handoff exports all visible project tasks regardless of board filters, omitting closed and restricted by default',()=>{
  const {dom,q}=app();try{
    q.s.tasks.push({id:'restricted',project_id:'p1',title:'Confidential deployment',description:'Private credentials',visibility:'restricted',status:'ready',priority:'high',assignee_id:'sam',due_date:'2026-12-01'});
    q.s.tasks.push({id:'foreign',project_id:'p2',title:'Other project secret',status:'ready',visibility:'inherit'});
    q.s.milestones=[{id:'mile',project_id:'p1',title:'Ready for handoff',due_date:'2026-11-30',description:'Milestone acceptance',archived:false},{id:'mile2',project_id:'p1',title:'Retired',archived:true}];
    q.s.projectClosed=false;q.s.projectOwner='mine';q.s.projectPriority='critical';q.s.query='not-a-match';
    const report=q.staffExportData('p1');
    assert.deepEqual(Array.from(report.tasks,t=>t.id).sort(),['t1','t3']);
    assert.equal(report.restrictedOmitted,1);
    const html=q.staffExportHTML(report);
    assert.match(html,/Network Infrastructure Modernization/);
    assert.match(html,/Ready for handoff/);
    assert.match(html,/Review upgrade plans and schedule/);
    assert.match(html,/Complete Trinity switch inventory/);
    assert.match(html,/Verify uplink ports/);
    assert(!html.includes('Retired'));assert(!html.includes('Confidential deployment'));
    assert(!html.includes('Private credentials'));assert(!html.includes('Other project secret'));
    assert(!html.includes('Document network naming standards'));
  }finally{dom.window.close();}
});
test('Export options filter assignments and protect dependency titles excluded from staff document',()=>{
  const {dom,q}=app();try{
    q.s.tasks.push({id:'restricted',project_id:'p1',title:'Sensitive security review',visibility:'restricted',status:'ready',priority:'high',assignee_id:'sam',due_date:null});
    q.s.dependencies=[{task_id:'t1',prerequisite_id:'restricted'},{task_id:'t1',prerequisite_id:'t4'}];
    q.s.milestones=[{id:'m1',project_id:'p1',title:'First milestone',due_date:'2026-11-28',archived:false}];
    let report=q.staffExportData('p1',{assignee:'sam',includeFinished:true,includeChecklists:false});
    assert.deepEqual(Array.from(report.tasks,t=>t.id).sort(),['t1','t4']);
    assert(!q.staffExportHTML(report).includes('Sensitive security review'));
    assert(!q.staffExportHTML(report).includes('Verify uplink ports'));
    assert.match(q.staffExportHTML(report),/Identify unused wireless bridge/);
    assert.deepEqual(Array.from(report.dependencies(report.tasks.find(t=>t.id==='t1'))),['Identify unused wireless bridge']);
    report=q.staffExportData('p1',{assignee:'sam',includeRestricted:true,includeFinished:true});
    assert(report.tasks.some(t=>t.id==='restricted'));
    assert(q.staffExportHTML(report).includes('Sensitive security review'));
  }finally{dom.window.close();}
});
test('Downloaded HTML escapes project content and CSV guards against formulas',()=>{
  const {dom,q}=app();try{
    q.s.projects.find(p=>p.id==='p1').summary='<img src=x onerror=alert(1)>';
    q.s.tasks.find(t=>t.id==='t1').title='=HYPERLINK("https://attacker.test","Open")';
    q.s.tasks.find(t=>t.id==='t1').description='<script>danger()</script>';
    q.s.tasks.find(t=>t.id==='t3').description='@SUM(1,2)';
    q.s.checklist.push({id:'danger',task_id:'t1',title:'@SUM(1,2)',done:false});
    const report=q.staffExportData('p1');
    const html=q.staffExportHTML(report),csv=q.staffExportCSV(report);
    assert.match(html,/&lt;script&gt;danger\(\)&lt;\/script&gt;/);
    assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
    assert(!html.includes('<script>'));
    assert.match(csv,/'=HYPERLINK/);assert.match(csv,/'@SUM/);
    assert(!csv.includes('Other project secret'));
    for(const row of csvRows(csv))assert.equal(row.length,19);
  }finally{dom.window.close();}
});
test('Staff export dialog is available without project edit permissions and respects selected scope',async()=>{
  const {dom,q}=app();try{
    q.s.orgMembership={role:'member',status:'active'};q.s.departmentMembers=[];q.s.projectMembers=[];
    assert.match(q.projectPage(),/Export for staff/);
    await q.handleClick({dataset:{action:'modal',value:'project-export'}});
    assert.equal(q.s.modal,'project-export');
    const root=dom.window.document;
    assert(root.querySelector('#staff-export-assignee'));
    assert(!root.querySelector('#staff-export-finished').checked);
    assert(root.querySelector('#staff-export-checklists').checked);
    root.querySelector('#staff-export-finished').checked=true;
    root.querySelector('#staff-export-assignee').value='sam';
    const report=q.currentStaffExport();
    assert.deepEqual(Array.from(report.tasks,t=>t.id).sort(),['t1','t4']);
    await q.handleClick({dataset:{action:'close-modal'}});
    assert.equal(q.currentStaffExport(),null);
  }finally{dom.window.close();}
});
