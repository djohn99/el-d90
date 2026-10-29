const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const kube=require('../src/kube.cjs');const access=require('../src/node-access.cjs');const original=kube.run;
afterEach(()=>{kube.run=original;});
const input={context:'test-context',nodeName:'worker-1',namespace:'debug-team',image:'busybox:1.37.0'};
function harness({osName='linux',waitFail=false}={}){const requests=[];let stored;
 kube.run=async(args,options={})=>{requests.push({args,options});if(args[0]==='get'&&args[1]==='nodes')return JSON.stringify({metadata:{name:'worker-1',uid:'node-uid'},spec:{providerID:'test://node'},status:{nodeInfo:{operatingSystem:osName},addresses:[{type:'InternalIP',address:'10.0.0.1'},{type:'ExternalIP',address:'192.0.2.2'}]}});if(args[0]==='create'){const body=JSON.parse(options.input);stored={...body,metadata:{...body.metadata,name:'el-d90-node-debug-fixture',uid:'owned-uid'}};return JSON.stringify(stored);}if(args[0]==='wait'){if(waitFail)throw new Error('Pod readiness failed');return 'ready';}if(args[0]==='get'&&args[1]==='pods')return JSON.stringify(stored);if(args[0]==='delete'&&args.includes('--raw'))return '{}';throw new Error('Unexpected fixture request: '+args.join(' '));};
 return {requests,get stored(){return stored;},set stored(value){stored=value;}};
}
test('SSH argv uses existing config/keys with host-key verification and no remote command',()=>{
 const ssh=access.validateSSH({...input,host:'192.0.2.2',user:'ubuntu',port:22});assert.equal(ssh.command,'/usr/bin/ssh');assert.deepEqual(ssh.args.slice(-1),['ubuntu@192.0.2.2']);assert.ok(ssh.args.includes('StrictHostKeyChecking=ask'));assert.ok(ssh.args.includes('-a'));assert.equal(ssh.args.includes('StrictHostKeyChecking=no'),false);
 const alias=access.validateSSH({...input,host:'worker-alias',useConfigAlias:true});assert.equal(alias.args.includes('-p'),false);assert.equal(alias.args.at(-1),'worker-alias');
});
test('SSH rejects option-shaped hosts, shell-like usernames, invalid ports and relative identities',()=>{
 for(const bad of [{host:'--help',user:'ubuntu'},{host:'host;whoami',user:'ubuntu'},{host:'host',user:'user;id'},{host:'host',user:'ubuntu',port:65536},{host:'host',user:'ubuntu',identityFile:'~/.ssh/key'},{host:'host',user:''}])assert.throws(()=>access.validateSSH({...input,...bad}));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'eld90-ssh-'));try{const file=path.join(directory,'identity');fs.writeFileSync(file,'offline identity fixture');const result=access.validateSSH({...input,host:'host',user:'ubuntu',identityFile:file});assert.equal(result.args[result.args.indexOf('-i')+1],file);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('read-only discovery reports exact node addresses/OS and prefers reachable external address',async()=>{
 const h=harness();const result=await access.discover(input);assert.equal(result.os,'linux');assert.equal(result.defaultHost,'192.0.2.2');assert.equal(h.requests[0].args[1],'nodes');assert.ok(h.requests[0].args.includes('test-context'));assert.equal(h.requests.some(r=>r.args[0]==='create'),false);
});
test('debug manifest bounds the privileged session and omits service-account credentials',()=>{
 const body=access.manifest(input,'fixture-session');assert.equal(body.spec.nodeName,'worker-1');assert.equal(body.spec.activeDeadlineSeconds,3600);assert.equal(body.spec.automountServiceAccountToken,false);assert.equal(body.spec.containers[0].securityContext.privileged,true);assert.deepEqual(body.spec.volumes[0].hostPath,{path:'/',type:'Directory'});assert.equal(body.metadata.labels['el-d90.local/session'],'fixture-session');
 for(const image of ['busybox','registry:5000/busybox','bad image:tag','image@sha256:abc'])assert.throws(()=>access.validateDebug({...input,image}),/image/);
 assert.throws(()=>access.validateDebug({...input,namespace:'*'}));
});
test('owned debug lifecycle waits readiness, scopes exec and deletes with atomic UID precondition',async()=>{
 const h=harness();let created;const record=await access.createDebug(input,{onCreated:r=>created=r});assert.equal(created.uid,'owned-uid');assert.equal(access.terminalArgs(record).at(-1),'/bin/sh');assert.ok(access.terminalArgs(record).includes('test-context'));
 await access.cleanup(record);
 const host=await access.createDebug({...input,hostShell:true});assert.deepEqual(access.terminalArgs(host).slice(-3),['/bin/sh','-c','chroot /host /bin/sh']);
 await access.cleanup(host);const request=h.requests.find(r=>r.args[0]==='delete');assert.equal(request.args[request.args.indexOf('--raw')+1],'/api/v1/namespaces/debug-team/pods/el-d90-node-debug-fixture');assert.equal(JSON.parse(request.options.input).preconditions.uid,'owned-uid');assert.equal(access.active().length,0);
});
test('cleanup refuses name-reused or unowned Pods without issuing delete',async()=>{
 const h=harness();const record=await access.createDebug(input);h.stored={...h.stored,metadata:{...h.stored.metadata,uid:'other-uid'}};await assert.rejects(access.cleanup(record),/identity or ownership changed/);assert.equal(h.requests.some(r=>r.args[0]==='delete'),false);
 h.stored={...h.stored,metadata:{...h.stored.metadata,uid:record.uid}};await access.cleanup(record);
 await assert.rejects(access.cleanup({...record,podName:'other-pod'}),/Invalid owned|not owned/);
});
test('readiness failure attempts cleanup and unsupported OS never creates a privileged Pod',async()=>{
 const h=harness({waitFail:true});await assert.rejects(access.createDebug(input),/readiness failed/);assert.equal(h.requests.filter(r=>r.args[0]==='delete').length,1);assert.equal(access.active().length,0);
 const windows=harness({osName:'windows'});await assert.rejects(access.createDebug(input),/Linux/);assert.equal(windows.requests.some(r=>r.args[0]==='create'),false);
});

test('recovery journals restore only validated metadata without contacting a cluster',async()=>{
 const fresh=()=>{delete require.cache[require.resolve('../src/node-access.cjs')];return require('../src/node-access.cjs');};
 const recovered=fresh(),token=require('node:crypto').randomUUID();
 const record={...input,podName:'el-d90-node-debug-recovered',uid:'recovered-uid',sessionToken:token,hostShell:false};let requests=0;
 kube.run=async()=>{requests++;throw new Error('No cluster requests allowed while restoring');};
 const restored=recovered.restoreOwned([record]);assert.equal(restored.length,1);assert.equal(recovered.active()[0].uid,record.uid);assert.equal(requests,0);
 for(const bad of [{...record,podName:'ordinary-pod'},{...record,uid:'uid/other'},{...record,sessionToken:'forged-token'},{...record,namespace:'bad-'},{...record,context:'--help'},{...record,image:'latest'}])assert.throws(()=>fresh().restoreOwned([bad]));
 assert.throws(()=>fresh().restoreOwned({sessions:[record]}),/journal/);
 assert.throws(()=>fresh().restoreOwned([record,{...record,uid:'different-uid'}]),/Conflicting/);
 assert.equal(requests,0);
});
test('restored journal ownership still requires current labels and matching live UID for cleanup',async()=>{
 delete require.cache[require.resolve('../src/node-access.cjs')];const recovered=require('../src/node-access.cjs');const token=require('node:crypto').randomUUID();
 const record={...input,podName:'el-d90-node-debug-recovered',uid:'recovered-uid',sessionToken:token,hostShell:false};recovered.restoreOwned([record]);const requests=[];
 kube.run=async(args,options={})=>{requests.push({args,options});if(args[0]==='get')return JSON.stringify({metadata:{uid:record.uid,labels:{'app.kubernetes.io/managed-by':'other','el-d90.local/session':token,'el-d90.local/purpose':'node-debug'}}});throw new Error('Deletion should be refused');};
 await assert.rejects(recovered.cleanup(record),/ownership changed/);assert.equal(requests.some(r=>r.args[0]==='delete'),false);
 kube.run=async(args,options={})=>{requests.push({args,options});if(args[0]==='get')return JSON.stringify({metadata:{uid:record.uid,labels:{'app.kubernetes.io/managed-by':'el-d90','el-d90.local/session':token,'el-d90.local/purpose':'node-debug'}}});return '{}';};
 await recovered.cleanup(record);const deletion=requests.find(r=>r.args[0]==='delete');assert.equal(JSON.parse(deletion.options.input).preconditions.uid,record.uid);assert.equal(recovered.active().length,0);
});

test('failed recovery-journal persistence cleans up the created Pod before reporting failure',async()=>{
 const h=harness();await assert.rejects(access.createDebug(input,{onCreated:async()=>{throw new Error('journal unavailable');}}),/journal unavailable/);assert.equal(h.requests.some(r=>r.args[0]==='wait'),false);assert.equal(h.requests.filter(r=>r.args[0]==='delete').length,1);assert.equal(access.active().length,0);
});
