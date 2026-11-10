const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(__dirname+'/../dist/app.js','utf8');
function app(){
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});
  dom.window.eval(source.replace('  init();','  globalThis.qa={s,loadDemo,projectBriefPanel,leadershipReport,leadershipReportPage,standaloneLeadershipHTML,handleForm,invalidateWorkspace};'));
  dom.window.qa.loadDemo();return{dom,q:dom.window.qa};
}
test('Accomplishment report uses dated check-ins, period and authorized project scope',()=>{
  const {dom,q}=app();try{
    q.s.reportView='accomplishments';q.s.reportPeriod='30';
    const now=new Date().toISOString(),old=new Date(Date.now()-40*86400000).toISOString();
    q.s.briefs=[
      {id:'recent',project_id:'p1',author_id:'demo-user',health:'on_track',accomplishments:'Delivered campus network readiness',next_steps:'',risks:'',decisions:'',created_at:now},
      {id:'old',project_id:'p1',author_id:'demo-user',health:'on_track',accomplishments:'Legacy result',next_steps:'',risks:'',decisions:'',created_at:old},
      {id:'foreign',project_id:'invisible',author_id:'demo-user',health:'on_track',accomplishments:'Secret information',next_steps:'',risks:'',decisions:'',created_at:now}
    ];
    assert.equal(q.leadershipReport().length,1);
    const html=q.standaloneLeadershipHTML();assert.match(html,/Delivered campus network readiness/);assert(!html.includes('Legacy result'));assert(!html.includes('Secret information'));
    q.s.reportPeriod='90';assert(q.standaloneLeadershipHTML().includes('Legacy result'));
    q.s.workspace='fac';assert.equal(q.leadershipReport().length,0);
  }finally{dom.window.close();}
});
test('Outlook reports show latest risk, decisions and milestone; escape untrusted HTML',()=>{
  const {dom,q}=app();try{
    q.s.reportView='outlook';q.s.briefs=[{id:'risk',project_id:'p1',author_id:'demo-user',delivery_owner:'Technician A',health:'blocked',accomplishments:'',next_steps:'Reschedule maintenance',risks:'<img src=x onerror=alert(1)>',decisions:'Approve replacement',created_at:new Date().toISOString()}];
    q.s.milestones=[{id:'m',project_id:'p1',title:'Network readiness',due_date:'2027-01-01',archived:false}];
    dom.window.document.getElementById('app').innerHTML=q.leadershipReportPage();
    assert.equal(dom.window.document.querySelector('.leadership-report img'),null);
    assert.match(dom.window.document.querySelector('.leadership-report').textContent,/Approve replacement/);
    assert.match(dom.window.document.querySelector('.leadership-report').textContent,/Network readiness/);
    assert.match(dom.window.document.querySelector('.leadership-report').textContent,/Technician A/);
    assert.match(q.standaloneLeadershipHTML(),/&lt;img src=x/);
    assert.equal(q.leadershipReport()[0].latest.health,'blocked');
  }finally{dom.window.close();}
});
test('Project check-ins save one immutable demo update and reset on organization invalidation',async()=>{
  const {dom,q}=app();try{
    q.s.projectId='p1';q.s.nav='project';
    dom.window.document.getElementById('app').innerHTML=q.projectBriefPanel('p1');
    const form=dom.window.document.querySelector('form[data-form="project-brief"]');
    assert(form);form.elements.delivery_owner.value='Eve';form.elements.health.value='on_track';form.elements.accomplishments.value='Confirmed project scope';form.elements.next_steps.value='Schedule pilot';
    const prior=q.s.briefs.length;await q.handleForm(form);
    assert.equal(q.s.briefs.length,prior+1);assert.equal(q.s.briefs[0].accomplishments,'Confirmed project scope');assert.equal(q.s.briefs[0].delivery_owner,'Eve');
    q.invalidateWorkspace();assert.equal(q.s.briefs.length,0);
  }finally{dom.window.close();}
});
