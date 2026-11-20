const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{ContextExecAuth}=require('../src/kube-exec-auth.cjs');
async function fixture(code,fn,options={}){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eld90-exec-auth-')),file=path.join(dir,'plugin.cjs');await fs.writeFile(file,code);const provider=new ContextExecAuth({apiVersion:'client.authentication.k8s.io/v1beta1',command:process.execPath,args:[file],provideClusterInfo:true},{server:'https://fixture.test',caData:'Zml4dHVyZQ=='},process.env,options);try{await fn(provider);}finally{provider.close();await fs.rm(dir,{recursive:true,force:true});}}
test('context exec provider sends noninteractive cluster info and keeps cached credentials in memory only',()=>fixture(`const info=JSON.parse(process.env.KUBERNETES_EXEC_INFO);if(info.spec.interactive||info.spec.cluster.server!=='https://fixture.test')process.exit(1);console.log(JSON.stringify({apiVersion:info.apiVersion,kind:'ExecCredential',status:{token:'fixture-token'}}));`,async p=>{const headers={};await p.applyAuthentication(null,{headers});assert.equal(headers.Authorization,'Bearer fixture-token');assert.equal((await p.credential()).token,'fixture-token');}));
test('plugin failures and malformed output never expose stderr or private payloads',async()=>{for(const code of [`console.error('PRIVATE_TOKEN');process.exit(1)`,`console.log('PRIVATE_TOKEN')`,`console.log(JSON.stringify({kind:'ExecCredential',apiVersion:'wrong',status:{token:'PRIVATE_TOKEN'}}))`])await fixture(code,async p=>{await assert.rejects(p.credential(),error=>!error.message.includes('PRIVATE_TOKEN'));});});
test('hung or disconnected credential plugins terminate; output is bounded',async()=>{await fixture('setInterval(()=>{},1000)',async p=>{await assert.rejects(p.credential(),/timed out/);},{timeout:40});await fixture('setInterval(()=>{},1000)',async p=>{const pending=p.credential();p.close();await assert.rejects(pending,/cancelled/);});await fixture(`process.stdout.write('x'.repeat(1100000));setInterval(()=>{},1000);`,async p=>{await assert.rejects(p.credential(),/limit/);});});
test('credential failures identify safe causes without exposing plugin output',async()=>{
 for(const [message,code,description] of [
  ['UnauthorizedSSOToken: PRIVATE_TOKEN','sso-expired',/Sign in again/],
  ['The config profile (PRIVATE_PROFILE) could not be found','profile-missing',/AWS config file/],
  ['CERTIFICATE_VERIFY_FAILED PRIVATE_CERT','certificate',/CA bundle/],
  ['ProxyConnectionError PRIVATE_PROXY','proxy',/proxy/],
  ['AccessDenied PRIVATE_ACCOUNT','access-denied',/account and role/],
  ['PRIVATE_UNKNOWN','exit',/exited unsuccessfully/]
 ])await fixture(`console.error(${JSON.stringify(message)});process.exit(1)`,async p=>{
  await assert.rejects(p.credential(),error=>{assert.equal(error.credentialCode,code);assert.match(error.message,description);assert.ok(!error.message.includes('PRIVATE'));return true;});
 });
 const missing=new ContextExecAuth({apiVersion:'client.authentication.k8s.io/v1beta1',command:path.join(os.tmpdir(),'missing-'+require('node:crypto').randomUUID())},{},process.env);
 try{await assert.rejects(missing.credential(),error=>error.credentialCode==='not-found'&&!error.message.includes(os.tmpdir()));}finally{missing.close();}
});
