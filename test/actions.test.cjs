const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const actions = require('../src/actions.cjs');

const base = { context: 'cluster-blue', namespace: 'team-a', resource: 'pods', name: 'web-123' };
let directory, originalExecutable;
before(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'el-d90-actions-'));
  const executable = path.join(directory, 'kubectl');
  fs.writeFileSync(executable, '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n', { mode: 0o755 });
  originalExecutable = process.env.EL_D90_KUBECTL;
  process.env.EL_D90_KUBECTL = executable;
});
after(() => {
  if (originalExecutable === undefined) delete process.env.EL_D90_KUBECTL; else process.env.EL_D90_KUBECTL = originalExecutable;
  fs.rmSync(directory, { recursive: true, force: true });
});

test('single-object deletion pins the context and namespace and never selects a collection', () => {
  const operation = actions.validate({ ...base, action: 'delete' });
  assert.deepEqual(operation.args.slice(0, 3), ['delete', 'pods', 'web-123']);
  assert.equal(operation.args[operation.args.indexOf('--context') + 1], 'cluster-blue');
  assert.equal(operation.args[operation.args.indexOf('--namespace') + 1], 'team-a');
  assert.equal(operation.args.includes('--all'), false);
  assert.equal(operation.args.includes('--all-namespaces'), false);
  assert.equal(operation.confirmation.highRisk, false);
});

test('ambiguous namespaces, collection-shaped names and unsupported actions fail before spawning', () => {
  for (const input of [
    { ...base, action: 'delete', namespace: '*' },
    { ...base, action: 'delete', namespace: '*', namespaces: ['team-a', 'team-b'] },
    { ...base, action: 'delete', name: '*' },
    { ...base, action: 'delete', name: 'a,b' },
    { ...base, action: 'delete', name: '--all' },
    { ...base, action: 'exec' },
    { ...base, action: 'drain' },
  ]) assert.throws(() => actions.validate(input));
});

test('a selected object keeps its exact namespace even under a multi-namespace workspace filter', () => {
  const operation = actions.validate({ ...base, action: 'delete', namespaces: ['team-a', 'team-b'] });
  assert.equal(operation.namespace, 'team-a');
  assert.equal(operation.args[operation.args.indexOf('--namespace') + 1], 'team-a');
});

test('namespace, node, volume, secret and CRD deletions carry typed-name confirmation metadata', () => {
  for (const resource of ['namespaces', 'nodes', 'persistentvolumes', 'persistentvolumeclaims', 'secrets', 'customresourcedefinitions']) {
    const operation = actions.validate({ ...base, resource, action: 'delete' });
    assert.equal(operation.confirmation.highRisk, true);
    assert.equal(operation.confirmation.typedName, 'web-123');
  }
});

test('drain respects eviction safeguards and does not force-delete local or unmanaged pod data', () => {
  const operation = actions.validate({ ...base, resource: 'nodes', action: 'drain' });
  for (const arg of ['--ignore-daemonsets=true', '--delete-emptydir-data=false', '--force=false', '--disable-eviction=false', '--timeout=5m']) assert.ok(operation.args.includes(arg));
  assert.equal(operation.args.includes('--namespace'), false);
  assert.equal(operation.confirmation.highRisk, true);
  assert.match(operation.confirmation.impact, /disruption budgets/);
});

test('cordon and uncordon apply to one named node with a context', () => {
  for (const action of ['cordon', 'uncordon']) {
    const operation = actions.validate({ ...base, resource: 'nodes', action });
    assert.deepEqual(operation.args.slice(0, 2), [action, 'web-123']);
    assert.ok(operation.args.includes('--context'));
  }
});

test('CronJob suspend/resume is a merge patch with no arbitrary caller JSON', () => {
  for (const action of ['suspend', 'resume']) {
    const operation = actions.validate({ ...base, resource: 'cronjobs', action, patch: 'arbitrary-input-is-ignored' });
    assert.deepEqual(JSON.parse(operation.args[operation.args.indexOf('-p') + 1]), { spec: { suspend: action === 'suspend' } });
  }
  assert.throws(() => actions.validate({ ...base, action: 'suspend' }), /CronJob/);
});

test('perform runs only the validated argv against an offline executable', async () => {
  const operation = actions.validate({ ...base, resource: 'cronjobs', action: 'suspend' });
  const result = await actions.perform({ ...base, resource: 'cronjobs', action: 'suspend' });
  assert.deepEqual(JSON.parse(result.output), operation.args);
});

test('describe and rollout status are context-bound read-only commands', async () => {
  const description = JSON.parse(await actions.describe(base));
  assert.deepEqual(description.slice(0, 3), ['describe', 'pods', 'web-123']);
  assert.equal(description[description.indexOf('--context') + 1], 'cluster-blue');
  const status = JSON.parse(await actions.rolloutStatus({ ...base, resource: 'deployments' }));
  assert.deepEqual(status.slice(0, 3), ['rollout', 'status', 'deployments/web-123']);
  assert.ok(status.includes('--watch=false'));
  await assert.rejects(actions.rolloutStatus(base), /Rollout status/);
});
