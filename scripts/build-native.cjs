const{execFileSync}=require('node:child_process'),path=require('node:path');const root=path.resolve(__dirname,'..');
execFileSync(process.execPath,[path.join(__dirname,'prepare-editor.cjs')],{stdio:'inherit'});
if(process.platform==='darwin')execFileSync('clang',['-arch','arm64','-mmacosx-version-min=13.0','-O2','-Wall','-Wextra','src/pty.c','-o','assets/el-d90-pty'],{cwd:root,stdio:'inherit'});
else if(process.platform==='win32'){
 const installer=path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Microsoft Visual Studio','Installer','vswhere.exe');
 const vs=execFileSync(installer,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8'}).trim();if(!vs)throw Error('Visual Studio C++ build tools are required');
 const vcvars=path.join(vs,'VC','Auxiliary','Build','vcvars64.bat');
 execFileSync('cmd.exe',['/d','/s','/c',`call "${vcvars}" >nul && cl /nologo /O2 /W4 /DUNICODE /D_UNICODE src\\pty-windows.c /Fe:assets\\el-d90-pty.exe /Fo:assets\\el-d90-pty.obj`],{cwd:root,stdio:'inherit'});
}else throw Error('Supported build platforms: macOS arm64 and Windows x64');
