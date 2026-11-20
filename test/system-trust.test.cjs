const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),https=require('node:https'),tls=require('node:tls'),{execFileSync}=require('node:child_process'),trust=require('../src/system-trust.cjs');
test('macOS trust combines public and system roots, applies to AWS children and validates TLS without global changes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'eld90-trust-'));let server,agent;const prior=process.env.AWS_CA_BUNDLE;
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key'),'-out',path.join(dir,'cert'),'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
  const cert=await fs.readFile(path.join(dir,'cert'),'utf8');
  await trust.initialize(dir,{platform:'darwin',readSystem:async()=>[cert,cert]});assert.equal(trust.status().available,true);
  const env=trust.environment({AWS_CONFIG_FILE:path.join(dir,'config')});
  const automatic=trust.awsEnvironment(env,'company'),pem=await fs.readFile(automatic.AWS_CA_BUNDLE,'utf8');
  assert.ok(pem.includes(cert.trim()));assert.ok(pem.includes(tls.rootCertificates[0].trim()));assert.equal(pem.split(cert.trim()).length,2);assert.equal((await fs.stat(automatic.AWS_CA_BUNDLE)).mode&0o777,0o600);
  assert.equal(trust.awsEnvironment({...env,AWS_CA_BUNDLE:'/explicit.pem'},'company').AWS_CA_BUNDLE,'/explicit.pem');
  const config='[profile company]\nca_bundle = /profile.pem\n[profile other]\nregion = eu-west-1\n';await fs.writeFile(env.AWS_CONFIG_FILE,config);
  assert.equal(trust.awsEnvironment(env,'company').AWS_CA_BUNDLE,undefined);assert.equal(trust.awsEnvironment(env,'other').AWS_CA_BUNDLE,automatic.AWS_CA_BUNDLE);assert.equal(await fs.readFile(env.AWS_CONFIG_FILE,'utf8'),config);
  server=https.createServer({key:await fs.readFile(path.join(dir,'key')),cert},(_req,res)=>res.end('ok'));await new Promise(resolve=>server.listen(0,resolve));
  const request=agent=>new Promise((resolve,reject)=>https.get({hostname:'localhost',port:server.address().port,agent},res=>{res.resume();res.on('end',resolve);}).on('error',reject));
  await assert.rejects(request(false));agent=trust.httpsAgent(env);assert.equal(agent.options.rejectUnauthorized,true);await request(agent);
  assert.equal(process.env.AWS_CA_BUNDLE,prior);
 }finally{agent?.destroy();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));await trust.initialize(dir,{platform:'linux'});await fs.rm(dir,{recursive:true,force:true});}
});
test('system trust lookup failure leaves explicit bundle configuration available and reports a safe warning',async()=>{
 await trust.initialize('/unused',{platform:'darwin',readSystem:async()=>{throw Error('PRIVATE_PATH');}});
 assert.equal(trust.status().available,false);assert.match(trust.status().warning,/company CA bundle/);assert.ok(!JSON.stringify(trust.status()).includes('PRIVATE'));
 assert.equal(trust.awsEnvironment({AWS_CA_BUNDLE:'/explicit.pem'},'company').AWS_CA_BUNDLE,'/explicit.pem');
 await trust.initialize('/unused',{platform:'linux'});
});
