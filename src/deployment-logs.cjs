// Original el-d90 Deployment log aggregation. No shell interpolation or target mutation.
const { spawn: nodeSpawn } = require('node:child_process');
const kube = require('./kube.cjs');

function labelKey(value) {
  if (typeof value !== 'string' || value.length > 317) throw new Error('Invalid Deployment selector label key');
  const parts = value.split('/');
  if (parts.length > 2) throw new Error('Invalid Deployment selector label key');
  const leaf = parts.at(-1);
  if (!leaf || leaf.length > 63 || !/^[A-Za-z0-9](?:[-A-Za-z0-9_.]*[A-Za-z0-9])?$/.test(leaf)) throw new Error('Invalid Deployment selector label key');
  if (parts.length === 2 && (parts[0].length > 253 || !parts[0].split('.').every(part => part.length <= 63 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(part)))) throw new Error('Invalid Deployment selector label prefix');
  return value;
}
function labelValue(value) {
  if (typeof value !== 'string' || value.length > 63 || !/^(?:[A-Za-z0-9](?:[-A-Za-z0-9_.]*[A-Za-z0-9])?)?$/.test(value)) throw new Error('Invalid Deployment selector label value');
  return value;
}
function selectorFromDeployment(deployment) {
  const selector = deployment?.spec?.selector;
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) throw new Error('Deployment has no valid pod selector');
  const labels = selector.matchLabels || {};
  if (typeof labels !== 'object' || Array.isArray(labels)) throw new Error('Invalid Deployment matchLabels');
  const expressions = selector.matchExpressions || [];
  if (!Array.isArray(expressions) || expressions.length > 100 || Object.keys(labels).length > 100) throw new Error('Deployment selector exceeds supported bounds');
  const terms = Object.keys(labels).sort().map(key => `${labelKey(key)}=${labelValue(labels[key])}`);
  for (const expression of expressions) {
    const key = labelKey(expression?.key), values = expression.values || [];
    if (!Array.isArray(values) || values.length > 100) throw new Error('Invalid Deployment matchExpression values');
    if (expression.operator === 'In' || expression.operator === 'NotIn') {
      if (!values.length) throw new Error('Deployment set selector requires values');
      terms.push(`${key} ${expression.operator === 'In' ? 'in' : 'notin'} (${values.map(labelValue).join(',')})`);
    } else if (expression.operator === 'Exists' || expression.operator === 'DoesNotExist') {
      if (values.length) throw new Error('Deployment existence selector must not have values');
      terms.push(expression.operator === 'Exists' ? key : `!${key}`);
    } else throw new Error('Unsupported Deployment selector operator');
  }
  if (!terms.length) throw new Error('Deployment has an empty pod selector; refusing to aggregate unrelated pods');
  return terms.join(',');
}
function incarnation(pod, container) {
  const statuses = [...(pod.status?.initContainerStatuses || []), ...(pod.status?.containerStatuses || [])];
  const selected = container === '*' ? statuses : statuses.filter(item => item.name === container);
  const identity = selected.map(item => `${item.name}:${item.containerID || ''}:${item.restartCount || 0}`).sort().join('|');
  return `${pod.metadata?.uid || `${pod.metadata?.name}:${pod.metadata?.creationTimestamp || ''}`}|${identity}`;
}
function eligible(pod, container) {
  if (!['Pending','Running','Succeeded','Failed'].includes(pod.status?.phase)) return false;
  const statuses = [...(pod.status?.initContainerStatuses || []), ...(pod.status?.containerStatuses || [])];
  if (!statuses.length) return pod.status?.phase !== 'Pending'; // Status can lag the pod phase; kubectl reports the concrete error.
  const selected = container === '*' ? statuses : statuses.filter(item => item.name === container);
  return selected.some(item => item.state?.running || item.state?.terminated || item.lastState?.terminated);
}
function defaultKill(child, signal = 'SIGTERM') {
  try { if (Number.isInteger(child.pid) && child.pid > 0) process.kill(-child.pid, signal); else child.kill(signal); }
  catch { try { child.kill(signal); } catch {} }
}
function start(input, options = {}) {
  if (input?.resource !== 'deployments') throw new Error('Deployment log aggregation requires resource=deployments');
  const context = kube.string(input.context, 'context'), namespace = kube.name(input.namespace, 'namespace'), name = kube.name(input.name, 'Deployment name');
  if (namespace === '*') throw new Error('Choose a single Deployment namespace');
  const container = !input.container || input.container === '*' ? '*' : kube.name(input.container, 'container');
  if (typeof input.previous !== 'undefined' && typeof input.previous !== 'boolean') throw new Error('Invalid previous-log selection');
  if (!input.previous && input.follow !== true) throw new Error('Deployment log aggregation requires follow=true');
  const previous = !!input.previous;
  const spawn = options.spawn || nodeSpawn, kill = options.kill || defaultKill;
  const reads = new Set();
  const pollMs = options.pollMs === undefined ? 5000 : Math.max(10, Math.min(60000, Number(options.pollMs) || 5000));
  const retryMs = options.retryMs === undefined ? 30000 : Math.max(20, Number(options.retryMs) || 30000);
  const records = new Map(), completed = new Set();
  let stopped = false, ended = false, timer = null, selector = '', waiting = false, firstSweepDone = false;
  function read(args) {
    if (stopped) return Promise.reject(new Error('Deployment logs stopped'));
    if (options.run) return options.run(args);
    return new Promise((resolve, reject) => {
      let child;
      try { child = spawn(options.executable || kube.executable(), args, { env: kube.environment(), detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch(error) { reject(error); return; }
      reads.add(child);
      let stdout = '', stderr = '', failure = null;
      const timeout = setTimeout(() => { failure = new Error('Deployment log discovery timed out'); kill(child, 'SIGKILL'); }, 25000);
      const append = (text, error) => {
        if (error) stderr += text; else stdout += text;
        if (stdout.length + stderr.length > 24 * 1024 * 1024) { failure = new Error('Deployment log discovery exceeded 24 MB'); kill(child, 'SIGKILL'); }
      };
      child.stdout?.setEncoding?.('utf8'); child.stderr?.setEncoding?.('utf8');
      child.stdout?.on('data', text => append(text, false)); child.stderr?.on('data', text => append(text, true));
      child.on('error', error => { clearTimeout(timeout); reads.delete(child); reject(error); });
      child.on('close', code => { clearTimeout(timeout); reads.delete(child); if (failure) reject(failure); else if (code) reject(new Error(stderr.trim() || `kubectl exited with ${code}`)); else resolve(stdout); });
    });
  }
  function emit(text) { if (!stopped) { try { options.onData?.(text); } catch {} } }
  function end(error = null) { if (!ended) { ended = true; try { options.onEnd?.(error); } catch {} } }
  function terminate(record) {
    if (record.child) {
      const child = record.child; record.intentional = true; kill(child, 'SIGTERM'); record.child = null;
      record.forceTimer = setTimeout(() => { if (!record.closed) kill(child, 'SIGKILL'); }, 500); record.forceTimer.unref?.();
    }
  }
  function stop() {
    if (stopped) return;
    stopped = true; clearTimeout(timer);
    for (const record of records.values()) terminate(record);
    records.clear(); for (const child of reads) kill(child, 'SIGKILL'); reads.clear(); end();
  }
  function fail(error) {
    if (stopped) return;
    emit(`[Deployment ${namespace}/${name}] ERROR: ${error.message}\n`);
    stopped = true; clearTimeout(timer);
    for (const record of records.values()) terminate(record);
    records.clear(); for (const child of reads) kill(child, 'SIGKILL'); reads.clear(); end(error);
  }
  function remember(signature) {
    completed.add(signature);
    if (completed.size > 10000) completed.delete(completed.values().next().value);
  }
  function snapshotEnd() {
    if (previous && firstSweepDone && ![...records.values()].some(record => record.child)) { stopped = true; end(); }
  }
  function attach(pod, signature, prior) {
    if (stopped) return;
    const podName = kube.name(pod.metadata.name, 'pod name');
    const record = { signature, child: null, phase: pod.status.phase, intentional: false, retryAt: 0, lastTimestamp: prior?.lastTimestamp || '', recent: prior?.recent || new Set(), recentBytes: prior?.recentBytes || 0, replay: prior?.lastTimestamp ? new Set(prior.recent) : null };
    records.set(podName, record);
    const args = ['logs', podName, '--context', context, '--namespace', namespace, '--request-timeout=0', '--timestamps=true', '--prefix=true'];
    if (container === '*') args.push('--all-containers=true', '--max-log-requests=100'); else args.push('--container', container);
    if (previous) args.push('--previous'); else args.push('--follow');
    if (record.lastTimestamp && !previous) args.push('--since-time=' + record.lastTimestamp); else args.push('--tail=300');
    emit(`[${podName}] Attaching ${previous ? 'previous-container snapshot' : 'log stream'}${container === '*' ? ' · all containers' : ` · ${container}`}\n`);
    let child;
    try {
      child = spawn(options.executable || kube.executable(), args, { env: kube.environment(), detached: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      record.retryAt = Date.now() + retryMs; emit(`[${podName}] ERROR: ${error.message}\n`); snapshotEnd(); return;
    }
    if (stopped) { kill(child); return; }
    record.child = child;
    function lines(stream, errorStream) {
      if (!stream) return;
      let buffered = '';
      stream.setEncoding?.('utf8');
      function output(line) {
        if (!line || stopped || record.intentional) return;
        const stamp = line.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/)?.[0];
        if (stamp && !errorStream) record.lastTimestamp = stamp;
        if (!errorStream) {
          if (stamp && record.replay?.has(line)) return;
          if (!record.recent.has(line) && line.length <= 262144) { record.recent.add(line); record.recentBytes += line.length; }
          while (record.recent.size > 2000 || record.recentBytes > 262144) { const first = record.recent.values().next().value; record.recent.delete(first); record.recentBytes -= first.length; }
        }
        emit(`[${podName}] ${errorStream ? 'ERROR: ' : ''}${line}\n`);
      }
      stream.on('data', text => {
        buffered += text.toString();
        const split = buffered.split(/\r?\n/); buffered = split.pop();
        for (const line of split) output(line);
        if (buffered.length > 1024 * 1024) { output(buffered.slice(0, 1024 * 1024) + ' [line truncated at 1 MiB]'); buffered = ''; }
      });
      stream.on('end', () => { if (buffered) output(buffered); buffered = ''; });
    }
    lines(child.stdout, false); lines(child.stderr, true);
    let closed = false;
    const finish = (code, error) => {
      if (closed) return; closed = true; record.closed = true; clearTimeout(record.forceTimer);
      record.child = null;
      if (stopped || record.intentional) return;
      if (error) emit(`[${podName}] ERROR: ${error.message}\n`);
      else if (code) emit(`[${podName}] Log process exited with code ${code}${previous ? '; previous-container snapshot unavailable.' : `; retrying after ${Math.round(retryMs / 1000)} seconds if this incarnation is still current.`}\n`);
      if (previous || (record.phase === 'Succeeded' && !code && !error)) remember(signature);
      record.retryAt = Date.now() + retryMs;
      snapshotEnd();
    };
    child.on('error', error => finish(1, error));
    child.on('close', code => finish(code));
  }
  async function sweep() {
    try {
      const data = JSON.parse(await read(['get', 'pods', '--context', context, '--namespace', namespace, '--request-timeout=20s', '--selector', selector, '-o', 'json']));
      if (stopped) return;
      if (!Array.isArray(data.items)) throw new Error('Pod list returned no items array');
      const pods = data.items;
      if (pods.length > 10000 || (previous && pods.length > 100)) { fail(new Error(previous ? 'Previous-log snapshots support at most 100 matched replicas; narrow the workload before collecting.' : 'Deployment matches more than 10,000 retained pod identities; narrow the workload before streaming.')); return; }
      const active = pods.filter(pod => !['Succeeded', 'Failed'].includes(pod.status?.phase));
      if (active.length > 100) { fail(new Error(`Deployment matches ${active.length} active replicas; the supported aggregation limit is 100. Narrow the workload before streaming.`)); return; }
      const present = new Set(pods.map(pod => pod.metadata?.name));
      for (const [podName, record] of records) if (!present.has(podName)) { terminate(record); records.delete(podName); }
      if (!pods.length) {
        if (!waiting) emit(`[Deployment ${namespace}/${name}] Waiting for matching replicas…\n`);
        waiting = true;
      } else if(!previous && !pods.some(pod=>eligible(pod,container)) && ![...records.values()].some(record=>record.child)){if(!waiting)emit(`[Deployment ${namespace}/${name}] Waiting for replica containers to produce logs…\n`);waiting=true;}else waiting = false;
      for (const pod of pods) {
        const podName = pod.metadata?.name;
        if (!podName) continue;
        const signature = incarnation(pod, container), prior = records.get(podName);
        if (prior) prior.phase = pod.status?.phase;
        if (prior && prior.signature !== signature) { terminate(prior); records.delete(podName); }
        if (!previous && !eligible(pod, container)) continue;
        if (completed.has(signature)) continue;
        const current = records.get(podName);
        if (current?.child || (current && current.retryAt > Date.now())) continue;
        if ([...records.values()].filter(record => record.child).length >= 100) {
          emit(`[Deployment ${namespace}/${name}] Stream concurrency limit reached; remaining completed replicas will be collected on a later poll.\n`); break;
        }
        attach(pod, signature, current);
      }
      firstSweepDone = true;
      snapshotEnd();
    } catch (error) {
      if (stopped) return;
      if (!firstSweepDone || previous) { fail(error); return; }
      emit(`[Deployment ${namespace}/${name}] Pod refresh failed: ${error.message}\n`);
    }
    if (!stopped && !previous) { timer = setTimeout(sweep, pollMs); timer.unref?.(); }
  }
  // Validation is synchronous; reads and subprocess creation begin after start() returns.
  queueMicrotask(async () => {
    try {
      if (stopped) return;
      const deployment = JSON.parse(await read(['get', 'deployments', name, '--context', context, '--namespace', namespace, '--request-timeout=20s', '-o', 'json']));
      if (stopped) return;
      selector = selectorFromDeployment(deployment);
      await sweep();
    } catch (error) { fail(error); }
  });
  return { stop };
}
module.exports = { start, selectorFromDeployment };
