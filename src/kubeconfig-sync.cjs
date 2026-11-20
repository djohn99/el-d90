const fs=require('node:fs/promises');
async function fingerprint(paths){return JSON.stringify(await Promise.all(paths.map(async file=>{try{const stat=await fs.stat(file);return[file,stat.mtimeMs,stat.size,stat.ino];}catch{return[file,null];}})));}
// App-owned updates apply once and acknowledge the same snapshot the watcher observes.
class KubeconfigSync{
 constructor({snapshot=fingerprint}={}){this.snapshot=snapshot;this.signature=null;this.revision=0;this.mutations=0;this.polling=false;}
 async register(paths,apply){++this.revision;++this.mutations;try{const signature=await this.snapshot(paths);apply();this.signature=signature;}finally{--this.mutations;++this.revision;}}
 async poll(resolvePaths,onChange){
  if(this.polling||this.mutations)return false;this.polling=true;const revision=this.revision;
  try{const paths=await resolvePaths(),signature=await this.snapshot(paths);if(revision!==this.revision||this.mutations)return false;
   const changed=this.signature!==null&&signature!==this.signature;this.signature=signature;if(changed)onChange(paths);return changed;
  }finally{this.polling=false;}
 }
}
module.exports={KubeconfigSync,fingerprint};
