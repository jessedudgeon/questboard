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
