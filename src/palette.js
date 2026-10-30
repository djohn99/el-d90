// Deterministic local palette generation, shared by the UI and contrast checks.
(function(root){
 const rgb=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16));
 const mix=(a,b,t)=>'#'+rgb(a).map((v,i)=>Math.round(v*(1-t)+rgb(b)[i]*t).toString(16).padStart(2,'0')).join('');
 const luminance=hex=>rgb(hex).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
 function readable(color,surfaces,dark){const target=dark?'#ffffff':'#000000';for(let i=0;i<=100;i++){const candidate=mix(color,target,i/100);if(surfaces.every(bg=>contrast(candidate,bg)>=4.5))return candidate;}return target;}
 function generate(seed){if(typeof seed!=='string'||!/^#[0-9a-f]{6}$/i.test(seed))throw Error('Choose a #RRGGBB palette color');const colors={};for(const mode of ['dark','light']){const dark=mode==='dark';const background=mix(dark?'#101519':'#f2f5f8',seed,dark?0.08:0.04),sidebar=mix(dark?'#171f24':'#e5ecf1',seed,dark?0.10:0.08),panel=mix(dark?'#202a30':'#ffffff',seed,dark?0.12:0.025),surfaces=[background,sidebar,panel];colors[mode]={accent:readable(seed,surfaces,dark),background,sidebar,panel,text:readable(mix(seed,dark?'#ffffff':'#000000',.94),surfaces,dark),muted:readable(mix(seed,dark?'#ffffff':'#000000',.62),surfaces,dark)};}return colors;}
 const api={generate,contrast};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.elD90Palette=api;
})(typeof window==='undefined'?globalThis:window);
