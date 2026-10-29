const {test,afterEach}=require('node:test');const assert=require('node:assert/strict');const kube=require('../src/kube.cjs');const topology=require('../src/topology.cjs');const original=kube.list;afterEach(()=>kube.list=original);
const resource=(kind,name,namespace='team',extra={})=>({kind,metadata:{name,namespace,uid:namespace+'-'+kind+'-'+name,...extra.metadata},spec:extra.spec||{},status:extra.status||{}});
function fixtures(){
 const deployment=resource('Deployment','web','team',{metadata:{labels:{'app.kubernetes.io/name':'web'}},spec:{selector:{matchLabels:{app:'web'}},replicas:2},status:{readyReplicas:2}});
 const replica=resource('ReplicaSet','web-rs','team',{metadata:{ownerReferences:[{uid:deployment.metadata.uid,kind:'Deployment'}]}});
 const pod=resource('Pod','web-rs-a','team',{metadata:{labels:{app:'web'},ownerReferences:[{uid:replica.metadata.uid,kind:'ReplicaSet'}]},spec:{containers:[{env:[{name:'TOKEN',value:'do-not-return'}]}],volumes:[{persistentVolumeClaim:{claimName:'data'}}]},status:{phase:'Running'}});
 const service=resource('Service','web','team',{spec:{selector:{app:'web'}}});
 const ingress=resource('Ingress','edge','team',{spec:{rules:[{http:{paths:[{backend:{service:{name:'web',port:{number:80}}}}]}}]}});
 return[deployment,replica,pod,service,ingress,resource('PersistentVolumeClaim','data')];
}
test('owner references, backend references, PVC mounts and service selector matches keep distinct evidence',()=>{
 const graph=topology.build('a',fixtures());const byId=new Map(graph.nodes.map(n=>[n.id,n]));const edges=graph.edges.map(e=>[byId.get(e.from).kind,byId.get(e.to).kind,e.type,e.confidence]);
 assert.ok(edges.some(e=>e.join('/')==='Deployment/ReplicaSet/owns/observed'));assert.ok(edges.some(e=>e.join('/')==='ReplicaSet/Pod/owns/observed'));assert.ok(edges.some(e=>e.join('/')==='Service/Pod/selects/inferred'));assert.ok(edges.some(e=>e.join('/')==='Ingress/Service/routes-to/observed'));assert.ok(edges.some(e=>e.join('/')==='Pod/PersistentVolumeClaim/mounts/observed'));
 assert.equal(JSON.stringify(graph).includes('do-not-return'),false);assert.ok(graph.nodes.every(n=>!('spec'in n)));assert.ok(graph.applications.some(a=>a.name==='web'));
});
test('selectors and object references never cross namespaces or bind an empty Service selector to every pod',()=>{
 const rows=fixtures();const foreign=resource('Pod','foreign','other',{metadata:{labels:{app:'web'},ownerReferences:[{uid:rows[0].metadata.uid,kind:'Deployment'}]}});rows.push(foreign,resource('Service','external','team'));
 const graph=topology.build('a',rows);const foreignId=graph.nodes.find(n=>n.name==='foreign').id,externalId=graph.nodes.find(n=>n.name==='external').id;assert.equal(graph.edges.some(e=>e.from===foreignId||e.to===foreignId),false);assert.equal(graph.edges.some(e=>e.from===externalId),false);
 const scoped=topology.build('a',rows,{namespaces:['team']});assert.equal(scoped.nodes.some(n=>n.namespace==='other'),false);
});
test('label selector expressions implement conjunction and correct missing-label semantics',()=>{
 assert.equal(topology.matches({app:'web',tier:'frontend'},{matchLabels:{app:'web'},matchExpressions:[{key:'tier',operator:'In',values:['frontend']},{key:'disabled',operator:'DoesNotExist'}]}),true);
 assert.equal(topology.matches({app:'web'},{matchExpressions:[{key:'tier',operator:'Exists'}]}),false);assert.equal(topology.matches({},{matchExpressions:[{key:'tier',operator:'NotIn',values:['a']}]}),true);assert.equal(topology.matches({},{}),false);assert.equal(topology.matches({}, {},true),true);
});
test('snapshot forwards selected namespace sets and preserves resource-specific partial failures',async()=>{
 const calls=[];kube.list=async input=>{calls.push(input);if(input.resource==='networkpolicies')throw new Error('Forbidden');if(input.resource==='pods')return{items:[fixtures()[2]],warnings:['other: forbidden']};return{items:[]};};
 const graph=await topology.snapshot({context:'a',namespaces:['team','other']});assert.equal(calls.length,9);assert.ok(calls.every(i=>i.context==='a'&&i.namespaces.join(',')==='team,other'));assert.match(graph.warnings.join('\n'),/networkpolicies unavailable.*Forbidden/);assert.match(graph.warnings.join('\n'),/pods: other: forbidden/);assert.equal(graph.nodes.length,1);
});
test('fully unavailable snapshots fail explicitly instead of looking like an empty app',async()=>{kube.list=async()=>{throw new Error('Forbidden');};await assert.rejects(topology.snapshot({context:'a',namespace:'team'}),/topology unavailable/);});
test('node and edge bounds remain explicit and identity is stable across input order',()=>{
 const rows=fixtures(),one=topology.build('a',rows),two=topology.build('a',[...rows].reverse());assert.deepEqual(new Set(one.nodes.map(n=>n.id)),new Set(two.nodes.map(n=>n.id)));
 const bounded=topology.build('a',rows,{maxNodes:3,maxEdges:1});assert.equal(bounded.nodes.length,3);assert.equal(bounded.edges.length,1);assert.match(bounded.warnings.join('\n'),/first 3/);assert.ok(bounded.coverage.edgesOmitted>0);
});
test('dedicated API projections expose declared references and conditions without certificates or full specs',async()=>{
 const object=resource('HTTPRoute','api','team',{spec:{parentRefs:[{name:'public'}],rules:[{backendRefs:[{name:'api',port:8080}]}]},status:{conditions:[{type:'Accepted',status:'True',reason:'Accepted'}]}});kube.list=async()=>({items:[object],warnings:[]});const result=await topology.apiInspection({context:'a',resource:'httproutes.gateway.networking.k8s.io'});assert.equal(result.items[0].references[0].kind,'Gateway');assert.equal(result.items[0].references[1].name,'api');assert.equal(result.items[0].conditions[0].type,'Accepted');
 const webhook={kind:'ValidatingWebhookConfiguration',metadata:{name:'test'},webhooks:[{clientConfig:{service:{name:'hook',namespace:'system'},caBundle:'SECRET-CERT'}}]};const projected=topology.summarizeApiObject(webhook,'validatingwebhookconfigurations.admissionregistration.k8s.io');assert.equal(projected.references[0].name,'hook');assert.equal(JSON.stringify(projected).includes('SECRET-CERT'),false);
 await assert.rejects(topology.apiInspection({context:'a',resource:'secrets'}),/supported Gateway/);
});
