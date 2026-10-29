// Original el-d90 declaration/selector topology. This is not observed network traffic.
const kube=require('./kube.cjs');
const BASE=['deployments','statefulsets','daemonsets','replicasets','pods','services','ingresses','persistentvolumeclaims','networkpolicies'];
const API_FAMILIES=Object.freeze({
 gateway:['gateways.gateway.networking.k8s.io','gatewayclasses.gateway.networking.k8s.io','httproutes.gateway.networking.k8s.io','grpcroutes.gateway.networking.k8s.io','tcproutes.gateway.networking.k8s.io','tlsroutes.gateway.networking.k8s.io','udproutes.gateway.networking.k8s.io','referencegrants.gateway.networking.k8s.io'],
 admission:['validatingwebhookconfigurations.admissionregistration.k8s.io','mutatingwebhookconfigurations.admissionregistration.k8s.io','validatingadmissionpolicies.admissionregistration.k8s.io','validatingadmissionpolicybindings.admissionregistration.k8s.io','mutatingadmissionpolicies.admissionregistration.k8s.io','mutatingadmissionpolicybindings.admissionregistration.k8s.io'],
 devices:['deviceclasses.resource.k8s.io','resourceclaims.resource.k8s.io','resourceclaimtemplates.resource.k8s.io','resourceslices.resource.k8s.io'],
});
function cleanLabels(labels){return Object.fromEntries(Object.entries(labels||{}).filter(([k,v])=>typeof v==='string').slice(0,50).map(([k,v])=>[String(k).slice(0,253),v.slice(0,512)]));}
function status(object){const s=object.status||{};if(object.kind==='Pod')return s.phase||'Unknown';if(['Deployment','StatefulSet','ReplicaSet'].includes(object.kind))return `${s.readyReplicas||0}/${object.spec?.replicas??1} ready`;if(object.kind==='DaemonSet')return `${s.numberReady||0}/${s.desiredNumberScheduled||0} ready`;return s.phase||'Declared';}
function matches(labels,selector,emptyMatches=false){
 if(!selector||typeof selector!=='object'||Array.isArray(selector))return false;
 const ordinary=selector.matchLabels||(!('matchExpressions'in selector)?selector:{}),expressions=selector.matchExpressions||[];
 if(!Object.keys(ordinary).length&&!expressions.length)return emptyMatches;
 if(!Object.entries(ordinary).every(([k,v])=>labels?.[k]===v))return false;
 return expressions.every(e=>e.operator==='In'?Array.isArray(e.values)&&e.values.includes(labels?.[e.key]):e.operator==='NotIn'?Array.isArray(e.values)&&!e.values.includes(labels?.[e.key]):e.operator==='Exists'?Object.hasOwn(labels||{},e.key):e.operator==='DoesNotExist'?!Object.hasOwn(labels||{},e.key):false);
}
function build(context,records,options={}){
 const maxNodes=Math.max(1,Math.min(1500,options.maxNodes||1500)),maxEdges=Math.max(1,Math.min(3000,options.maxEdges||3000)),warnings=[...(options.warnings||[])];
 const selected=options.namespaces||[];const admitted=records.filter(r=>r?.metadata?.name&&r.kind&&(!selected.length||selected.includes(r.metadata.namespace)));
 const dedup=new Map();for(const r of admitted){const key=[r.kind,r.metadata.namespace||'',r.metadata.uid||r.metadata.name].join('|');if(!dedup.has(key))dedup.set(key,r);}
 const all=[...dedup.values()],objects=all.slice(0,maxNodes);if(all.length>maxNodes)warnings.push(`Topology includes the first ${maxNodes} of ${all.length} resources. Narrow namespace selection.`);
 const nodes=objects.map((r,i)=>({id:JSON.stringify([context,r.kind,r.metadata.namespace||'',r.metadata.uid||r.metadata.name]),resource:r.__resource,kind:r.kind,name:r.metadata.name,namespace:r.metadata.namespace||'',uid:r.metadata.uid||null,status:status(r),labels:cleanLabels(r.metadata.labels)}));
 const byObject=new Map(objects.map((r,i)=>[r,nodes[i]])),byUID=new Map(nodes.filter(n=>n.uid).map(n=>[n.uid,n])),byName=new Map(nodes.map(n=>[[n.kind,n.namespace,n.name].join('|'),n])),edges=[],keys=new Set();let omitted=0;
 function edge(from,to,type,evidence,confidence='observed'){if(!from||!to||from.id===to.id)return;const key=[from.id,to.id,type].join('::');if(keys.has(key))return;if(edges.length>=maxEdges){omitted++;return;}keys.add(key);edges.push({from:from.id,to:to.id,type,evidence,confidence});}
 const find=(kind,ns,name)=>byName.get([kind,ns,name].join('|'));
 for(const r of objects){const n=byObject.get(r),ns=n.namespace;
  for(const ref of r.metadata.ownerReferences||[]){const owner=byUID.get(ref.uid);if(owner&&owner.namespace===ns&&owner.kind===ref.kind)edge(owner,n,'owns',`metadata.ownerReferences UID ${ref.uid}`);}
  if(r.kind==='Service'&&Object.keys(r.spec?.selector||{}).length){for(const pod of objects.filter(p=>p.kind==='Pod'&&p.metadata.namespace===ns))if(matches(pod.metadata.labels,{matchLabels:r.spec.selector}))edge(n,byObject.get(pod),'selects','Service spec.selector matches Pod labels','inferred');}
  if(['Deployment','StatefulSet','DaemonSet','ReplicaSet'].includes(r.kind)&&r.spec?.selector){for(const pod of objects.filter(p=>p.kind==='Pod'&&p.metadata.namespace===ns))if(matches(pod.metadata.labels,r.spec.selector))edge(n,byObject.get(pod),'selects-workload','Workload spec.selector matches Pod labels','inferred');}
  if(r.kind==='Ingress'){const backends=[r.spec?.defaultBackend,...(r.spec?.rules||[]).flatMap(rule=>(rule.http?.paths||[]).map(p=>p.backend))];for(const backend of backends){const service=backend?.service?.name||backend?.serviceName;if(service)edge(n,find('Service',ns,service),'routes-to','Ingress backend Service name');}}
  if(r.kind==='Pod')for(const volume of r.spec?.volumes||[]){const claim=volume.persistentVolumeClaim?.claimName;if(claim)edge(n,find('PersistentVolumeClaim',ns,claim),'mounts','Pod volume persistentVolumeClaim.claimName');}
  if(r.kind==='NetworkPolicy')for(const pod of objects.filter(p=>p.kind==='Pod'&&p.metadata.namespace===ns))if(matches(pod.metadata.labels,r.spec?.podSelector,true))edge(n,byObject.get(pod),'policy-selects','NetworkPolicy podSelector applies to Pod labels','inferred');
 }
 if(omitted)warnings.push(`${omitted} additional relationship candidates omitted by the ${maxEdges}-edge bound.`);
 const appById=new Map(nodes.map(n=>[n.id,n.labels['app.kubernetes.io/part-of']||n.labels['app.kubernetes.io/name']||n.labels.app||'']));
 for(let pass=0;pass<8;pass++){let changed=false;for(const n of nodes){if(appById.get(n.id))continue;const owning=edges.filter(e=>e.to===n.id&&e.type==='owns').map(e=>appById.get(e.from)).filter(Boolean);if(new Set(owning).size===1){appById.set(n.id,owning[0]);changed=true;continue;}const connected=edges.filter(e=>e.from===n.id&&['selects','routes-to','mounts'].includes(e.type)).map(e=>appById.get(e.to)).filter(Boolean);if(new Set(connected).size===1){appById.set(n.id,connected[0]);changed=true;}}if(!changed)break;}
 const groups=new Map();for(const n of nodes){n.application=appById.get(n.id)||'Ungrouped';const id=n.namespace+'|'+n.application;if(!groups.has(id))groups.set(id,{id,name:n.application,namespace:n.namespace,nodeIds:[],kinds:{}});const a=groups.get(id);a.nodeIds.push(n.id);a.kinds[n.kind]=(a.kinds[n.kind]||0)+1;}
 return{nodes,edges,applications:[...groups.values()].sort((a,b)=>(a.namespace+'/'+a.name).localeCompare(b.namespace+'/'+b.name)),warnings:[...new Set(warnings)],summary:{resources:nodes.length,relationships:edges.length,applications:groups.size,observed:edges.filter(e=>e.confidence==='observed').length,inferred:edges.filter(e=>e.confidence==='inferred').length},coverage:{nodesExamined:all.length,nodesReturned:nodes.length,edgesOmitted:omitted,scope:'resource declarations and selector candidates; no traffic observation'}};
}
async function snapshot(input){
 const context=kube.string(input.context,'context'),namespaces=kube.selectedNamespaces(input);
 const results=await Promise.allSettled(BASE.map(resource=>kube.list({...input,resource})));
 const records=[],warnings=[];for(let i=0;i<results.length;i++){const r=results[i];if(r.status==='fulfilled'){records.push(...(r.value.items||[]).map(item=>({...item,__resource:BASE[i]})));warnings.push(...(r.value.warnings||[]).map(w=>`${BASE[i]}: ${w}`));}else warnings.push(`${BASE[i]} unavailable: ${r.reason.message}`);}
 if(results.every(r=>r.status==='rejected'))throw new Error('Application topology unavailable: '+warnings.join('\n'));
 return build(context,records,{namespaces,warnings});
}
function summarizeApiObject(object,resource){
 const m=object.metadata||{},spec=object.spec||{},references=[];
 for(const w of object.webhooks||[])if(w.clientConfig?.service)references.push({type:'webhook-service',...w.clientConfig.service});
 for(const p of spec.parentRefs||[])references.push({type:'parent',kind:p.kind||'Gateway',name:p.name,namespace:p.namespace||m.namespace});
 for(const rule of spec.rules||[])for(const ref of rule.backendRefs||[])references.push({type:'backend',kind:ref.kind||'Service',name:ref.name,namespace:ref.namespace||m.namespace,port:ref.port});
 for(const ref of spec.to||[])references.push({type:'reference-grant-target',kind:ref.kind,name:ref.name||'*',group:ref.group||''});
 for(const ref of spec.from||[])references.push({type:'reference-grant-source',kind:ref.kind,namespace:ref.namespace,group:ref.group||''});
 if(spec.policyName)references.push({type:'admission-policy',name:spec.policyName});
 if(spec.paramRef?.name)references.push({type:'policy-parameter',name:spec.paramRef.name,namespace:spec.paramRef.namespace});
 if(spec.gatewayClassName)references.push({type:'gateway-class',kind:'GatewayClass',name:spec.gatewayClassName});
 for(const claim of spec.devices?.requests||[])references.push({type:'device-class',kind:'DeviceClass',name:claim.deviceClassName||claim.exactly?.deviceClassName});
 if(spec.driver)references.push({type:'device-driver',name:spec.driver});
 if(spec.nodeName)references.push({type:'node',kind:'Node',name:spec.nodeName});
 const conditions=(object.status?.conditions||[]).map(c=>({type:c.type,status:c.status,reason:c.reason,message:c.message}));
 return{resource,kind:object.kind,name:m.name,namespace:m.namespace||'',uid:m.uid||null,labels:cleanLabels(m.labels),references,conditions,details:{controller:spec.controllerName||object.controllerName||null,addressCount:object.status?.addresses?.length||0,webhooks:object.webhooks?.length||0,deviceCount:spec.devices?.length||0}};
}
async function apiInspection(input){
 const resource=kube.string(input.resource,'resource');if(!Object.values(API_FAMILIES).flat().includes(resource))throw new Error('Choose a supported Gateway, admission or device resource');
 const result=await kube.list(input);return{resource,items:(result.items||[]).map(r=>summarizeApiObject(r,resource)),warnings:result.warnings||[],coverage:'Declared references and conditions; enforcement, routing and physical device availability are not observed.'};
}
module.exports={snapshot,build,matches,apiInspection,summarizeApiObject,API_FAMILIES};
