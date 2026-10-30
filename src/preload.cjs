const { contextBridge, ipcRenderer } = require('electron');
const channels = new Set(['read:cancel','workspace:issues','workspace:search','workspace:permissions','workspace:monitoring','workspace:state','workspace:policy-set','release:check','release:dependencies','release:open','file:save-image','resource:history','deployments:metrics','cluster:resources','pods:table-data','nodes:table-data','settings:get','settings:appearance-draft','settings:save','settings:pick-kubeconfig','app:restart','session:terminal-start','session:logs-start','session:list','session:snapshot','session:write','session:resize','session:close','resource:events','file:open-yaml','watch:start','watch:stop','watch:status','topology:snapshot','topology:api','editor:parse','editor:format','editor:diff','editor:explain','editor:schema','node:discover','node:sessions','node:ssh-start','node:debug-start','node:debug-cleanup','workspace:close','kube:health','history:sources','history:query','resource:describe','resource:rollout-status','resource:action','helm:operations','helm:repos','helm:search','helm:versions','helm:values','helm:release-values','helm:history','helm:preview','helm:perform','helm:rollback','helm:uninstall','helm:repo-add','helm:repo-update','app:info', 'kube:contexts', 'kube:list', 'kube:yaml', 'kube:validate', 'kube:apply', 'kube:discover', 'kube:metrics', 'kube:action', 'helm:list', 'helm:manifest', 'forward:start', 'forward:stop', 'forward:list', 'logs:start', 'terminal:start', 'stream:stop', 'terminal:resize','terminal:write', 'file:save']);
contextBridge.exposeInMainWorld('eld90', {
  invoke(channel, data) {
    if (!channels.has(channel)) return Promise.reject(new Error('Unsupported action'));
    return ipcRenderer.invoke(channel, data);
  },
  onSession(callback){const listener=(_e,value)=>callback(value);ipcRenderer.on('session:data',listener);return()=>ipcRenderer.removeListener('session:data',listener);},
  onWatch(callback){const listener=(_e,value)=>callback(value);ipcRenderer.on('watch:event',listener);return()=>ipcRenderer.removeListener('watch:event',listener);},
  onWatchStatus(callback){const listener=(_e,value)=>callback(value);ipcRenderer.on('watch:status',listener);return()=>ipcRenderer.removeListener('watch:status',listener);},
  onNodeCleanup(callback){const listener=(_e,value)=>callback(value);ipcRenderer.on('node:cleanup-status',listener);return()=>ipcRenderer.removeListener('node:cleanup-status',listener);},
  onStream(callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('stream:data', listener);
    return () => ipcRenderer.removeListener('stream:data', listener);
  },
});
