const{spawn}=require('node:child_process');
const credentialFailure=(code,message)=>Object.assign(Error(message),{credentialCode:code});
function pluginFailure(stderr){
 if(/expired|UnauthorizedSSOToken|SSO session|TokenRetrieval|InvalidGrant/i.test(stderr))return credentialFailure('sso-expired','AWS SSO credentials are unavailable or expired. Sign in again with the selected profile.');
 if(/config profile.*could not be found|profile.*not found/i.test(stderr))return credentialFailure('profile-missing','The selected AWS profile was not found by the credential plugin. Check the AWS config file used by the app.');
 if(/certificate verify failed|CERTIFICATE_VERIFY_FAILED|unable to get local issuer/i.test(stderr))return credentialFailure('certificate','The credential plugin could not verify an AWS server certificate. Check the company CA bundle.');
 if(/proxy|407 Proxy/i.test(stderr))return credentialFailure('proxy','The credential plugin could not connect through the proxy. Check the app connection settings.');
 if(/AccessDenied|not authorized|Forbidden/i.test(stderr))return credentialFailure('access-denied','AWS denied the credential request for the selected profile. Check its account and role.');
 return credentialFailure('exit','The credential plugin exited unsuccessfully. Check the selected AWS profile and connection settings.');
}
// One provider per context; no credential or stderr content is returned to the renderer.
class ContextExecAuth{
 constructor(exec,cluster,environment,options={}){this.timeout=options.timeout||15000;this.exec=exec;this.cluster=cluster;this.environment=environment;this.cached=null;this.pending=null;this.child=null;this.closed=false;}
 isAuthProvider(user){return user?.authProvider?.name==='el-d90-exec';}
 async applyAuthentication(_user,options){const status=await this.credential();if(status.token)options.headers.Authorization='Bearer '+status.token;if(status.clientCertificateData){options.cert=status.clientCertificateData;options.key=status.clientKeyData;}}
 credential(){if(this.closed)return Promise.reject(Error('Request cancelled'));if(this.cached&&(!this.cached.expirationTimestamp||Date.parse(this.cached.expirationTimestamp)>Date.now()+1000))return Promise.resolve(this.cached);if(this.pending)return this.pending;const job=this.load();this.pending=job;job.finally(()=>{if(this.pending===job)this.pending=null;}).catch(()=>{});return job;}
 load(){return new Promise((resolve,reject)=>{
  const exec=this.exec;if(!exec.command||!['client.authentication.k8s.io/v1','client.authentication.k8s.io/v1beta1'].includes(exec.apiVersion)||exec.interactiveMode==='Always'){reject(credentialFailure('unsupported','The kubeconfig requires an unsupported or interactive credential plugin.'));return;}
  const env={...this.environment};for(const item of exec.env||[])env[item.name]=item.value;
  if((exec.args||[]).includes('eks')&&(exec.args||[]).includes('get-token')){const index=exec.args.indexOf('--profile');Object.assign(env,require('./system-trust.cjs').awsEnvironment(env,index>=0?exec.args[index+1]:env.AWS_PROFILE));}
  const info={apiVersion:exec.apiVersion,kind:'ExecCredential',spec:{interactive:false}};
  if(exec.provideClusterInfo)info.spec.cluster={server:this.cluster.server,'tls-server-name':this.cluster.tlsServerName,'insecure-skip-tls-verify':!!this.cluster.skipTLSVerify,'certificate-authority-data':this.cluster.caData||(this.cluster.caFile?require('node:fs').readFileSync(this.cluster.caFile).toString('base64'):undefined),'proxy-url':this.cluster.proxyUrl};
  env.KUBERNETES_EXEC_INFO=JSON.stringify(info);let child;try{child=spawn(exec.command,exec.args||[],{env,shell:false,stdio:['ignore','pipe','pipe']});}catch{reject(credentialFailure('start','The Kubernetes credential plugin could not start. Check its executable path.'));return;}this.child=child;let output='',stderr='',bytes=0,failure,done=false;
  const timer=setTimeout(()=>{failure=credentialFailure('timeout','The Kubernetes credential plugin timed out. Check VPN, network access and sign-in, then retry.');child.kill('SIGKILL');},this.timeout);timer.unref?.();
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(this.child===child)this.child=null;if(error){reject(error);return;}try{const result=JSON.parse(output),status=result.status;if(result.apiVersion!==exec.apiVersion||result.kind!=='ExecCredential'||!status||!(typeof status.token==='string'&&status.token&&!/[\s\x00]/.test(status.token)||typeof status.clientCertificateData==='string'&&typeof status.clientKeyData==='string')||status.expirationTimestamp&&(!Number.isFinite(Date.parse(status.expirationTimestamp))||Date.parse(status.expirationTimestamp)<=Date.now()))throw Error();this.cached=status;resolve(status);}catch{reject(credentialFailure('invalid-response','The credential plugin returned an invalid or expired ExecCredential. Check the AWS CLI executable and version.'));}};
  const receive=(chunk,stdout)=>{bytes+=chunk.length;if(bytes>1024*1024){failure=credentialFailure('output-limit','The credential plugin output exceeded its limit.');child.kill('SIGKILL');return;}if(stdout)output+=chunk.toString();else stderr+=chunk.toString();};
  child.stdout.on('data',chunk=>receive(chunk,true));child.stderr.on('data',chunk=>receive(chunk,false));child.once('error',error=>finish(credentialFailure(error.code==='ENOENT'?'not-found':'start',error.code==='ENOENT'?'The Kubernetes credential plugin executable was not found. Check the AWS CLI path in the connection settings.':'The Kubernetes credential plugin could not start. Check its executable path and permissions.')));child.once('close',code=>finish(this.closed?Error('Request cancelled'):failure|| (code?pluginFailure(stderr):null)));
 });}
 close(){this.closed=true;this.cached=null;this.child?.kill('SIGKILL');}
}
module.exports={ContextExecAuth};
