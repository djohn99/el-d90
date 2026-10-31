const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const kube = require('./kube.cjs');
const history = require('./history.cjs');
const helm = require('./helm.cjs');
const actions = require('./actions.cjs');
const deploymentLogs = require('./deployment-logs.cjs');
const nodes=require('./node-access.cjs');
const resourceEvents=require('./events.cjs');
const{Sessions}=require('./sessions.cjs');
const topology=require('./topology.cjs');
const editor=require('./editor.cjs');
const settingsStore=require('./settings.cjs');
const nodeTable=require('./node-table.cjs');
const clusterResources=require('./cluster-resources.cjs');
const workloadMetrics=require('./workload-metrics.cjs');
const resourceHistory=require('./resource-history.cjs');
const connections=require('./connections.cjs');
const{Projects}=require('./projects.cjs');
const appCatalog=require('./app-catalog.cjs'),gitops=require('./gitops.cjs');
const{Extensions}=require('./extensions.cjs');
const forms=require('./resource-forms.cjs');
const workspaceTools=require('./workspace-tools.cjs'),releaseTools=require('./release-tools.cjs'),readRequests=require('./read-requests.cjs');
const{WorkspacePolicy}=require('./workspace-policy.cjs');
let appliedSettings=settingsStore.defaults(),settingsError='';
const settingsPath=()=>path.join(app.getPath('userData'),'settings.yaml');
const {Watches}=require('./watches.cjs');
const watchSend=(channel,value)=>{if(window&&!window.webContents.isDestroyed())window.webContents.send(channel,value);};
const watches=new Watches({onEvent:value=>watchSend('watch:event',value),onStatus:value=>watchSend('watch:status',value)});
const nodePending=new Map(),nodeCleanupErrors=new Map(),nodeCleanupTasks=new Map();
let journalWrites=Promise.resolve(),allowClose=false,closingNodes=false;
const journalPath=()=>path.join(app.getPath('userData'),'el-d90-debug-sessions.json');
function saveDebugJournal(){const records=nodes.active();journalWrites=journalWrites.catch(()=>{}).then(async()=>{await fs.mkdir(app.getPath('userData'),{recursive:true});const temporary=journalPath()+'.'+randomUUID();await fs.writeFile(temporary,JSON.stringify(records),{mode:0o600});await fs.rename(temporary,journalPath());});return journalWrites;}
async function cleanDebug(record){const key=record.sessionToken;if(nodeCleanupTasks.has(key))return nodeCleanupTasks.get(key);const task=(async()=>{try{await nodes.cleanup(record);nodeCleanupErrors.delete(key);await saveDebugJournal();return {removed:true};}catch(e){nodeCleanupErrors.set(key,e.message);await saveDebugJournal().catch(()=>{});if(window&&!window.webContents.isDestroyed())window.webContents.send('node:cleanup-status',{context:record.context,podName:record.podName,error:e.message});return {removed:false,error:e.message};}finally{nodeCleanupTasks.delete(key);}})();nodeCleanupTasks.set(key,task);return task;}
const helmOperations = new Set();
const helmOperationResults = new Map();
const { Forwards } = require('./forwards.cjs');
const forwards = new Forwards();
const demo = process.argv.includes('--demo');
const index = pathToFileURL(path.join(__dirname, 'index.html')).href;
const streams = new Map();
const sessions=new Sessions({helper:app.isPackaged?path.join(process.resourcesPath,'app.asar.unpacked/assets/el-d90-pty'):path.join(__dirname,'../assets/el-d90-pty'),directory:path.join(app.getPath('temp'),'el-d90-terminals'),onData:value=>{if(window&&!window.webContents.isDestroyed())window.webContents.send('session:data',value);}});
let window;
app.setName('el-d90');
// Keep the existing local profile when upgrading from Harbor.
app.setPath('userData', process.env.EL_D90_USER_DATA || path.join(app.getPath('appData'), 'Harbor'));
const projectStore=new Projects(path.join(app.getPath('userData'),'projects.json'));
const extensionStore=new Extensions(path.join(app.getPath('userData'),'extensions.json'));
const importPreviews=new Map();
const awsConnections=new (require('./aws-connections.cjs').AWSConnections)(path.join(app.getPath('userData'),'eks-kubeconfigs'));let awsRegistration=Promise.resolve();
const ssoDiscovery=new (require('./aws-sso-discovery.cjs').SSODiscovery)(awsConnections,{openExternal:url=>require('electron').shell.openExternal(url)});
const workspacePolicy=new WorkspacePolicy(path.join(app.getPath('userData'),'workspace-safeguards.json'));
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== index) throw new Error('Untrusted request');
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, input = {}) => {
    trusted(event);
    if (demo && !['resource-data:read','resource-data:write','projects:list','projects:save','projects:remove','extensions:list','extensions:install','extensions:toggle','extensions:remove','catalog:list','editor:form-read','editor:form-write','editor:diagnostics','workspace:state','workspace:policy-set','read:cancel','release:check','release:open','file:save-image','settings:get','settings:appearance-draft','settings:save','settings:pick-kubeconfig','app:restart','app:info', 'file:save','editor:parse','editor:format','editor:diff'].includes(channel)) throw new Error('Demo mode is disconnected from Kubernetes');
    const ownedContext=channel==='session:write'?sessions.entries.get(input.id)?.context:channel==='terminal:write'?streams.get(input.id)?.context:null;
    const request=ownedContext?{...input,context:ownedContext}:input;
    await workspacePolicy.assertAllowed(channel,request);
    let result;try{result=await(readRequests.READS.has(channel)?readRequests.execute(request,()=>fn(request,event)):fn(request,event));}catch(error){await workspacePolicy.record(channel,request,null,error).catch(()=>{});throw error;}
    await workspacePolicy.record(channel,request,result).catch(()=>{if(result&&typeof result==='object')result.auditWarning='The operation completed, but local change history could not be saved.';});return result;
  });
}
async function stop(id) {
  const item = streams.get(id);
  if (item) { streams.delete(id);if(item.controller){item.controller.stop();return;} try { process.kill(-item.child.pid, 'SIGTERM'); } catch { item.child.kill(); } if(item.cleanup)await item.cleanup(); }
}
function startStream(args, type, event, context, options={}) {
  for (const [id, s] of streams) if (s.type === type && s.context === context) stop(id);
  const id = randomUUID();
  const helper = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked/assets/el-d90-pty') : path.join(__dirname, '../assets/el-d90-pty');
  const command = type === 'terminal' ? helper : kube.executable();
  const argv = type === 'terminal' ? [options.command || kube.executable(), ...args] : args;
  const child = spawn(command, argv, { shell: false, detached: true, env: { ...kube.environment(), TERM: 'xterm-256color', COLUMNS: '100', LINES: '28' }, stdio: type === 'terminal' ? ['pipe', 'pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] });
  streams.set(id, { child, type, context,cleanup:options.cleanup,metadata:options.metadata });
  function send(data, ended = false) { if (!event.sender.isDestroyed()) event.sender.send('stream:data', { id, type, data, ended, context }); }
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', text => send(text));
  child.stderr.on('data', text => send(text));
  child.on('error', e => { send(e.message, true); streams.delete(id); });
  child.on('close', code => { if(options.cleanup)options.cleanup().catch(()=>{});send(`\r\n[${type} ended${code ? `, exit ${code}` : ''}]\r\n`, true); streams.delete(id); });
  child.stdin.on('error', () => {});if(type==='terminal')child.stdio[3].on('error',()=>{});
  return id;
}
handle('read:cancel',readRequests.cancel);
handle('workspace:issues',workspaceTools.issues);
handle('workspace:search',workspaceTools.search);
handle('workspace:permissions',workspaceTools.permissions);
handle('workspace:monitoring',workspaceTools.monitoring);
handle('workspace:state',input=>workspacePolicy.state(kube.string(input.context,'context')));
handle('workspace:policy-set',async input=>{const context=kube.string(input.context,'context'),previous=await workspacePolicy.state(context);if(previous.policy.readOnly&&!input.readOnly){const choice=await dialog.showMessageBox(window,{type:'warning',buttons:['Keep read-only','Allow changes'],defaultId:0,cancelId:0,message:'Disable read-only mode?',detail:'Context: '+context+'\nCluster-changing actions and interactive sessions will become available.'});if(choice.response!==1)return{...previous,cancelled:true};}return workspacePolicy.set(context,input);});
handle('release:check',()=>releaseTools.check(app.getVersion()));
handle('release:dependencies',()=>releaseTools.dependencies());
handle('release:open',input=>require('electron').shell.openExternal(releaseTools.releaseUrl(input.url)));
handle('file:save-image',async input=>{if(typeof input.data!=='string'||input.data.length>12*1024*1024||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.data))throw Error('Invalid PNG export');const buffer=Buffer.from(input.data.split(',')[1],'base64');if(buffer.length>8*1024*1024||buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid PNG export');const target=await dialog.showSaveDialog(window,{defaultPath:'el-d90-chart.png',filters:[{name:'PNG image',extensions:['png']}]});if(!target.canceled&&target.filePath)await fs.writeFile(target.filePath,buffer);return!target.canceled;});
handle('watch:start',input=>watches.start(input));
handle('watch:stop',input=>{watches.stop(input.id);return true;});
handle('watch:status',()=>watches.status());
handle('settings:get',async()=>({settings:await settingsStore.read(settingsPath()).catch(()=>appliedSettings),yaml:settingsStore.stringify(await settingsStore.read(settingsPath()).catch(()=>appliedSettings)),path:settingsPath(),error:settingsError}));
handle('settings:appearance-draft',input=>{const value=settingsStore.parse(input.yaml);if(input.resetColors){if(!['dark','light'].includes(input.colorMode))throw Error('Choose a color mode');if(value.appearance.colors)delete value.appearance.colors[input.colorMode];}else{const patch=input.appearance;if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Appearance must be a mapping');const colors=patch.colors;Object.assign(value.appearance,{...patch,colors:value.appearance.colors});if(colors){value.appearance.colors={...value.appearance.colors};for(const[mode,palette]of Object.entries(colors))value.appearance.colors[mode]={...value.appearance.colors[mode],...palette};}if(value.appearance.colors===undefined)delete value.appearance.colors;}const settings=settingsStore.normalize(value);return{settings,yaml:settingsStore.stringify(settings)};});
handle('settings:save',async input=>{const saved=await settingsStore.write(settingsPath(),input.yaml);const restartRequired=JSON.stringify(saved.kubeconfig)!==JSON.stringify(appliedSettings.kubeconfig);settingsError='';return{settings:saved,yaml:settingsStore.stringify(saved),restartRequired};});
handle('settings:pick-kubeconfig',async()=>{const result=await dialog.showOpenDialog(window,{title:'Choose kubeconfig files',properties:['openFile','multiSelections','showHiddenFiles']});return{cancelled:result.canceled,paths:result.filePaths};});
handle('app:restart',()=>{if(sessions.entries.size||nodePending.size||nodes.active().length||helmOperations.size||streams.size)throw Error('Close active terminal, log, node and Helm sessions before restarting.');app.relaunch();app.quit();return true;});
handle('projects:list',()=>projectStore.list());
handle('projects:save',input=>projectStore.save(input));
handle('projects:remove',input=>projectStore.remove(input));
handle('projects:snapshot',input=>projectStore.snapshot(input));
handle('catalog:list',()=>appCatalog.list());
handle('catalog:configure',input=>appCatalog.configure(input));
handle('catalog:open-doc',input=>require('electron').shell.openExternal(appCatalog.docURL(input.id)));
handle('gitops:snapshot',input=>gitops.snapshot(input));
handle('extensions:list',()=>extensionStore.list());
handle('extensions:install',async input=>{const model=require('./extensions-model.js');let manifest;if(input.bundledId!==undefined){manifest=model.bundled();if(input.bundledId!==manifest.id)throw Error('Unknown bundled extension');}else{const selection=await dialog.showOpenDialog(window,{title:'Install or update an el-d90 declarative extension',filters:[{name:'el-d90 extension manifest',extensions:['json']}],properties:['openFile']});if(selection.canceled)return{cancelled:true};const file=selection.filePaths[0],stat=await fs.stat(file);if(!stat.isFile()||stat.size>131072)throw Error('Extension manifest must be a JSON file no larger than 128 KiB');manifest=model.parse(await fs.readFile(file,'utf8'));}const checked=model.normalize(manifest);const answer=await dialog.showMessageBox(window,{type:'question',buttons:['Cancel','Install / update extension'],defaultId:0,cancelId:0,message:'Install declarative extension?',detail:checked.name+' · '+checked.version+'\nExtensions add read-only views, field projections and map relations. They cannot run scripts, send network requests or change cluster resources.'});if(answer.response!==1)return{cancelled:true};return extensionStore.install(checked);});
handle('extensions:query',input=>extensionStore.query(input));
handle('extensions:toggle',input=>extensionStore.toggle(input));
handle('extensions:remove',input=>extensionStore.remove(input));
handle('editor:form-read',forms.read);
handle('editor:form-write',forms.write);
handle('editor:diagnostics',editor.diagnostics);
for(const [channel,method] of Object.entries({'aws:sso-reopen':'reopen','aws:sso-portals':'portals','aws:sso-start':'start','aws:sso-status':'status','aws:sso-cancel':'cancel','aws:sso-roles':'roles','aws:sso-select':'select'}))handle(channel,input=>ssoDiscovery[method](input));
handle('aws:diagnostics',input=>awsConnections.diagnostics(input));
handle('aws:network-get',()=>require('./runtime-environment.cjs').settings());
handle('aws:network-save',async input=>{const result=await require('./runtime-environment.cjs').save(input);awsConnections.close();kube.api.close();return result;});
handle('aws:profiles',()=>awsConnections.profiles());
handle('aws:profile-create',input=>awsConnections.createProfile(input));
handle('aws:login-start',input=>awsConnections.startLogin(input));
handle('aws:login-status',input=>awsConnections.status(input));
handle('aws:login-cancel',input=>awsConnections.cancel(input));
handle('aws:clusters',input=>awsConnections.clusters(input));
handle('aws:connect',async input=>{
  const result=await awsConnections.connect(input);
  const registration=awsRegistration.catch(()=>{}).then(async()=>{
    const settings=await settingsStore.read(settingsPath());let existing=connections.existingPaths(settings);
    if(!settings.kubeconfig.paths.length)existing=(await Promise.all(existing.map(async file=>await fs.access(file).then(()=>file,()=>null)))).filter(Boolean);
    settings.kubeconfig.paths=[...new Set([...existing,result.file])];const saved=await settingsStore.write(settingsPath(),settingsStore.stringify(settings));
    kube.setKubeconfigPaths(settingsStore.resolvePaths(saved),{preserveCatalogues:true});appliedSettings={...appliedSettings,kubeconfig:saved.kubeconfig};return result;
  });awsRegistration=registration;return registration;
});
handle('connections:overview',()=>connections.overview());
handle('connections:test',input=>connections.test(input));
handle('connections:choose',async()=>{const selection=await dialog.showOpenDialog(window,{title:'Import kubeconfig paths',properties:['openFile','multiSelections','showHiddenFiles']});if(selection.canceled)return{cancelled:true};const inspected=await connections.inspectFiles(selection.filePaths),token=randomUUID();for(const[id,p]of importPreviews)if(p.expires<Date.now())importPreviews.delete(id);if(importPreviews.size>=10)importPreviews.delete(importPreviews.keys().next().value);importPreviews.set(token,{...inspected,expires:Date.now()+300000});return{token,...inspected};});
handle('connections:use',async input=>{const preview=importPreviews.get(input.token);if(!preview||preview.expires<Date.now())throw Error('Choose kubeconfig files again; the import preview expired');const checked=await connections.inspectFiles(preview.files.map(f=>f.path));if(checked.files.some((f,i)=>f.digest!==preview.files[i].digest))throw Error('A kubeconfig file changed after preview. Choose the files again.');const value=await settingsStore.read(settingsPath());let existing=connections.existingPaths(value);if(!value.kubeconfig.paths.length){const available=await Promise.all(existing.map(async p=>await fs.access(p).then(()=>p,()=>null)));existing=available.filter(Boolean);}value.kubeconfig.paths=[...new Set([...existing,...checked.files.map(f=>f.path)])];await settingsStore.write(settingsPath(),settingsStore.stringify(value));importPreviews.delete(input.token);return{restartRequired:true,paths:value.kubeconfig.paths};});
handle('topology:snapshot',topology.snapshot);
handle('topology:api',topology.apiInspection);
handle('editor:parse',editor.parseDocuments);
handle('editor:format',editor.format);
handle('editor:diff',editor.diff);
handle('editor:explain',editor.explain);
handle('editor:schema',editor.schema);
handle('node:discover',nodes.discover);
handle('node:sessions',input=>({warnings:nodeCleanupErrors.has('journal')?[nodeCleanupErrors.get('journal')]:[],pending:[...nodePending.values()].filter(v=>v.context===input.context),debug:nodes.active().filter(v=>v.context===input.context).map(v=>({...v,cleanupError:nodeCleanupErrors.get(v.sessionToken)||null})),ssh:[...streams.entries()].filter(([,v])=>v.metadata?.transport==='ssh'&&v.context===input.context).map(([id,v])=>({id,...v.metadata}))}));
handle('node:ssh-start',async(input,event)=>{const request=nodes.validateSSH(input);const choice=await dialog.showMessageBox(window,{type:'question',buttons:['Cancel','Connect SSH'],defaultId:0,cancelId:0,message:request.confirmation.title,detail:request.confirmation.detail});if(choice.response!==1)return {cancelled:true};await workspacePolicy.assertAllowed('node:ssh-start',input);for(const[id,s]of streams)if(s.type==='terminal'&&s.context===input.context)await stop(id);const id=startStream(request.args,'terminal',event,input.context,{command:request.command,metadata:{transport:'ssh',context:request.context,nodeName:request.nodeName,host:request.host}});return{id,transport:'ssh',nodeName:request.nodeName};});
handle('node:debug-start',async(input,event)=>{const request=nodes.validateDebug(input);const choice=await dialog.showMessageBox(window,{type:'warning',buttons:['Cancel','Create privileged debug Pod'],defaultId:0,cancelId:0,message:request.confirmation.title,detail:request.confirmation.detail});if(choice.response!==1)return{cancelled:true};await workspacePolicy.assertAllowed('node:debug-start',input);const pendingId=randomUUID();nodePending.set(pendingId,{...request,startedAt:new Date().toISOString()});let record;try{record=await nodes.createDebug(input,{onCreated:()=>saveDebugJournal()});await saveDebugJournal();for(const[id,s]of streams)if(s.type==='terminal'&&s.context===input.context)await stop(id);const id=startStream(nodes.terminalArgs(record),'terminal',event,input.context,{cleanup:()=>cleanDebug(record),metadata:{transport:'debug',nodeName:record.nodeName,podName:record.podName,namespace:record.namespace}});return{id,transport:'debug',nodeName:record.nodeName,podName:record.podName,namespace:record.namespace};}catch(e){if(record)await cleanDebug(record);await saveDebugJournal().catch(()=>{});throw e;}finally{nodePending.delete(pendingId);}});
handle('node:debug-cleanup',async input=>{const record=nodes.active().find(v=>v.sessionToken===input.sessionToken&&v.context===input.context);if(!record)throw new Error('Owned debug session not found');const result=await dialog.showMessageBox(window,{type:'warning',buttons:['Cancel','Clean up owned debug Pod'],defaultId:0,cancelId:0,message:`Remove ${record.podName}?`,detail:`Context: ${record.context}\nNamespace: ${record.namespace}\nOnly the recorded Pod UID and ownership labels can be removed.`});if(result.response!==1)return{cancelled:true};for(const[id,s]of streams)if(s.context===record.context&&s.metadata?.podName===record.podName)await stop(id);return nodes.active().some(v=>v.sessionToken===record.sessionToken)?cleanDebug(record):{removed:true};});
handle('app:info', () => ({ demo, version: app.getVersion(), platform: process.platform }));
handle('kube:contexts', kube.contexts);
handle('kube:health', async input => { await kube.run(['get', '--context', kube.string(input.context,'context'), '--request-timeout=5s', '--raw', '/readyz'], {timeout:8000}); return {ready:true}; });
handle('history:sources', history.sources);
handle('history:query', history.query);
handle('resource:describe', actions.describe);
handle('resource:rollout-status', actions.rolloutStatus);
handle('resource:action', async input => {
  const operation=actions.validate(input);
  if(operation.confirmation.typedName && input.confirmName!==operation.confirmation.typedName)throw new Error('Type the exact resource name to confirm this action');
  const result=await dialog.showMessageBox(window,{type:'warning',buttons:['Cancel','Confirm '+operation.action],defaultId:0,cancelId:0,message:operation.confirmation.title,detail:`Context: ${operation.context}\nNamespace: ${operation.namespace || 'cluster scoped'}\n${operation.confirmation.impact}`});
  if(result.response!==1)return{cancelled:true};await workspacePolicy.assertAllowed('resource:action',input);return actions.perform(input);
});
for(const [channel,fn] of Object.entries({'helm:repos':helm.repos,'helm:search':helm.search,'helm:versions':helm.versions,'helm:values':helm.values,'helm:release-values':helm.releaseValues,'helm:history':helm.history,'helm:preview':helm.preview}))handle(channel,fn);
async function confirmHelm(input, operation, fn) {
  const key=[input.context,input.namespace,input.name].join('|');
  if(helmOperations.has(key))throw new Error('An operation is already running for this release');
  const choice=await dialog.showMessageBox(window,{type:'warning',buttons:['Cancel','Confirm '+operation],defaultId:0,cancelId:0,message:`${operation} ${input.name}?`,detail:`Context: ${input.context}\nNamespace: ${input.namespace}${input.chart?'\nChart: '+input.chart+' '+input.version:''}${input.revision?'\nRevision: '+input.revision:''}\nThis changes resources on the selected cluster.`});
  if(choice.response!==1)return {cancelled:true};
  await workspacePolicy.assertAllowed('helm:perform',input);
  if(helmOperations.has(key))throw new Error('An operation is already running for this release');
  helmOperations.add(key);const job={id:randomUUID(),context:input.context,namespace:input.namespace,name:input.name,operation,state:'running',startedAt:new Date().toISOString()};helmOperationResults.set(job.id,job);try{const result=await fn(input);job.state='completed';job.output=String(result.output||'Completed').slice(-24000);return result;}catch(e){job.state='failed';job.output=e.message;throw e;}finally{job.endedAt=new Date().toISOString();helmOperations.delete(key);for(const [id,old] of helmOperationResults)if(helmOperationResults.size>100&&old.state!=='running')helmOperationResults.delete(id);}
}
handle('helm:operations', input=>[...helmOperationResults.values()].filter(job=>job.context===input.context));
handle('helm:perform',input=>{const v=helm.validateOperation(input);return confirmHelm(input,v.operation,helm.perform);});
handle('helm:rollback',input=>{helm.validateRevision(input);return confirmHelm(input,'rollback',helm.rollback);});
handle('helm:uninstall',input=>{helm.releaseName(input.name);helm.namespace(input.namespace);kube.string(input.context,'context');return confirmHelm(input,'uninstall',helm.uninstall);});
handle('helm:repo-add',async input=>{helm.validateRepo(input);const choice=await dialog.showMessageBox(window,{type:'question',buttons:['Cancel','Add repository'],defaultId:0,cancelId:0,message:`Add repository ${input.name}?`,detail:input.url});return choice.response===1?helm.repoAdd(input):{cancelled:true};});
handle('helm:repo-update',async()=>{const choice=await dialog.showMessageBox(window,{type:'question',buttons:['Cancel','Refresh indexes'],defaultId:0,cancelId:0,message:'Refresh local Helm repository indexes?',detail:'Downloads current indexes from repositories configured in your Helm installation.'});return choice.response===1?helm.repoUpdate():{cancelled:true};});

handle('kube:discover', kube.discover);
handle('kube:metrics', kube.metrics);
handle('nodes:table-data',nodeTable.extras);
handle('cluster:resources',clusterResources.snapshot);
handle('deployments:metrics',workloadMetrics.snapshot);
handle('resource:history',resourceHistory.query);
handle('pods:table-data',nodeTable.podExtras);
handle('helm:list', kube.helmList);
handle('helm:manifest', kube.helmManifest);
handle('forward:start', input => forwards.start(input));
handle('forward:stop', input => { forwards.stop(input.id); return true; });
handle('forward:list', () => forwards.list());
handle('kube:list', kube.list);
handle('resource-data:read',input=>require('./resource-data.cjs').read(input));
handle('resource-data:write',input=>require('./resource-data.cjs').write(input));
handle('secret:reveal', async input => {
  const context=kube.string(input.context,'context'),namespace=kube.name(input.namespace,'namespace'),name=kube.name(input.name);kube.string(input.uid,'Secret UID');
  const choice=await dialog.showMessageBox(window,{type:'warning',buttons:['Cancel','Reveal values'],defaultId:0,cancelId:0,message:'Reveal decoded Secret values?',detail:`Secret: ${namespace}/${name}\nContext: ${context}\nValues will be shown locally in the selected detail panel.`});
  if(choice.response!==1)return{cancelled:true};
  return require('./secret-values.cjs').reveal(input);
});
handle('kube:yaml', async input => {
  if (input.resource === 'secrets' || input.resource?.startsWith('secrets.')) {
    const choice = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel', 'Reveal manifest'], defaultId: 0, cancelId: 0, message: 'Reveal Secret manifest?', detail: `Secret: ${kube.name(input.name)}\nContext: ${kube.string(input.context, 'context')}\nThe YAML contains encoded Secret values.` });
    if (choice.response !== 1) return '# Secret reveal cancelled.';
  }
  return kube.yaml(input);
});
handle('kube:validate', input => kube.apply(input, true));
handle('kube:action', async input => {
  const args = kube.actionArgs(input);
  const result = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel', input.action === 'scale' ? 'Scale workload' : 'Restart workload'], defaultId: 0, cancelId: 0, message: `${input.action === 'scale' ? 'Scale' : 'Restart'} ${input.name}?`, detail: `Context: ${input.context}\nNamespace: ${input.namespace}${input.action === 'scale' ? `\nDesired replicas: ${input.replicas}` : ''}` });
  if(result.response!==1)return{cancelled:true};await workspacePolicy.assertAllowed('kube:action',input);return{output:await kube.run(args)};
});
handle('kube:apply', async input => {
  const choice = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel', 'Apply changes'], defaultId: 0, cancelId: 0, message: `Apply YAML to ${kube.string(input.context, 'context')}?`, detail: `Namespace scope: ${input.namespace === '*' ? 'defined in YAML' : input.namespace || 'defined in YAML'}. This changes resources on the cluster.` });
  if (choice.response !== 1) return { cancelled: true };
  await workspacePolicy.assertAllowed('kube:apply',input);return { output: await kube.apply(input, false) };
});
handle('logs:start', (input,event)=>{
  if(input.resource!=='deployments'){
    if(input.resource && input.resource!=='pods')throw new Error('Logs require a Pod or Deployment');
    return startStream(kube.logArgs({...input,follow:true}),'logs',event,input.context);
  }
  for(const [id,stream] of streams)if(stream.type==='logs'&&stream.context===input.context)stop(id);
  const id=randomUUID();const send=(data,ended=false)=>{if(!event.sender.isDestroyed())event.sender.send('stream:data',{id,type:'logs',context:input.context,data,ended});};
  const controller=deploymentLogs.start({...input,follow:true},{onData:text=>send(text),onEnd:error=>{streams.delete(id);send(`\n[Deployment log stream ended${error?': '+error.message:''}]\n`,true);}});
  streams.set(id,{controller,type:'logs',context:input.context});return id;
});
handle('terminal:start', (input, event) => startStream(kube.terminalArgs(input), 'terminal', event, input.context));
handle('workspace:close', async input => {watches.closeContext(input.context);kube.api.closeContext(input.context);if([...nodePending.values()].some(v=>v.context===input.context))throw new Error('Wait for the pending node session to finish before disconnecting this cluster');await sessions.closeContext(input.context);for (const [id,s] of streams) if (s.context === input.context)await stop(id); for (const item of forwards.list()) if (item.context === input.context) forwards.stop(item.id); return true; });
handle('stream:stop', async input => {await stop(input.id);return true;});
handle('terminal:resize', input=>{const stream=streams.get(input.id);if(!stream || stream.type!=='terminal')return false;if(!Number.isInteger(input.cols)||input.cols<20||input.cols>400||!Number.isInteger(input.rows)||input.rows<5||input.rows>200)throw new Error('Invalid terminal dimensions');stream.child.stdio[3].write(`${input.cols} ${input.rows}\n`);return true;});
handle('terminal:write', input => {
  const stream = streams.get(input.id);
  if (!stream || stream.type !== 'terminal') return false;
  if (typeof input.data !== 'string' || input.data.length > 65536) throw new Error('Invalid terminal input');
  stream.child.stdin.write(input.data); return true;
});
handle('file:save', async input => {
  if (typeof input.text !== 'string' || input.text.length > 24 * 1024 * 1024) throw new Error('Invalid file contents');
  const target = await dialog.showSaveDialog(window, { defaultPath: 'el-d90-export.txt' });
  if (!target.canceled && target.filePath) await fs.writeFile(target.filePath, input.text, 'utf8');
  return !target.canceled;
});
async function createWindow() {
  window = new BrowserWindow({ width: 1460, height: 940, minWidth: 1080, minHeight: 700, title: 'el-d90', backgroundColor: '#101519', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 21 }, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('close',event=>{
    if(allowClose)return;
    if(nodePending.size){event.preventDefault();dialog.showMessageBoxSync(window,{type:'info',buttons:['Keep app open'],message:'A node-debug session is still being created.',detail:'Wait for readiness or its bounded timeout so el-d90 can track and clean up the created Pod.'});return;}
    if(helmOperations.size){const choice=dialog.showMessageBoxSync(window,{type:'warning',buttons:['Keep app open','Quit anyway'],defaultId:0,cancelId:0,message:'Helm operations are still running.',detail:'Quitting can leave an operation unfinished.'});if(choice===0){event.preventDefault();return;}}
    if(nodes.active().length||sessions.entries.size){event.preventDefault();if(closingNodes)return;closingNodes=true;(async()=>{await sessions.closeAll();for(const id of [...streams.keys()])await stop(id);await Promise.all(nodes.active().map(cleanDebug));await journalWrites.catch(()=>{});if(nodes.active().length){const choice=dialog.showMessageBoxSync(window,{type:'warning',buttons:['Keep app open','Quit and retain recovery records'],defaultId:0,cancelId:0,message:'Some debug Pods could not be cleaned up.',detail:'Their exact identities are saved in Node sessions for retry after restart.'});if(choice===0){closingNodes=false;return;}}allowClose=true;window.close();})().catch(()=>{closingNodes=false;});}
  });
  window.on('closed', () => {awsConnections.close();ssoDiscovery.close();sessions.closeAll().catch(()=>{});watches.close();kube.api.close(); for (const id of streams.keys()) stop(id); forwards.close(); window = null; });
  await window.loadFile(path.join(__dirname, 'index.html'));
}
app.whenReady().then(async () => {
  await require('./runtime-environment.cjs').initialize(path.join(app.getPath('userData'),'aws-network.json'),{loadShell:!process.env.EL_D90_USER_DATA});
  try{appliedSettings=await settingsStore.read(settingsPath());kube.setKubeconfigPaths(settingsStore.resolvePaths(appliedSettings));}catch(e){settingsError='Settings could not be loaded: '+e.message;}
  app.setAboutPanelOptions({applicationName:'el-d90',applicationVersion:app.getVersion(),copyright:'Copyright © 2026 David John',credits:'Created and maintained by David John (@djohn99).\nhttps://github.com/djohn99/el-d90'});
  try{const records=JSON.parse(await fs.readFile(journalPath(),'utf8'));nodes.restoreOwned(records);}catch(e){if(e.code!=='ENOENT')nodeCleanupErrors.set('journal','Debug recovery metadata could not be loaded: '+e.message);}
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'el-d90', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  return createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (!window) createWindow(); });

handle('file:open-yaml',async()=>{const result=await dialog.showOpenDialog(window,{title:'Open Kubernetes manifest',properties:['openFile'],filters:[{name:'Kubernetes YAML / JSON',extensions:['yaml','yml','json']}]});if(result.canceled||!result.filePaths.length)return{cancelled:true};const file=await fs.open(result.filePaths[0],'r');try{const stat=await file.stat();if(!stat.isFile()||stat.size>2*1024*1024)throw new Error('Choose a regular manifest file no larger than 2 MB');const text=await file.readFile('utf8');if(Buffer.byteLength(text)>2*1024*1024||text.includes('\0'))throw new Error('Choose a UTF-8 YAML or JSON manifest');return{text};}finally{await file.close();}});

handle('resource:events',resourceEvents.forResource);

handle('session:terminal-start',input=>sessions.terminal(input));
handle('session:logs-start',input=>sessions.logs(input));
handle('session:list',input=>sessions.list(input.context));
handle('session:snapshot',input=>sessions.snapshot(input.id));
handle('session:write',input=>sessions.write(input));
handle('session:resize',input=>sessions.resize(input));
handle('session:close',async input=>{await sessions.close(input.id);return true;});
