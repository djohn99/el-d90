// Original el-d90 Kubernetes watch manager. Renderer callbacks never contain objects.
const {spawn:nodeSpawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {StringDecoder}=require('node:string_decoder');
const kube=require('./kube.cjs');

class JsonEventParser {
  constructor(onValue,{maxBytes=4*1024*1024}={}){this.onValue=onValue;this.maxBytes=maxBytes;this.decoder=new StringDecoder('utf8');this.buffer='';this.depth=0;this.quoted=false;this.escaped=false;this.bytes=0;}
  feed(chunk){const text=typeof chunk==='string'?chunk:this.decoder.write(chunk);for(const char of text){if(!this.depth){if(/\s/.test(char))continue;if(char!=='{')throw new Error('Watch output was not a JSON event stream');this.buffer='{';this.depth=1;this.bytes=1;continue;}this.buffer+=char;this.bytes+=Buffer.byteLength(char);if(this.bytes>this.maxBytes)throw new Error('Watch event exceeded the 4 MB delivery limit');if(this.quoted){if(this.escaped)this.escaped=false;else if(char==='\\')this.escaped=true;else if(char==='"')this.quoted=false;}else if(char==='"')this.quoted=true;else if(char==='{'||char==='[')this.depth++;else if(char==='}'||char===']'){this.depth--;if(!this.depth){let value;try{value=JSON.parse(this.buffer);}catch{throw new Error('Watch output contained invalid JSON');}this.buffer='';this.bytes=0;this.onValue(value);}}}}
  end(){const rest=this.decoder.end();if(rest)this.feed(rest);if(this.depth||this.buffer.trim())throw new Error('Watch output ended in an incomplete JSON event');}
}
function defaultKill(child,signal='SIGTERM'){try{if(Number.isInteger(child.pid)&&child.pid>0)process.kill(-child.pid,signal);else child.kill(signal);}catch{try{child.kill(signal);}catch{}}}
function authError(error){return /Forbidden|Unauthorized|permission denied|must be logged in|provide credentials|invalid.*credential|unable to locate credentials/i.test(String(error));}
function expired(error){return /too old resource version|resource.?version.*expired|\b410\b|reason.?[:= ]+.?Expired|reason.?[:= ]+.?Gone/i.test(String(error));}
function version(value){return typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\x00-\x20]/.test(value)?value:null;}
class Watches {
  constructor(options={}){this.options=options;this.groups=new Map();this.spawn=options.spawn||nodeSpawn;this.kill=options.kill||defaultKill;this.baseDelay=Math.max(10,options.baseDelay??500);this.maxDelay=Math.max(this.baseDelay,options.maxDelay??30000);}
  start(input){
    if(this.groups.size>=32)throw new Error('At most 32 live watch subscriptions can be open');
    const context=kube.string(input.context,'context'),resource=kube.resource(input.resource,context),selected=kube.selectedNamespaces(input);
    const allFlags=kube.scope({context,namespace:'*'},resource),namespaced=allFlags.includes('--all-namespaces');
    const namespaces=namespaced?(selected.length?selected:['*']):[null];
    if(this._lanes()+namespaces.length>128)throw new Error('At most 128 namespace watch streams can be open');
    const id=randomUUID(),group={id,context,resource,namespaces:namespaces.filter(Boolean),stopped:false,lanes:namespaces.map(namespace=>({namespace,rv:'',state:'starting',error:null,attempts:0,epoch:0,child:null,readChild:null,timer:null,lastEventAt:null}))};
    this.groups.set(id,group);this._status(group);
    queueMicrotask(()=>{for(const lane of group.lanes)this._connect(group,lane,true);});
    return {id};
  }
  _lanes(){return [...this.groups.values()].reduce((n,g)=>n+g.lanes.length,0);}
  _active(group,lane,epoch){return !group.stopped&&this.groups.get(group.id)===group&&lane.epoch===epoch;}
  _flags(group,lane){return kube.scope({context:group.context,namespace:lane.namespace||'*'},group.resource).filter(arg=>!arg.startsWith('--request-timeout='));}
  _status(group){if(group.stopped)return;const lanes=group.lanes;let state='connecting';if(lanes.some(l=>l.state==='paused'))state=lanes.every(l=>l.state==='paused')?'paused':'partial';else if(lanes.every(l=>l.state==='watching'))state='watching';else if(lanes.some(l=>l.state==='retrying'))state=lanes.some(l=>l.state==='watching')?'partial':'reconnecting';try{this.options.onStatus?.({id:group.id,context:group.context,resource:group.resource,state,error:lanes.filter(l=>l.error).map(l=>`${l.namespace||'cluster'}: ${l.error}`).join('\n')||null});}catch{}}
  _event(group,lane,type){try{this.options.onEvent?.({id:group.id,context:group.context,resource:group.resource,namespace:lane.namespace,type,resourceVersion:lane.rv||null});}catch{}}
  _terminate(child){if(!child)return;let closed=child.exitCode!==null&&child.exitCode!==undefined||!!child.signalCode;child.once?.('close',()=>{closed=true;});if(closed)return;this.kill(child,'SIGTERM');const timer=setTimeout(()=>{if(!closed)this.kill(child,'SIGKILL');},500);timer.unref?.();}
  _read(group,lane,args,epoch){
    if(!this._active(group,lane,epoch))return Promise.reject(new Error('Watch stopped'));
    if(this.options.run)return this.options.run(args);
    return new Promise((resolve,reject)=>{
      let child;try{child=this.spawn(this.options.executable||kube.executable(),args,{env:kube.environment(),detached:true,shell:false,stdio:['ignore','pipe','pipe']});}catch(error){reject(error);return;}
      lane.readChild=child;let output='',stderr='',failure=null,done=false;
      const timeout=setTimeout(()=>{failure=new Error('Watch initial list timed out');this.kill(child,'SIGKILL');},25000);
      const finish=(code,error)=>{if(done)return;done=true;clearTimeout(timeout);if(lane.readChild===child)lane.readChild=null;if(error)reject(error);else if(failure)reject(failure);else if(code)reject(new Error(stderr.trim()||`kubectl initial list exited with ${code}`));else resolve(output);};
      child.stdout?.setEncoding?.('utf8');child.stderr?.setEncoding?.('utf8');
      child.stdout?.on('data',text=>{output+=text;if(Buffer.byteLength(output)>24*1024*1024){failure=new Error('Watch initial list exceeded 24 MB');this.kill(child,'SIGKILL');}});
      child.stderr?.on('data',text=>{stderr=(stderr+text).slice(-8000);});
      child.once('error',error=>finish(1,error));child.once('close',code=>finish(code));
      if(!this._active(group,lane,epoch))this.kill(child,'SIGKILL');
    });
  }
  _schedule(group,lane,{relist=false,error=null,pause=false}={}){
    if(group.stopped)return;const prior=lane.child;lane.child=null;lane.epoch++;this._terminate(prior);clearTimeout(lane.timer);lane.error=error?String(error).slice(0,1800):null;
    if(pause){lane.state='paused';this._status(group);return;}
    if(relist)lane.rv='';lane.state='retrying';const delay=Math.min(this.maxDelay,this.baseDelay*2**Math.min(lane.attempts++,8));this._status(group);
    lane.timer=setTimeout(()=>{lane.timer=null;this._connect(group,lane,relist||!lane.rv);},delay);lane.timer.unref?.();
  }
  async _connect(group,lane,relist){
    if(group.stopped)return;const epoch=++lane.epoch;lane.state='connecting';this._status(group);
    try{
      if(relist||!lane.rv){
        const text=await this._read(group,lane,['get',group.resource,...this._flags(group,lane),'--request-timeout=20s','-o','json'],epoch);
        if(!this._active(group,lane,epoch))return;let data;try{data=JSON.parse(text);}catch{throw new Error('Watch initial list was not valid JSON');}
        const rv=version(data.metadata?.resourceVersion);if(!rv)throw new Error('The API did not return a list resourceVersion; live watch is unavailable for this resource');
        lane.rv=rv;this._event(group,lane,'RESYNC');
      }
      if(!this._active(group,lane,epoch))return;
      const args=['get',group.resource,...this._flags(group,lane),'--watch-only=true','--output-watch-events=true','-o','json','--resource-version='+lane.rv,'--request-timeout=0'];
      const child=this.spawn(this.options.executable||kube.executable(),args,{env:kube.environment(),detached:true,shell:false,stdio:['ignore','pipe','pipe']});lane.child=child;let stderr='',closed=false,parserFailed=false;
      const active=()=>this._active(group,lane,epoch)&&lane.child===child;
      const parser=new JsonEventParser(event=>{
        if(!active())return;
        if(!event||typeof event!=='object'||typeof event.type!=='string')throw new Error('Watch output did not contain an event type');
        if(event.type==='ERROR'){
          const object=event.object||{},code=Number(object.code),message=String(object.message||object.reason||'Kubernetes watch error');
          this._schedule(group,lane,{relist:code===410||expired(message),pause:code===401||code===403||authError(message),error:code===410?'Resource version expired; relisting.':message});return;
        }
        if(!['ADDED','MODIFIED','DELETED','BOOKMARK'].includes(event.type))return;
        const rv=version(event.object?.metadata?.resourceVersion);if(rv)lane.rv=rv;lane.lastEventAt=new Date().toISOString();lane.attempts=0;lane.error=null;
        // The raw event/object goes out of scope here; only identity and version cross IPC.
        if(event.type!=='BOOKMARK')this._event(group,lane,event.type);
      });
      child.stdout?.on('data',chunk=>{if(!active())return;try{parser.feed(chunk);}catch(error){parserFailed=true;this._schedule(group,lane,{relist:true,error:error.message});}});
      child.stderr?.setEncoding?.('utf8');child.stderr?.on('data',text=>{stderr=(stderr+text).slice(-8000);});
      const finish=(code,error)=>{
        if(closed)return;closed=true;if(!active())return;lane.child=null;
        if(!parserFailed){try{parser.end();}catch(parseError){error=error||parseError;}}
        const message=error?.message || stderr.trim() || (code?`Watch exited with ${code}`:'Watch connection closed; reconnecting.');
        this._schedule(group,lane,{relist:expired(message)||!!error,pause:authError(message),error:message});
      };
      child.once('error',error=>finish(1,error));child.once('close',code=>finish(code));
      if(!active()){this._terminate(child);return;}lane.state='watching';lane.error=null;this._status(group);
    }catch(error){if(this._active(group,lane,epoch))this._schedule(group,lane,{relist:true,pause:authError(error.message)||/resourceVersion; live watch is unavailable/.test(error.message),error:error.message});}
  }
  stop(id){const group=this.groups.get(id);if(!group)return;group.stopped=true;for(const lane of group.lanes){lane.epoch++;clearTimeout(lane.timer);this._terminate(lane.child);if(lane.readChild)this.kill(lane.readChild,'SIGKILL');lane.child=null;lane.readChild=null;}this.groups.delete(id);try{this.options.onStatus?.({id,context:group.context,resource:group.resource,state:'stopped',error:null});}catch{}}
  closeContext(context){for(const [id,group]of this.groups)if(group.context===context)this.stop(id);}
  close(){for(const id of this.groups.keys())this.stop(id);}
  status(){return [...this.groups.values()].map(group=>({id:group.id,context:group.context,resource:group.resource,namespaces:[...group.namespaces],lanes:group.lanes.map(lane=>({namespace:lane.namespace,state:lane.state,resourceVersion:lane.rv||null,lastEventAt:lane.lastEventAt,error:lane.error}))}));}
}
module.exports={Watches,JsonEventParser};
