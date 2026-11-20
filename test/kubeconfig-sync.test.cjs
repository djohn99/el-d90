const{test}=require('node:test'),assert=require('node:assert/strict'),{KubeconfigSync}=require('../src/kubeconfig-sync.cjs');
test('managed kubeconfig registration does not cancel the credential process again on the next poll',async()=>{
 let revision='old',resets=0;const sync=new KubeconfigSync({snapshot:async()=>revision});
 await sync.poll(async()=>['config'],()=>resets++);
 revision='new';await sync.register(['config'],()=>resets++);const authSession={closed:false};
 await sync.poll(async()=>['config'],()=>{resets++;authSession.closed=true;});
 assert.equal(resets,1);assert.equal(authSession.closed,false);
 revision='external edit';assert.equal(await sync.poll(async()=>['config'],()=>resets++),true);assert.equal(resets,2);
});
test('a poll started before managed registration cannot restore an old source snapshot',async()=>{
 let signature='old',release;const sync=new KubeconfigSync({snapshot:async()=>signature});let resets=0;
 await sync.poll(async()=>['old'],()=>resets++);
 const pending=sync.poll(()=>new Promise(resolve=>{release=resolve;}),()=>resets++);
 signature='new';await sync.register(['new'],()=>resets++);release(['old']);assert.equal(await pending,false);
 assert.equal(resets,1);assert.equal(await sync.poll(async()=>['new'],()=>resets++),false);assert.equal(resets,1);
});
test('polls skip in-progress managed writes and resume after registration failure',async()=>{
 let release;const sync=new KubeconfigSync({snapshot:()=>new Promise(resolve=>{release=resolve;})});
 const pending=sync.register(['new'],()=>{throw Error('fixture apply failure');});
 assert.equal(await sync.poll(async()=>{throw Error('must not resolve paths during write');},()=>{}),false);
 release('new');await assert.rejects(pending,/fixture apply failure/);assert.equal(sync.mutations,0);
});
test('a delayed credential provider survives the watcher after a managed kubeconfig write',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),YAML=require('yaml'),{KubernetesAPI}=require('../src/kube-api.cjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eld90-sync-auth-')),file=path.join(dir,'config'),plugin=path.join(dir,'plugin.cjs');let api;
 try{
  await fs.writeFile(plugin,"setTimeout(()=>console.log(JSON.stringify({apiVersion:'client.authentication.k8s.io/v1beta1',kind:'ExecCredential',status:{token:'fixture'}})),200);");
  const config=YAML.stringify({clusters:[{name:'c',cluster:{server:'http://fixture.invalid','insecure-skip-tls-verify':true}}],users:[{name:'u',user:{exec:{apiVersion:'client.authentication.k8s.io/v1beta1',command:process.execPath,args:[plugin]}}}],contexts:[{name:'fixture',context:{cluster:'c',user:'u'}}]});
  await fs.writeFile(file,config);api=new KubernetesAPI({environment:()=>({...process.env,KUBECONFIG:file})});const sync=new KubeconfigSync();
  await sync.poll(async()=>[file],()=>api.close());await fs.writeFile(file,config+'\n# app-managed update\n');
  // Reproduce the previous main-process behavior: applying sources without acknowledging the watcher.
  api.close();const interrupted=await api.session('fixture'),cancelled=api.authorize(interrupted);
  const rejected=assert.rejects(cancelled,/Request cancelled/);
  await sync.poll(async()=>[file],()=>api.close());await rejected;assert.equal(interrupted.closed,true);
  await fs.writeFile(file,config+'\n# second managed update\n');
  await sync.register([file],()=>api.close());const session=await api.session('fixture'),pending=api.authorize(session);
  await sync.poll(async()=>[file],()=>api.close());const authorized=await pending;
  assert.equal(authorized.headers.Authorization,'Bearer fixture');assert.equal(session.closed,false);
 }finally{api?.close();await fs.rm(dir,{recursive:true,force:true});}
});
