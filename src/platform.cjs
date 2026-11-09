// Platform boundaries shared by tool discovery and terminal transports.
const path=require('node:path'),fs=require('node:fs');
function findExecutable(name,env=process.env,platform=process.platform){
 const search=env.PATH||env.Path||'';const dirs=search.split(platform==='win32'?';':':');
 const names=platform==='win32'&&!path.extname(name)?[name+'.exe',name]:[name];
 for(const dir of dirs.filter(Boolean))for(const file of names){const candidate=path.join(dir,file);try{if(fs.statSync(candidate).isFile()){fs.accessSync(candidate,fs.constants.X_OK);return candidate;}}catch{}}
 return null;
}
const ptyName=()=>process.platform==='win32'?'el-d90-pty.exe':'el-d90-pty';
module.exports={findExecutable,ptyName};
