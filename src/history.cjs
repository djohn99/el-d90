// Original el-d90 historical metrics adapter. Queries stay inside Kubernetes RBAC.
const kube = require('./kube.cjs');
const historyTime = require('./history-time.js');
const workloadHistory=require('./workload-history.js');
const METRICS = Object.freeze({
  cpu: { unit: 'cores', title: 'CPU usage', expression: selector => `sum by (namespace) (rate(container_cpu_usage_seconds_total{container!="",container!="POD",${selector}}[5m]))` },
  memory: { unit: 'bytes', title: 'Memory working set', expression: selector => `sum by (namespace) (container_memory_working_set_bytes{container!="",container!="POD",${selector}})` },
  filesystem: { unit: 'bytes', title: 'Filesystem usage', expression: selector => `sum by (namespace) (container_fs_usage_bytes{container!="",container!="POD",${selector}})` },
  network: { unit: 'bytes/s', title: 'Network receive', expression: selector => `sum by (namespace) (rate(container_network_receive_bytes_total{${selector}}[5m]))` },
  restarts: { unit: 'restarts / 5m', title: 'Container restarts · rolling 5 minutes', expression: selector => `sum by (namespace) (increase(kube_pod_container_status_restarts_total{${selector}}[5m]))` },
});
function dns(value, label) {
  if (typeof value !== 'string' || value.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function sourceInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Choose a Prometheus source');
  const namespace = dns(input.namespace, 'Prometheus namespace'), name = dns(input.name, 'Prometheus service');
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Prometheus port must be between 1 and 65535');
  const scheme = input.scheme || 'http';
  if (!['http', 'https'].includes(scheme)) throw new Error('Prometheus scheme must be http or https');
  return { namespace, name, port, scheme };
}
function namespacesInput(input) {
  const raw = input.namespaces !== undefined ? input.namespaces : input.namespace && input.namespace !== '*' ? [input.namespace] : [];
  if (!Array.isArray(raw) || raw.length > 50) throw new Error('Select at most 50 namespaces');
  if (raw.length === 1 && raw[0] === '*') return [];
  return [...new Set(raw.map(value => dns(value, 'namespace')))];
}
async function sources(input) {
  const context = kube.string(input.context, 'context');
  const result = JSON.parse(await kube.run(['get', 'services', '--context', context, '--request-timeout=20s', '--all-namespaces', '-o', 'json']));
  const candidates = [];
  for (const service of result.items || []) {
    const labels = service.metadata?.labels || {};
    const signature = [service.metadata?.name, labels.app, labels['app.kubernetes.io/name'], labels['app.kubernetes.io/component']].filter(Boolean).join(' ').toLowerCase();
    if (!/prometheus/.test(signature) || /operator|alertmanager|pushgateway|exporter/.test(signature) || service.spec?.type === 'ExternalName' || service.spec?.clusterIP === 'None') continue;
    for (const port of service.spec?.ports || []) {
      if (port.protocol && port.protocol !== 'TCP') continue;
      if (/reloader|config|grpc|thanos/.test(port.name || '')) continue;
      if (!(port.port === 9090 || /web|http|prometheus/.test(port.name || ''))) continue;
      try {
        const source = sourceInput({ namespace: service.metadata.namespace, name: service.metadata.name, port: port.port, scheme: /https/.test(port.name || '') || port.appProtocol === 'https' ? 'https' : 'http' });
        candidates.push({ ...source, label: `${source.namespace}/${source.name}:${source.port}` });
      } catch { /* Invalid service metadata is not admitted as a proxy target. */ }
    }
  }
  return candidates.sort((a, b) => (a.port === 9090 ? -1 : 0) - (b.port === 9090 ? -1 : 0) || a.label.localeCompare(b.label));
}
function plan(input, now = Date.now()) {
  const context = kube.string(input.context, 'context'), source = sourceInput(input.source);
  const window = historyTime.resolve(input,now);
  const metric = input.metric || 'cpu';
  if (!Object.hasOwn(METRICS, metric)) throw new Error('Unsupported historical metric or time range');
  const namespaces = namespacesInput(input);
  const selector = namespaces.length ? `namespace=~${JSON.stringify(`^(${namespaces.join('|')})$`)}` : 'namespace!=""';
  let expression = METRICS[metric].expression(selector);
  if(input.aggregate){if(!['cpu','memory'].includes(metric))throw Error('Cluster history supports CPU and memory');const sample=metric==='cpu'?`rate(container_cpu_usage_seconds_total{container!="",container!="POD",${selector}}[5m])`:`container_memory_working_set_bytes{container!="",container!="POD",${selector}}`;let filter='';if(input.nodeNames!==undefined){if(!Array.isArray(input.nodeNames)||input.nodeNames.length>1000||input.nodeNames.some(n=>typeof n!=='string'||n.length>253||!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(n)))throw Error('Invalid history node selection');const pattern=input.nodeNames.length?'^('+input.nodeNames.map(n=>n.replace(/\./g,'\\.')).join('|')+')$':'a^';filter=` * on(namespace,pod) group_left() max by(namespace,pod) (kube_pod_info{node=~${JSON.stringify(pattern)}})`;}expression=`sum(${sample}${filter})`;}

  if(input.target){
   if(input.aggregate)throw Error('Choose cluster or resource history');const target=input.target;
   if(target.resource==='nodes'){
    const name=kube.name(target.name,'node name'),category=input.resourceSeries||'usage';
    if(!['cpu','memory'].includes(metric))throw Error('Node history supports CPU and memory');
    if(input.container&&input.container!=='*')throw Error('Node history has no container selection');
    if(!['usage','capacity'].includes(category))throw Error('Node history supports usage and capacity');
    const identity=`(group by(instance) (node_uname_info{nodename=${JSON.stringify(name)}}) or group by(instance) (node_cpu_seconds_total{node=${JSON.stringify(name)},mode="idle"}))`;
    if(metric==='cpu'){const idle='max by(instance,cpu) (node_cpu_seconds_total{mode="idle"})',busy='max by(instance,cpu) (1-rate(node_cpu_seconds_total{mode="idle"}[5m]))';expression=category==='capacity'?`max(count by(instance) (${idle} * on(instance) group_left() ${identity}))`:`max(sum by(instance) (${busy} * on(instance) group_left() ${identity}))`;}
    else {const total='max by(instance) (node_memory_MemTotal_bytes)',available='max by(instance) (node_memory_MemAvailable_bytes)';expression=`max((${category==='capacity'?total:total+' - '+available}) * on(instance) group_left() ${identity})`;}
   }else{
   if(!workloadHistory.resources.includes(target.resource))throw Error('Choose a supported workload');const ns=dns(target.namespace,'resource namespace'),name=kube.name(target.name,'resource name'),container=input.container&&input.container!=='*'?kube.name(input.container,'container'):null;
   if(!['cpu','memory','network','filesystem'].includes(metric))throw Error('Unsupported resource metric');if(metric==='network'&&container)throw Error('Network history is Pod scoped; select all containers');
   const common=`namespace=${JSON.stringify(ns)}`,containers=container?`,container=${JSON.stringify(container)}`:',container!="",container!="POD"';let admitted;
   if(target.resource==='pods'){if(target.uid&&!/^[A-Za-z0-9-]{1,128}$/.test(target.uid))throw Error('Invalid Pod UID');admitted=`max by(namespace,pod) (kube_pod_info{${common},pod=${JSON.stringify(name)}${target.uid?',uid='+JSON.stringify(target.uid):''}})`;}
   else if(workloadHistory.direct[target.resource])admitted=`max by(namespace,pod) (kube_pod_owner{${common},owner_kind=${JSON.stringify(workloadHistory.direct[target.resource])},owner_name=${JSON.stringify(name)},owner_is_controller="true"})`;
   else {const chain=workloadHistory.chains[target.resource];admitted=`max by(namespace,pod) (kube_pod_owner{${common},owner_kind=${JSON.stringify(chain.podOwner)},owner_is_controller="true"} * on(namespace,owner_name) group_left() label_replace(max by(namespace,${chain.label}) (${chain.metric}{${common},owner_kind=${JSON.stringify(chain.owner)},owner_name=${JSON.stringify(name)},owner_is_controller="true"}),"owner_name","$1",${JSON.stringify(chain.label)},"(.*)"))`;}
   const category=input.resourceSeries||'usage';if(!['usage','requests','limits','transmit'].includes(category))throw Error('Invalid resource history series');let sample;
   if(['requests','limits'].includes(category)){if(!['cpu','memory'].includes(metric))throw Error('Resource requests/limits apply to CPU and memory');sample=`kube_pod_container_resource_${category}{${common},resource=${JSON.stringify(metric)}${container?',container='+JSON.stringify(container):''}}`;}
   else if(metric==='cpu')sample=`rate(container_cpu_usage_seconds_total{${common}${containers}}[5m])`;
   else if(metric==='memory')sample=`container_memory_working_set_bytes{${common}${containers}}`;
   else if(metric==='filesystem')sample=`container_fs_usage_bytes{${common}${containers}}`;
   else sample=`rate(container_network_${category==='transmit'?'transmit':'receive'}_bytes_total{${common},interface!="lo"}[5m])`;
   expression=`sum(${sample} * on(namespace,pod) group_left() ${admitted})`;
   }
  }
  const {start,end,step}=window;
  const parameters = new URLSearchParams({ query: expression, start: String(start), end: String(end), step: String(step), timeout: '15s', limit: '21' });
  const proxy = `${source.scheme}:${source.name}:${source.port}`;
  const path = `/api/v1/namespaces/${source.namespace}/services/${proxy}/proxy/api/v1/query_range?${parameters}`;
  return { aggregate:!!input.aggregate, context, source, namespaces, metric, unit: METRICS[metric].unit, start, end, step, path };
}
async function query(input) {
  const request = plan(input);
  let response;
  try { response = JSON.parse(await kube.run(['get', '--context', request.context, '--request-timeout=20s', '--raw', request.path], { timeout: 25000 })); }
  catch (error) { throw new Error(`Historical metrics unavailable through ${request.source.namespace}/${request.source.name}: ${error.message}`); }
  if (response.status !== 'success') throw new Error(`Prometheus query failed: ${response.error || response.errorType || 'Unknown error'}`);
  if (response.data?.resultType !== 'matrix' || !Array.isArray(response.data.result)) throw new Error('Prometheus returned an unexpected range-query response');
  const warnings = Array.isArray(response.warnings) ? response.warnings.filter(s => typeof s === 'string') : [];
  if (response.data.result.length > 20) warnings.push('Only the first 20 namespace series are displayed. Narrow the namespace selection.');
  const series = response.data.result.slice(0, 20).map((row, index) => {
    const labels = Object.fromEntries(Object.entries(row.metric || {}).filter(([key, value]) => typeof key === 'string' && typeof value === 'string').slice(0, 50));
    if (!Array.isArray(row.values) || row.values.length > 2000) throw new Error('Prometheus returned too many samples for one series');
    const values = row.values.map(pair => {
      if (!Array.isArray(pair) || pair.length !== 2) return null;
      if (pair[0] === null || pair[1] === null || pair[1] === '') return null;
      const timestamp = Number(pair[0]), value = Number(pair[1]);
      return Number.isFinite(timestamp) && Number.isFinite(value) && timestamp >= request.start && timestamp <= request.end ? [timestamp, value] : null;
    });
    // Invalid samples are omitted; the chart splits paths across missing time steps.
    return { name: request.aggregate?'Cluster workload':labels.namespace || labels.pod || labels.instance || `Series ${index + 1}`, labels, values: values.filter(Boolean) };
  });
  const { path, context, ...result } = request;
  return { ...result, series, errors: warnings };
}
module.exports = { sources, query, plan, sourceInput, namespacesInput };
