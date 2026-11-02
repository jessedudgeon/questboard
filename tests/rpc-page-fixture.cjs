// Existing focused UI tests use small, one-page replies. Keep their deferred
// responses and mutation calls intact while emulating the terminal empty page.
function withPagedRpc(api){
 const rpc=api.rpc;
 return {...api,rpc(name,args){
  if(!['qb_assignment_candidates','qb_membership_directory'].includes(name))return rpc(name,args);
  const result=rpc(name,args);let start=0,end=Infinity;
  return {order(){return this;},range(a,b){start=a;end=b;return this;},then(resolve,reject){return (start?Promise.resolve({data:[]}):Promise.resolve(result).then(r=>({...r,data:r.data?.slice(start,end+1)}))).then(resolve,reject);}};
 }};
}
module.exports={withPagedRpc};
