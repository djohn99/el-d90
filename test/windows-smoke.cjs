// Native Windows acceptance against the actual packaged app and native module.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{_electron}=require('playwright');
const watchdog=setTimeout(()=>{console.error('Windows acceptance exceeded 150 seconds');process.exit(1);},150000);
(async()=>{
 assert.equal(process.platform,'win32');const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'eld90-win-'));
 const launchEnvironment={...process.env,EL_D90_USER_DATA:path.join(temporary,'profile')};delete launchEnvironment.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:path.join(root,'dist/el-d90-win32-x64/el-d90.exe'),args:['--demo'],env:launchEnvironment});
 try{
  const result=await app.evaluate(async({app},temporary)=>{
   const require=process.mainModule.require.bind(process.mainModule);const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');const {spawnWindowsTerminal}=require(path.join(app.getAppPath(),'src/windows-pty.cjs'));
   const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
   const wait=async(check,getOutput)=>{const deadline=Date.now()+20000;while(!check()){if(Date.now()>deadline)throw Error('Native terminal timeout: '+getOutput());await new Promise(r=>setTimeout(r,50));}};
   async function exercise(command,args,prompt,commands){const child=spawnWindowsTerminal(command,args),pid=child.pid;let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);child.stdin.on('error',()=>{});const clean=()=>output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');let ended=false,code;const closed=new Promise(resolve=>child.once('close',value=>{ended=true;code=value;resolve();}));try{
    await wait(()=>clean().includes(prompt),()=>output);child.resize(120,35);await new Promise(r=>setTimeout(r,300));
    for(const [command,marker]of commands){const offset=output.length;child.stdin.write(command+'\r');await wait(()=>clean().includes(marker)&&output.length>offset,()=>output);await new Promise(r=>setTimeout(r,300));}
    child.stdin.write('exit\r');await wait(()=>ended,()=>output);await closed;assert.equal(code,0);return pid;
   }finally{if(!ended){child.kill();await wait(()=>ended,()=>output);}}}
   await exercise(path.join(process.env.SystemRoot,'System32/cmd.exe'),['/Q'],'>',[['echo CMD_FIRST','CMD_FIRST'],['echo CMD_SECOND','CMD_SECOND']]);
   await exercise(powershell,['-NoLogo','-NoProfile','-NoExit','-Command',"[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Write-Host 'CONPTY_READY'"],'CONPTY_READY',[["Write-Host ('RESIZED_' + $Host.UI.RawUI.WindowSize.Width)",'RESIZED_120'],["Write-Host ('INPUT_' + (20 + 22))",'INPUT_42'],["Write-Host ('UNICODE_' + [char]0x2713)",'UNICODE_✓']]);
   assert.ok(require(path.join(app.getAppPath(),'src/platform.cjs')).findExecutable('kubectl'),'kubectl.exe discovery');
   const config=path.join(temporary,'config.json');fs.writeFileSync(config,JSON.stringify({apiVersion:'v1',kind:'Config',contexts:[{name:'windows-fixture',context:{cluster:'offline',namespace:'team'}}],clusters:[{name:'offline',cluster:{server:'https://127.0.0.1:9'}}],users:[]}));process.env.KUBECONFIG=config;
   const prepared=await require(path.join(app.getAppPath(),'src/cluster-terminal.cjs')).prepare({context:'windows-fixture'},{base:path.join(temporary,'sessions')});try{assert.equal(prepared.namespace,'team');assert.equal(JSON.parse(fs.readFileSync(prepared.overlay)).contexts[0].context.namespace,'team');await exercise(prepared.command,prepared.args,'Namespace: team',[["Write-Host ('CONTEXT_' + $env:KUBECONFIG)",prepared.overlay]]);}finally{await prepared.cleanup();}assert.ok(!fs.existsSync(prepared.directory));
   return 'CMD + PowerShell repeated input, resize, Unicode, exit, kubectl discovery, real context overlay and cleanup';
  },temporary);console.log('PASS Windows native: '+result);
  const p=await app.firstWindow();p.setDefaultTimeout(30000);const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.waitForFunction(()=>typeof state!=='undefined'&&state.initialized&&!state.loading);await p.evaluate(async()=>{await navigate('pods');await openDetail(state.items[0],'pods');await tab('yaml');});await p.locator('[data-rich=toggle]').click();await p.locator('.rich-editor-host .monaco-editor').waitFor();await p.evaluate(()=>window.monaco.editor.getModels().at(-1).setValue('apiVersion: v1\nkind: Pod\n'));assert.match(await p.locator('#yaml-editor').inputValue(),/kind: Pod/);await p.locator('#close-drawer').click();assert.deepEqual(errors,[]);console.log('PASS Windows packaged editor/UI');
 }finally{await app.close();fs.rmSync(temporary,{recursive:true,force:true});}
 clearTimeout(watchdog);
})().catch(error=>{console.error(error);process.exit(1);});
