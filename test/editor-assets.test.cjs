const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('generated editor ships the patched sanitizer, excludes Monaco vendored copies and stale AMD chunks',()=>{
 const root=path.join(__dirname,'../assets/monaco'),metadata=JSON.parse(fs.readFileSync(path.join(root,'build.json')));
 assert.equal(metadata.dompurify,'3.4.17');assert.equal(metadata.source,'esm');assert.ok(metadata.inputs.some(p=>p.endsWith('contrib/find/browser/findController.js')));assert.ok(metadata.inputs.some(p=>p.endsWith('contrib/folding/browser/folding.js')));assert.ok(metadata.inputs.some(p=>p.endsWith('dompurify/dist/purify.es.mjs')));assert.ok(!metadata.inputs.some(p=>p.endsWith('/browser/dompurify/dompurify.js')));
 assert.equal(fs.existsSync(path.join(root,'vs')),false);const scripts=fs.readdirSync(root).filter(p=>p.endsWith('.js')).map(p=>fs.readFileSync(path.join(root,p),'utf8')).join('\n');assert.match(scripts,/3\.4\.17/);assert.doesNotMatch(scripts,/DOMPurify 3\.4\.15|version\s*=\s*["']3\.4\.15/);assert.ok(fs.existsSync(path.join(root,'editor-worker.js')));assert.ok(fs.existsSync(path.join(root,'DOMPurify-LICENSE')));
});
