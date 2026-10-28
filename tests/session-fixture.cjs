// Synthetic in-memory API; never initializes a hosted Supabase connection.
function installFakeSupabase(w){
 const user=id=>({id,email:id+'@example.invalid',user_metadata:{full_name:id}});
 const f={current:user('u1'),callback:null,calls:[],before:null,signOutError:false,tables:{
  qb_organizations:[{id:'a',name:'Alpha department group'},{id:'b',name:'Beta department group'}],
  qb_org_members:[{org_id:'a',user_id:'u1',role:'admin',status:'active'},{org_id:'b',user_id:'u1',role:'member',status:'active'},{org_id:'b',user_id:'u2',role:'member',status:'active'}],
  qb_departments:[{id:'da',org_id:'a',name:'Alpha department'},{id:'db',org_id:'b',name:'Beta department'}],
  qb_department_members:[{department_id:'da',user_id:'u1',role:'manager',status:'active'},{department_id:'db',user_id:'u1',role:'viewer',status:'active'}],
  qb_projects:[{id:'pa',org_id:'a',department_id:'da',title:'Alpha secret project',summary:'',visibility:'department',status:'active'},{id:'pb',org_id:'b',department_id:'db',title:'Beta project',summary:'',visibility:'department',status:'active'}],
  qb_project_members:[],qb_tasks:[{id:'ta',project_id:'pa',title:'Alpha secret task',status:'backlog',assignee_id:'u1'},{id:'tb',project_id:'pb',title:'Beta task',status:'backlog',assignee_id:'u2'}],
  qb_checklist:[{id:'ca',task_id:'ta',title:'Alpha checklist',done:false}],
  qb_task_updates:[{id:'ua',task_id:'ta',body:'Alpha private note',author_id:'u1'}],qb_task_events:[],qb_xp_events:[],
  qb_profiles:[{user_id:'u1',display_name:'First account'},{user_id:'u2',display_name:'Second account'}],
  qb_invitations:[],qb_membership_events:[]
 }};
 class Query{
  constructor(table){this.table=table;this.filters=[];this.operation='select';}
  select(){return this;}eq(k,v){this.filters.push([k,[v]]);return this;}in(k,v){this.filters.push([k,v]);return this;}
  order(){return this;}limit(){return this;}upsert(row){this.operation='upsert';this.row=row;return this;}
  insert(row){this.operation='insert';this.row=row;return this;}update(row){this.operation='update';this.row=row;return this;}
  abortSignal(signal){this.signal=signal;return this;}
  then(resolve,reject){return this.run().then(resolve,reject);}
  async run(){const call={table:this.table,filters:this.filters,operation:this.operation,user:f.current?.id,signal:this.signal};f.calls.push(call);
   // Deliberately allow replies after abort, exercising generation checks as well.
   if(f.before)await f.before(call);
   if(this.operation!=='select')return{data:null};
   let rows=f.tables[this.table]||[];rows=rows.filter(row=>this.filters.every(([k,v])=>v.includes(row[k])));
   return{data:JSON.parse(JSON.stringify(rows))};
  }
 }
 f.api={from:table=>new Query(table),rpc(name,args){return{signal:null,abortSignal(signal){this.signal=signal;return this;},async then(resolve,reject){try{const call={rpc:name,args,user:f.current?.id,signal:this.signal};f.calls.push(call);if(f.before)await f.before(call);return resolve({data:[]});}catch(e){return reject(e);}}};},auth:{
  getSession:async()=>({data:{session:f.current?{user:f.current}:null}}),
  onAuthStateChange(cb){f.callback=cb;return{data:{subscription:{unsubscribe(){}}}};},
  async signOut(options){f.calls.push({signOut:options});if(f.signOutError)return{error:{message:'offline'}};f.emit('SIGNED_OUT',null);return{error:null};}
 }};
 f.emit=(event,id)=>{f.current=id?user(id):null;f.callback?.(event,f.current?{user:f.current}:null);};
 w.supabase={createClient:()=>f.api};w.QUESTBOARD_CONFIG={supabaseUrl:'https://synthetic.invalid',supabasePublishableKey:'test-only'};w.fixture=f;return f;
}
module.exports={installFakeSupabase};
