const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const kube=require('../src/kube.cjs');
const history=require('../src/history.cjs');
const originalRun=kube.run;
afterEach(()=>{kube.run=originalRun;});
const input={context:'cluster-a',source:{namespace:'monitoring',name:'prometheus-server',port:9090,scheme:'http'},range:'1h',metric:'cpu',namespaces:['team-a','team-b']};
test('history service discovery is read-only, context pinned, and excludes unrelated/headless endpoints',async()=>{
 let args;
 kube.run=async received=>{args=received;return JSON.stringify({items:[
  {metadata:{name:'prometheus-server',namespace:'monitoring',labels:{app:'prometheus'}},spec:{clusterIP:'10.0.0.3',ports:[{name:'http-web',port:9090,protocol:'TCP'}]}},
  {metadata:{name:'prometheus-operator',namespace:'monitoring'},spec:{ports:[{name:'https',port:443}]}},
  {metadata:{name:'prometheus-operated',namespace:'monitoring'},spec:{clusterIP:'None',ports:[{name:'http-web',port:9090}]}},
  {metadata:{name:'user-app',namespace:'team'},spec:{ports:[{name:'web',port:80}]}},
 ]});};
 const result=await history.sources({context:'cluster-a'});
 assert.deepEqual(result,[{namespace:'monitoring',name:'prometheus-server',port:9090,scheme:'http',label:'monitoring/prometheus-server:9090'}]);
 assert.equal(args[0],'get');assert.ok(args.includes('--all-namespaces'));assert.equal(args[args.indexOf('--context')+1],'cluster-a');
});
test('query plans select exact namespace sets and bounded range resolution through service proxy',()=>{
 const plan=history.plan(input,1_800_000_000_000);
 const proxy=new URL('https://kube.invalid'+plan.path);
 assert.equal(proxy.pathname,'/api/v1/namespaces/monitoring/services/http:prometheus-server:9090/proxy/api/v1/query_range');
 assert.match(proxy.searchParams.get('query'),/namespace=~"\^\(team-a\|team-b\)\$"/);
 assert.match(proxy.searchParams.get('query'),/rate\(container_cpu_usage_seconds_total/);
 assert.equal(plan.end-plan.start,3600);assert.equal(plan.step,15);
 const week=history.plan({...input,range:'7d',metric:'memory'});assert.ok((week.end-week.start)/week.step<=500);assert.equal(week.unit,'bytes');
});
test('untrusted source and selection fields cannot become arbitrary URLs or PromQL',()=>{
 for(const source of [{...input.source,name:'https://attacker.test'},{...input.source,namespace:'a/../b'},{...input.source,scheme:'file'},{...input.source,port:0}])assert.throws(()=>history.plan({...input,source}),/Invalid|must be/);
 assert.throws(()=>history.plan({...input,namespaces:['team-a"} or up']}),/namespace/);
 assert.throws(()=>history.plan({...input,metric:'up'}),/Unsupported/);
 assert.throws(()=>history.plan({...input,range:'constructor'}),/Unsupported/);
 assert.throws(()=>history.plan({...input,context:'--server=bad'}),/context/);
 assert.throws(()=>history.plan({...input,namespaces:Array.from({length:51},(_,i)=>'ns-'+i)}),/50 namespaces/);
});
test('query returns actual finite samples, omits nonfinite values and keeps empty results empty',async()=>{
 let args;
 kube.run=async received=>{args=received;const url=new URL('https://kube.invalid'+received.at(-1));const start=Number(url.searchParams.get('start'));return JSON.stringify({status:'success',data:{resultType:'matrix',result:[{metric:{namespace:'team-a'},values:[[start,'2.5'],[start+15,'NaN'],[start+30,null],[start+45,'3.5']]}]}});};
 const result=await history.query(input);assert.equal(result.series.length,1);assert.equal(result.series[0].values.length,2);assert.deepEqual(result.series[0].values.map(p=>p[1]),[2.5,3.5]);assert.equal(args[args.indexOf('--context')+1],'cluster-a');assert.ok(args.includes('--raw'));
 kube.run=async()=>JSON.stringify({status:'success',data:{resultType:'matrix',result:[]}});
 assert.deepEqual((await history.query(input)).series,[]);
});
test('Prometheus errors, unexpected result types and RBAC failures stay actionable',async()=>{
 kube.run=async()=>JSON.stringify({status:'error',errorType:'timeout',error:'query deadline exceeded'});
 await assert.rejects(history.query(input),/query deadline exceeded/);
 kube.run=async()=>JSON.stringify({status:'success',data:{resultType:'vector',result:[]}});
 await assert.rejects(history.query(input),/unexpected range-query/);
 kube.run=async()=>{throw new Error('Forbidden: services/proxy denied');};
 await assert.rejects(history.query(input),/monitoring\/prometheus-server.*services\/proxy denied/);
});
test('large series responses are bounded and report selection truncation',async()=>{
 kube.run=async()=>JSON.stringify({status:'success',warnings:['partial remote read'],data:{resultType:'matrix',result:Array.from({length:25},(_,i)=>({metric:{namespace:'ns-'+i},values:[]}))}});
 const result=await history.query(input);assert.equal(result.series.length,20);assert.match(result.errors.join(' '),/partial remote read/);assert.match(result.errors.join(' '),/20 namespace series/);
});
