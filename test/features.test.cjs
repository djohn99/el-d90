const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const kube = require('../src/kube.cjs');
const { Forwards } = require('../src/forwards.cjs');
let temp, record;
before(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eld90-feature-'));
  record = path.join(temp, 'requests.jsonl');
  process.env.EL_D90_KUBECTL = path.join(__dirname, 'mock-kubectl.cjs');
  process.env.EL_D90_HELM = path.join(__dirname, 'mock-helm.cjs');
  process.env.EL_D90_TEST_RECORD = record;
});
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const input = { context: 'fixture-a', namespace: '*' };
const calls = () => fs.readFileSync(record, 'utf8').trim().split('\n').map(JSON.parse);
test('all-namespace resource query uses subcommand before its local flags', async () => {
  await kube.list({ ...input, resource: 'pods' });
  const args = calls().at(-1).args; assert.equal(args[0], 'get'); assert.ok(args.indexOf('--all-namespaces') > args.indexOf('get'));
  if (fs.existsSync('/usr/local/bin/kubectl')) assert.match(await kube.run(['get', 'pods', ...kube.scope(input, 'pods'), '--help'], { binary: '/usr/local/bin/kubectl' }), /Display one or many resources/);
});
test('discovery parses blank short names, API groups, scope and verbs', () => {
  const resources = kube.parseDiscovery('widgets wd example.test/v1 true Widget [get,list,watch]\nclusterwidgets    example.test/v1 false ClusterWidget [get list]\npods po v1 true Pod [get,list]\nwidgets/status wd example.test/v1 true Widget [get]');
  assert.equal(resources.length, 3); assert.equal(resources[0].key, 'widgets.example.test'); assert.equal(resources[1].namespaced, false); assert.deepEqual(resources[1].verbs, ['get', 'list']); assert.equal(resources[2].key, 'pods');
});
test('discovered resources can be listed with their actual API scope', async () => {
  assert.throws(() => kube.scope({context:'not-discovered',namespace:'*'},'widgets.example.test'), /Unsupported/);
  await kube.discover(input);
  const widgets = await kube.list({ ...input, resource: 'widgets.example.test' }); assert.equal(widgets.items[0].metadata.name, 'fixture-widget'); assert.ok(calls().at(-1).args.includes('--all-namespaces'));
  await kube.list({ ...input, resource: 'clusterwidgets.example.test' }); assert.equal(calls().at(-1).args.includes('--all-namespaces'), false);
  assert.throws(() => kube.scope(input, 'constructor'), /Unsupported/);
});
test('secret lists expose keys without values', async () => {
  const data = await kube.list({ ...input, resource: 'secrets' }); assert.deepEqual(data.items[0].dataKeys, ['token']); assert.equal('data' in data.items[0], false); assert.equal(JSON.stringify(data).includes('DO-NOT-RETURN'), false); assert.deepEqual(Object.keys(data.items[0]).sort(),['apiVersion','dataKeys','kind','metadata','type']); assert.deepEqual(data.items[0].metadata,{name:'fixture-secret',namespace:'team',uid:'secret-uid',creationTimestamp:'2026-01-01T00:00:00Z'}); assert.equal(data.items[0].type,'Opaque'); assert.equal(JSON.stringify(data).includes('FORGED'),false);
});
test('Metrics API requests respect the namespace and return samples', async () => {
  const result = await kube.metrics({ ...input, namespace: 'team' }); assert.equal(result.errors.length, 0); assert.equal(result.pods.items.length, 1); assert.ok(calls().some(c => c.args.includes('/apis/metrics.k8s.io/v1beta1/namespaces/team/pods')));
});
test('Helm listing supports both installed Helm 4 and Helm 3 all-status flags', async () => {
  delete process.env.EL_D90_TEST_HELM3; assert.equal((await kube.helmList(input))[0].name, 'fixture-release');
  process.env.EL_D90_TEST_HELM3 = '1'; try { assert.equal((await kube.helmList(input))[0].name, 'fixture-release'); } finally { delete process.env.EL_D90_TEST_HELM3; }
  assert.match(await kube.helmManifest({...input,namespace:'team',name:'fixture-release'}), /kind: ConfigMap/);
});
test('scale, restart and port-forward arguments cannot escape the explicit target', () => {
  assert.deepEqual(kube.actionArgs({...input,namespace:'team',resource:'deployments',name:'web',action:'scale',replicas:3}).slice(0,3), ['scale','deployments','web']);
  assert.throws(() => kube.actionArgs({...input,namespace:'team',resource:'pods',name:'web',action:'scale',replicas:3}), /Unsupported/);
  assert.throws(() => kube.actionArgs({...input,namespace:'team',resource:'deployments',name:'web',action:'scale',replicas:-1}), /Replicas/);
  const args = kube.forwardArgs({...input,namespace:'team',resource:'services',name:'web',localPort:18080,remotePort:80}); assert.ok(args.includes('--address=127.0.0.1')); assert.ok(args.includes('18080:80')); assert.equal(args[args.indexOf('--context')+1],'fixture-a');
  assert.throws(() => kube.forwardArgs({...input,namespace:'team',resource:'pods',name:'web',localPort:0,remotePort:80}), /Ports/);
});
test('port forwards report readiness, reject duplicate ports and clean up on stop', async () => {
  const manager = new Forwards();
  try {
    const request = {...input,namespace:'team',resource:'pods',name:'fixture-pod',localPort:18080,remotePort:80};
    const {id} = manager.start(request); assert.throws(() => manager.start(request), /active forward/);
    const end=Date.now()+3000; while(manager.list()[0].state==='starting' && Date.now()<end) await new Promise(r=>setTimeout(r,20));
    assert.equal(manager.list()[0].state,'ready');
    const child=manager.entries.get(id).child;
    const closed=new Promise(resolve=>child.once('close',resolve));manager.stop(id);await closed;
    assert.equal(manager.list()[0].state,'stopped'); assert.throws(()=>process.kill(child.pid,0));
  } finally {manager.close();}
});

test('partial API discovery retains successful groups and surfaces the warning', async () => {
  process.env.EL_D90_TEST_FAILURE = 'discovery';
  try { const result=await kube.discover(input);assert.equal(result.resources.length,1);assert.match(result.warnings[0],/API group is unavailable/); } finally { delete process.env.EL_D90_TEST_FAILURE; }
});

test('multi-namespace lists query each authorized namespace and retain partial errors', async () => {
  const data=await kube.list({...input,resource:'pods',namespaces:['team','other','team']});assert.equal(data.items.length,2);assert.deepEqual(new Set(data.items.map(r=>r.metadata.namespace)),new Set(['team','other']));
  const before=calls().length;await kube.list({...input,resource:'nodes',namespaces:['team','other']});assert.equal(calls().length-before,1);
  process.env.EL_D90_TEST_FAILURE='denied-namespace';
  try{const partial=await kube.list({...input,resource:'pods',namespaces:['team','blocked']});assert.equal(partial.items.length,1);assert.match(partial.warnings[0],/blocked/);await assert.rejects(kube.list({...input,resource:'pods',namespaces:['blocked']}),/Forbidden/);}finally{delete process.env.EL_D90_TEST_FAILURE;}
});
test('multi-namespace metrics make separate scoped pod requests and one node request', async()=>{const before=calls().length;const result=await kube.metrics({...input,namespaces:['team','other']});assert.equal(result.pods.items.length,2);assert.equal(calls().length-before,3);assert.throws(()=>kube.selectedNamespaces({...input,namespaces:['--all-namespaces']}),/namespace/);});
