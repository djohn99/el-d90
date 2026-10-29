// Original el-d90 historical metrics adapter. Queries stay inside Kubernetes RBAC.
const kube = require('./kube.cjs');
const RANGES = Object.freeze({ '1h': { seconds: 3600, step: 15 }, '6h': { seconds: 21600, step: 60 }, '24h': { seconds: 86400, step: 300 }, '7d': { seconds: 604800, step: 1800 } });
const METRICS = Object.freeze({
  cpu: { unit: 'cores', title: 'CPU usage', expression: selector => `sum by (namespace) (rate(container_cpu_usage_seconds_total{container!="",container!="POD",${selector}}[5m]))` },
  memory: { unit: 'bytes', title: 'Memory working set', expression: selector => `sum by (namespace) (container_memory_working_set_bytes{container!="",container!="POD",${selector}})` },
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
  const range = RANGES[input.range || '1h'];
  const metric = input.metric || 'cpu';
  if (!Object.hasOwn(RANGES, input.range || '1h') || !Object.hasOwn(METRICS, metric)) throw new Error('Unsupported historical metric or time range');
  const namespaces = namespacesInput(input);
  const selector = namespaces.length ? `namespace=~${JSON.stringify(`^(${namespaces.join('|')})$`)}` : 'namespace!=""';
  const expression = METRICS[metric].expression(selector);
  const end = Math.floor(now / 1000), start = end - range.seconds, step = range.step;
  const parameters = new URLSearchParams({ query: expression, start: String(start), end: String(end), step: String(step), timeout: '15s', limit: '21' });
  const proxy = `${source.scheme}:${source.name}:${source.port}`;
  const path = `/api/v1/namespaces/${source.namespace}/services/${proxy}/proxy/api/v1/query_range?${parameters}`;
  return { context, source, namespaces, metric, unit: METRICS[metric].unit, start, end, step, path };
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
    return { name: labels.namespace || labels.pod || labels.instance || `Series ${index + 1}`, labels, values: values.filter(Boolean) };
  });
  const { path, context, ...result } = request;
  return { ...result, series, errors: warnings };
}
module.exports = { sources, query, plan, sourceInput, namespacesInput };
