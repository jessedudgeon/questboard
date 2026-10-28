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
