// Local application preferences. Kubeconfig files are referenced, never copied.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),YAML=require('yaml');
const defaults=()=>({appearance:{theme:'dark',fontSize:13},kubeconfig:{paths:[]}});
function normalize(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Settings must be a YAML mapping');
 for(const key of Object.keys(value))if(!['appearance','kubeconfig'].includes(key))throw Error('Unknown setting: '+key);
 const result=defaults();
 for(const section of ['appearance','kubeconfig'])if(value[section]!==undefined&&(!value[section]||typeof value[section]!=='object'||Array.isArray(value[section])))throw Error(section+' must be a mapping');
 for(const key of Object.keys(value.appearance||{}))if(!['theme','fontSize','colors','paletteMode','paletteSeed'].includes(key))throw Error('Unknown appearance setting: '+key);
 for(const key of Object.keys(value.kubeconfig||{}))if(key!=='paths')throw Error('Unknown kubeconfig setting: '+key);
 Object.assign(result.appearance,value.appearance);Object.assign(result.kubeconfig,value.kubeconfig);
 if(!['dark','light','system'].includes(result.appearance.theme))throw Error('Theme must be dark, light or system');
 if(!Number.isInteger(result.appearance.fontSize)||result.appearance.fontSize<12||result.appearance.fontSize>18)throw Error('Font size must be an integer between 12 and 18');
 if(result.appearance.paletteMode!==undefined&&!['smart','advanced'].includes(result.appearance.paletteMode))throw Error('Palette mode must be smart or advanced');
 if(result.appearance.paletteSeed!==undefined&&(typeof result.appearance.paletteSeed!=='string'||!/^#[0-9a-fA-F]{6}$/.test(result.appearance.paletteSeed)))throw Error('Palette seed must be a #RRGGBB color');
 if(result.appearance.colors!==undefined){const colors=result.appearance.colors;if(!colors||typeof colors!=='object'||Array.isArray(colors))throw Error('Appearance colors must be a mapping');for(const [mode,palette]of Object.entries(colors)){if(!['dark','light'].includes(mode)||!palette||typeof palette!=='object'||Array.isArray(palette))throw Error('Colors must use dark and light palettes');for(const[key,color]of Object.entries(palette)){if(!['accent','background','sidebar','panel','text','muted'].includes(key)||typeof color!=='string'||!/^#[0-9a-fA-F]{6}$/.test(color))throw Error('Colors must use supported names and #RRGGBB values');}}}
 const paths=result.kubeconfig.paths;if(!Array.isArray(paths)||paths.length>16)throw Error('kubeconfig.paths must be a list of up to 16 paths');
 result.kubeconfig.paths=[...new Set(paths.map(p=>{if(typeof p!=='string'||!p||p.length>4096||/[\x00-\x1f:]/.test(p)||!(path.isAbsolute(p)||p.startsWith('~/')))throw Error('Use absolute kubeconfig paths or ~/ paths; do not use colon-separated paths');return p;}))];return result;
}
function parse(text){if(typeof text!=='string'||Buffer.byteLength(text)>32768)throw Error('Settings YAML exceeds 32 KiB');const doc=YAML.parseDocument(text,{uniqueKeys:true});if(doc.errors.length)throw Error(doc.errors[0].message);return normalize(doc.toJS({maxAliasCount:20}));}
function resolvePaths(settings){return settings.kubeconfig.paths.map(p=>p.startsWith('~/')?path.join(os.homedir(),p.slice(2)):p);}
async function read(file){try{return parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return defaults();throw e;}}
async function write(file,text){const settings=parse(text);for(const p of resolvePaths(settings)){const stat=await fs.stat(p).catch(()=>{throw Error('Kubeconfig file not found: '+p)});if(!stat.isFile())throw Error('Kubeconfig path is not a file: '+p);await fs.access(p,require('node:fs').constants.R_OK);}
 await fs.mkdir(path.dirname(file),{recursive:true});const temporary=file+'.'+require('node:crypto').randomUUID();try{await fs.writeFile(temporary,YAML.stringify(settings),{mode:0o600});await fs.rename(temporary,file);}finally{await fs.rm(temporary,{force:true});}return settings;}
module.exports={defaults,normalize,parse,resolvePaths,read,write,stringify:YAML.stringify};
