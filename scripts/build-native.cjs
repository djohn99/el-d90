const{execFileSync}=require('node:child_process'),path=require('node:path');const root=path.resolve(__dirname,'..');
execFileSync(process.execPath,[path.join(__dirname,'prepare-editor.cjs')],{stdio:'inherit'});
if(process.platform==='darwin')execFileSync('clang',['-arch','arm64','-mmacosx-version-min=13.0','-O2','-Wall','-Wextra','src/pty.c','-o','assets/el-d90-pty'],{cwd:root,stdio:'inherit'});
else if(process.platform==='win32'){require('node-pty');console.log('Windows ConPTY native dependency is available');}
else throw Error('Supported build platforms: macOS arm64 and Windows x64');
