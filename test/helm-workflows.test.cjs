const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const helm = require('../src/helm.cjs');
let directory, record, previous;
before(() => {
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'eld90-helm-test-'));
  record=path.join(directory,'calls.jsonl');previous=process.env.EL_D90_HELM;
  const binary=path.join(directory,'helm');
  fs.writeFileSync(binary,`#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);const i=args.indexOf('--values');let file=null;if(i>=0){const p=args[i+1];file={path:p,content:fs.readFileSync(p,'utf8'),mode:fs.statSync(p).mode&511,directoryMode:fs.statSync(require('node:path').dirname(p)).mode&511};}fs.appendFileSync(${JSON.stringify(record)},JSON.stringify({args,file})+'\\n');
if(args.includes('--help')){console.log(process.env.EL_D90_HELM_TEST_LEGACY?'  --dry-run simulate install':'  --dry-run string server or client\\n  --hide-secret hide Secrets');}
else if(args[0]==='repo'&&args[1]==='list')console.log(JSON.stringify([{name:'fixture',url:'https://example.test/charts'}]));
else if(args[0]==='search')console.log(JSON.stringify([{name:'fixture/web',version:'1.2.3',description:'fixture'}]));
else if(args[0]==='show'&&args[1]==='chart')console.log('apiVersion: v2\\nversion: 1.2.3');
else if(args[0]==='show'||args[0]==='get')console.log('replicaCount: 2');
else if(args[0]==='history')console.log(JSON.stringify([{revision:1,status:'deployed',chart:'web-1.2.3'}]));
else if(file?.content.includes('fixture-fail')){console.error('Synthetic Helm error');process.exit(1);}
else console.log(args.some(a=>a.startsWith('--dry-run'))?'PREVIEW: no mutation':'Helm operation complete');
`,{mode:0o755});
  process.env.EL_D90_HELM=binary;
});
after(()=>{if(previous===undefined)delete process.env.EL_D90_HELM;else process.env.EL_D90_HELM=previous;fs.rmSync(directory,{recursive:true,force:true});});
const calls=()=>fs.existsSync(record)?fs.readFileSync(record,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
const input=()=>({operation:'install',context:'fixture cluster',namespace:'team',name:'web',chart:'fixture/web',version:'1.2.3',values:'replicaCount: 2\npassword: synthetic-only\n',createNamespace:true,wait:true});
test('install/upgrade arguments fix one context, namespace and chart with values off argv',()=>{
  const args=helm.operationArgs(input(),{dryRun:'server',valuesPath:'/private/tmp/synthetic-values.yaml',hideSecret:true});
  assert.deepEqual(args.slice(0,3),['install','web','fixture/web']);assert.equal(args[args.indexOf('--kube-context')+1],'fixture cluster');assert.equal(args[args.indexOf('--namespace')+1],'team');assert.ok(args.includes('--dry-run=server'));assert.ok(args.includes('--hide-secret'));assert.ok(args.includes('--create-namespace'));assert.equal(args.includes('--wait'),false);assert.equal(args.join(' ').includes('synthetic-only'),false);
  const upgrade=helm.operationArgs({...input(),operation:'upgrade'});assert.equal(upgrade.includes('--create-namespace'),false);assert.ok(upgrade.includes('--wait'));
});
test('invalid target, flag-shaped chart, namespace set and unsupported operation fail before spawn',()=>{
  for(const patch of [{namespace:'*'},{namespace:'team,other'},{name:'--help'},{chart:'--set=anything'},{chart:'https://charts.test/chart.tgz'},{operation:'delete'},{version:'--bad'},{context:'--bad'},{values:'x'.repeat(2*1024*1024+1)}])assert.throws(()=>helm.validateOperation({...input(),...patch}));
  assert.equal(helm.chartRef('oci://registry.example.test/team/web'),'oci://registry.example.test/team/web');
});
test('preview uses protected temporary values files and removes them after success',async()=>{
  const result=await helm.preview(input());assert.equal(result.mode,'server dry run');assert.match(result.output,/PREVIEW/);assert.ok(result.previewToken);
  const request=calls().filter(c=>c.file).at(-1);assert.equal(request.file.mode,0o600);assert.equal(request.file.directoryMode,0o700);assert.equal(request.file.content,input().values);assert.equal(fs.existsSync(request.file.path),false);assert.ok(request.args.includes('--hide-secret'));
});
test('apply requires an unexpired matching preview and consumes it once',async()=>{
  await assert.rejects(helm.perform(input()),/Preview/);
  const preview=await helm.preview(input());
  await assert.rejects(helm.perform({...input(),namespace:'other',previewToken:preview.previewToken}),/Preview/);
  const result=await helm.perform({...input(),previewToken:preview.previewToken});assert.match(result.output,/operation complete/);
  const request=calls().filter(c=>c.file).at(-1);assert.equal(request.args.some(a=>a.startsWith('--dry-run')),false);assert.equal(fs.existsSync(request.file.path),false);
  await assert.rejects(helm.perform({...input(),previewToken:preview.previewToken}),/Preview/);
});
test('legacy Helm boolean dry-run is explicit and temporary values clean on failure',async()=>{
  process.env.EL_D90_HELM_TEST_LEGACY='1';
  try {const result=await helm.preview({...input(),operation:'upgrade'});assert.equal(result.mode,'client dry run');assert.ok(calls().filter(c=>c.file).at(-1).args.includes('--dry-run'));}
  finally{delete process.env.EL_D90_HELM_TEST_LEGACY;}
  await assert.rejects(helm.preview({...input(),values:'fixture-fail: true\n'}),/Synthetic Helm error/);assert.equal(fs.existsSync(calls().filter(c=>c.file).at(-1).file.path),false);
});
test('repository/chart/version and release reads are structured commands',async()=>{
  assert.equal((await helm.repos())[0].name,'fixture');assert.equal((await helm.search({query:'web'}))[0].name,'fixture/web');assert.equal((await helm.versions({chart:'fixture/web'}))[0].version,'1.2.3');assert.match(await helm.values({chart:'fixture/web',version:'1.2.3'}),/replicaCount/);assert.match(await helm.releaseValues(input()),/replicaCount/);assert.equal((await helm.history(input()))[0].revision,1);
});
test('rollback and uninstall keep their explicit target; repository URLs reject embedded credentials',async()=>{
  assert.throws(()=>helm.validateRevision({...input(),revision:0}));assert.throws(()=>helm.validateRepo({name:'fixture',url:'https://user:secret@example.test/charts'}));assert.throws(()=>helm.validateRepo({name:'fixture',url:'http://example.test/charts'}));
  await helm.rollback({...input(),revision:1});let args=calls().at(-1).args;assert.deepEqual(args.slice(0,3),['rollback','web','1']);assert.equal(args[args.indexOf('--namespace')+1],'team');
  await helm.uninstall(input());args=calls().at(-1).args;assert.deepEqual(args.slice(0,2),['uninstall','web']);assert.equal(args[args.indexOf('--kube-context')+1],'fixture cluster');
});

test('blank chart versions resolve during preview and must remain pinned during apply',async()=>{
 const original={...input(),version:''}; const result=await helm.preview(original);assert.equal(result.resolvedVersion,'1.2.3');
 await assert.rejects(helm.perform({...original,previewToken:result.previewToken}),/Preview/);
 assert.match((await helm.perform({...original,version:result.resolvedVersion,previewToken:result.previewToken})).output,/complete/);
});
