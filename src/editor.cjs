// Original local editing helpers. No manifest is executed or sent during local operations.
const YAML = require('yaml');
const kube = require('./kube.cjs');
const MAX_BYTES = 2 * 1024 * 1024;
function inputText(input) {
  const text = typeof input === 'string' ? input : input?.text ?? input?.yaml;
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES || text.includes('\0')) throw new Error('YAML must be UTF-8 text no larger than 2 MB');
  return text;
}
function parsed(input) {
  const text = inputText(input), lineCounter = new YAML.LineCounter();
  const documents = YAML.parseAllDocuments(text, { lineCounter, uniqueKeys: true, prettyErrors: false, strict: true, maxAliasCount: 100 });
  if (documents.length > 100) throw new Error('The editor supports at most 100 YAML documents at once');
  return { text, documents, lineCounter };
}
function scalar(document, path) { const node = document.getIn(path, true); return YAML.isScalar(node) && ['string', 'number', 'boolean'].includes(typeof node.value) ? String(node.value).slice(0, 1000) : null; }
function parseDocuments(input) {
  const {text, documents, lineCounter} = parsed(input);
  const errors = [], warnings = [];
  const describe = (error, index) => { const position = error.pos?.[0] ?? 0, line = lineCounter.linePos(position); return {document:index + 1, line:line.line, column:line.col, code:error.code || 'YAML', message:error.message}; };
  const outline = documents.map((document, index) => {
    errors.push(...document.errors.map(e=>describe(e,index)));warnings.push(...document.warnings.map(e=>describe(e,index)));
    return {index:index+1, apiVersion:scalar(document,['apiVersion']),kind:scalar(document,['kind']),name:scalar(document,['metadata','name']),namespace:scalar(document,['metadata','namespace']),startLine:lineCounter.linePos(document.range?.[0]||0).line,endLine:lineCounter.linePos(document.range?.[2] ?? text.length).line,empty:document.contents===null};
  });
  return {valid:errors.length===0,documents:outline,errors,warnings};
}
function format(input) {
  const result = parsed(input), inspection = parseDocuments(result.text);
  if (!inspection.valid) throw new Error(`Cannot format invalid YAML: document ${inspection.errors[0].document}, line ${inspection.errors[0].line}: ${inspection.errors[0].message}`);
  const text = result.documents.map((document,index)=>{const output=document.toString({indent:2,lineWidth:100});return index && !output.startsWith('---')?'---\n'+output:output;}).join('');
  return {text,documents:parseDocuments(text).documents};
}
function diff(input) {
  if (!input || typeof input.original !== 'string' || typeof input.modified !== 'string') throw new Error('Diff needs original and modified YAML text');
  const original=inputText(input.original).replace(/\r\n/g,'\n'),modified=inputText(input.modified).replace(/\r\n/g,'\n');
  const a=original.split('\n'),b=modified.split('\n');
  if(a.length>2000||b.length>2000||a.length*b.length>3000000)throw new Error('Diff supports up to 2,000 lines per version and 3 million comparison cells');
  if(original===modified)return {changed:false,text:'No changes.',added:0,removed:0};
  const matrix=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)matrix[i][j]=a[i]===b[j]?matrix[i+1][j+1]+1:Math.max(matrix[i+1][j],matrix[i][j+1]);
  const output=['--- original','+++ editor'];let i=0,j=0,added=0,removed=0;
  while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){output.push(' '+a[i]);i++;j++;}else if(j<b.length&&(i===a.length||matrix[i][j+1]>=matrix[i+1][j])){output.push('+'+b[j++]);added++;}else{output.push('-'+a[i++]);removed++;}}
  return {changed:true,text:output.join('\n'),added,removed};
}
async function explain(input) {
  const context=kube.string(input.context,'context'),resource=kube.resource(input.resource,context),field=input.path || '';
  if(typeof field!=='string'||field.length>240||field && !/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*$/.test(field))throw new Error('Use a dot-separated field path such as spec.template.spec.containers');
  const args=['explain',resource+(field?'.'+field:''),'--context',context,'--request-timeout=20s'];
  const text=await kube.run(args);
  const fields=[];for(const line of text.split('\n')){const match=line.match(/^\s{2,}([A-Za-z][A-Za-z0-9_-]*)\s+<([^>]+)>\s*(?:-required-)?\s*$/);if(match&&!fields.some(f=>f.name===match[1]))fields.push({name:match[1],type:match[2],path:field?field+'.'+match[1]:match[1]});}
  return {text,fields,resource,path:field,context};
}
function versionRoute(value) {
  if(typeof value!=='string'||value.length>300)throw new Error('Invalid API version');
  if(/^v[0-9]+(?:(?:alpha|beta)[0-9]+)?$/.test(value))return 'api/'+value;
  const match=value.match(/^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)\/(v[0-9]+(?:(?:alpha|beta)[0-9]+)?)$/);
  if(!match||!match[1].split('.').every(p=>p.length<=63&&/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(p)))throw new Error('Invalid API version');
  return 'apis/'+value;
}
function localReference(document,value) {
  if(!value?.$ref)return value || {};
  if(typeof value.$ref!=='string'||!value.$ref.startsWith('#/components/schemas/'))return {};
  return document.components?.schemas?.[value.$ref.slice('#/components/schemas/'.length)] || {};
}
async function schema(input) {
  const context=kube.string(input.context,'context'),route=versionRoute(input.apiVersion);
  if(typeof input.kind!=='string'||!/^[A-Za-z][A-Za-z0-9]{0,99}$/.test(input.kind))throw new Error('Invalid Kubernetes kind');
  const read=async path=>JSON.parse(await kube.run(['get','--context',context,'--request-timeout=20s','--raw',path]));
  const index=await read('/openapi/v3'),entry=index.paths?.[route] || index.paths?.['/'+route];
  if(!entry?.serverRelativeURL)throw new Error(`No OpenAPI v3 schema advertised for ${input.apiVersion}`);
  const url=entry.serverRelativeURL;
  if(typeof url!=='string'||url.length>600||!url.startsWith('/openapi/v3/'))throw new Error('The API server advertised an invalid schema path');
  const parsedURL=new URL(url,'https://kubernetes.invalid');
  if(parsedURL.pathname!=='/openapi/v3/'+route||[...parsedURL.searchParams].some(([key,value])=>key!=='hash'||!/^[A-Za-z0-9_-]{1,200}$/.test(value)))throw new Error('The API server advertised an unexpected schema path');
  const document=await read(url),entries=Object.entries(document.components?.schemas || {});
  const candidate=entries.find(([,schema])=>(Array.isArray(schema['x-kubernetes-group-version-kind'])?schema['x-kubernetes-group-version-kind']:[]).some(gvk=>gvk.kind===input.kind && (gvk.group?gvk.group+'/':'')+gvk.version===input.apiVersion));
  if(!candidate)throw new Error(`No schema found for ${input.apiVersion} ${input.kind}`);
  const root=candidate[1];const fields=[];
  function walk(node,path,depth,visited){node=localReference(document,node);if(depth>7||fields.length>=2500||visited.has(node))return;const next=new Set(visited);next.add(node);for(const [name,property]of Object.entries(node.properties||{})){const value=localReference(document,property),field=path?path+'.'+name:name;fields.push({path:field,name,type:value.type || (value.items?'array':'object'),description:String(value.description||'').slice(0,8000),required:(node.required||[]).includes(name),nullable:!!value.nullable,...(Array.isArray(value.enum)?{enum:value.enum.filter(v=>['string','number','boolean'].includes(typeof v)).slice(0,100)}:{}),...Object.fromEntries(['minimum','maximum','minLength','maxLength'].filter(k=>Number.isFinite(value[k])).map(k=>[k,value[k]])),...(value.items?{itemsType:localReference(document,value.items).type||'object'}:{})});walk(value.type==='array'?value.items:value,field,depth+1,next);}}
  walk(root,'',0,new Set());return {apiVersion:input.apiVersion,kind:input.kind,fields,source:url,coverage:fields.length>=2500?'bounded':'schema-properties',limitations:['Recursive paths are bounded to seven levels and 2,500 fields. Schema availability does not establish admission or authorization. Composed schemas and arbitrary map keys may require Explain field.']};
}
// Local diagnostics accept an explicitly loaded schema; they never fetch a cluster.
function diagnostics(input){const result=parseDocuments(input);if(!result.valid||!Array.isArray(input.fields)||!input.fields.length)return result;const forms=require('./resource-forms.cjs'),{documents,lineCounter}=parsed(input);for(const[index,doc]of documents.entries()){let object;try{object=doc.toJS({maxAliasCount:100});}catch(e){result.errors.push({document:index+1,line:1,column:1,code:'YAML',message:e.message});continue;}if(!object||typeof object!=='object')continue;const fields=input.fields.filter(f=>f&&['string','integer','number','boolean','array','object'].includes(f.type)).slice(0,2500);for(const field of fields){const parts=forms.pathParts(field.path);function values(value,remaining){if(!remaining.length)return[{value}];if(Array.isArray(value))return value.flatMap(v=>values(v,remaining));if(!value||typeof value!=='object')return[];const[key,...rest]=remaining;if(!Object.hasOwn(value,key))return rest.length?[]:[{value:undefined}];return values(value[key],rest);}for(const item of values(object,parts)){if(item.value===undefined&&!field.required)continue;try{forms.convert(item.value,field);if(item.value===undefined&&field.required)throw Error(field.path+': required');}catch(error){const node=doc.getIn(parts,true),position=node?.range?.[0]??doc.range?.[0]??0,line=lineCounter.linePos(position);result.errors.push({document:index+1,line:line.line,column:line.col,code:'SCHEMA',path:field.path,message:error.message});}}}}result.valid=!result.errors.length;return result;}
module.exports={parseDocuments,format,diff,explain,schema,versionRoute,diagnostics};
