const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PassThrough}=require('node:stream');
const {start,selectorFromDeployment}=require('../src/deployment-logs.cjs');
const deployment={spec:{selector:{matchLabels:{app:'web'},matchExpressions:[{key:'tier',operator:'In',values:['api','worker']},{key:'track',operator:'NotIn',values:['old']},{key:'enabled',operator:'Exists'},{key:'paused',operator:'DoesNotExist'}]}}};
const input={context:'cluster-a',namespace:'team',resource:'deployments',name:'web',container:'*',follow:true};
const pod=(name,id='one',phase='Running',restarts=0)=>({metadata:{name,uid:name+'-uid'},spec:{containers:[{name:'web'}]},status:{phase,containerStatuses:[{name:'web',containerID:id,restartCount:restarts,state:phase==='Pending'?{waiting:{}}:phase==='Succeeded'?{terminated:{exitCode:0}}:{running:{}}}]}});
async function waitFor(fn,ms=1200){const end=Date.now()+ms;while(!fn()){if(Date.now()>end)throw new Error('Test condition timed out');await new Promise(r=>setTimeout(r,5));}}
function harness(initialPods){
 let pods=initialPods,nextPid=999999;const children=[],reads=[],text=[],ends=[],killed=[];
 const run=async args=>{reads.push(args);return JSON.stringify(args[1]==='deployments'?deployment:{items:pods});};
 const spawn=(binary,args,options)=>{const child=new EventEmitter();child.pid=++nextPid;child.stdout=new PassThrough();child.stderr=new PassThrough();child.args=args;child.options=options;children.push(child);return child;};
 const kill=(child,signal)=>{killed.push({child,signal});queueMicrotask(()=>child.emit('close',0));};
 const session=start(input,{run,spawn,kill,executable:'/fixture/kubectl',pollMs:10,retryMs:50,onData:data=>text.push(data),onEnd:error=>ends.push(error)});
 return {session,children,reads,text,ends,killed,setPods:value=>{pods=value;},run,spawn,kill};
}
test('Deployment selectors preserve conjunction and set/existence expressions without broad fallback',()=>{
 assert.equal(selectorFromDeployment(deployment),'app=web,tier in (api,worker),track notin (old),enabled,!paused');
 assert.throws(()=>selectorFromDeployment({spec:{selector:{}}}),/empty pod selector/);
 assert.throws(()=>selectorFromDeployment({spec:{selector:{matchLabels:{'bad,key':'value'}}}}),/label key/);
 assert.throws(()=>selectorFromDeployment({spec:{selector:{matchExpressions:[{key:'app',operator:'In',values:['web,other']}]}}}),/label value/);
 assert.throws(()=>selectorFromDeployment({spec:{selector:{matchExpressions:[{key:'app',operator:'Bogus'}]}}}),/Unsupported/);
});
test('all replicas attach with source prefixes, explicit scope, and legitimate duplicate lines preserved',async()=>{
 const h=harness([pod('web-a'),pod('web-b')]);try{
  await waitFor(()=>h.children.length===2);
  for(const child of h.children){assert.equal(child.args[0],'logs');assert.ok(child.args.includes('--prefix=true'));assert.ok(child.args.includes('--all-containers=true'));assert.ok(child.args.includes('--follow'));assert.equal(child.args[child.args.indexOf('--context')+1],'cluster-a');assert.equal(child.args[child.args.indexOf('--namespace')+1],'team');assert.equal(child.options.shell,false);}
  h.children[0].stdout.write('same message\nsame message\n');h.children[1].stdout.write('[pod/web-b/web] 2026-10-29T18:00:00Z hello\n');
  assert.equal(h.text.join('').match(/same message/g).length,2);assert.match(h.text.join(''),/\[web-a\] same message/);assert.match(h.text.join(''),/\[web-b\].*web-b\/web/);
  const selectorRequest=h.reads.find(args=>args[1]==='pods');assert.equal(selectorRequest[selectorRequest.indexOf('--selector')+1],selectorFromDeployment(deployment));
 }finally{h.session.stop();}await waitFor(()=>h.ends.length===1);assert.equal(h.killed.length,2);
});
test('polling adds new replicas, follows new container incarnations and removes deleted replicas',async()=>{
 const h=harness([pod('web-a')]);try{
  await waitFor(()=>h.children.length===1);await new Promise(r=>setTimeout(r,30));assert.equal(h.children.length,1);
  h.setPods([pod('web-a'),pod('web-b')]);await waitFor(()=>h.children.length===2);
  h.setPods([pod('web-a','new-container','Running',1),pod('web-b')]);await waitFor(()=>h.children.length===3);assert.ok(h.killed.some(k=>k.child===h.children[0]));
  h.setPods([pod('web-a','new-container','Running',1)]);await waitFor(()=>h.killed.some(k=>k.child===h.children[1]));
 }finally{h.session.stop();}
});
test('Pending replicas are retried when Running and completed same incarnation is not reread',async()=>{
 const h=harness([pod('web-a','one','Pending')]);try{
  await waitFor(()=>h.reads.length>=2);assert.equal(h.children.length,0);
  h.setPods([pod('web-a','one','Succeeded')]);await waitFor(()=>h.children.length===1);h.children[0].emit('close',0);
  await new Promise(r=>setTimeout(r,90));assert.equal(h.children.length,1);
 }finally{h.session.stop();}
});
test('zero replicas remains a following stream; oversize active replica set fails explicitly',async()=>{
 const h=harness([]);try{await waitFor(()=>h.reads.length>=2);assert.match(h.text.join(''),/Waiting for matching replicas/);assert.equal(h.ends.length,0);h.setPods(Array.from({length:101},(_,i)=>pod('web-'+i)));await waitFor(()=>h.ends.length===1);assert.match(h.ends[0].message,/101 active replicas/);assert.equal(h.children.length,0);}finally{h.session.stop();}
});
test('stop prevents late initialization or polling reads from spawning children',async()=>{
 let resolveRead;const pending=new Promise(resolve=>resolveRead=resolve);let spawns=0,ends=0;
 const session=start(input,{run:()=>pending,spawn:()=>{spawns++;throw new Error('unexpected spawn');},onEnd:()=>ends++});
 await new Promise(resolve=>setImmediate(resolve));session.stop();resolveRead(JSON.stringify(deployment));await new Promise(resolve=>setImmediate(resolve));assert.equal(spawns,0);assert.equal(ends,1);
 const h=harness([pod('web-a')]);await waitFor(()=>h.children.length===1);h.session.stop();h.setPods([pod('web-b')]);await new Promise(r=>setTimeout(r,30));assert.equal(h.children.length,1);
});
test('previous logs use one snapshot sweep and finish after every replica child ends',async()=>{
 let ends=0;const children=[];const session=start({...input,previous:true},{run:async args=>JSON.stringify(args[1]==='deployments'?deployment:{items:[pod('web-a'),pod('web-b')]}),spawn:(_binary,args)=>{const child=new EventEmitter();child.args=args;child.stdout=new PassThrough();child.stderr=new PassThrough();children.push(child);return child;},kill:()=>{},executable:'/fixture/kubectl',onEnd:()=>ends++});
 try{await waitFor(()=>children.length===2);for(const child of children){assert.ok(child.args.includes('--previous'));assert.equal(child.args.includes('--follow'),false);}children[0].emit('close',0);assert.equal(ends,0);children[1].emit('close',0);assert.equal(ends,1);await new Promise(r=>setTimeout(r,25));assert.equal(children.length,2);}finally{session.stop();}
});
test('named container selection and callback errors remain bounded and actionable',async()=>{
 assert.throws(()=>start({...input,context:'--server=bad'}),/context/);assert.throws(()=>start({...input,resource:'pods'}),/deployments/);
 let args;const session=start({...input,container:'web'},{run:async a=>JSON.stringify(a[1]==='deployments'?deployment:{items:[pod('web-a')]}),spawn:(_binary,a)=>{args=a;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();queueMicrotask(()=>child.emit('error',new Error('fixture denied')));return child;},kill:()=>{},executable:'/fixture/kubectl',onData:()=>{throw new Error('renderer closed');}});
 try{await waitFor(()=>!!args);assert.equal(args[args.indexOf('--container')+1],'web');assert.equal(args.includes('--all-containers=true'),false);}finally{session.stop();}
});
test('reconnect resumes after the last timestamp and suppresses only replay overlap',async()=>{
 const h=harness([pod('web-a')]);try{
  await waitFor(()=>h.children.length===1);
  const line='[pod/web-a/web] 2026-10-29T18:00:00.123Z old line';h.children[0].stdout.write(line+'\n');h.children[0].emit('close',1);
  await waitFor(()=>h.children.length===2);assert.ok(h.children[1].args.includes('--since-time=2026-10-29T18:00:00.123Z'));assert.equal(h.children[1].args.includes('--tail=300'),false);
  h.children[1].stdout.write(line+'\nnew repeated line\nnew repeated line\n');
  assert.equal(h.text.join('').match(/old line/g).length,1);assert.equal(h.text.join('').match(/new repeated line/g).length,2);
 }finally{h.session.stop();}
});
test('default tracked discovery subprocess is killed when stopped before its read completes',async()=>{
 const children=[],killed=[],ended=[];
 const session=start(input,{executable:'/fixture/kubectl',spawn:(_binary,args)=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.args=args;children.push(child);return child;},kill:(child,signal)=>{killed.push(signal);queueMicrotask(()=>child.emit('close',1));},onEnd:error=>ended.push(error)});
 await waitFor(()=>children.length===1);assert.equal(children[0].args[0],'get');session.stop();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(killed,['SIGKILL']);assert.equal(ended.length,1);assert.equal(children.length,1);
});

test('CrashLoop and failed replica containers can expose their existing logs',async()=>{
 const crashing=pod('web-crash');crashing.status.containerStatuses[0].state={waiting:{reason:'CrashLoopBackOff'}};crashing.status.containerStatuses[0].lastState={terminated:{exitCode:1}};
 const failed=pod('web-failed','two','Failed');failed.status.containerStatuses[0].state={terminated:{exitCode:1}};
 const h=harness([crashing,failed]);try{await waitFor(()=>h.children.length===2);assert.equal(h.children.length,2);}finally{h.session.stop();}
});
