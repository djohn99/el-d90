const{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const kube=require('./kube.cjs'),clusterTerminal=require('./cluster-terminal.cjs'),deploymentLogs=require('./deployment-logs.cjs');
const MAX_BUFFER=1024*1024;
class Sessions{
 constructor(options={}){this.options=options;this.entries=new Map();}
 _reserve(input,type,transport){const context=kube.string(input.context,'context');if(this.entries.size>=64||[...this.entries.values()].filter(e=>e.context===context).length>=16)throw Error('Close a session first (16 per cluster, 64 total)');const entry={id:randomUUID(),context,namespace:input.namespace||'',type,transport,resource:input.resource||'',name:input.name||'',state:'starting',buffer:'',seq:0,createdAt:new Date().toISOString(),closed:false};this.entries.set(entry.id,entry);return entry;}
 _public(e){return{id:e.id,context:e.context,namespace:e.namespace,type:e.type,transport:e.transport,resource:e.resource,name:e.name,state:e.state,createdAt:e.createdAt,shell:e.shell||null,cwd:e.cwd||null};}
 _send(e,data='',ended=false){if(this.entries.get(e.id)!==e)return;e.buffer=(e.buffer+String(data)).slice(-MAX_BUFFER);const message={...this._public(e),data:String(data),seq:++e.seq,ended};try{this.options.onData?.(message);}catch{}}
 _finish(e,message,state='ended'){if(e.closed)return e.finished;e.closed=true;e.state=state;this._send(e,message,true);e.finished=Promise.resolve().then(()=>e.cleanup?.()).catch(error=>{e.state='error';this._send(e,'\r\nSession cleanup failed: '+error.message+'\r\n',true);});return e.finished;}
 _spawn(e,command,args,options={}){
  if(e.closed)throw Error('Session was cancelled');
  const child=(this.options.spawn||spawn)(this.options.helper,[command,...args],{shell:false,detached:true,cwd:options.cwd,env:{...(options.env||kube.environment()),TERM:'xterm-256color',COLUMNS:'100',LINES:'28'},stdio:['pipe','pipe','pipe','pipe']});e.child=child;e.state='running';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');for(const output of [child.stdout,child.stderr])output.on('data',data=>{if(!e.closed)this._send(e,data);});
  child.on('error',error=>this._finish(e,'\r\n'+error.message+'\r\n','error'));
  child.on('close',code=>this._finish(e,`\r\n[Session ended${code?', exit '+code:''}]\r\n`,code?'error':'ended'));
  child.stdin.on('error',()=>{});child.stdio[3].on('error',()=>{});this._send(e);return{id:e.id};
 }
 async terminal(input){
  const transport=input.resource==='pods'?'pod':'local';if(input.resource&&input.resource!=='pods')throw Error('Use a Pod or a general cluster terminal');
  if(transport==='pod'){const args=kube.terminalArgs(input),e=this._reserve(input,'terminal','pod');try{return this._spawn(e,kube.executable(),args);}catch(error){this.entries.delete(e.id);throw error;}}
  const e=this._reserve(input,'terminal','local');try{e.preparing=(this.options.prepare||clusterTerminal.prepare)(input,{base:this.options.directory});const prepared=await e.preparing;e.cleanup=prepared.cleanup;if(e.closed||this.entries.get(e.id)!==e){await prepared.cleanup();throw Error('Session was cancelled');}e.namespace=prepared.namespace;e.shell=prepared.command;e.cwd=prepared.cwd;return this._spawn(e,prepared.command,prepared.args,prepared);}catch(error){await e.cleanup?.();this.entries.delete(e.id);throw error;}
 }
 logs(input){if(!['pods','deployments'].includes(input.resource))throw Error('Choose Pod or Deployment logs');kube.string(input.context,'context');kube.name(input.namespace,'namespace');if(input.namespace==='*')throw Error('Choose one log namespace');kube.name(input.name);const e=this._reserve(input,'logs',input.resource==='deployments'?'deployment':'pod');try{
  if(input.resource==='deployments'){e.controller=(this.options.deploymentLogs||deploymentLogs).start({...input,follow:true},{onData:data=>{if(!e.closed)this._send(e,data);},onEnd:error=>this._finish(e,'\n[Log session ended'+(error?': '+error.message:'')+']\n',error?'error':'ended')});e.state='running';this._send(e);return{id:e.id};}
  const args=kube.logArgs({...input,follow:true}),child=(this.options.spawn||spawn)(kube.executable(),args,{shell:false,detached:true,env:kube.environment(),stdio:['ignore','pipe','pipe']});e.child=child;e.state='running';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');for(const out of [child.stdout,child.stderr])out.on('data',data=>{if(!e.closed)this._send(e,data);});child.on('error',error=>this._finish(e,error.message,'error'));child.on('close',code=>this._finish(e,'\n[Log session ended'+(code?', exit '+code:'')+']\n',code?'error':'ended'));this._send(e);return{id:e.id};
 }catch(error){this.entries.delete(e.id);throw error;}}
 list(context){if(context)kube.string(context,'context');return[...this.entries.values()].filter(e=>!context||e.context===context).map(e=>this._public(e));}
 snapshot(id){const e=this.entries.get(id);if(!e)throw Error('Session is closed');return{...this._public(e),buffer:e.buffer,seq:e.seq};}
 write(input){const e=this.entries.get(input.id);if(!e||e.closed||e.type!=='terminal'||!e.child)return false;if(typeof input.data!=='string'||Buffer.byteLength(input.data)>65536)throw Error('Terminal input exceeds 64 KB');return e.child.stdin.write(input.data);}
 resize(input){const e=this.entries.get(input.id);if(!e||e.closed||e.type!=='terminal'||!e.child)return false;if(!Number.isInteger(input.cols)||input.cols<20||input.cols>400||!Number.isInteger(input.rows)||input.rows<5||input.rows>200)throw Error('Invalid terminal dimensions');return e.child.stdio[3].write(`${input.cols} ${input.rows}\n`);}
 async close(id){const e=this.entries.get(id);if(!e)return;if(e.preparing&&!e.child&&!e.closed){e.closed=true;e.state='ended';try{const prepared=await e.preparing;await prepared.cleanup();}catch{}this.entries.delete(id);return;}if(e.controller){e.controller.stop();await this._finish(e,'\n[Session closed]\n');}else if(e.child&&!e.closed){await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};e.child.once('close',finish);const timer=setTimeout(()=>{try{process.kill(-e.child.pid,'SIGKILL');}catch{}finish();},1500);try{process.kill(-e.child.pid,'SIGTERM');}catch{e.child.kill();}});await this._finish(e,'\r\n[Session closed]\r\n');}else await this._finish(e,'\n[Session closed]\n');await e.finished;this.entries.delete(id);}
 async closeContext(context){await Promise.all([...this.entries.values()].filter(e=>e.context===context).map(e=>this.close(e.id)));}
 async closeAll(){await Promise.all([...this.entries.keys()].map(id=>this.close(id)));}
}
module.exports={Sessions,MAX_BUFFER};
