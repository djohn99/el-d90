// Offline desktop integration: transport adapters are replaced with local shells.
const {_electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'eld90-node-ui-'));
(async()=>{let app;try{
 app=await _electron.launch({executablePath:process.env.EL_D90_APP_EXECUTABLE||require('electron'),args:process.env.EL_D90_APP_EXECUTABLE?[]:[root],env:{...process.env,ELECTRON_RUN_AS_NODE:'',EL_D90_USER_DATA:profile,EL_D90_KUBECTL:path.join(root,'test/mock-kubectl.cjs')}});
 const page=await app.firstWindow();await page.setViewportSize({width:1460,height:940});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({app,dialog,ipcMain})=>{
  const load=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/src/main.cjs');const n=load('./node-access.cjs');let records=[];global.nodeTest={ssh:0,debug:0,cleaned:0};
  dialog.showMessageBox=async()=>({response:1});
  ipcMain.removeHandler('node:discover');ipcMain.handle('node:discover',async()=>({os:'linux',addresses:[{type:'InternalIP',address:'127.0.0.1'}],defaultHost:'127.0.0.1'}));
  const original=n.validateSSH;n.validateSSH=input=>{const v=original(input);global.nodeTest.ssh++;return{...v,command:'/bin/sh',args:['-c','echo SSH_FIXTURE_READY; while read line; do echo "SSH_RECEIVED:$line"; [ "$line" = exit ] && exit 0; done']};};
  n.createDebug=async(input,opts)=>{global.nodeTest.debug++;const v=n.validateDebug(input),record={...v,podName:'el-d90-node-debug-fixture',uid:'fixture-uid',sessionToken:'e9ca9251-72f9-4ab4-9d4f-5facdc3bbcbf'};records=[record];await opts.onCreated?.(record);return record;};
  n.active=()=>records;n.cleanup=async()=>{global.nodeTest.cleaned++;records=[];return{removed:true};};
  n.terminalArgs=()=>['exec','-it','fixture-pod','--context','fixture-a','--namespace','team','--','/bin/sh'];
 });
 await page.locator('#context option[value="fixture-a"]').waitFor({state:'attached'});
 await page.locator('#context').selectOption('fixture-a');await page.locator('#busy').waitFor({state:'hidden'});
 // Open a synthetic Node through the same renderer detail handler.
 await page.evaluate(()=>openDetail({kind:'Node',metadata:{name:'fixture-node'},spec:{},status:{conditions:[{type:'Ready',status:'True'}]}},'nodes'));
 await page.locator('[data-tab="node-access"]').click();await page.locator('#node-discover').click();
 await page.waitForFunction(()=>document.querySelector('#node-ssh-host').value==='127.0.0.1');
 await page.locator('#node-ssh-user').fill('fixture');await page.locator('#node-ssh-connect').click();
 await page.waitForFunction(()=>(state.terminalBuffer||'').includes('SSH_FIXTURE_READY'));
 await page.evaluate(()=>state.terminalInstance.input('echo-check\r'));
 await page.waitForFunction(()=>(state.terminalBuffer||'').includes('SSH_RECEIVED:echo-check'));
 await page.locator('#close-drawer').click();
 await page.evaluate(()=>openDetail({kind:'Node',metadata:{name:'fixture-node'},spec:{},status:{}},'nodes'));
 await page.locator('[data-tab="terminal"]').click();await page.locator('#connect-terminal').click();
 await page.waitForFunction(()=>(state.terminalBuffer||'').includes('FIXTURE_SHELL_CONNECTED'));
 await page.evaluate(()=>state.terminalInstance.input('debug-check\r'));
 await page.waitForFunction(()=>(state.terminalBuffer||'').includes('fixture received: debug-check'));
 await page.locator('#close-drawer').click();
 await page.waitForTimeout(200);
 const result=await app.evaluate(()=>global.nodeTest);assert.equal(result.ssh,1);assert.equal(result.debug,1);assert.ok(result.cleaned>=1);assert.deepEqual(errors,[]);
 await page.locator('#new-yaml').click();await page.locator('#create-controls').waitFor();
 const kinds=await page.locator('#create-kind').textContent();assert.ok(kinds.includes('Widget'));assert.ok(kinds.includes('CustomResourceDefinition'));
 await page.locator('#create-namespace').selectOption('');await page.locator('#yaml-editor').fill('apiVersion: example.test/v1\nkind: Widget\nmetadata:\n  name: fixture\n  namespace: team\n---\napiVersion: v1\nkind: Namespace\nmetadata:\n  name: fixture-only\n');await page.locator('#validate-yaml').click();await page.waitForFunction(()=>document.querySelector('#yaml-result').textContent.includes('validated'));
 assert.deepEqual(errors,[]);console.log('PASS: arbitrary multi-document and custom-resource YAML creation UI with server dry-run (offline)');
 console.log('PASS: node discovery, SSH native confirmation/PTY input, debug confirmation/PTY input and owned-session cleanup (offline)');
 }finally{await app?.close();fs.rmSync(profile,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
