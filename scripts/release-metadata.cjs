const fs=require('node:fs');
function metadata({version,event,refType,refName,platform,arch}){
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version||''))throw Error('package.json must contain a release version');
 if(platform!=='darwin'||arch!=='arm64')throw Error('Release builds require a native Apple Silicon macOS runner');
 const tag='v'+version;
 if(event==='push'&&(refType!=='tag'||refName!==tag))throw Error('Version tag must exactly match package.json: '+tag);
 if(!['push','workflow_dispatch'].includes(event))throw Error('Unsupported release event');
 return{version,tag,artifact:'el-d90-'+version+'-mac-arm64',prerelease:String(version.includes('-'))};
}
if(require.main===module){
 const result=metadata({version:require('../package.json').version,event:process.env.GITHUB_EVENT_NAME,refType:process.env.GITHUB_REF_TYPE,refName:process.env.GITHUB_REF_NAME,platform:process.platform,arch:process.arch});
 if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(result).map(([k,v])=>k+'='+v+'\n').join(''));
 console.log(JSON.stringify(result));
}
module.exports={metadata};
