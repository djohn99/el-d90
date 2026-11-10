// Adapt Microsoft's maintained ConPTY implementation to the existing stream API.
const {EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream'),path=require('node:path');
function spawnWindowsTerminal(command,args,options={}){
 const location=process.versions.electron&&require('electron').app.isPackaged?path.join(process.resourcesPath,'app.asar.unpacked/node_modules/node-pty'): 'node-pty';
 const pty=require(location).spawn(command,args,{name:'xterm-256color',cols:100,rows:28,cwd:options.cwd||process.cwd(),env:options.env||process.env,useConpty:true,useConptyDll:true});
 const child=new EventEmitter();child.pid=pty.pid;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new Writable({write(data,encoding,done){try{pty.write(data.toString('utf8'));done();}catch(error){done(error);}}});child.stdio=[child.stdin,child.stdout,child.stderr];
 child.resize=(cols,rows)=>{pty.resize(cols,rows);return true;};child.kill=()=>{pty.kill();return true;};
 pty.onData(data=>child.stdout.write(data));pty.onExit(({exitCode,signal})=>{child.stdout.end();child.stderr.end();child.emit('exit',exitCode,signal);child.emit('close',exitCode,signal);});return child;
}
module.exports={spawnWindowsTerminal};
