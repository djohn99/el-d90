// Original read-only GitOps projections. These are controller declarations, not traffic evidence.
const kube=require('./kube.cjs');
const TYPES=Object.freeze([
 ['applications.argoproj.io','Argo CD'],['appprojects.argoproj.io','Argo CD'],['applicationsets.argoproj.io','Argo CD'],
 ['kustomizations.kustomize.toolkit.fluxcd.io','Flux'],['helmreleases.helm.toolkit.fluxcd.io','Flux'],
 ['gitrepositories.source.toolkit.fluxcd.io','Flux'],['ocirepositories.source.toolkit.fluxcd.io','Flux'],['helmrepositories.source.toolkit.fluxcd.io','Flux'],['buckets.source.toolkit.fluxcd.io','Flux'],['helmcharts.source.toolkit.fluxcd.io','Flux'],
]);
function clean(value,max=1500){return typeof value==='string'?value.slice(0,max):'';}
function safeURL(value){const text=clean(value,2048);try{const u=new URL(text);u.username='';u.password='';u.search='';u.hash='';return u.href;}catch{return text.replace(/(https?:\/\/)[^/@\s]+@/g,'$1[redacted]@');}}
function ref(object,resource,context){return {context,resource,resourceKind:object.kind,name:object.metadata.name,namespace:object.metadata.namespace||'',uid:object.metadata.uid||null};}
function conditionRows(object){return(object.status?.conditions||[]).slice(0,30).map(c=>({type:clean(c.type,100),status:clean(c.status,50),reason:clean(c.reason,150),message:clean(c.message),lastTransitionTime:clean(c.lastTransitionTime,100)}));}
function project(object,resource,context){
 const m=object.metadata||{},s=object.status||{},spec=object.spec||{},conditions=conditionRows(object),ready=conditions.find(c=>c.type==='Ready');let health=ready?.status==='True'?'Ready':ready?.status==='False'?'Not ready':'Unknown',sync='';
 if(object.kind==='Application'){health=s.health?.status||'Unknown';sync=s.sync?.status||'Unknown';}
 else if(spec.suspend)health='Suspended';
 const row={...ref(object,resource,context),provider:TYPES.find(t=>t[0]===resource)?.[1]||'GitOps',health,sync,suspended:!!spec.suspend,conditions,revision:clean(s.sync?.revision||s.lastAppliedRevision||s.lastAttemptedRevision||s.artifact?.revision,300),lastReconciled:clean(s.lastHandledReconcileAt||s.reconciledAt||s.artifact?.lastUpdateTime,100),source:null,destination:null,history:[],managedResources:[],references:[],summary:{}};
 if(object.kind==='Application'){
  row.source={project:clean(spec.project,253),sources:(spec.sources||(spec.source?[spec.source]:[])).slice(0,20).map(v=>({repoURL:safeURL(v.repoURL),path:clean(v.path,500),chart:clean(v.chart,253),targetRevision:clean(v.targetRevision,300)}))};
  row.destination={server:safeURL(spec.destination?.server),name:clean(spec.destination?.name,253),namespace:clean(spec.destination?.namespace,253),local:spec.destination?.server==='https://kubernetes.default.svc'};
  row.history=(s.history||[]).slice(-20).reverse().map(h=>({id:h.id,revision:clean(h.revision,300),deployedAt:clean(h.deployedAt,100),deployStartedAt:clean(h.deployStartedAt,100)}));
  row.managedResources=(s.resources||[]).slice(0,200).map(r=>({group:clean(r.group,253),kind:clean(r.kind,100),version:clean(r.version,100),name:clean(r.name,253),namespace:clean(r.namespace||spec.destination?.namespace,253),uid:clean(r.uid,128),sync:clean(r.status,100),health:clean(r.health?.status,100),verified:false,reason:row.destination.local?'Not yet verified in this cluster':'Remote or unverified destination; local navigation is disabled'}));
 } else if(object.kind==='AppProject'){
  row.summary={sourceRepositories:(spec.sourceRepos||[]).slice(0,40).map(safeURL),destinations:(spec.destinations||[]).slice(0,40).map(v=>({server:safeURL(v.server),name:clean(v.name,253),namespace:clean(v.namespace,253)})),roles:(spec.roles||[]).slice(0,40).map(v=>clean(v.name,253))};
 } else if(object.kind==='ApplicationSet'){
  row.summary={generators:(spec.generators||[]).slice(0,30).map(g=>Object.keys(g).filter(k=>k!=='template').join(', ')),templateProject:clean(spec.template?.spec?.project,253)};
 } else {
  const source=spec.sourceRef||spec.chartRef||spec.chart?.spec?.sourceRef||{};if(source.kind&&source.name)row.references.push({kind:clean(source.kind,100),name:clean(source.name,253),namespace:clean(source.namespace||m.namespace,253),verified:false});
  row.source={url:safeURL(spec.url),reference:spec.ref?{branch:clean(spec.ref.branch,300),tag:clean(spec.ref.tag,300),commit:clean(spec.ref.commit,300)}:null};
  row.destination={namespace:clean(spec.targetNamespace||m.namespace,253),local:!spec.kubeConfig};
  row.summary={interval:clean(spec.interval,100),path:clean(spec.path,500),chart:clean(spec.chart?.spec?.chart,253),chartVersion:clean(spec.chart?.spec?.version,100),inventoryCount:s.inventory?.entries?.length||0};
  row.history=(Array.isArray(s.history)?s.history:[]).slice(-20).reverse().map(h=>({revision:clean(h.revision||h.digest||h.chartVersion,300),deployedAt:clean(h.lastDeployed||h.firstDeployed,100),status:clean(h.status,100)}));
  row.managedResources=(s.inventory?.entries||[]).slice(0,200).flatMap(entry=>{const parts=typeof entry.id==='string'?entry.id.split('_'):[];if(parts.length!==4||!parts[1]||!parts[3])return[];return[{namespace:clean(parts[0],253),name:clean(parts[1],253),group:clean(parts[2],253),kind:clean(parts[3],100),version:clean(entry.v,100),uid:'',verified:false,reason:row.destination.local?'Not yet verified in this cluster':'Remote Flux kubeConfig; local navigation is disabled'}];});
  row.summary.unparsedInventory=Math.min(200,s.inventory?.entries?.length||0)-row.managedResources.length;
  // Flux kubeConfig can point at another cluster. Do not infer local resource links.
 }
 return row;
}
async function snapshot(input,options={}){
 const context=kube.string(input.context,'context'),namespaces=kube.selectedNamespaces(input),catalog=(options.discover?await options.discover({context}):await kube.discover({context})).resources,warnings=[],records=[],items=[];
 const supported=TYPES.filter(([resource])=>catalog.some(r=>r.key===resource));
 const results=await Promise.allSettled(supported.map(async([resource])=>({resource,data:await(options.list||kube.list)({context,resource,namespaces})})));
 results.forEach((r,i)=>{if(r.status==='rejected'){warnings.push(supported[i][0]+': '+r.reason.message);return;}warnings.push(...(r.value.data.warnings||[]));for(const object of(r.value.data.items||[]).slice(0,1000)){if(!object?.metadata?.name)continue;if(items.length>=1500){warnings.push('GitOps inventory is limited to 1,500 controller resources. Select namespaces to narrow the view.');break;}records.push({object,resource:r.value.resource});items.push(project(object,r.value.resource,context));}});
 // ApplicationSet generated Applications are linked only by actual owner UID/kind/namespace.
 for(const set of items.filter(r=>r.resourceKind==='ApplicationSet')){
  set.summary.generatedApplications=records.filter(r=>set.uid&&r.object.kind==='Application'&&r.object.metadata.namespace===set.namespace&&(r.object.metadata.ownerReferences||[]).some(o=>o.kind==='ApplicationSet'&&o.uid===set.uid)).map(r=>ref(r.object,r.resource,context));set.references.push(...set.summary.generatedApplications.map(target=>({kind:target.resourceKind,name:target.name,namespace:target.namespace,verified:true,target})));
 }
 const byKindName=new Map(items.map(row=>[[row.resourceKind,row.namespace,row.name].join('|'),row]));
 for(const row of items)for(const target of row.references){const known=byKindName.get([target.kind,target.namespace,target.name].join('|'));if(known){target.verified=true;target.target={context,resource:known.resource,resourceKind:known.resourceKind,name:known.name,namespace:known.namespace,uid:known.uid};}}
 const tasks=new Map();let referenceBudget=2000;
 for(const row of items.filter(r=>r.destination?.local&&r.managedResources.length))for(const target of row.managedResources){
  if(!target.name||!target.kind)continue;if(--referenceBudget<0){target.reason='Managed-resource verification is limited to 2,000 references';continue;}const entry=catalog.find(d=>d.kind===target.kind&&d.group===target.group&&(!target.version||d.apiVersion===(target.group?target.group+'/':'')+target.version));
  if(!entry){target.reason='API kind/version is not served or is not listable';continue;}
  if(!entry.namespaced)target.namespace='';const ns=entry.namespaced?target.namespace:'';if(entry.namespaced&&!ns){target.reason='Namespace not declared';continue;}
  const key=entry.key+'|'+ns;if(!tasks.has(key)){if(tasks.size>=32){target.reason='Verification read bound reached';continue;}tasks.set(key,{entry,namespace:ns,targets:[]});}tasks.get(key).targets.push(target);
 }
 const queue=[...tasks.values()];let next=0;
 await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{while(next<queue.length){const task=queue[next++];try{const data=await(options.list||kube.list)({context,resource:task.entry.key,namespaces:task.namespace?[task.namespace]:[],namespace:task.namespace||'*'});for(const target of task.targets){const object=(data.items||[]).find(r=>r.kind===target.kind&&(!task.entry.apiVersion||r.apiVersion===task.entry.apiVersion)&&r.metadata?.name===target.name&&(!task.entry.namespaced||r.metadata?.namespace===target.namespace)&&(!target.uid||target.uid===r.metadata.uid));if(object?.metadata?.uid){target.verified=true;target.reason='Verified current resource in the declared local destination';target.target=ref(object,task.entry.key,context);}else target.reason='Resource is missing or its recorded UID does not match';}warnings.push(...(data.warnings||[]));}catch(e){for(const target of task.targets)target.reason='Resource verification unavailable';warnings.push(task.entry.key+': '+e.message);}}}));
 return {context,items:items.slice(0,3000),available:supported.map(([resource,provider])=>({resource,provider})),missing:TYPES.filter(([r])=>!supported.some(([s])=>s===r)).map(([resource])=>resource),warnings:[...new Set(warnings)].map(w=>clean(w)),coverage:'Read-only controller status and declared references. Remote or unverified managed resources cannot navigate to same-named local resources.',sampledAt:new Date().toISOString()};
}
module.exports={snapshot,project,TYPES,safeURL};
