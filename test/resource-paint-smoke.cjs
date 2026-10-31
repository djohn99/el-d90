const {_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'eld90-resource-paint-'));let app;
(async()=>{try{
 app=await _electron.launch({executablePath:process.env.EL_D90_APP_EXECUTABLE||require('electron'),args:process.env.EL_D90_APP_EXECUTABLE?[]:[root],cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'',EL_D90_USER_DATA:temp,EL_D90_KUBECTL:path.join(root,'test/mock-kubectl.cjs')}});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({ipcMain})=>{
  global.paintProbe={next:0,reads:[],pending:new Map()};
  for(const channel of ['pods:table-data','nodes:table-data','deployments:metrics']){ipcMain.removeHandler(channel);ipcMain.handle(channel,(_event,input)=>new Promise(resolve=>{const id=++global.paintProbe.next,record={id,channel,context:input.context,requestId:input.requestId};global.paintProbe.reads.push(record);global.paintProbe.pending.set(id,{...record,resolve});}));}
  ipcMain.removeHandler('kube:list');ipcMain.handle('kube:list',(_event,input)=>{
   const suffix=input.context==='fixture-b'?'b':'a',namespace='team',metadata=name=>({name:name+'-'+suffix,namespace,uid:name+'-'+suffix+'-uid',creationTimestamp:'2026-10-31T00:00:00Z'});
   if(input.resource==='namespaces')return{items:[{kind:'Namespace',metadata:{name:'team'}}]};
   if(input.resource==='pods')return{items:[{apiVersion:'v1',kind:'Pod',metadata:metadata('pod'),spec:{containers:[{name:'web',image:'fixture:1'}]},status:{phase:'Running',containerStatuses:[{name:'web',ready:true}]}}]};
   if(input.resource==='nodes')return{items:[{apiVersion:'v1',kind:'Node',metadata:{...metadata('node'),namespace:undefined},status:{allocatable:{cpu:'2',memory:'4Gi',pods:'50'},capacity:{cpu:'2',memory:'4Gi'},conditions:[{type:'Ready',status:'True'}]}}]};
   if(input.resource==='deployments')return{items:[{apiVersion:'apps/v1',kind:'Deployment',metadata:metadata('deployment'),spec:{replicas:1,selector:{matchLabels:{app:'fixture'}}},status:{readyReplicas:1}}]};
   if(input.resource==='configmaps')return{items:[{apiVersion:'v1',kind:'ConfigMap',metadata:metadata('config'),data:{setting:'synthetic'}}]};
   return{items:[]};
  });
 });
 await page.locator('#context option[value="fixture-a"]').waitFor({state:'attached'});
 await page.evaluate(()=>{window.paintDeliveries=[];const original=invoke;invoke=async(channel,input)=>{const result=await original(channel,input);if(['pods:table-data','nodes:table-data','deployments:metrics'].includes(channel))paintDeliveries.push({channel,context:input.context,probe:result.probe});return result;};});
 const pending=()=>app.evaluate(()=>[...global.paintProbe.pending.values()].map(({id,channel,context})=>({id,channel,context})));
 const release=async(id,tag='released',cpu='250m')=>{await app.evaluate((_electron,{id,tag,cpu})=>{const entry=global.paintProbe.pending.get(id);if(!entry)throw Error('No deferred metric read '+id);global.paintProbe.pending.delete(id);const suffix=entry.context==='fixture-b'?'b':'a',metrics=entry.channel==='pods:table-data'?{['team/pod-'+suffix]:{containers:[{name:'web',cpu,memory:'64Mi'}]}}:{['node-'+suffix]:{cpu,memory:'1Gi'}};entry.resolve(entry.channel==='deployments:metrics'?{probe:tag,deployments:{['team/deployment-'+suffix]:{cpu:Number.parseInt(cpu)/1000,memory:64*1024**2,pods:1,cpuSamples:1,memorySamples:1}},warnings:[tag]}:{probe:tag,metrics,podCounts:{['node-'+suffix]:1},podsAvailable:true,warnings:[tag]});},{id,tag,cpu});await page.waitForFunction(tag=>paintDeliveries.some(r=>r.probe===tag),tag);};
 const ready=async(view,context='fixture-a')=>page.waitForFunction(({view,context})=>state.view===view&&state.context===context&&state.initialized&&!state.loading,{view,context});
 const nav=async(view,context='fixture-a')=>{await page.evaluate(view=>{window.paintNavigation=navigate(view);},view);await ready(view,context);};
 const row=async(view,suffix='a')=>page.locator((view==='overview'?'#overview-table':'#resource-table')+' [aria-label="Open '+({pods:'pod',nodes:'node',deployments:'deployment',overview:'pod'}[view])+'-'+suffix+'"]').waitFor();
 // Initial Overview must become usable although its metrics Promise has no result.
 await page.locator('#context').selectOption('fixture-a');await ready('overview');await row('overview');assert.ok((await pending()).some(r=>r.channel==='pods:table-data'));
 for(const entry of await pending())await release(entry.id,'startup-'+entry.id);
 for(const[view,channel]of [['pods','pods:table-data'],['nodes','nodes:table-data'],['deployments','deployments:metrics'],['overview','pods:table-data']]){
  await nav('configmaps');const prior=new Set((await pending()).map(r=>r.id));await nav(view);await row(view);
  const entry=(await pending()).find(r=>r.channel===channel&&!prior.has(r.id));assert.ok(entry,view+' did not start its deferred metric read');
  assert.equal(await page.locator('#busy').isVisible(),false,view+' stayed busy waiting for optional metrics');
  // Navigation away is independently usable while the old read remains unresolved.
  await nav('configmaps');await page.getByRole('button',{name:'Open config-a',exact:true}).waitFor();assert.ok((await pending()).some(r=>r.id===entry.id));
  await release(entry.id,'old-'+view);
  assert.equal(await page.evaluate(()=>state.view),'configmaps');assert.match(await page.locator('#resource-table').textContent(),/config-a/);assert.ok(!await page.locator('#notice').textContent().then(text=>text.includes('old-'+view)));
 }
 // Same-context older generation must not replace newer measurements or warnings.
 await nav('pods');const old=(await pending()).find(r=>r.channel==='pods:table-data'&&r.context==='fixture-a');assert.ok(old);await nav('configmaps');await nav('pods');const newer=(await pending()).find(r=>r.channel==='pods:table-data'&&r.id!==old.id&&r.context==='fixture-a');assert.ok(newer);
 await release(newer.id,'newer-generation','222m');await page.waitForFunction(()=>state.podTableData?.metrics?.['team/pod-a']?.containers?.[0]?.cpu==='222m');await release(old.id,'stale-generation','999m');
 assert.equal(await page.evaluate(()=>state.podTableData.metrics['team/pod-a'].containers[0].cpu),'222m');assert.ok(!await page.locator('#notice').textContent().then(text=>text.includes('stale-generation')));
 // A response from cluster A must not repaint or mutate the visible cluster B view.
 await nav('nodes');const clusterA=(await pending()).find(r=>r.channel==='nodes:table-data'&&r.context==='fixture-a');assert.ok(clusterA);
 await page.locator('#context').selectOption('fixture-b');await ready('overview','fixture-b');await nav('nodes','fixture-b');await row('nodes','b');const clusterB=(await pending()).find(r=>r.channel==='nodes:table-data'&&r.context==='fixture-b');assert.ok(clusterB);
 await release(clusterB.id,'cluster-b-current','333m');await page.waitForFunction(()=>state.nodeTableData?.metrics?.['node-b']?.cpu==='333m');await release(clusterA.id,'cluster-a-late','999m');
 assert.equal(await page.evaluate(()=>state.context),'fixture-b');assert.equal(await page.evaluate(()=>state.nodeTableData.metrics['node-b'].cpu),'333m');assert.match(await page.locator('#resource-table').textContent(),/node-b/);assert.ok(!await page.locator('#notice').textContent().then(text=>text.includes('cluster-a-late')));
 assert.deepEqual(errors,[]);console.log('PASS: Pods/Nodes/Deployments/Overview rows and navigation complete before unresolved optional metrics; late generation/context results cannot replace newer data or warnings');
}finally{await app?.close();fs.rmSync(temp,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1});
