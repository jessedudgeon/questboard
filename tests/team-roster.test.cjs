const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
function app(){const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://projects.dudgeon.io',runScripts:'outside-only'});dom.window.eval(fs.readFileSync(__dirname+'/../dist/app.js','utf8').replace('  init();','  globalThis.qa={s,membership,loadDemo,teamPage,handleClick};'));const q=dom.window.qa;q.loadDemo();return{dom,q};}
test('Team includes organization-only members and pending invites, without duplicating accepted invitations',()=>{
 const {dom,q}=app();try{q.s.demo=false;q.s.orgMembership.is_owner=true;q.s.orgMembers=[{user_id:'demo-user',status:'active',role:'admin',is_owner:true},{user_id:'org-only',status:'active',role:'member'}];q.s.profiles.push({user_id:'org-only',display_name:'Organization only'});q.s.invitations=[{id:'pending',invited_email:'new@example.com',scope_type:'organization',invite_role:'member',status:'pending',expires_at:'2099-01-01'},{id:'accepted',invited_email:'accepted@example.com',scope_type:'organization',invite_role:'member',status:'accepted'}];const html=q.teamPage();assert.match(html,/Organization only/);assert.doesNotMatch(html,/No team members yet/);assert.match(html,/No department assigned/);assert.match(html,/new@example.com/);assert.match(html,/Pending acceptance/);assert.match(html,/Owner/);assert.doesNotMatch(html,/accepted@example.com/);assert.match(html,/Add team member/);assert.match(html,/manage-team-scope/);
 }finally{dom.window.close();}
});
test('Expired invitations stay visible with replacement action, escaped names and no unusable copy link',()=>{
 const {dom,q}=app();try{q.s.invitations=[{id:'expired',invited_email:'<img src=x>@example.com',scope_type:'department',scope_id:'it',invite_role:'department_manager',status:'pending',expires_at:'2000-01-01'}];const html=q.teamPage();assert.match(html,/Expired/);assert.match(html,/Create replacement invite/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/data-action="copy-invite"/);assert.doesNotMatch(html,/<img src=x>/);
 }finally{dom.window.close();}
});
test('Replacing an expired invitation preserves recipient, scope and intended leadership role',async()=>{
 const {dom,q}=app();try{q.s.invitations=[{id:'expired',invited_email:'manager@example.com',scope_type:'department',scope_id:'it',invite_role:'department_manager',status:'pending',expires_at:'2000-01-01'}];await q.handleClick({dataset:{action:'replace-invite',id:'expired'}});const form=dom.window.document.querySelector('form[data-form="invite"]');assert.equal(form.elements.invited_email.value,'manager@example.com');assert.equal(form.elements.scope.value,'dept:it');assert.equal(form.elements.invite_role.value,'department_manager');
 }finally{dom.window.close();}
});
