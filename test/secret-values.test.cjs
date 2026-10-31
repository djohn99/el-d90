const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decode, reveal } = require('../src/secret-values.cjs');
const columns = require('../src/resource-columns.js');
test('Secret text decoding preserves Unicode, multiline and empty values; binary data is labelled', () => {
  const entries = decode({ text: Buffer.from('hello 🌍\nline 2').toString('base64'), empty: '', binary: Buffer.from([0, 255, 1]).toString('base64'), html: Buffer.from('<script>synthetic</script>').toString('base64') });
  assert.equal(entries[0].value, 'hello 🌍\nline 2'); assert.equal(entries[1].value, '');
  assert.equal(entries[2].binary, true); assert.equal(entries[2].encoding, 'base64 (binary)'); assert.equal(entries[2].value, 'AP8B');
  assert.throws(() => decode({ bad: '<not-base64>' }), /invalid base64/);
});
test('Secret reveal pins exact context/namespace/name/UID and rejects replacement objects', async () => {
  const input = { context: 'fixture-a', namespace: 'team', name: 'synthetic', uid: 'uid-1' }, calls = [];
  const object = { kind: 'Secret', metadata: { name: input.name, namespace: input.namespace, uid: input.uid }, data: { password: Buffer.from('synthetic-only').toString('base64') } };
  const result = await reveal(input, { run: async args => { calls.push(args); return JSON.stringify(object); } });
  assert.equal(result.entries[0].value, 'synthetic-only');
  assert.deepEqual(calls[0].slice(0, 3), ['get', 'secrets', 'synthetic']); assert.ok(calls[0].includes('fixture-a')); assert.ok(calls[0].includes('team')); assert.ok(!calls[0].includes('--all-namespaces'));
  for (const metadata of [{ ...object.metadata, uid: 'replacement' }, { ...object.metadata, namespace: 'other' }, { ...object.metadata, name: 'other' }]) await assert.rejects(reveal(input, { run: async () => JSON.stringify({ ...object, metadata }) }), /identity changed/);
  await assert.rejects(reveal({ ...input, namespace: '*' }), /Invalid/);
});
test('VPA columns show actual target, policy and per-container recommendations', () => {
  const resource = { spec: { targetRef: { kind: 'Deployment', name: 'api' }, updatePolicy: { updateMode: 'Off' } }, status: { recommendation: { containerRecommendations: [{ containerName: 'web', target: { cpu: '200m', memory: '256Mi' } }] } } };
  const profile = columns.profiles['verticalpodautoscalers.autoscaling.k8s.io'];
  assert.equal(profile.find(c => c.key === 'target').read(resource), 'Deployment/api');
  assert.equal(profile.find(c => c.key === 'mode').read(resource), 'Off');
  assert.match(profile.find(c => c.key === 'recommendations').read(resource), /web: cpu=200m, memory=256Mi/);
});
