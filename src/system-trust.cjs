// Public certificates only. Use the OS trust policy, not an export of every Keychain certificate.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),tls=require('node:tls'),https=require('node:https');
let bundle='',warning='',sourceDirectory='';
function systemCertificates(){return new Promise((resolve,reject)=>{
 const {Worker}=require('node:worker_threads');
 const worker=new Worker("const {parentPort}=require('node:worker_threads');parentPort.postMessage(require('node:tls').getCACertificates('system'));",{eval:true});
 const timer=setTimeout(()=>{worker.terminate();reject(Error('System trust lookup timed out'));},15000);
 worker.once('message',certs=>{clearTimeout(timer);resolve(certs);worker.terminate();});worker.once('error',error=>{clearTimeout(timer);reject(error);});
});}
async function initialize(directory,{platform=process.platform,readSystem=systemCertificates}={}){
 bundle='';warning='';sourceDirectory=platform==='darwin'?directory:'';if(platform!=='darwin')return;
 try{const system=await readSystem();if(!system.length)return;const certificates=[...new Set([...tls.rootCertificates,...system])];
  for(const cert of certificates)new (require('node:crypto').X509Certificate)(cert);
  await fsp.mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,'system-trusted-ca.pem'),temporary=file+'.'+require('node:crypto').randomUUID();
  try{await fsp.writeFile(temporary,certificates.join('\n')+'\n',{mode:0o600,flag:'wx'});await fsp.rename(temporary,file);}finally{await fsp.rm(temporary,{force:true});}bundle=file;
 }catch{warning='Automatic macOS certificate trust could not be loaded. Choose a company CA bundle in AWS connection settings if required.';}
}
function status(){return{available:!!bundle,warning};}
function environment(env){return bundle?{...env,EL_D90_SYSTEM_CA_BUNDLE:bundle}:env;}
function awsEnvironment(env,profile){
 if(env.AWS_CA_BUNDLE||!env.EL_D90_SYSTEM_CA_BUNDLE)return env;
 // A profile's explicit ca_bundle remains owned and interpreted by AWS CLI.
 try{const config=fs.readFileSync(env.AWS_CONFIG_FILE||path.join(os.homedir(),'.aws/config'),'utf8');let selected=false;
  for(const line of config.split(/\r?\n/)){const heading=/^\s*\[([^\]]+)\]/.exec(line);if(heading)selected=heading[1]===(profile&&profile!=='default'?'profile '+profile:'default');else if(selected&&/^\s*ca_bundle\s*=\s*\S/.test(line))return env;}
 }catch{}
 return{...env,AWS_CA_BUNDLE:env.EL_D90_SYSTEM_CA_BUNDLE};
}
function httpsAgent(env){const file=env.AWS_CA_BUNDLE||env.EL_D90_SYSTEM_CA_BUNDLE;if(!file)return undefined;try{return new https.Agent({keepAlive:true,ca:fs.readFileSync(file),rejectUnauthorized:true});}catch{throw Error('The configured AWS CA bundle could not be read. Review AWS connection settings.');}}
async function refresh(){if(sourceDirectory)await initialize(sourceDirectory);}
module.exports={initialize,refresh,status,environment,awsEnvironment,httpsAgent};
