// Original el-d90 node-access adapters. No credential values are read or stored.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {randomUUID} = require('node:crypto');
const kube = require('./kube.cjs');
const owned = new Map();
const scope = input => ['--context',kube.string(input.context,'context'),'--namespace',namespace(input.namespace),'--request-timeout=20s'];
function namespace(value) {kube.name(value,'namespace');if(value.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value))throw new Error('Choose one valid debug namespace');return value;}
function nodeName(value) {return kube.name(value,'node name');}
function host(value) {
  kube.string(value,'SSH host',253);
  if (net.isIP(value))return value;
  if(!/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(value))throw new Error('Use an IP address, hostname or SSH config alias');
  return value;
}
function validateSSH(input) {
  const context=kube.string(input.context,'context'),node=nodeName(input.nodeName),address=host(input.host);
  if(input.useConfigAlias!==undefined&&typeof input.useConfigAlias!=='boolean')throw new Error('Invalid SSH config-alias choice');
  let user=input.user || '';
  if(typeof user!=='string'||(user&&!/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(user)))throw new Error('Invalid SSH username');
  if(!user&&!input.useConfigAlias)throw new Error('Enter an SSH username or choose SSH config alias mode');
  const port=Number(input.port || 22);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('SSH port must be between 1 and 65535');
  const args=['-tt','-a','-o','StrictHostKeyChecking=ask','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3'];
  // In config-alias mode, omitted user/port are left to the user's existing SSH config.
  if(!input.useConfigAlias || input.port)args.push('-p',String(port));
  if(input.identityFile){
    if(typeof input.identityFile!=='string'||!path.isAbsolute(input.identityFile)||/[\x00-\x1f]/.test(input.identityFile))throw new Error('Identity file must be an absolute local path');
    const stat=fs.statSync(input.identityFile);if(!stat.isFile())throw new Error('Identity file is not a regular file');fs.accessSync(input.identityFile,fs.constants.R_OK);
    args.push('-i',input.identityFile);
  }
  args.push(user?`${user}@${address}`:address);
  return {command:'/usr/bin/ssh',args,context,nodeName:node,host:address,user,port,confirmation:{title:`Connect to ${node} over SSH?`,detail:`SSH destination: ${user?user+'@':''}${address}${input.useConfigAlias?' (existing SSH configuration)':':'+port}\nKubernetes context: ${context}\nSSH uses your existing keys, SSH agent and config. Host-key prompts remain enabled; no key values are stored by el-d90.`}};
}
async function discover(input) {
  const context=kube.string(input.context,'context'),name=nodeName(input.nodeName);
  const node=JSON.parse(await kube.run(['get','nodes',name,'--context',context,'--request-timeout=20s','-o','json']));
  const addresses=(node.status?.addresses||[]).filter(a=>['InternalIP','ExternalIP','Hostname','InternalDNS','ExternalDNS'].includes(a.type)&&typeof a.address==='string').map(a=>({type:a.type,address:a.address}));
  const preferred=addresses.find(a=>a.type==='ExternalIP') || addresses.find(a=>a.type==='InternalIP') || addresses[0];
  return {context,nodeName:name,os:node.status?.nodeInfo?.operatingSystem||node.metadata?.labels?.['kubernetes.io/os']||'unknown',addresses,defaultHost:preferred?.address||'',providerID:node.spec?.providerID||'',uid:node.metadata?.uid||null};
}
function validateDebug(input) {
  const context=kube.string(input.context,'context'),name=nodeName(input.nodeName),ns=namespace(input.namespace);
  if(typeof input.image!=='string'||input.image.length>512||! /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(input.image))throw new Error('Choose a trusted debug image with an explicit tag or digest');
  const imageParts=input.image.split('@'),last=imageParts[0].split('/').at(-1);
  if(imageParts.length>2 || (imageParts.length===2?!/^sha256:[a-fA-F0-9]{64}$/.test(imageParts[1]):!/^[a-zA-Z0-9._-]+:[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(last)))throw new Error('Choose a trusted debug image with an explicit tag or sha256 digest');
  if(input.hostShell!==undefined&&typeof input.hostShell!=='boolean')throw new Error('Invalid host-shell choice');
  return {context,nodeName:name,namespace:ns,image:input.image,hostShell:!!input.hostShell,confirmation:{title:`Start a privileged debug shell on ${name}?`,detail:`Context: ${context}\nNamespace: ${ns}\nImage: ${input.image}\nCreates a privileged temporary Pod on this node with host PID/network/IPC and the host filesystem at /host. It can change the node. The Pod is deleted on session cleanup; a one-hour active deadline bounds interrupted sessions.`}};
}
function manifest(input,sessionToken=randomUUID()) {
  const v=validateDebug(input);
  return {apiVersion:'v1',kind:'Pod',metadata:{generateName:'el-d90-node-debug-',namespace:v.namespace,labels:{'app.kubernetes.io/managed-by':'el-d90','el-d90.local/purpose':'node-debug','el-d90.local/session':sessionToken}},spec:{nodeName:v.nodeName,hostPID:true,hostNetwork:true,hostIPC:true,automountServiceAccountToken:false,activeDeadlineSeconds:3600,restartPolicy:'Never',terminationGracePeriodSeconds:5,tolerations:[{operator:'Exists'}],containers:[{name:'debugger',image:v.image,imagePullPolicy:'IfNotPresent',command:['/bin/sh','-c','trap "exit 0" TERM INT; while :; do sleep 3600; done'],securityContext:{privileged:true,runAsUser:0},resources:{requests:{cpu:'10m',memory:'16Mi'},limits:{cpu:'500m',memory:'256Mi'}},volumeMounts:[{name:'host',mountPath:'/host'}]}],volumes:[{name:'host',hostPath:{path:'/',type:'Directory'}}]}};
}
function key(record){return [record.context,record.namespace,record.podName].join('|');}
function validateRecord(record) {
  kube.string(record.context,'context');namespace(record.namespace);kube.name(record.podName,'debug pod name');
  if(!record.podName.startsWith('el-d90-node-debug-')||typeof record.uid!=='string'||!record.uid||typeof record.sessionToken!=='string'||!record.sessionToken)throw new Error('Invalid owned debug Pod record');
  const stored=owned.get(key(record));if(!stored||stored.uid!==record.uid||stored.sessionToken!==record.sessionToken)throw new Error('This debug Pod is not owned by this el-d90 session');
  return stored;
}
async function createDebug(input,options={}) {
  const v=validateDebug(input),node=await discover(v);
  if(node.os!=='linux')throw new Error('Kubernetes host debug sessions currently require a Linux node');
  const sessionToken=randomUUID(),body=manifest(v,sessionToken);
  const pod=JSON.parse(await kube.run(['create',...scope(v),'-f','-','-o','json'],{input:JSON.stringify(body),timeout:45000}));
  if(!pod.metadata?.name||!pod.metadata?.uid)throw new Error('Kubernetes did not return the debug Pod identity; inspect the namespace for el-d90-node-debug Pods');
  const record={...v,podName:pod.metadata.name,uid:pod.metadata.uid,sessionToken};
  kube.name(record.podName,'created debug Pod name');if(!record.podName.startsWith('el-d90-node-debug-'))throw new Error('Kubernetes returned an unexpected debug Pod name');
  owned.set(key(record),record);
  try{
    await options.onCreated?.({...record});
    await kube.run(['wait','--for=condition=Ready','pod/'+record.podName,'--context',v.context,'--namespace',v.namespace,'--request-timeout=100s','--timeout=90s'],{timeout:110000});
    return {...record};
  }catch(error){
    try{await cleanup(record);}catch(cleanupError){throw new Error(`${error.message}\nDebug Pod cleanup failed: ${v.namespace}/${record.podName}: ${cleanupError.message}`);}
    throw error;
  }
}
function terminalArgs(record) {
  const v=validateRecord(record);
  const command=v.hostShell?['/bin/sh','-c','chroot /host /bin/sh']:['/bin/sh'];
  return ['exec','-it',v.podName,'--context',v.context,'--namespace',v.namespace,'--request-timeout=0','--container','debugger','--',...command];
}
async function cleanup(record) {
  const v=validateRecord(record);
  let pod;
  try{pod=JSON.parse(await kube.run(['get','pods',v.podName,...scope(v),'-o','json']));}catch(error){if(/notfound|not found/i.test(error.message)){owned.delete(key(v));return {removed:true,alreadyGone:true};}throw error;}
  const labels=pod.metadata?.labels||{};
  if(pod.metadata?.uid!==v.uid||labels['app.kubernetes.io/managed-by']!=='el-d90'||labels['el-d90.local/session']!==v.sessionToken||labels['el-d90.local/purpose']!=='node-debug')throw new Error('Debug Pod identity or ownership changed; refusing cleanup');
  const body={apiVersion:'v1',kind:'DeleteOptions',gracePeriodSeconds:5,preconditions:{uid:v.uid},propagationPolicy:'Background'};
  await kube.run(['delete','--context',v.context,'--request-timeout=20s','--raw',`/api/v1/namespaces/${v.namespace}/pods/${v.podName}`,'-f','-'],{input:JSON.stringify(body)});
  owned.delete(key(v));return {removed:true};
}
function restoreOwned(records) {
  if(!Array.isArray(records)||records.length>100)throw new Error('Invalid debug-session recovery journal');
  // Journal restoration performs no cluster operations. Cleanup still verifies live ownership and UID.
  const normalized=records.map(record=>{
    if(!record||typeof record!=='object'||Array.isArray(record))throw new Error('Invalid debug-session recovery record');
    const v=validateDebug(record);
    if(typeof record.podName!=='string'||record.podName.length>253||!/^el-d90-node-debug-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(record.podName))throw new Error('Invalid recovered debug Pod name');
    if(typeof record.uid!=='string'||record.uid.length>128||! /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(record.uid))throw new Error('Invalid recovered debug Pod UID');
    if(typeof record.sessionToken!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.sessionToken))throw new Error('Invalid recovered debug-session token');
    return {...v,podName:record.podName,uid:record.uid,sessionToken:record.sessionToken};
  });
  const seen=new Map();
  for(const record of normalized){const id=key(record),prior=seen.get(id)||owned.get(id);if(prior&&(prior.uid!==record.uid||prior.sessionToken!==record.sessionToken))throw new Error('Conflicting recovered debug Pod identity');seen.set(id,record);}
  for(const [id,record] of seen)owned.set(id,record);
  return [...seen.values()].map(record=>({...record}));
}
function active(){return [...owned.values()].map(v=>({...v}));}
module.exports={validateSSH,discover,validateDebug,manifest,createDebug,terminalArgs,cleanup,active,restoreOwned};
