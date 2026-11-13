const {test,expect}=require('@playwright/test');
const {installFakeSupabase}=require('../session-fixture.cjs');
const path=require('node:path');
async function start(page){
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.addScriptTag({content:'('+installFakeSupabase.toString()+')(window);'});
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await expect(page.getByLabel('Organization',{exact:true})).toHaveValue('a');
 await expect(page.locator('.page')).toContainText('Alpha');
}
test('Actual organization selector removes prior-org content and privileges',async({page})=>{
 await start(page);await page.getByLabel('Organization',{exact:true}).selectOption('b');
 await expect(page.getByLabel('Organization',{exact:true})).toHaveValue('b');await expect(page.locator('.page')).toContainText('Beta');
 await expect(page.locator('body')).not.toContainText('Alpha secret');
 await expect(page.locator('.nav-link[data-value="admin"]')).toHaveCount(0);
 const calls=await page.evaluate(()=>fixture.calls.filter(c=>c.table==='qb_tasks').map(c=>c.filters));
 expect(calls.every(filters=>filters.some(([key])=>key==='project_id'))).toBeTruthy();
});
test('Account change and sign-out defeat delayed load responses in Chromium',async({page})=>{
 await start(page);
 await page.evaluate(()=>{window.release=null;const pending=new Promise(resolve=>window.release=resolve);fixture.before=c=>c.table==='qb_projects'&&c.user==='u1'?pending:undefined;});
 await page.getByLabel('Organization',{exact:true}).selectOption('b');
 await page.evaluate(()=>fixture.emit('SIGNED_IN','u2'));
 await expect(page.locator('.page')).toContainText('Beta');await expect(page.locator('.user-dot')).toHaveAttribute('title','u2@example.invalid');
 await page.evaluate(()=>release());await expect(page.locator('body')).not.toContainText('Alpha secret');
 await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(page.getByRole('button',{name:'Continue with Microsoft'})).toBeVisible();await expect(page.getByLabel('Organization',{exact:true})).toHaveCount(0);
 await expect(page.locator('body')).not.toContainText('Beta task');
});
test('Suspension revalidation removes active workspace on token refresh',async({page})=>{
 await start(page);await page.evaluate(()=>{fixture.tables.qb_org_members.forEach(m=>m.status='suspended');fixture.emit('TOKEN_REFRESHED','u1');});
 await expect(page.getByLabel('Organization',{exact:true})).toHaveCount(0);await expect(page.locator('body')).not.toContainText('Alpha secret');
 await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
});

test('Organization control remains usable on a narrow viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await start(page);
 await expect(page.getByLabel('Organization',{exact:true})).toBeVisible();await page.getByLabel('Organization',{exact:true}).selectOption('b');
 await expect(page.locator('.page')).toContainText('Beta');
 const box=await page.getByLabel('Organization',{exact:true}).boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(390);
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
 await page.getByLabel('Organization',{exact:true}).selectOption('b');await expect(page.locator('.page')).toContainText('Beta');
 await page.getByLabel('Organization',{exact:true}).selectOption('a');
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
 await page.getByLabel('Organization',{exact:true}).selectOption('b');await expect(page.locator('.page')).toContainText('Beta');
 await page.getByLabel('Organization',{exact:true}).selectOption('a');await expect(page.locator('.page')).toContainText('Alpha');
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
   if(name!=='qb_create_planned_task')return rpc(name,a);
   fixture.calls.push({rpc:name,args:a});
   if(window.failCreate)return Promise.resolve({error:{message:'Prerequisite is unavailable'}});
   fixture.tables.qb_tasks.push({id:'created',project_id:a.p_project,title:a.p_values.title,status:'backlog',priority:a.p_values.priority});
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
 await page.locator('.board-task,.task-item').filter({hasText:'New dependent task'}).first().click();
 await expect(page.locator('.dependency-list').first()).toContainText('Alpha secret task');
 await expect(page.locator('.detail-content')).toContainText('Waiting for prerequisites');
 const calls=await page.evaluate(()=>fixture.calls.filter(c=>c.rpc==='qb_create_planned_task'));
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
 await page.getByLabel('Organization',{exact:true}).selectOption('b');
 await page.getByRole('button',{name:'Open menu'}).click();
 await page.locator('.nav-link[data-value="calendar"]').click();
 await expect(page.locator('.calendar-event')).toHaveCount(1);
 await expect(page.locator('.calendar-event')).toContainText('Beta task');
 await expect(page.getByLabel('Calendar work scope')).toHaveValue('all');
 await expect(page.locator('body')).not.toContainText('Alpha secret');
});

test('Personal and manager dashboards support mobile navigation and reset on organization switch',async({page})=>{
 await start(page);
 await page.getByRole('button',{name:'My dashboard',exact:true}).click();
 await expect(page.locator('h1')).toHaveText('My dashboard');
 await expect(page.locator('[data-dashboard-section]')).toHaveCount(4);
 await page.getByRole('button',{name:'Manager dashboard',exact:true}).click();
 await expect(page.locator('.dashboard-workload')).toContainText('1 open');
 await page.setViewportSize({width:390,height:844});
 await page.locator('.workload-person summary').click();
 await expect(page.locator('.dashboard-workload')).toContainText('Alpha secret task');
 const width=await page.evaluate(()=>({body:document.documentElement.scrollWidth,viewport:innerWidth}));
 expect(width.body).toBeLessThanOrEqual(width.viewport);
 await page.locator('.dashboard-workload [data-action="task"]').click();
 await expect(page.locator('h1')).toHaveText('Alpha secret task');
 await page.getByLabel('Organization',{exact:true}).selectOption('b');
 await expect(page.getByRole('button',{name:'Overview',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:'Manager dashboard',exact:true})).toHaveCount(0);
 await expect(page.locator('body')).not.toContainText('Alpha secret');
});

test('New signup creates an organization then departments on mobile',async({page})=>{
 await start(page);
 await page.evaluate(()=>{
  fixture.tables.qb_org_members=[];
  const rpc=fixture.api.rpc;fixture.api.rpc=(name,args)=>{
   if(name!=='qb_create_organization')return rpc(name,args);
   fixture.tables.qb_organizations.push({id:'new',name:args.p_name});
   fixture.tables.qb_org_members.push({org_id:'new',user_id:'u1',role:'admin',status:'active'});
   return Promise.resolve({data:'new'});
  };
  const from=fixture.api.from;fixture.api.from=table=>{const query=from(table);if(table==='qb_departments')query.insert=row=>{fixture.tables.qb_departments.push({...row,id:'new-dept'});return Promise.resolve({data:null});};return query;};
  fixture.emit('TOKEN_REFRESHED','u1');
 });
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('heading',{name:'Create your organization',exact:true})).toBeVisible();
 await page.getByLabel('Organization name').fill('My new organization');
 await page.getByRole('button',{name:'Create organization',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Step 3 · Add your first department'})).toBeVisible();
 await page.getByLabel('Department name').fill('Technology');
 await page.getByRole('button',{name:'Create department',exact:true}).click();
 await expect(page.locator('.data-table').first()).toContainText('Technology');
 await expect(page.getByLabel('Organization',{exact:true})).toHaveValue('new');
 const width=await page.evaluate(()=>({body:document.documentElement.scrollWidth,viewport:innerWidth}));expect(width.body).toBeLessThanOrEqual(width.viewport);
});

test('Project list filters, search and finished work stay usable on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await page.getByRole('button',{name:'Explore sample workspace',exact:false}).click();
 await page.locator('.project-card').first().click();
 await page.locator('[data-action="project-view"][data-value="list"]').click();
 await expect(page.locator('.project-task-list .task-item')).toHaveCount(2);
 await page.locator('#project-owner').selectOption('mine');
 await expect(page.locator('.project-task-list .task-item')).toHaveCount(1);
 await page.locator('#search').fill('no matching title');
 await expect(page.locator('.page')).toContainText('No matching tasks');
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await page.locator('#project-closed').check();
 await expect(page.locator('.project-task-list .task-item')).toHaveCount(4);
 const bounds=await page.locator('#project-sort').boundingBox();expect(bounds.x+bounds.width).toBeLessThanOrEqual(390);
 await page.locator('.project-task-list .task-item').first().press('Enter');
 await expect(page.locator('.page')).toContainText('Work journal');
});

test('Manager plans, exports and reschedules filtered work on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await page.getByRole('button',{name:'Explore sample workspace'}).click();
 await page.getByRole('button',{name:'Workload planner'}).click();
 await page.getByLabel('Group by',{exact:true}).selectOption('project');
 await page.getByLabel('Show',{exact:true}).selectOption('blocked');
 await page.locator('tbody [data-action="planner-cell"][data-value="all"]').click();
 const detail=page.locator('.planner-detail');
 await expect(detail.locator('.task-item')).toHaveCount(1);
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export CSV'}).click();
 expect((await download).suggestedFilename()).toMatch(/^questboard-workload-.*\.csv$/);
 await detail.getByRole('button',{name:/^Edit Resolve/}).click();
 const form=page.locator('form[data-form="edit-task"]');
 await form.locator('[name="due_date"]').fill('2099-08-10');
 await form.locator('[type="submit"]').click();
 await expect(form).toHaveCount(0);
 await expect(detail.locator('.task-item')).toContainText('2099');
 await expect(page.locator('tbody [data-value="later"]')).toHaveText('1');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Template workflow saves a snapshot, creates a fresh checklist and archives on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await page.getByRole('button',{name:'Explore sample workspace'}).click();
 await page.locator('[data-action="task"][data-id="t1"]').first().click();
 await page.getByRole('button',{name:'Save as template',exact:true}).click();
 await page.getByLabel('Template name',{exact:true}).fill('Weekly closet inspection');
 await page.getByLabel('Due after how many days?',{exact:true}).fill('7');
 await page.getByRole('button',{name:'Save template',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.locator('.breadcrumb [data-action="project"]').click();
 const library=page.locator('.template-library');
 await expect(library).toContainText('Weekly closet inspection');
 await library.getByText('Preview checklist').click();
 await expect(library).toContainText('Record model and serial');
 await library.getByRole('button',{name:'Create task',exact:true}).click();
 const form=page.locator('form[data-form="task"]');
 await expect(form.locator('[name="title"]')).toHaveValue('Complete Trinity switch inventory');
 await form.locator('[name="title"]').fill('Next closet inspection');
 await form.locator('[name="assignee_id"]').selectOption('sam');
 await form.locator('[name="due_date"]').fill('2027-01-10');
 await form.locator('[name="prerequisite_id"]').selectOption('t2');
 await form.getByRole('button',{name:'Create task',exact:true}).click();
 await page.locator('.board-task,.task-item').filter({hasText:'Next closet inspection'}).first().click();
 await expect(page.getByRole('heading',{name:'Next closet inspection',exact:true})).toBeVisible();
 await expect(page.locator('.checkline')).toHaveCount(3);
 await expect(page.locator('.checkline input:checked')).toHaveCount(0);
 await expect(page.locator('.dependency-list').first()).toContainText('Document network naming standards');
 await page.locator('.breadcrumb [data-action="project"]').click();
 await library.getByRole('button',{name:'Archive',exact:true}).click();
 await expect(library.locator('[data-action="use-template"]')).toHaveCount(0);
 await library.getByText('Archived templates (1)').click();
 await library.getByRole('button',{name:'Restore',exact:true}).click();
 await expect(library.locator('[data-action="use-template"]')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Milestones connect project planning, task editing and calendar on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await page.getByRole('button',{name:'Explore sample workspace'}).click();
 await page.locator('.project-card').first().click();
 await page.getByRole('button',{name:'Add milestone',exact:true}).click();
 await page.getByLabel('Milestone name',{exact:true}).fill('Campus rollout');
 await page.getByLabel('Delivery goal',{exact:true}).fill('All systems verified');
 const today=await page.evaluate(()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');});
 await page.getByLabel('Target date',{exact:true}).fill(today);
 await page.getByRole('button',{name:'Save milestone',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Campus rollout',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add task',exact:true}).click();
 const taskForm=page.locator('form[data-form="task"]');
 await expect(taskForm.locator('[name="milestone_id"] option:checked')).toHaveText('Campus rollout');
 await taskForm.locator('[name="title"]').fill('Verify rollout');
 await taskForm.getByRole('button',{name:'Create task',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Campus rollout',exact:true})).toBeVisible();
 await expect(page.locator('.milestone-tasks .task-item')).toHaveCount(1);
 await expect(page.locator('.milestone-signals')).toContainText('1 without a due date');
 await page.locator('.milestone-tasks').getByRole('button',{name:'Edit Verify rollout'}).click();
 await page.locator('form[data-form="edit-task"] [name="due_date"]').fill(today);
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.locator('.milestone-signals')).toHaveCount(0);
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await page.locator('[data-action="nav"][data-value="calendar"]').click();
 await page.locator('.milestone-target').click();
 await expect(page.getByRole('heading',{name:'Campus rollout',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit milestone',exact:true}).click();
 await page.getByLabel('Archive milestone').check();
 await page.getByRole('button',{name:'Save milestone',exact:true}).click();
 await expect(page.locator('.page')).toContainText('Archived milestone');
 await expect(page.locator('.milestone-tasks .task-item')).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Add task',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('Inbox supports unread filters, page read and task links on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await page.getByRole('button',{name:'Explore sample workspace'}).click();
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await page.locator('[data-action="nav"][data-value="inbox"]').click();
 await expect(page.locator('.inbox-item')).toHaveCount(3);
 await page.locator('[data-action="inbox-filter"][data-value="unread"]').click();
 await expect(page.locator('.inbox-item')).toHaveCount(2);
 await page.getByRole('button',{name:'Mark this page read',exact:true}).click();
 await expect(page.locator('.inbox-item')).toHaveCount(0);
 await page.locator('[data-action="inbox-filter"][data-value="all"]').click();
 await expect(page.locator('.inbox-item')).toHaveCount(3);
 await page.getByRole('button',{name:'Mark unread',exact:true}).first().click();
 await expect(page.locator('.inbox-item.is-unread')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 const title=await page.locator('.inbox-open strong').first().textContent();
 await page.locator('.inbox-open').first().click();
 await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
});

test('Project check-ins feed both leadership reports and export on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await page.getByRole('button',{name:'Explore sample workspace'}).click();
 await page.locator('.project-card').first().click();
 await page.locator('.brief-entry summary').click();
 await page.getByLabel('Delivery owner (for reporting)').fill('Assigned network technician');
 await page.getByLabel('What did we accomplish?').fill('Completed network readiness checks');
 await page.getByLabel('What happens next?').fill('Prepare the next maintenance window');
 await page.getByLabel('Risks or blockers').fill('Awaiting vendor confirmation');
 await page.getByRole('button',{name:'Save check-in'}).click();
 await expect(page.locator('.project-briefs')).toContainText('Completed network readiness checks');
 await expect(page.locator('.project-briefs')).toContainText('Assigned network technician');
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await page.locator('[data-action="nav"][data-value="reports"]').click();
 await expect(page.locator('.leadership-report')).toContainText('Prepare the next maintenance window');
 await page.getByRole('button',{name:'What we accomplished',exact:true}).click();
 await expect(page.locator('.leadership-report')).toContainText('Completed network readiness checks');
 const downloadEvent=page.waitForEvent('download');
 await page.getByRole('button',{name:'Download HTML'}).click();
 expect((await downloadEvent).suggestedFilename()).toMatch(/^questboard-accomplishments-\d{4}-\d{2}-\d{2}\.html$/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('Portfolio filters, task drill-down and CSV export work on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await page.getByRole('button',{name:'Explore sample workspace'}).click();
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await page.locator('[data-action="nav"][data-value="reports"]').click();
 await page.getByRole('button',{name:'Task health',exact:true}).click();
 await expect(page.locator('.portfolio-card').first()).toBeVisible();
 const project=await page.locator('.portfolio-card h2').first().textContent();
 await page.getByLabel('Search projects and tasks').fill(project);
 await expect(page.locator('.portfolio-card')).toHaveCount(1);
 await page.locator('.portfolio-card [data-action="report-detail"][data-value="open"]').click();
 await expect(page.locator('.report-detail')).toBeVisible();
 await expect(page.locator('.report-task').first()).toBeVisible();
 const taskTitle=await page.locator('.report-task button').first().textContent();
 const downloadEvent=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export project CSV',exact:true}).click();
 const download=await downloadEvent;
 expect(download.suggestedFilename()).toMatch(/^questboard-project-health-\d{4}-\d{2}-\d{2}\.csv$/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.locator('.report-task button').first().click();
 await expect(page.getByRole('heading',{name:taskTitle,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await page.locator('[data-action="nav"][data-value="reports"]').click();
 await page.getByRole('button',{name:'Task health',exact:true}).click();
 await page.getByLabel('Health',{exact:true}).selectOption('closed');
 await expect(page.locator('.portfolio-card')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Export project CSV',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Progress & recognition',exact:true}).click();
 await expect(page.getByText('Experience earned',{exact:true})).toBeVisible();
});

test('Project settings update lifecycle and preserve task history on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await page.getByRole('button',{name:'Explore sample workspace'}).click();
 await page.locator('.project-card').first().click();
 const taskCount=await page.locator('.board-task').count();
 await page.getByRole('button',{name:'Project settings',exact:true}).click();
 await page.getByLabel('Project name',{exact:true}).fill('Campus readiness');
 await page.getByLabel('Desired outcome',{exact:true}).fill('Verified systems for the next semester');
 await page.getByLabel('Project status',{exact:true}).selectOption('paused');
 await page.getByLabel('Target date',{exact:true}).fill('2027-01-15');
 await page.getByRole('button',{name:'Save project',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Campus readiness',exact:true})).toBeVisible();
 await expect(page.locator('.detail-banner')).toContainText('PAUSED');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await expect(page.locator('.board-task')).toHaveCount(taskCount);
 await page.getByRole('button',{name:'Change history',exact:true}).click();
 await expect(page.locator('.project-change')).toHaveCount(1);
 await expect(page.locator('.project-change')).toContainText('Campus readiness');
 await expect(page.locator('.project-change')).toContainText('2027-01-15');
 await page.locator('.breadcrumb button').click();
 for(const status of ['archived','active']){
  await page.getByRole('button',{name:'Project settings',exact:true}).click();
  await page.getByLabel('Project status',{exact:true}).selectOption(status);
  await page.getByRole('button',{name:'Save project',exact:true}).click();
  await expect(page.locator('.detail-banner')).toContainText(status.toUpperCase());
 }
 await page.getByRole('button',{name:'Change history',exact:true}).click();
 await expect(page.locator('.project-change')).toHaveCount(3);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('All tasks saves and restores filters, exports matches and opens tasks on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await page.getByRole('button',{name:'Explore sample workspace'}).click();
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await page.locator('[data-action="nav"][data-value="alltasks"]').click();
 await page.getByLabel('Assignee or review',{exact:true}).selectOption('mine');
 await page.getByLabel('Task status',{exact:true}).selectOption('all');
 const matches=await page.locator('.task-explorer-list .task-item').count();expect(matches).toBeGreaterThan(0);
 const title=await page.locator('.task-explorer-list .task-title').first().textContent();
 await page.getByRole('button',{name:'Save current view',exact:true}).click();
 await page.getByLabel('View name',{exact:true}).fill('My follow-up');
 await page.getByRole('button',{name:'Save view',exact:true}).click();
 await expect(page.locator('#tasks-view option:checked')).toHaveText('My follow-up');
 await page.getByRole('button',{name:'Clear filters',exact:true}).click();
 await expect(page.getByLabel('Assignee or review',{exact:true})).toHaveValue('all');
 await page.getByLabel('Saved view',{exact:true}).selectOption({label:'My follow-up'});
 await expect(page.getByLabel('Assignee or review',{exact:true})).toHaveValue('mine');
 await expect(page.locator('.task-explorer-list .task-item')).toHaveCount(matches);
 const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export matching tasks',exact:true}).click();
 const download=await event;expect(download.suggestedFilename()).toMatch(/^questboard-tasks-.*\.csv$/);
 const csv=await require('node:fs/promises').readFile(await download.path(),'utf8');expect(csv).toContain(title);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.locator('.task-explorer-list .task-item').first().click();
 await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await page.locator('[data-action="nav"][data-value="alltasks"]').click();
 await page.getByRole('button',{name:'Remove saved view',exact:true}).click();
 await expect(page.getByLabel('Saved view',{exact:true}).locator('option')).toHaveCount(1);
 await expect(page.getByLabel('Assignee or review',{exact:true})).toHaveValue('mine');
});

test('Activity filters, journal follow-up, task history and export work on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="app"></div><div id="toast"></div></body></html>'}));
 await page.goto('http://127.0.0.1:4173/');
 await page.addStyleTag({path:path.join(__dirname,'../../dist/styles.css')});
 await page.addScriptTag({path:path.join(__dirname,'../../dist/app.js')});
 await page.getByRole('button',{name:'Explore sample workspace'}).click();
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await page.locator('[data-action="nav"][data-value="activity"]').click();
 await page.getByLabel('Activity type',{exact:true}).selectOption('status');
 await expect(page.locator('.activity-record')).toHaveCount(1);
 await expect(page.locator('.activity-record')).toContainText('In Progress → In Review');
 await page.getByLabel('Date range',{exact:true}).selectOption('all');
 await page.getByLabel('Activity type',{exact:true}).selectOption('journal');
 await expect(page.locator('.activity-record')).toHaveCount(2);
 await page.locator('.activity-task').first().click();
 const form=page.locator('form[data-form="update"]');
 await form.locator('textarea[name="body"]').fill('Verified the replacement uplink during maintenance.');
 await form.locator('select[name="kind"]').selectOption('action');
 await form.getByRole('button',{name:'Post update',exact:true}).click();
 await page.getByRole('button',{name:'View all task activity',exact:true}).click();
 await expect(page.locator('.invite-box')).toContainText('Task filter:');
 await page.getByLabel('Search projects and tasks').fill('replacement uplink');
 await expect(page.locator('.activity-record')).toHaveCount(1);
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export activity',exact:true}).click();
 const download=await downloadEvent;const csv=await require('node:fs/promises').readFile(await download.path(),'utf8');expect(csv).toContain('Verified the replacement uplink during maintenance.');expect(csv).toContain('Timestamp (UTC)');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.getByLabel('Date range',{exact:true}).selectOption('custom');
 await page.getByLabel('From',{exact:true}).fill('2030-01-01');await page.getByLabel('Through',{exact:true}).fill('2020-01-01');
 await expect(page.getByRole('alert')).toContainText('start date must be on or before');
 await expect(page.getByRole('button',{name:'Export activity',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Clear activity filters',exact:true}).click();
 await expect(page.getByLabel('Date range',{exact:true})).toHaveValue('7');
 await expect(page.locator('.activity-record')).toHaveCount(3);
});
