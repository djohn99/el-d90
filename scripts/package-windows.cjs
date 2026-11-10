const path=require('node:path');
(async()=>{
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('Windows packaging requires a native Windows x64 runner');
 require('node:child_process').execFileSync(process.execPath,[path.join(__dirname,'build-native.cjs')],{stdio:'inherit'});
 const {packager}=await import('@electron/packager');
 await packager({dir:path.resolve(__dirname,'..'),name:'el-d90',icon:path.join(__dirname,'../assets/el-d90.ico'),platform:'win32',arch:'x64',out:'dist',overwrite:true,asar:{unpackDir:'{assets,node_modules/node-pty}'},appCopyright:'Copyright © 2026 David John',ignore:[/^\/research/,/^\/test/,/^\/dist/,/^\/scripts/,/^\/\.github/],win32metadata:{CompanyName:'David John',FileDescription:'el-d90 Kubernetes workspace',ProductName:'el-d90'}});
})().catch(error=>{console.error(error);process.exitCode=1;});
