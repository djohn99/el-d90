const {test}=require('node:test');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const path=require('node:path');
test('native PTY resizes through its control pipe without injecting terminal input',{skip:process.platform!=='darwin'},async()=>{
 const child=spawn(path.join(__dirname,'../assets/el-d90-pty'),['/bin/sh','-c','stty size; read command; stty size'],{stdio:['pipe','pipe','pipe','pipe']});let output='',stderr='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>stderr+=b);
 const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 const timer=setTimeout(()=>child.kill('SIGTERM'),5000);
 try{const end=Date.now()+3000;while(!/28\s+100/.test(output)&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.match(output,/28\s+100/);child.stdio[3].write('120 40\n');await new Promise(r=>setTimeout(r,30));child.stdin.write('continue\n');const code=await exit;assert.equal(code,0,stderr);assert.match(output,/40\s+120/);}finally{clearTimeout(timer);child.kill('SIGTERM');}
});
