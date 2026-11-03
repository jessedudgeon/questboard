const {test,expect}=require('@playwright/test');
const {installFakeSupabase}=require('../session-fixture.cjs');
const path=require('node:path');
async function start(page){
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.addScriptTag({content:'('+installFakeSupabase.toString()+')(window);'});
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await expect(page.getByLabel('Organization')).toHaveValue('a');
 await expect(page.locator('.page')).toContainText('Alpha');
}
test('Actual organization selector removes prior-org content and privileges',async({page})=>{
 await start(page);await page.getByLabel('Organization').selectOption('b');
 await expect(page.getByLabel('Organization')).toHaveValue('b');await expect(page.locator('.page')).toContainText('Beta');
 await expect(page.locator('body')).not.toContainText('Alpha secret');
 await expect(page.locator('.nav-link[data-value="admin"]')).toHaveCount(0);
 const calls=await page.evaluate(()=>fixture.calls.filter(c=>c.table==='qb_tasks').map(c=>c.filters));
 expect(calls.every(filters=>filters.some(([key])=>key==='project_id'))).toBeTruthy();
});
test('Account change and sign-out defeat delayed load responses in Chromium',async({page})=>{
 await start(page);
 await page.evaluate(()=>{window.release=null;const pending=new Promise(resolve=>window.release=resolve);fixture.before=c=>c.table==='qb_projects'&&c.user==='u1'?pending:undefined;});
 await page.getByLabel('Organization').selectOption('b');
 await page.evaluate(()=>fixture.emit('SIGNED_IN','u2'));
 await expect(page.locator('.page')).toContainText('Beta');await expect(page.locator('.user-dot')).toHaveAttribute('title','u2@example.invalid');
 await page.evaluate(()=>release());await expect(page.locator('body')).not.toContainText('Alpha secret');
 await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(page.getByRole('button',{name:'Continue with Microsoft'})).toBeVisible();await expect(page.getByLabel('Organization')).toHaveCount(0);
 await expect(page.locator('body')).not.toContainText('Beta task');
});
test('Suspension revalidation removes active workspace on token refresh',async({page})=>{
 await start(page);await page.evaluate(()=>{fixture.tables.qb_org_members.forEach(m=>m.status='suspended');fixture.emit('TOKEN_REFRESHED','u1');});
 await expect(page.getByLabel('Organization')).toHaveCount(0);await expect(page.locator('body')).not.toContainText('Alpha secret');
 await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
});

test('Organization control remains usable on a narrow viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await start(page);
 await expect(page.getByLabel('Organization')).toBeVisible();await page.getByLabel('Organization').selectOption('b');
 await expect(page.locator('.page')).toContainText('Beta');
 const box=await page.getByLabel('Organization').boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(390);
});

test('Signed-out invitation and OAuth recovery remain usable on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/?invite=10000000-0000-0000-0000-000000000001#error=access_denied&error_description=private-provider-text');
 await page.addScriptTag({content:'('+installFakeSupabase.toString()+')(window);fixture.current=null;QUESTBOARD_CONFIG.authProviders={google:true,azure:false};fixture.api.auth.signInWithOAuth=async()=>({error:{message:"private-provider-text"}});'});
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await expect(page.getByRole('alert')).toContainText('Sign-in was not completed');
 await expect(page.getByRole('button',{name:'Microsoft sign-in unavailable'})).toBeDisabled();
 await expect(page.locator('body')).not.toContainText('private-provider-text');
 expect(page.url()).not.toContain('error');
 await page.getByRole('button',{name:'Continue with Google'}).click();
 await expect(page.getByRole('alert')).toContainText('Unable to start sign-in');
 await expect(page.getByRole('button',{name:'Continue with Google'})).toBeEnabled();
 await expect(page.locator('.invite-box')).toContainText('email address that received');
 await page.getByRole('button',{name:'Dismiss notice'}).click();await expect(page.locator('.invite-box')).toHaveCount(0);
 const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);expect(fits).toBeTruthy();
});

test('Large project loads every page before showing its task board',async({page})=>{
 await start(page);
 await page.evaluate(()=>{
  fixture.rowCap=71;
  fixture.tables.qb_tasks=Array.from({length:1105},(_,i)=>({id:'large-'+String(i).padStart(5,'0'),project_id:'pa',title:'Large task '+i,status:'backlog',priority:'normal',created_at:'2026-11-02T00:00:00Z'}));
 });
 await page.getByLabel('Organization').selectOption('b');await expect(page.locator('.page')).toContainText('Beta');
 await page.getByLabel('Organization').selectOption('a');
 await expect(page.locator('.project-card[data-id="pa"]')).toContainText('1105 tasks');
 await page.locator('.project-card[data-id="pa"]').click();
 await expect(page.locator('.board-task')).toHaveCount(1105);
 await expect(page.locator('.board-task[data-id="large-01104"]')).toContainText('Large task 1104');
});

test('Large eligible-person lists retry in place without losing the task draft',async({page})=>{
 await start(page);
 await page.evaluate(()=>{
  fixture.rowCap=73;
  fixture.rpcRows.qb_assignment_candidates=Array.from({length:1105},(_,i)=>({user_id:'candidate-'+String(i).padStart(5,'0'),display_name:'Candidate '+String(i).padStart(5,'0')}));
  fixture.before=c=>{if(c.rpc==='qb_assignment_candidates'&&c.start>=250)throw Error('Temporary directory failure');};
 });
 await page.locator('.project-card[data-id="pa"]').click();
 await page.locator('[data-action="modal"][data-value="task"]').first().click();
 await expect(page.getByRole('button',{name:'Retry loading people'})).toBeVisible();
 const form=page.locator('form[data-form="task"]');await form.locator('[name="title"]').fill('Keep this draft');
 await expect(form.locator('[type="submit"]')).toBeDisabled();
 await page.evaluate(()=>fixture.before=null);
 await page.getByRole('button',{name:'Retry loading people'}).click();
 await expect(form.locator('[name="assignee_id"] option')).toHaveCount(1106);
 await expect(form.locator('[name="title"]')).toHaveValue('Keep this draft');
 await expect(form.locator('[type="submit"]')).toBeEnabled();
 await form.locator('[name="assignee_id"]').selectOption('candidate-01104');
 await expect(form.locator('[name="assignee_id"]')).toHaveValue('candidate-01104');
});

test('Dependencies link and unlink through the task UI and show both directions',async({page})=>{
 await start(page);
 await page.evaluate(()=>{
  fixture.tables.qb_tasks.push({id:'pre',project_id:'pa',title:'Finish prerequisite first',status:'ready',priority:'normal'});
  const rpc=fixture.api.rpc;
  fixture.api.rpc=(name,args)=>{
   if(name!=='qb_set_task_dependency')return rpc(name,args);
   if(args.p_link)fixture.tables.qb_task_dependencies.push({id:'dependency-1',project_id:'pa',task_id:args.p_task,prerequisite_id:args.p_prerequisite});
   else fixture.tables.qb_task_dependencies=fixture.tables.qb_task_dependencies.filter(d=>d.task_id!==args.p_task||d.prerequisite_id!==args.p_prerequisite);
   return Promise.resolve({data:null,error:null});
  };
 });
 await page.getByLabel('Organization').selectOption('b');await expect(page.locator('.page')).toContainText('Beta');
 await page.getByLabel('Organization').selectOption('a');await expect(page.locator('.page')).toContainText('Alpha');
 await page.locator('.project-card[data-id="pa"]').click();await page.locator('.board-task[data-id="ta"]').click();
 await page.getByLabel('Add prerequisite').selectOption('pre');await page.getByRole('button',{name:'Link prerequisite',exact:true}).click();
 await expect(page.locator('.dependency-list').first()).toContainText('Finish prerequisite first');
 await expect(page.locator('.detail-content')).toContainText('Waiting for prerequisites');
 await page.locator('.dependency-list').first().getByRole('button',{name:'Finish prerequisite first',exact:true}).click();
 await expect(page.locator('.dependency-list').nth(1)).toContainText('Alpha secret task');
 await page.locator('.dependency-list').nth(1).getByRole('button',{name:'Alpha secret task',exact:true}).click();
 await page.getByRole('button',{name:'Remove prerequisite: Finish prerequisite first',exact:true}).click();
 await expect(page.locator('.dependency-list').first()).toContainText('No visible prerequisites');
});

test('Create task with prerequisite saves in one call and retains draft on error',async({page})=>{
 await start(page);
 await page.evaluate(()=>{
  fixture.rpcRows.qb_assignment_candidates=[{user_id:'u1',display_name:'First account'}];
  const rpc=fixture.api.rpc;window.failCreate=true;
  fixture.api.rpc=(name,a)=>{
   if(name!=='qb_create_task')return rpc(name,a);
   fixture.calls.push({rpc:name,args:a});
   if(window.failCreate)return Promise.resolve({error:{message:'Prerequisite is unavailable'}});
   fixture.tables.qb_tasks.push({id:'created',project_id:a.p_project,title:a.p_title,status:'backlog',priority:a.p_priority});
   fixture.tables.qb_task_dependencies.push({id:'created-link',project_id:a.p_project,task_id:'created',prerequisite_id:a.p_prerequisite});
   return Promise.resolve({data:'created'});
  };
 });
 await page.locator('.project-card[data-id="pa"]').click();
 await page.locator('[data-action="modal"][data-value="task"]').first().click();
 const form=page.locator('form[data-form="task"]');
 await form.locator('[name="title"]').fill('New dependent task');
 await page.getByLabel('Depends on (optional)').selectOption('ta');
 await form.getByRole('button',{name:'Create task',exact:true}).click();
 await expect(page.locator('#toast')).toContainText('Prerequisite is unavailable');
 await expect(form.locator('[name="title"]')).toHaveValue('New dependent task');
 await expect(page.getByLabel('Depends on (optional)')).toHaveValue('ta');
 await page.evaluate(()=>window.failCreate=false);
 await form.getByRole('button',{name:'Create task',exact:true}).click();
 await expect(page.locator('.dependency-list').first()).toContainText('Alpha secret task');
 await expect(page.locator('.detail-content')).toContainText('Waiting for prerequisites');
 const calls=await page.evaluate(()=>fixture.calls.filter(c=>c.rpc==='qb_create_task'));
 expect(calls[1].args.p_prerequisite).toBe('ta');
});

test('Calendar filters, task navigation and mobile agenda preserve organization boundaries',async({page})=>{
 await start(page);
 await page.evaluate(()=>{
  const date=new Date(),key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-15`;
  fixture.tables.qb_tasks.find(t=>t.id==='ta').due_date=key;
  fixture.tables.qb_tasks.find(t=>t.id==='tb').due_date=key;
  fixture.tables.qb_projects.find(p=>p.id==='pa').target_date=key;
  fixture.emit('TOKEN_REFRESHED','u1');
 });
 await expect(page.locator('.page')).toContainText('Alpha');
 await page.locator('.nav-link[data-value="calendar"]').click();
 await expect(page.locator('.calendar-event')).toHaveCount(2);
 await expect(page.locator('.calendar-event')).not.toContainText(['Beta','Beta']);
 await page.getByLabel('Calendar work scope').selectOption('mine');
 await expect(page.locator('.calendar-event')).toHaveCount(1);
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('.calendar-day.has-events .calendar-mobile-date')).toBeVisible();
 const width=await page.evaluate(()=>({body:document.documentElement.scrollWidth,viewport:innerWidth}));
 expect(width.body).toBeLessThanOrEqual(width.viewport);
 await page.locator('.calendar-event').click();
 await expect(page.locator('h1')).toHaveText('Alpha secret task');
 await page.getByLabel('Organization').selectOption('b');
 await page.getByRole('button',{name:'Open menu'}).click();
 await page.locator('.nav-link[data-value="calendar"]').click();
 await expect(page.locator('.calendar-event')).toHaveCount(1);
 await expect(page.locator('.calendar-event')).toContainText('Beta task');
 await expect(page.getByLabel('Calendar work scope')).toHaveValue('all');
 await expect(page.locator('body')).not.toContainText('Alpha secret');
});
