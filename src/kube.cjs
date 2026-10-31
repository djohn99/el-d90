const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RESOURCES = Object.freeze({
  pods: { title: 'Pods', namespaced: true },
  deployments: { title: 'Deployments', namespaced: true },
  statefulsets: { title: 'StatefulSets', namespaced: true },
  daemonsets: { title: 'DaemonSets', namespaced: true },
  jobs: { title: 'Jobs', namespaced: true },
  cronjobs: { title: 'CronJobs', namespaced: true },
  services: { title: 'Services', namespaced: true },
  ingresses: { title: 'Ingresses', namespaced: true },
  configmaps: { title: 'ConfigMaps', namespaced: true },
  persistentvolumeclaims: { title: 'Volumes', namespaced: true },
  nodes: { title: 'Nodes', namespaced: false },
  namespaces: { title: 'Namespaces', namespaced: false },
  events: { title: 'Events', namespaced: true },
  replicasets: { title: 'ReplicaSets', namespaced: true },
  replicationcontrollers: { title: 'ReplicationControllers', namespaced: true },
  horizontalpodautoscalers: { title: 'Horizontal Pod Autoscalers', namespaced: true },
  poddisruptionbudgets: { title: 'Pod Disruption Budgets', namespaced: true },
  secrets: { title: 'Secrets', namespaced: true },
  resourcequotas: { title: 'Resource Quotas', namespaced: true },
  limitranges: { title: 'Limit Ranges', namespaced: true },
  serviceaccounts: { title: 'Service Accounts', namespaced: true },
  endpoints: { title: 'Endpoints', namespaced: true },
  endpointslices: { title: 'Endpoint Slices', namespaced: true },
  networkpolicies: { title: 'Network Policies', namespaced: true },
  persistentvolumes: { title: 'Persistent Volumes', namespaced: false },
  storageclasses: { title: 'Storage Classes', namespaced: false },
  roles: { title: 'Roles', namespaced: true },
  rolebindings: { title: 'Role Bindings', namespaced: true },
  clusterroles: { title: 'Cluster Roles', namespaced: false },
  clusterrolebindings: { title: 'Cluster Role Bindings', namespaced: false },
  customresourcedefinitions: { title: 'Custom Resource Definitions', namespaced: false },
});

function string(value, label, max = 1024) {
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f]/.test(value) || value.startsWith('-')) throw new Error(`Invalid ${label}`);
  return value;
}
const catalogues = new Map();
const pendingLists = new Map();
const readRequests=require('./read-requests.cjs');
const api=new (require('./kube-api.cjs').KubernetesAPI)({environment});
function definition(value, context) { return catalogues.get(context)?.get(value) || (Object.hasOwn(RESOURCES, value) ? RESOURCES[value] : undefined); }
function resource(value, context) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(value) || !definition(value, context)) throw new Error('Unsupported resource');
  return value;
}
function name(value, label = 'name') {
  string(value, label, 253);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function scope(input, kind, requireNamespace = false) {
  const args = ['--context', string(input.context, 'context'), '--request-timeout=20s'];
  if (definition(resource(kind, input.context), input.context).namespaced) {
    if (input.namespace && input.namespace !== '*') args.push('--namespace', name(input.namespace, 'namespace'));
    else if (requireNamespace) throw new Error('Choose a namespace first');
    else args.push('--all-namespaces');
  }
  return args;
}
let configuredKubeconfigPaths=[];
function setKubeconfigPaths(paths,{preserveCatalogues=false}={}){const previous=configuredKubeconfigPaths.length?configuredKubeconfigPaths:(environment().KUBECONFIG||path.join(os.homedir(),'.kube/config')).split(path.delimiter).filter(Boolean);const appended=paths.length>=previous.length&&previous.every((p,i)=>p===paths[i]);configuredKubeconfigPaths=[...paths];api.close();if(!preserveCatalogues||!appended)catalogues.clear();pendingLists.clear();}
function environment() {
  return { ...process.env, ...(configuredKubeconfigPaths.length?{KUBECONFIG:configuredKubeconfigPaths.join(path.delimiter)}:{}), PATH: [...new Set([path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', ...(process.env.PATH || '').split(path.delimiter), '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean))].join(':') };
}
function executable() {
  const candidates = [process.env.EL_D90_KUBECTL || process.env.HARBOR_KUBECTL, ...environment().PATH.split(':').map(p => path.join(p, 'kubectl'))].filter(Boolean);
  for (const p of candidates) { try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
  throw new Error('kubectl was not found. Install kubectl or launch el-d90 with EL_D90_KUBECTL=/absolute/path/to/kubectl.');
}
function run(args, { input, timeout = 30000, binary, captureStatus = false, signal=readRequests.signal() } = {}) {
  if(!binary&&api.enabled()&&args[0]==='get'&&args.includes('--raw')){const raw=args[args.indexOf('--raw')+1],context=args[args.indexOf('--context')+1];const flag=args.find(value=>/^--request-timeout=/.test(value)),match=/^--request-timeout=(\d+)(ms|s|m)$/.exec(flag||''),deadline=match&&Number(match[1])?Number(match[1])*({ms:1,s:1000,m:60000}[match[2]]):timeout;return api.text(string(context,'context'),raw,{signal,timeout:Math.min(timeout,deadline)});}
  binary ||= executable();
  if(!['get','api-resources','version','explain','auth'].includes(args[0])&&!(args[0]==='config'&&args[1]==='view'))pendingLists.clear();
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: environment(), shell: false, stdio: ['pipe', 'pipe', 'pipe'], ...(signal?{signal}:{}) });
    let stdout = '', stderr = '', failure;
    const timer = setTimeout(() => { failure = new Error('Request timed out. Check your cluster connection and authentication.'); child.kill('SIGKILL'); }, timeout);
    function append(chunk, error) {
      if (error) stderr += chunk.toString(); else stdout += chunk.toString();
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 24 * 1024 * 1024) { failure = new Error('Response exceeds 24 MB. Choose a narrower namespace.'); child.kill('SIGKILL'); }
    }
    child.stdout.on('data', c => append(c, false));child.stderr.on('data', c => append(c, true));
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); if (failure) reject(failure); else if (captureStatus) resolve({ stdout, stderr, code }); else if (code) reject(new Error(stderr.trim() || `kubectl exited with ${code}`)); else resolve(stdout); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
async function contexts() {
  // Redacted kubeconfig: never request --raw, and return only context metadata.
  const config = JSON.parse(await run(['config', 'view', '-o', 'json']));
  return { current: config['current-context'], contexts: (config.contexts || []).map(c => ({ name: c.name, cluster: c.context.cluster, namespace: c.context.namespace || 'default' })) };
}
function selectedNamespaces(input) {
  const values = input.namespaces;
  if (values !== undefined) {
    if (!Array.isArray(values) || values.length > 64) throw new Error('Choose at most 64 namespaces');
    return [...new Set(values.map(value => name(value, 'namespace')))];
  }
  return input.namespace && input.namespace !== '*' ? [name(input.namespace, 'namespace')] : [];
}
const LIST_VERSIONS={deployments:'apps/v1',statefulsets:'apps/v1',daemonsets:'apps/v1',replicasets:'apps/v1',jobs:'batch/v1',cronjobs:'batch/v1',horizontalpodautoscalers:'autoscaling/v2',poddisruptionbudgets:'policy/v1',ingresses:'networking.k8s.io/v1',networkpolicies:'networking.k8s.io/v1',endpointslices:'discovery.k8s.io/v1',storageclasses:'storage.k8s.io/v1',roles:'rbac.authorization.k8s.io/v1',rolebindings:'rbac.authorization.k8s.io/v1',clusterroles:'rbac.authorization.k8s.io/v1',clusterrolebindings:'rbac.authorization.k8s.io/v1',customresourcedefinitions:'apiextensions.k8s.io/v1'};
function listPath(input,kind){const def=definition(kind,input.context),apiVersion=def?.apiVersion||LIST_VERSIONS[kind]||'v1';if(!/^[a-zA-Z0-9.-]+(?:\/[a-zA-Z0-9]+)?$/.test(apiVersion))throw Error('Invalid discovered API version');const base=apiVersion.includes('/')?'/apis/'+apiVersion:'/api/'+apiVersion;return base+(def.namespaced&&input.namespace&&input.namespace!=='*'?'/namespaces/'+encodeURIComponent(name(input.namespace,'namespace')):'')+'/'+kind.split('.')[0];}
function listObject(item,kind){if(kind==='secrets'||kind.startsWith('secrets.'))return{apiVersion:item.apiVersion,kind:item.kind,type:item.type,metadata:Object.fromEntries(['name','namespace','uid','creationTimestamp'].filter(key=>typeof item.metadata?.[key]==='string').map(key=>[key,item.metadata[key]])),dataKeys:Object.keys(item.data||{})};if(item.metadata)delete item.metadata.managedFields;return item;}
async function pagedList(input,kind,request=run){
 const endpoint=listPath(input,kind),items=[],seen=new Set();let token='',limit=100,bytes=0,pages=0,resourceVersion;
 do{
  const query=new URLSearchParams({limit:String(limit)});if(token)query.set('continue',token);let page;
  try{page=JSON.parse(await request(['get','--raw',endpoint+'?'+query,'--context',string(input.context,'context'),'--request-timeout=20s']));}catch(e){if(/Response exceeds 24 MB/.test(e.message)&&limit>1){limit=Math.max(1,Math.floor(limit/5));continue;}throw e;}
  resourceVersion=page.metadata?.resourceVersion||resourceVersion;if(!Array.isArray(page.items))throw Error('Kubernetes returned an invalid resource page');
  for(const raw of page.items){const item={apiVersion:page.apiVersion||definition(kind,input.context)?.apiVersion||LIST_VERSIONS[kind]||'v1',kind:definition(kind,input.context)?.kind||(page.kind?.endsWith('List')?page.kind.slice(0,-4):undefined),...raw};const value=(kind==='secrets'||kind.startsWith('secrets.'))?item:listObject(item,kind);bytes+=Buffer.byteLength(JSON.stringify(value));if(bytes>128*1024*1024||items.length>=50000)throw Error('Resource list exceeds 128 MiB or 50,000 resources. Select namespaces to reduce the list.');items.push(value);}
  token=page.metadata?.continue||'';if(typeof token!=='string'||token.length>65536)throw Error('Invalid Kubernetes continuation token');if(token&&seen.has(token))throw Error('Kubernetes repeated a resource continuation token');seen.add(token);if(++pages>10000)throw Error('Resource pagination exceeded 10,000 pages. Select namespaces to reduce the list.');if(!token)break;
 }while(true);return{items,metadata:{resourceVersion}};
}
async function listScope(input,kind){if(api.enabled())return pagedList(input,kind,async args=>JSON.stringify(await api.get(input.context,args[2],{signal:readRequests.signal()})));try{return JSON.parse(await run(['get',kind,...scope(input,kind),'-o','json']));}catch(e){if(!/Response exceeds 24 MB/.test(e.message))throw e;return pagedList(input,kind);}}
async function list(input) {
  const kind = resource(input.resource, input.context);
  const namespaces = selectedNamespaces(input);
  const scopes = definition(kind, input.context).namespaced && namespaces.length ? namespaces : [input.namespace || '*'];
  const key=JSON.stringify([string(input.context,'context'),kind,[...scopes].sort(),configuredKubeconfigPaths,environment().KUBECONFIG||'',api.enabled()?'api':executable(),readRequests.key()]),pending=pendingLists.get(key);
  if(pending&&Date.now()-pending.started<100)return structuredClone(await pending.promise);
  const entry={started:Date.now(),promise:listSnapshot(input,kind,scopes)};pendingLists.set(key,entry);
  try{return await entry.promise;}finally{if(pendingLists.get(key)===entry)pendingLists.delete(key);}
}
async function listSnapshot(input,kind,scopes){
  const results = await Promise.allSettled(scopes.map(namespace => listScope({ ...input, namespace },kind)));
  const successful = results.filter(r => r.status === 'fulfilled');
  if (!successful.length) throw new Error(results.map((r,i) => `${scopes[i]}: ${r.reason.message}`).join('\n'));
  const data = { apiVersion: 'v1', kind: 'List', items: successful.flatMap(r => r.value.items || []), warnings: results.flatMap((r,i) => r.status === 'rejected' ? [`${scopes[i]}: ${r.reason.message}`] : []) };
  data.items=data.items.map(item=>listObject(item,kind));
  return data;
}
async function yaml(input) {
  const kind = resource(input.resource, input.context);
  return run(['get', kind, name(input.name), ...scope(input, kind, true), '-o', 'yaml']);
}
async function apply(input, dryRun) {
  string(input.context, 'context');
  if (typeof input.yaml !== 'string' || !input.yaml.trim() || Buffer.byteLength(input.yaml) > 2 * 1024 * 1024) throw new Error('YAML must be between 1 byte and 2 MB');
  const args = ['apply', '--context', input.context, '--request-timeout=20s'];
  if (input.namespace && input.namespace !== '*') args.push('--namespace', name(input.namespace, 'namespace'));
  args.push(...(dryRun ? ['--dry-run=server'] : []), '-f', '-');
  return run(args, { input: input.yaml });
}
function logArgs(input) {
  const args = ['logs', name(input.name), ...scope(input, 'pods', true).filter(arg => !arg.startsWith('--request-timeout=')), '--request-timeout=0', '--tail=300', '--timestamps=true'];
  if (input.container) args.push('--container', name(input.container, 'container'));
  if (input.previous) args.push('--previous');
  if (input.follow) args.push('--follow');
  return args;
}
function terminalArgs(input) {
  const args = ['exec', '-it', name(input.name), ...scope(input, 'pods', true).filter(arg => !arg.startsWith('--request-timeout=')), '--request-timeout=0'];
  if (input.container) args.push('--container', name(input.container, 'container'));
  const shell = input.shell === '/bin/bash' ? '/bin/bash' : '/bin/sh';
  return [...args, '--', shell];
}
function parseDiscovery(text) {
  const result = [];
  for (const line of text.trim().split('\n')) {
    const parts = line.trim().split(/\s+/), i = parts.findIndex(x => x === 'true' || x === 'false');
    if (i < 2 || !parts[i + 1]) continue;
    const apiVersion = parts[i - 1], group = apiVersion.includes('/') ? apiVersion.split('/')[0] : '';
    const key = parts[0] + (group ? '.' + group : '');
    if (!/^[a-z][a-z0-9.-]*$/.test(key) || parts[0].includes('/')) continue;
    result.push({ key, title: parts[i + 1], kind: parts[i + 1], apiVersion, group, namespaced: parts[i] === 'true', verbs: (parts.slice(i + 2).join(' ').replace(/[\[\]]/g, '')).split(/[,\s]+/).filter(Boolean) });
  }
  return result;
}
async function discover(input) {
  const context = string(input.context, 'context');
  const result = await run(['api-resources', '--context', context, '--request-timeout=20s', '--verbs=list', '--no-headers', '-o', 'wide'], { captureStatus: true });
  const resources = parseDiscovery(result.stdout);
  if (!resources.length && result.code) throw new Error(result.stderr || 'API discovery failed');
  catalogues.set(context, new Map(resources.map(r => [r.key, r])));
  return { resources, warnings: result.stderr.trim() ? [result.stderr.trim()] : [] };
}
async function metrics(input) {
  const context = string(input.context, 'context');
  const namespaces = selectedNamespaces(input);
  const podPaths = namespaces.length ? namespaces.map(ns => '/apis/metrics.k8s.io/v1beta1/namespaces/' + ns + '/pods') : ['/apis/metrics.k8s.io/v1beta1/pods'];
  const results = await Promise.allSettled([...podPaths, '/apis/metrics.k8s.io/v1beta1/nodes'].map(p => run(['get', '--context', context, '--request-timeout=20s', '--raw', p]).then(JSON.parse)));
  const pods = results.slice(0,-1), nodes = results.at(-1);
  return { pods: pods.some(r=>r.status==='fulfilled') ? {items:pods.flatMap(r=>r.status==='fulfilled' ? r.value.items || []:[])} : null, nodes: nodes.status === 'fulfilled' ? nodes.value : null, errors: results.flatMap((r,i) => r.status === 'rejected' ? [(i === podPaths.length ? 'Node' : `Pod${namespaces[i] ? ' ('+namespaces[i]+')':''}`) + ' metrics unavailable: ' + r.reason.message] : []) };
}

function findHelm() {
  if (process.env.EL_D90_HELM) { fs.accessSync(process.env.EL_D90_HELM, fs.constants.X_OK); return process.env.EL_D90_HELM; }
  for (const folder of environment().PATH.split(':')) { const p = path.join(folder, 'helm'); try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
  throw new Error('Helm is not installed or is not in PATH. Install Helm to inspect releases.');
}
function helmScope(input) {
  const args = ['--kube-context', string(input.context, 'context')];
  if (input.namespace && input.namespace !== '*') args.push('--namespace', name(input.namespace, 'namespace'));
  return args;
}
async function helmListSingle(input) {
  const binary = findHelm();
  const help = await run(['list', '--help'], { binary });
  const allStatuses = /(?:^|\n)\s*-a,?\s+--all\s|(?:^|\n)\s+--all\s/.test(help) ? ['--all'] : [];
  const rows = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const page = JSON.parse(await run(['list', ...helmScope(input), ...(input.namespace && input.namespace !== '*' ? [] : ['--all-namespaces']), ...allStatuses, '--max', '1000', '--offset', String(offset), '-o', 'json'], { binary }));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
  throw new Error('Helm returned more than 100,000 releases. Choose a namespace to narrow the query.');
}
async function helmList(input) {
  const namespaces = selectedNamespaces(input);
  if (namespaces.length < 2) return helmListSingle({ ...input, namespace: namespaces[0] || '*' });
  const results = await Promise.allSettled(namespaces.map(namespace=>helmListSingle({...input,namespace})));
  // A partial release list must never silently look complete.
  const failures = results.flatMap((r,i)=>r.status==='rejected' ? [`${namespaces[i]}: ${r.reason.message}`]:[]);
  if (failures.length) throw new Error('Helm release list incomplete:\n'+failures.join('\n'));
  return results.flatMap(r=>r.value);
}
async function helmManifest(input) {
  if (!input.namespace || input.namespace === '*') throw new Error('Choose the release namespace');
  return run(['get', 'manifest', name(input.name), ...helmScope(input)], { binary: findHelm() });
}
function actionArgs(input) {
  const kind = resource(input.resource, input.context);
  if (input.action === 'scale' && ['deployments', 'statefulsets', 'replicasets', 'replicationcontrollers'].includes(kind)) {
    if (!Number.isInteger(input.replicas) || input.replicas < 0 || input.replicas > 10000) throw new Error('Replicas must be an integer between 0 and 10000');
    return ['scale', kind, name(input.name), ...scope(input, kind, true), '--replicas=' + input.replicas];
  }
  if (input.action === 'restart' && ['deployments', 'statefulsets', 'daemonsets'].includes(kind)) return ['rollout', 'restart', kind + '/' + name(input.name), ...scope(input, kind, true)];
  throw new Error('Unsupported resource action');
}
function forwardArgs(input) {
  if (!['pods', 'services'].includes(input.resource)) throw new Error('Port forwarding requires a pod or service');
  for (const port of [input.localPort, input.remotePort]) if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ports must be integers between 1 and 65535');
  return ['port-forward', input.resource + '/' + name(input.name), input.localPort + ':' + input.remotePort, ...scope(input, input.resource, true).filter(arg => !arg.startsWith('--request-timeout=')), '--address=127.0.0.1'];
}
module.exports = { api, pagedList, listPath, setKubeconfigPaths, RESOURCES, string, name, resource, scope, environment, executable, run, contexts, list, yaml, apply, logArgs, terminalArgs, parseDiscovery, discover, metrics, helmList, helmManifest, actionArgs, forwardArgs, selectedNamespaces, findHelm };
