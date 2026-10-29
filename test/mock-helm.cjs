#!/usr/bin/env node
const args = process.argv.slice(2);
const fs = require('node:fs');
if (process.env.EL_D90_TEST_RECORD) fs.appendFileSync(process.env.EL_D90_TEST_RECORD, JSON.stringify({ args: ['helm', ...args], pid: process.pid }) + '\n');
if (args.includes('--help') && ['install','upgrade'].includes(args[0])) console.log('--dry-run string server --hide-secret');
else if (args.includes('--help')) console.log(process.env.EL_D90_TEST_HELM3 ? '  -a, --all    show all releases' : 'By default, it lists all releases in any status.\n  -A, --all-namespaces list all namespaces');
else if (args[0] === 'list') {
  if (!process.env.EL_D90_TEST_HELM3 && args.includes('--all')) { console.error('unknown flag: --all'); process.exit(1); }
  if (process.env.EL_D90_TEST_HELM3 && !args.includes('--all')) { console.error('Missing Helm 3 all-status selection'); process.exit(1); }
  console.log(JSON.stringify([{name:'fixture-release',namespace:'team',revision:'2',updated:new Date().toISOString(),status:'deployed',chart:'fixture-1.2.0',app_version:'1.2'}]));
} else if (args[0] === 'get' && args[1] === 'manifest') console.log('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: fixture-release');
else if(args[0]==='search') console.log(JSON.stringify([{name:'fixture/web',version:'1.2.0',description:'fixture chart'}]));
else if(args[0]==='show' && args[1]==='chart')console.log('version: 1.2.0');
else if(args[0]==='show' && args[1]==='values')console.log('replicaCount: 1');
else if(args[0]==='get' && args[1]==='values')console.log('replicaCount: 2');
else if(args[0]==='repo' && args[1]==='list')console.log(JSON.stringify([{name:'fixture',url:'https://charts.example.test'}]));
else if(args[0]==='history')console.log(JSON.stringify([{revision:2,status:'deployed',chart:'fixture-1.2.0',description:'fixture'}]));
else if(['install','upgrade','rollback','uninstall'].includes(args[0]))console.log(args.some(a=>a.startsWith('--dry-run'))?'FIXTURE_PREVIEW':'FIXTURE_HELM_APPLIED');
else if(args[0]==='repo')console.log('fixture repository updated');
else { console.error('Unsupported Helm fixture command'); process.exit(1); }
