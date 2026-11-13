// Existing focused UI tests use small, one-page replies. Keep their deferred
// responses and mutation calls intact while emulating the terminal empty page.
function withPagedRpc(api){
 const rpc=api.rpc;
 // Legacy focused fixtures do not define the new invited-owner directory.
 const empty=()=>({order(){return this;},range(){return this;},then(resolve){return Promise.resolve({data:[]}).then(resolve);}});
 return {...api,rpc(name,args){
  if(name==='qb_invited_assignment_candidates')return empty();
  if(!['qb_assignment_candidates','qb_membership_directory'].includes(name))return rpc(name,args);
  const result=rpc(name,args);let start=0,end=Infinity;
  return {order(){return this;},range(a,b){start=a;end=b;return this;},then(resolve,reject){return (start?Promise.resolve({data:[]}):Promise.resolve(result).then(r=>({...r,data:r.data?.slice(start,end+1)}))).then(resolve,reject);}};
 }};
}
module.exports={withPagedRpc};
