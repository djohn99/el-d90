const{spawn}=require('node:child_process');
// One provider per context; no credential or stderr content is returned to the renderer.
class ContextExecAuth{
 constructor(exec,cluster,environment,options={}){this.timeout=options.timeout||15000;this.exec=exec;this.cluster=cluster;this.environment=environment;this.cached=null;this.pending=null;this.child=null;this.closed=false;}
 isAuthProvider(user){return user?.authProvider?.name==='el-d90-exec';}
 async applyAuthentication(_user,options){const status=await this.credential();if(status.token)options.headers.Authorization='Bearer '+status.token;if(status.clientCertificateData){options.cert=status.clientCertificateData;options.key=status.clientKeyData;}}
 credential(){if(this.closed)return Promise.reject(Error('Request cancelled'));if(this.cached&&(!this.cached.expirationTimestamp||Date.parse(this.cached.expirationTimestamp)>Date.now()+1000))return Promise.resolve(this.cached);if(this.pending)return this.pending;const job=this.load();this.pending=job;job.finally(()=>{if(this.pending===job)this.pending=null;}).catch(()=>{});return job;}
 load(){return new Promise((resolve,reject)=>{
  const exec=this.exec;if(!exec.command||!['client.authentication.k8s.io/v1','client.authentication.k8s.io/v1beta1'].includes(exec.apiVersion)||exec.interactiveMode==='Always'){reject(Error('Unsupported interactive Kubernetes credential plugin'));return;}
  const env={...this.environment};for(const item of exec.env||[])env[item.name]=item.value;
  const info={apiVersion:exec.apiVersion,kind:'ExecCredential',spec:{interactive:false}};
  if(exec.provideClusterInfo)info.spec.cluster={server:this.cluster.server,'tls-server-name':this.cluster.tlsServerName,'insecure-skip-tls-verify':!!this.cluster.skipTLSVerify,'certificate-authority-data':this.cluster.caData||(this.cluster.caFile?require('node:fs').readFileSync(this.cluster.caFile).toString('base64'):undefined),'proxy-url':this.cluster.proxyUrl};
  env.KUBERNETES_EXEC_INFO=JSON.stringify(info);let child;try{child=spawn(exec.command,exec.args||[],{env,shell:false,stdio:['ignore','pipe','pipe']});}catch{reject(Error('Credential plugin could not start'));return;}this.child=child;let output='',bytes=0,failure,done=false;
  const timer=setTimeout(()=>{failure=Error('Credential plugin timed out');child.kill('SIGKILL');},this.timeout);timer.unref?.();
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(this.child===child)this.child=null;if(error){reject(error);return;}try{const result=JSON.parse(output),status=result.status;if(result.apiVersion!==exec.apiVersion||result.kind!=='ExecCredential'||!status||!(typeof status.token==='string'&&status.token&&!/[\s\x00]/.test(status.token)||typeof status.clientCertificateData==='string'&&typeof status.clientKeyData==='string')||status.expirationTimestamp&&(!Number.isFinite(Date.parse(status.expirationTimestamp))||Date.parse(status.expirationTimestamp)<=Date.now()))throw Error();this.cached=status;resolve(status);}catch{reject(Error('Credential plugin returned an invalid ExecCredential'));}};
  const receive=(chunk,stdout)=>{bytes+=chunk.length;if(bytes>1024*1024){failure=Error('Credential plugin output exceeded its limit');child.kill('SIGKILL');return;}if(stdout)output+=chunk.toString();};
  child.stdout.on('data',chunk=>receive(chunk,true));child.stderr.on('data',chunk=>receive(chunk,false));child.once('error',()=>finish(Error('Credential plugin failed')));child.once('close',code=>finish(this.closed?Error('Request cancelled'):failure|| (code?Error('Credential plugin sign-in failed'):null)));
 });}
 close(){this.closed=true;this.cached=null;this.child?.kill('SIGKILL');}
}
module.exports={ContextExecAuth};
