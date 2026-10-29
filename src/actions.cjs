// Original context-bound resource operations for el-d90.
// The main process must present validate().confirmation before perform().
const kube = require('./kube.cjs');

const HIGH_RISK_DELETE = new Set(['namespaces', 'nodes', 'persistentvolumes', 'persistentvolumeclaims', 'secrets', 'customresourcedefinitions']);
const ROLLOUT_RESOURCES = new Set(['deployments', 'statefulsets', 'daemonsets']);

function target(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose exactly one resource');
  const context = kube.string(input.context, 'context');
  const resource = kube.resource(input.resource, context);
  const name = kube.name(input.name);
  if (Array.isArray(input.namespaces) && input.namespaces.length > 1 && (!input.namespace || input.namespace === '*')) throw new Error('Resource actions require exactly one target namespace');
  const namespace = input.namespace && input.namespace !== '*' ? input.namespace : Array.isArray(input.namespaces) && input.namespaces.length === 1 ? input.namespaces[0] : input.namespace;
  // Do not pass the workspace's multi-selection to a single-object operation.
  const scoped = { context, resource, name, namespace };
  const flags = kube.scope(scoped, resource, true);
  return { ...scoped, namespace: flags.includes('--namespace') ? namespace : null, flags };
}

function validate(input) {
  const t = target(input);
  const action = kube.string(input.action, 'action', 30);
  let args, impact, highRisk = false, timeout = 90000;
  if (action === 'delete') {
    args = ['delete', t.resource, t.name, ...t.flags, '--wait=true', '--timeout=60s', '--cascade=background'];
    highRisk = HIGH_RISK_DELETE.has(t.resource.split('.')[0]);
    impact = 'Deletes this one named resource. A controller may recreate managed objects; storage or dependent resources can be affected.';
  } else if (['cordon', 'uncordon', 'drain'].includes(action)) {
    if (t.resource !== 'nodes') throw new Error('Node scheduling actions require a node');
    args = [action, t.name, ...t.flags];
    impact = action === 'uncordon' ? 'Makes this node eligible for scheduling.' : 'Marks this node unschedulable.';
    if (action === 'drain') {
      args.push('--ignore-daemonsets=true', '--delete-emptydir-data=false', '--force=false', '--disable-eviction=false', '--timeout=5m');
      impact += ' Gracefully evicts eligible pods while respecting disruption budgets. Pods with local emptyDir data or unmanaged pods can block the drain; el-d90 will not force them out.';
      highRisk = true; timeout = 330000;
    }
  } else if (action === 'suspend' || action === 'resume') {
    if (t.resource !== 'cronjobs') throw new Error('Suspend/resume requires a CronJob');
    args = ['patch', 'cronjobs', t.name, ...t.flags, '--type=merge', '-p', JSON.stringify({ spec: { suspend: action === 'suspend' } })];
    impact = action === 'suspend' ? 'Stops future scheduled Job creation. Existing Jobs keep running.' : 'Allows this CronJob to create scheduled Jobs again.';
  } else {
    throw new Error('Unsupported resource action');
  }
  return { action, resource: t.resource, name: t.name, context: t.context, namespace: t.namespace || null, args, timeout, confirmation: { title: `${action[0].toUpperCase() + action.slice(1)} ${t.name}?`, impact, highRisk, typedName: highRisk ? t.name : null } };
}

async function perform(input) {
  const operation = validate(input);
  return { output: await kube.run(operation.args, { timeout: operation.timeout }) };
}

async function describe(input) {
  const t = target(input);
  return kube.run(['describe', t.resource, t.name, ...t.flags]);
}

async function rolloutStatus(input) {
  const t = target(input);
  if (!ROLLOUT_RESOURCES.has(t.resource)) throw new Error('Rollout status requires a Deployment, StatefulSet or DaemonSet');
  return kube.run(['rollout', 'status', `${t.resource}/${t.name}`, ...t.flags, '--watch=false']);
}

module.exports = { validate, perform, describe, rolloutStatus };
