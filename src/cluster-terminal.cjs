// Per-terminal context overlays reference existing kubeconfig files; credentials are never copied.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const kube=require('./kube.cjs');
const quote=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
async function prepare(input,options={}){
 const context=kube.string(input.context,'context'),env={...(options.env||kube.environment())};
 const shell=input.shell||(['zsh','bash','sh'].includes(path.basename(env.SHELL||''))?env.SHELL:'/bin/zsh');
 if(!['/bin/zsh','/bin/bash','/bin/sh'].includes(shell))throw Error('Choose /bin/zsh, /bin/bash or /bin/sh');
 const cwd=input.cwd||os.homedir();if(typeof cwd!=='string'||!path.isAbsolute(cwd)||/[\x00-\x1f]/.test(cwd))throw Error('Working directory must be an absolute local directory');if(!(await fs.stat(cwd)).isDirectory())throw Error('Working directory is not a directory');
 const config=JSON.parse(await (options.run||kube.run)(['config','view','-o','json']));
 const selected=config.contexts?.find(c=>c.name===context)?.context;if(!selected?.cluster)throw Error('Selected context is not available in kubeconfig');
 const namespace=input.namespace&&input.namespace!=='*'?kube.name(input.namespace,'namespace'):selected.namespace||'default';
 const base=options.base||path.join(os.tmpdir(),'el-d90-terminals');await fs.mkdir(base,{recursive:true,mode:0o700});
 const directory=await fs.mkdtemp(path.join(base,'session-'));await fs.chmod(directory,0o700);
 const cleanup=()=>fs.rm(directory,{recursive:true,force:true});
 try{
  const overlay=path.join(directory,'context.json');
  const metadata={cluster:selected.cluster,...(typeof selected.user==='string'?{user:selected.user}:{}),namespace};
  await fs.writeFile(overlay,JSON.stringify({apiVersion:'v1',kind:'Config',preferences:{},'current-context':context,contexts:[{name:context,context:metadata}],clusters:[],users:[]}),{mode:0o600});
  const sources=(env.KUBECONFIG?env.KUBECONFIG.split(path.delimiter):[path.join(os.homedir(),'.kube/config')]).filter(Boolean).map(file=>path.resolve(file));
  env.KUBECONFIG=[overlay,...new Set(sources)].join(path.delimiter);env.EL_D90_CONTEXT=context;env.EL_D90_NAMESPACE=namespace;
  delete env.HELM_KUBECONTEXT;delete env.HELM_NAMESPACE;
  const bin=path.join(directory,'bin');await fs.mkdir(bin,{mode:0o700});await fs.symlink(options.kubectl||kube.executable(),path.join(bin,'kubectl'));
  try{await fs.symlink(options.helm||kube.findHelm(),path.join(bin,'helm'));}catch{}
  env.PATH=bin+path.delimiter+env.PATH;
  const setup=`\nexport KUBECONFIG=${quote(env.KUBECONFIG)}\nexport EL_D90_CONTEXT=${quote(context)}\nexport EL_D90_NAMESPACE=${quote(namespace)}\nexport PATH=${quote(env.PATH)}\nunset HELM_KUBECONTEXT HELM_NAMESPACE HISTFILE\nprintf '%s\\n' ${quote('el-d90 local shell · initial context: '+context)} ${quote('Namespace: '+namespace+' · working directory: '+cwd)}\n`;
  let args;
  if(shell==='/bin/zsh'){
   const original=path.resolve(env.ZDOTDIR||os.homedir());
   await fs.writeFile(path.join(directory,'.zshenv'),`if [ -r ${quote(path.join(original,'.zshenv'))} ]; then . ${quote(path.join(original,'.zshenv'))}; fi\nexport ZDOTDIR=${quote(directory)}\n`,{mode:0o600});
   await fs.writeFile(path.join(directory,'.zshrc'),`export ZDOTDIR=${quote(original)}\nif [ -r ${quote(path.join(original,'.zshrc'))} ]; then . ${quote(path.join(original,'.zshrc'))}; fi\n${setup}\n`,{mode:0o600});env.ZDOTDIR=directory;args=['-i'];
  }else if(shell==='/bin/bash'){
   const rc=path.join(directory,'bashrc');await fs.writeFile(rc,`if [ -r ${quote(path.join(os.homedir(),'.bashrc'))} ]; then . ${quote(path.join(os.homedir(),'.bashrc'))}; fi\n${setup}`,{mode:0o600});args=['--rcfile',rc,'-i'];
  }else{
   const rc=path.join(directory,'shrc'),original=env.ENV;await fs.writeFile(rc,(original&&path.isAbsolute(original)?`if [ -r ${quote(original)} ]; then . ${quote(original)}; fi\n`:'')+setup,{mode:0o600});env.ENV=rc;args=['-i'];
  }
  return{command:shell,args,env,cwd,context,namespace,directory,overlay,cleanup};
 }catch(error){await cleanup();throw error;}
}
module.exports={prepare,quote};
