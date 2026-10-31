// Isolated renderer-only acceptance checks. Clipboard is stubbed; no real Secret or clipboard is read.
const { _electron } = require('playwright'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eld90-secret-controls-'));
fs.writeFileSync(path.join(temp, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temp, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});w.loadURL('data:text/html,<main id="host"></main>');});`);
let app;
(async () => { try {
  app = await _electron.launch({ executablePath: process.env.EL_D90_APP_EXECUTABLE||require('electron'), args: process.env.EL_D90_APP_EXECUTABLE?['--demo']:[path.join(temp, 'main.cjs')], env: { ...process.env, ELECTRON_RUN_AS_NODE: '',EL_D90_USER_DATA:path.join(temp,'profile') } });
  const page = await app.firstWindow(); page.setDefaultTimeout(10000); if(process.env.EL_D90_APP_EXECUTABLE){await page.waitForFunction(()=>typeof state!=='undefined'&&state.initialized&&!state.loading);await page.evaluate(()=>{const host=document.createElement('main');host.id='host';host.style.cssText='position:fixed;inset:0;z-index:9999;overflow:auto;padding:20px;background:var(--bg)';document.body.append(host);});}else await page.addScriptTag({ path: path.join(root, 'src/secret-values-ui.js') });await page.locator('#host').waitFor({ state: 'attached' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.evaluate(() => {
    window.calls = []; window.edits = []; window.copied = []; window.current = true;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copied.push(value); } } });
    window.syntheticEntries = [{ key: 'config', value: 'hello 🌍\nline two', encoding: 'UTF-8', bytes: 20 }, { key: 'empty', value: '', encoding: 'UTF-8', bytes: 0 }, { key: 'binary', value: 'AP8B', encoding: 'base64 (binary)', binary: true, bytes: 3 }, { key: '<script>', value: '<img src=x onerror="window.ATTACK=true">', encoding: 'UTF-8', bytes: 42 }];
    window.attach = invoke => window.elD90SecretValues.attach(document.querySelector('#host'), { invoke, input: { context: 'fixture-a', namespace: 'team', name: 'synthetic', uid: 'synthetic-uid' }, demo: false, isCurrent: () => window.current, onEdit: async edit => { window.edits.push(edit); } });
    window.attach(async (channel, input) => { window.calls.push({ channel, input }); return { entries: window.syntheticEntries }; });
  });
  assert.equal(await page.locator('#secret-values').textContent(), '');
  await page.locator('#secret-reveal').click(); await page.locator('[data-secret-key=config] .secret-value').filter({ hasText: 'hello 🌍' }).waitFor();
  assert.equal((await page.evaluate(() => window.calls)).length, 1); assert.equal(await page.locator('#secret-values img').count(), 0);
  await page.getByRole('button', { name: 'Hide config', exact: true }).click(); assert.equal(await page.locator('[data-secret-key=config] pre').textContent(), 'Value hidden');
  assert.equal(await page.locator('[data-secret-key=binary] pre').textContent(), 'AP8B');
  await page.getByRole('button', { name: 'Show config', exact: true }).click(); assert.equal(await page.locator('[data-secret-key=config] pre').textContent(), 'hello 🌍\nline two');
  await page.getByRole('button', { name: 'Copy config', exact: true }).click(); await page.getByRole('button', { name: 'Copy empty', exact: true }).click(); await page.getByRole('button', { name: 'Copy binary', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.copied), ['hello 🌍\nline two', '', 'AP8B']);
  const config = page.locator('[data-secret-key=config]'); await config.getByRole('button', { name: 'Edit config', exact: true }).click(); await config.getByRole('textbox', { name: 'Edit config', exact: true }).fill('replacement\nconfiguration'); await config.getByRole('button', { name: 'Stage in YAML', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.edits), [{ key: 'config', value: 'replacement\nconfiguration', encoding: 'UTF-8' }]);
  const binary = page.locator('[data-secret-key=binary]'); await binary.getByRole('button', { name: 'Edit binary', exact: true }).click(); await binary.getByRole('textbox', { name: 'Edit binary', exact: true }).fill('AQID'); await binary.getByRole('button', { name: 'Cancel edit', exact: true }).click(); assert.equal(await binary.locator('textarea').inputValue(), ''); assert.equal((await page.evaluate(() => window.edits)).length, 1);
  await binary.getByRole('button', { name: 'Edit binary', exact: true }).click(); await binary.getByRole('textbox', { name: 'Edit binary', exact: true }).fill('AQID'); await binary.getByRole('button', { name: 'Hide binary', exact: true }).click(); assert.equal(await binary.locator('textarea').inputValue(), ''); assert.equal(await binary.locator('pre').textContent(), 'Value hidden');
  await page.locator('#secret-hide').click(); assert.equal(await page.locator('#secret-values').textContent(), '');
  await page.evaluate(() => { document.querySelector('#host').replaceChildren(); window.attach(async () => new Promise(resolve => { window.resolveLate = resolve; })); });
  await page.locator('#secret-reveal').click(); await page.evaluate(() => { window.elD90SecretValues.clear(); window.resolveLate({ entries: [{ key: 'late', value: 'never shown', encoding: 'UTF-8', bytes: 11 }] }); }); assert.equal(await page.locator('#secret-values').textContent(), '');
  assert.deepEqual(errors, []); console.log('PASS: per-key Secret show/hide, exact raw text/empty/binary copy with stubbed clipboard, edit stage/cancel, escaped data, all-hide and stale reveal cleanup');
} finally { await app?.close(); fs.rmSync(temp, { recursive: true, force: true }); } })().catch(e => { console.error(e); process.exitCode = 1; });
