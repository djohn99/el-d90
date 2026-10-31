const { test } = require('node:test'), assert = require('node:assert/strict'), YAML = require('yaml'), data = require('../src/resource-data.cjs');
const identity = { kind: 'ConfigMap', name: 'app', namespace: 'team', uid: 'uid-1' };
const text = '# preserve header\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app\n  namespace: team\n  uid: uid-1\n  resourceVersion: "123"\n  annotations:\n    example.test/keep: yes\ndata:\n  config.yaml: |\n    port: 8080\n  remove: old\nbinaryData:\n  sample.bin: AAE=\n';
test('ConfigMap text and binary data are edited locally while unrelated fields and metadata remain intact', () => {
  const parsed = data.read({ text, identity }); assert.equal(parsed.fields[0].value, 'port: 8080\n'); assert.equal(parsed.fields[2].binary, true);
  const result = data.write({ text, identity, fields: [{ key: 'config.yaml', value: 'message: 🌍\nline: two\n', binary: false }, { key: 'empty', value: '', binary: false }, { key: 'sample.bin', value: 'AAE=', binary: true }] });
  const obj = YAML.parse(result.text); assert.deepEqual(obj.data, { 'config.yaml': 'message: 🌍\nline: two\n', empty: '' }); assert.deepEqual(obj.binaryData, { 'sample.bin': 'AAE=' }); assert.equal(obj.metadata.resourceVersion, '123'); assert.equal(obj.metadata.annotations['example.test/keep'], 'yes'); assert.ok(result.text.startsWith('# preserve header'));
});
test('data drafts reject replacement identities, immutable resources, duplicate keys and invalid binary data', () => {
  for (const changed of [{ ...identity, uid: 'replacement' }, { ...identity, namespace: 'other' }, { ...identity, kind: 'Secret' }]) assert.throws(() => data.read({ text, identity: changed }), /identity changed/);
  assert.throws(() => data.write({ text: text + '\nimmutable: true\n', identity, fields: [] }), /immutable/);
  for (const fields of [[{ key: 'bad key', value: 'x' }], [{ key: 'same', value: 'x' }, { key: 'same', value: 'y' }], [{ key: 'binary', value: 'invalid!', binary: true }]]) assert.throws(() => data.write({ text, identity, fields }));
});
test('Secret staging replaces only edited data and retains the exact resource identity', () => {
  const secret = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'app', namespace: 'team', uid: 'uid-1', resourceVersion: '14' }, type: 'Opaque', data: { first: 'b2xk', second: 'a2VlcA==' } }, id = { ...identity, kind: 'Secret' }, original = YAML.stringify(secret);
  const parsed = data.read({ text: original, identity: id }); parsed.fields.find(f => f.key === 'first').value = Buffer.from('new 🌍').toString('base64');
  const obj = YAML.parse(data.write({ text: original, identity: id, fields: parsed.fields }).text); assert.equal(Buffer.from(obj.data.first, 'base64').toString(), 'new 🌍'); assert.equal(obj.data.second, secret.data.second); assert.deepEqual(obj.metadata, secret.metadata);
});
test('single-document and alias bounds prevent accidental multi-resource data edits', () => {
  assert.throws(() => data.read({ text: text + '\n---\nkind: ConfigMap\n', identity }), /one valid/);
  assert.throws(() => data.read({ text: 'kind: ConfigMap\ndata: {a: x, a: y}', identity }), /one valid/);
});
