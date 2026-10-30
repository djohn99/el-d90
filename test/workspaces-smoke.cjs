// Reusable offline Electron acceptance checks for independent cluster workspaces.
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'el-d90-workspaces-'));
const record = path.join(temp, 'requests.jsonl');
const mock = path.join(temp, 'kubectl');
const delayMarker = path.join(temp, 'delay-a');
const errors = [];
let application;

function fixtureMain() {
  const fs = require('node:fs');
  const args = process.argv.slice(2), context = args.includes('--context') ? args[args.indexOf('--context') + 1] : '';
  const namespace = args.includes('--namespace') ? args[args.indexOf('--namespace') + 1] : 'team';
  fs.appendFileSync(process.env.EL_D90_TEST_RECORD, JSON.stringify({ args, context, pid: process.pid }) + '\n');
  const pod = { apiVersion: 'v1', kind: 'Pod', metadata: { name: context === 'fixture-b' ? 'pod-b' : 'pod-a', namespace, uid: context + '-pod', creationTimestamp: new Date().toISOString() }, spec: { containers: [{ name: 'web', image: 'fixture:1' }] }, status: { phase: 'Running', containerStatuses: [{ name: 'web', ready: true, restartCount: 0 }] } };
  if (args[0] === 'config') console.log(JSON.stringify({ 'current-context': 'fixture-a', contexts: ['fixture-a', 'fixture-b'].map(name => ({ name, context: { cluster: name, namespace: 'team' } })) }));
  else if (args[0] === 'api-resources') console.log('pods po v1 true Pod [get,list,watch]\ndeployments deploy apps/v1 true Deployment [get,list,watch]');
  else if (args[0] === 'logs') { console.log('LOG_CONNECTED ' + context); setInterval(() => console.log('log ' + context), 100); }
  else if (args[0] === 'exec') { console.log('SHELL_CONNECTED ' + context); process.stdin.on('data', data => console.log('received ' + context + ': ' + data.toString().trim())); }
  else if (args[0] === 'get') {
    const emit = () => {
      if (args.includes('--raw')) console.log(JSON.stringify({ gitVersion: 'v1.33.0' }));
      else if (args.includes('yaml')) console.log('apiVersion: v1\nkind: Pod\nmetadata:\n  name: ' + pod.metadata.name + '\n  namespace: ' + namespace + '\nspec:\n  containers:\n    - name: web\n      image: fixture:1');
      else console.log(JSON.stringify({ items: args[1] === 'namespaces' ? ['team', 'ops'].map(name => ({ kind: 'Namespace', metadata: { name } })) : args[1] === 'pods' ? [pod] : [] }));
    };
    if (context === 'fixture-a' && args[1] === 'pods' && fs.existsSync(process.env.EL_D90_DELAY_MARKER)) setTimeout(emit, 1000); else emit();
  } else { console.error('Unsupported offline fixture request'); process.exit(1); }
}
fs.writeFileSync(mock, '#!/usr/bin/env node\n(' + fixtureMain.toString() + ')();\n', { mode: 0o755 });
const profile = path.join(temp, 'live-profile');
const demoProfile = path.join(temp, 'demo-profile');
const calls = () => fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitFor(predicate, timeout = 6000) { const end = Date.now() + timeout; while (!predicate()) { if (Date.now() > end) throw new Error('Workspace condition timed out'); await new Promise(r => setTimeout(r, 25)); } }
async function launch(demo = false) {
  application = await _electron.launch({ executablePath: process.env.EL_D90_APP_EXECUTABLE || require('electron'), args: [...(process.env.EL_D90_APP_EXECUTABLE ? [] : [root]), ...(demo ? ['--demo'] : [])], cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', EL_D90_USER_DATA: demo ? demoProfile : profile, EL_D90_KUBECTL: mock, EL_D90_TEST_RECORD: record, EL_D90_DELAY_MARKER: delayMarker } });
  const page = await application.firstWindow(); await page.setViewportSize({width:1460,height:940});
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => dialog.accept());
  return page;
}
async function selectContext(page, name) {
  await page.locator(`#context option[value="${name}"]`).waitFor({ state: 'attached' });
  await page.locator('#context').selectOption(name);
  await page.locator(`.cluster-tab-select[data-context="${name}"][aria-selected="true"]`).waitFor();
  await page.locator('#busy').waitFor({ state: 'hidden' });
}
async function tab(page, name) {
  await page.locator(`.cluster-tab-select[data-context="${name}"]`).click();
  await page.locator(`.cluster-tab-select[data-context="${name}"][aria-selected="true"]`).waitFor();
  await page.locator('#busy').waitFor({ state: 'hidden' });
}
async function namespaces(page, names) {
  await page.locator('#namespace-multi').click();
  const inputs = page.locator('#namespace-options input');
  for (let i = 0; i < await inputs.count(); i++) await inputs.nth(i).setChecked(names.includes(await inputs.nth(i).getAttribute('value')));
  await page.locator('#namespace-done').click();
  await page.locator('#namespace-popover').waitFor({ state: 'hidden' });
  await page.locator('#busy').waitFor({ state: 'hidden' });
}
async function text(page, selector, value) { await page.locator(selector).filter({ hasText: value }).waitFor(); }

(async () => {
  try {
    let page = await launch(true);
    await page.locator('#overview').waitFor({ state: 'visible' });
    await namespaces(page, ['production']);
    await page.locator('.nav-item[data-view="pods"]').click(); await text(page, '#resource-count', '7 resources');
    await namespaces(page, ['production', 'staging']); await text(page, '#resource-count', '9 resources');
    await page.locator('#search').fill('redis'); await text(page, '#resource-count', '1 resource');
    await page.getByRole('button', { name: 'Open redis-cache-0', exact: true }).click();
    await page.locator('[data-tab="yaml"]').click();
    await page.waitForFunction(() => document.getElementById('yaml-editor').value.includes('redis-cache-0'));
    const draft = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: unsaved-workspace-a\n';
    await page.locator('#yaml-editor').fill(draft);
    await selectContext(page, 'demo-us-east');
    await page.locator('.nav-item[data-view="deployments"]').click();
    await namespaces(page, ['staging']);
    await tab(page, 'demo-eu-west');
    assert.equal(await page.locator('#search').inputValue(), 'redis');
    assert.equal(await page.locator('#namespace').inputValue(), '__multiple__');
    assert.equal(await page.locator('#yaml-editor').inputValue(), draft);
    assert.equal(await page.locator('.nav-item[data-view="pods"]').getAttribute('class').then(c => c.includes('active')), true);
    await tab(page, 'demo-us-east');
    assert.equal(await page.locator('#namespace').inputValue(), 'staging');
    assert.equal(await page.locator('.nav-item[data-view="deployments"]').getAttribute('class').then(c => c.includes('active')), true);
    assert.equal(calls().length, 0, 'Disconnected demo must never execute kubectl');
    await application.close(); application = null;
    console.log('PASS: demo namespace union, independent cluster views/search/namespace sets and YAML drafts');

    page = await launch();
    await selectContext(page, 'fixture-a');
    await page.locator('.nav-item[data-view="pods"]').click();
    await page.getByRole('button', { name: 'Open pod-a', exact: true }).click();
    await page.locator('[data-tab="logs"]').click(); await text(page, '#logs-output', 'LOG_CONNECTED fixture-a');
    await page.locator('[data-tab="terminal"]').click(); await page.locator('#connect-terminal').click();
    await waitFor(() => calls().some(c => c.context === 'fixture-a' && c.args[0] === 'exec'));
    const aPids = calls().filter(c => c.context === 'fixture-a' && ['logs', 'exec'].includes(c.args[0])).map(c => c.pid);
    await selectContext(page, 'fixture-b');
    assert.ok(aPids.every(alive), 'Switching context must keep cluster A sessions alive');
    await page.locator('.nav-item[data-view="pods"]').click();
    await page.getByRole('button', { name: 'Open pod-b', exact: true }).click();
    await page.locator('[data-tab="logs"]').click(); await text(page, '#logs-output', 'LOG_CONNECTED fixture-b');
    await page.locator('[data-tab="terminal"]').click(); await page.locator('#connect-terminal').click();
    await waitFor(() => calls().some(c => c.context === 'fixture-b' && c.args[0] === 'exec'));
    const bPids = calls().filter(c => c.context === 'fixture-b' && ['logs', 'exec'].includes(c.args[0])).map(c => c.pid);
    assert.ok(aPids.every(alive) && bPids.every(alive));
    await page.locator('#reload-contexts').click();
    await page.locator('#busy').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.cluster-tab-select').count(), 2);
    assert.ok(aPids.every(alive) && bPids.every(alive), 'Reload contexts must not disconnect sessions');
    await page.getByRole('button', { name: 'Disconnect fixture-a', exact: true }).click();
    await waitFor(() => aPids.every(pid => !alive(pid)));
    assert.ok(bPids.every(alive), 'Closing A must preserve B sessions');
    assert.equal(await page.locator('.cluster-tab-select').count(), 1);
    console.log('PASS: concurrent context-bound logs/PTYs; reload preserves tabs; disconnect stops only owned sessions');

    await page.locator('#close-drawer').click();
    await namespaces(page, ['team', 'ops']);
    await page.locator('.nav-item[data-view="deployments"]').click();
    await selectContext(page, 'fixture-a');
    await page.locator('.nav-item[data-view="pods"]').click();
    // The old cluster's deliberately delayed request must not overwrite B.
    fs.writeFileSync(delayMarker, 'delay');
    await page.locator('#refresh').click();
    await tab(page, 'fixture-b');
    await new Promise(r => setTimeout(r, 1250));
    assert.equal(await page.locator('#context').inputValue(), 'fixture-b');
    assert.match(await page.locator('#page-title').textContent(), /Deployments/);
    assert.equal(await page.locator('#resource-table').textContent().then(t => t.includes('pod-a')), false);
    fs.unlinkSync(delayMarker);
    await application.close(); application = null;
    const restartOffset=calls().length;
    page = await launch();
    await page.locator('.cluster-tab-select[data-context="fixture-a"]').waitFor();
    await page.locator('.cluster-tab-select[data-context="fixture-b"][aria-selected="true"]').waitFor();
    await page.locator('#busy').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#namespace').inputValue(), '__multiple__');
    assert.match(await page.locator('#page-title').textContent(), /Deployments/);
    console.log('PASS: stale responses stay in their owning workspace and live workspace preferences restore after restart');
    await page.waitForFunction(()=>state.initialized&&!state.loading&&state.context==='fixture-b');
    const restartCalls=calls().slice(restartOffset);
    assert.equal(restartCalls.some(c=>c.context==='fixture-a'&&['get','api-resources'].includes(c.args[0])),false,'Startup must not block on loading inactive cluster tabs');
    assert.equal(restartCalls.some(c=>c.args[0]==='get'&&['nodes','events'].includes(c.args[1])),false,'Restoring Deployments must not fetch an unused Overview');
    assert.equal(restartCalls.filter(c=>c.context==='fixture-b'&&c.args[0]==='get'&&c.args[1]==='deployments').length,2,'Concurrent table/metrics requests share one Deployment list per namespace');
    await tab(page,'fixture-a');await page.waitForFunction(()=>state.initialized&&!state.loading&&state.context==='fixture-a');assert.match(await page.locator('#page-title').textContent(),/Pods/);
    await page.evaluate(async()=>{const host=document.createElement('div');document.body.append(host);const calls=[],source={namespace:'monitoring',name:'prometheus',port:9090},invoke=async(channel,input)=>{if(channel==='history:sources'){calls.push(input.context);return[source];}const end=Math.floor(Date.now()/1000);return{metric:'cpu',unit:'cores',start:end-3600,end,step:15,series:[{name:'Usage',values:[[end,1]]}],errors:[]};};const render=context=>window.elD90History.render(host,{context,target:{resource:'pods',namespace:'team',name:'pod'},settings:{source},invoke});window.elD90History.clearSources();await render('perf-a');await render('perf-a');await render('perf-b');if(JSON.stringify(calls)!==JSON.stringify(['perf-a','perf-b']))throw Error('Prometheus discovery was repeated or leaked across contexts');window.elD90History.clearSources();await render('perf-a');if(calls.length!==3)throw Error('Explicit source cache reset failed');host.remove();window.elD90History.clearSources();});
    console.log('PASS: one saved-view startup load, deferred inactive workspaces, duplicate-list coalescing and context-scoped Prometheus discovery reuse/reset');
    await page.evaluate(async()=>{const host=document.createElement('div');document.body.append(host);let release,queried=false;const pending=new Promise(resolve=>release=resolve),source={namespace:'monitoring',name:'prometheus',port:9090};window.elD90History.clearSources();const task=window.elD90History.render(host,{context:'slow-discovery',target:{resource:'pods',namespace:'team',name:'pod'},settings:{source},invoke:async channel=>{if(channel==='history:sources')return pending;queried=true;const end=Math.floor(Date.now()/1000);return{metric:'cpu',unit:'cores',start:end-3600,end,step:15,series:[{name:'Usage',values:[[end,1]]}],errors:[]};}});await new Promise(resolve=>setTimeout(resolve,50));const early=queried;release([source]);await task;host.remove();if(!early)throw Error('Saved chart source was blocked by service discovery');window.elD90History.clearSources();});
    console.log('PASS: saved Prometheus sources load charts while service discovery is pending');


    assert.deepEqual(errors, []);
    await application.close(); application = null;
  } finally {
    if (application) await application.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
