// Rebuild Monaco from ESM sources with the patched sanitizer. Never copy its
// prebuilt browser chunks: those contain an independent embedded DOMPurify.
const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),destination=path.join(root,'assets/monaco');
async function prepare(){
 const version=JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('dompurify')),'../package.json'),'utf8')).version;
 if(version!=='3.4.17')throw Error('Unexpected DOMPurify version; review security baseline before rebuilding');
 fs.rmSync(destination,{recursive:true,force:true});fs.mkdirSync(destination,{recursive:true});
 const purifier=path.join(path.dirname(require.resolve('dompurify')),'purify.es.mjs');
 let replaced=0;const plugin={name:'fixed-editor-sanitizer',setup(build){build.onResolve({filter:/dompurify\/dompurify\.js$/},()=>{replaced++;return{path:purifier};});}};
 const shared={bundle:true,target:'chrome140',logLevel:'warning',minify:true,legalComments:'eof',loader:{'.ttf':'file'},plugins:[plugin]};
 const editor=await esbuild.build({...shared,entryPoints:[path.join(__dirname,'monaco-entry.mjs')],outdir:destination,entryNames:'editor',format:'esm',splitting:true,metafile:true});
 await esbuild.build({...shared,entryPoints:[path.join(root,'node_modules/monaco-editor/esm/vs/editor/editor.worker.js')],outfile:path.join(destination,'editor-worker.js'),format:'iife'});
 if(!replaced||!Object.keys(editor.metafile.inputs).some(file=>file.endsWith('dompurify/dist/purify.es.mjs'))||Object.keys(editor.metafile.inputs).some(file=>file.endsWith('/browser/dompurify/dompurify.js')))throw Error('Editor must bundle only the patched external sanitizer');
 fs.copyFileSync(path.join(root,'node_modules/monaco-editor/LICENSE'),path.join(destination,'LICENSE'));
 fs.copyFileSync(path.join(root,'node_modules/monaco-editor/ThirdPartyNotices.txt'),path.join(destination,'ThirdPartyNotices.txt'));
 fs.copyFileSync(path.join(path.dirname(require.resolve('dompurify')),'../LICENSE'),path.join(destination,'DOMPurify-LICENSE'));
 fs.writeFileSync(path.join(destination,'build.json'),JSON.stringify({monaco:JSON.parse(fs.readFileSync(path.join(root,'node_modules/monaco-editor/package.json'),'utf8')).version,dompurify:version,source:'esm',sanitizerSource:'dompurify/dist/purify.es.mjs',inputs:Object.keys(editor.metafile.inputs)},null,2));
 console.log('Rebuilt local Monaco runtime with DOMPurify '+version);
}
prepare().catch(error=>{console.error(error);process.exitCode=1;});
