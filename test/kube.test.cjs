const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const kube = require('../src/kube.cjs');
let directory, binary, original;
before(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-test-'));
  binary = path.join(directory, 'kubectl'); original = process.env.HARBOR_KUBECTL;
  fs.writeFileSync(binary, `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);if(a.includes('--all-namespaces')&&a.indexOf('--all-namespaces')<a.indexOf('get')){console.error('flags cannot be placed before plugin name');process.exit(1);}fs.writeFileSync(${JSON.stringify(path.join(directory, 'last-args.json'))},JSON.stringify(a));if(a[0]==='config'){console.log(JSON.stringify({'current-context':'work cluster',contexts:[{name:'work cluster',context:{cluster:'test',namespace:'team'}}],users:[{name:'test',user:{token:'DO-NOT-RETURN'}}]}));}else if(a.includes('apply')){let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(path.join(directory, 'last-input'))},s);console.log(a.includes('--dry-run=server')?'validated':'applied');});}else if(a.includes('fail')){console.error('Forbidden: RBAC denied');process.exit(1);}else if(a.includes('wait')){setTimeout(()=>{},10000);}else if(a.includes('get')){console.log(JSON.stringify({items:[{metadata:{name:'test-pod'}}]}));}else{console.log('ok');}\n`, { mode: 0o755 });
  process.env.HARBOR_KUBECTL = binary;
});
after(() => { if (original === undefined) delete process.env.HARBOR_KUBECTL; else process.env.HARBOR_KUBECTL = original; fs.rmSync(directory, { recursive: true, force: true }); });
const args = () => JSON.parse(fs.readFileSync(path.join(directory, 'last-args.json'), 'utf8'));
test('context discovery returns only context metadata, not kubeconfig credentials', async () => {
  const result = await kube.contexts(); assert.deepEqual(result, { current: 'work cluster', contexts: [{ name: 'work cluster', cluster: 'test', namespace: 'team' }] }); assert.equal(JSON.stringify(result).includes('DO-NOT-RETURN'), false); assert.equal(args().includes('--raw'), false);
});
test('resource request pins context and namespace without modifying global context', async () => {
  const result = await kube.list({ context: 'work cluster', namespace: 'team', resource: 'pods' }); assert.equal(result.items[0].metadata.name, 'test-pod'); assert.deepEqual(args(), ['get', 'pods', '--context', 'work cluster', '--request-timeout=20s', '--namespace', 'team', '-o', 'json']);
  await kube.list({ context: 'other', namespace: '*', resource: 'nodes' }); assert.equal(args().includes('--all-namespaces'), false);
});
test('YAML validation sends original text on stdin with server dry-run', async () => {
  const yaml = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: test\n';
  assert.equal((await kube.apply({ context: 'test', namespace: 'team', yaml }, true)).trim(), 'validated'); assert.ok(args().includes('--dry-run=server')); assert.equal(fs.readFileSync(path.join(directory, 'last-input'), 'utf8'), yaml);
  assert.equal((await kube.apply({ context: 'test', namespace: 'team', yaml }, false)).trim(), 'applied'); assert.equal(args().includes('--dry-run=server'), false);
});
test('missing scope and option injection are rejected before a process starts', async () => {
  await assert.rejects(kube.list({ resource: 'pods', namespace: '*' }), /context/);
  await assert.rejects(kube.list({ context: '--server=attacker', resource: 'pods' }), /context/);
  await assert.rejects(kube.list({ context: 'test', resource: 'not-a-resource' }), /Unsupported resource/);
  assert.throws(() => kube.logArgs({ context: 'test', namespace: '*', name: 'pod' }), /namespace/);
  assert.throws(() => kube.terminalArgs({ context: 'test', namespace: 'team', name: '--help' }), /name/);
  await assert.rejects(kube.yaml({ context: 'test', namespace: 'team', resource: 'pods', name: 'pod;whoami' }), /name/);
});
test('pod log and shell sessions pin context, namespace, pod and container', () => {
  const input = { context: 'test', namespace: 'team', name: 'pod-1', container: 'worker', previous: true, follow: true };
  const log = kube.logArgs(input); assert.ok(log.includes('--previous')); assert.ok(log.includes('--follow')); assert.ok(log.includes('--request-timeout=0')); assert.equal(log[log.indexOf('--container') + 1], 'worker');
  const terminal = kube.terminalArgs({ ...input, shell: 'arbitrary-command' }); assert.deepEqual(terminal.slice(-2), ['--', '/bin/sh']); assert.equal(terminal[terminal.indexOf('--context') + 1], 'test'); assert.ok(terminal.includes('-it'));
});
test('RBAC errors and deadlines propagate as actionable errors', async () => {
  await assert.rejects(kube.run(['fail']), /RBAC denied/); await assert.rejects(kube.run(['wait'], { timeout: 60 }), /timed out/);
});

test('GUI authentication resolves user-local tools before legacy Intel system tools', () => { const folders=kube.environment().PATH.split(path.delimiter); assert.equal(folders[0],path.join(os.homedir(),'.local/bin')); assert.ok(folders.indexOf('/opt/homebrew/bin') < folders.indexOf('/usr/local/bin')); assert.equal(new Set(folders).size,folders.length); });
