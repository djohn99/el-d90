// Deterministic local palette generation, shared by the UI and contrast checks.
(function(root){
 const rgb=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16));
 const mix=(a,b,t)=>'#'+rgb(a).map((v,i)=>Math.round(v*(1-t)+rgb(b)[i]*t).toString(16).padStart(2,'0')).join('');
 const luminance=hex=>rgb(hex).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
 const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
 function readable(color,surfaces,dark){const target=dark?'#ffffff':'#000000';for(let i=0;i<=100;i++){const candidate=mix(color,target,i/100);if(surfaces.every(bg=>contrast(candidate,bg)>=4.5))return candidate;}return target;}
 function generate(seed) {
   if (typeof seed !== 'string' || !/^#[0-9a-f]{6}$/i.test(seed)) {
     throw Error('Choose a #RRGGBB palette color');
   }
   const channels = rgb(seed);
   const average = channels.reduce((sum, channel) => sum + channel, 0) / channels.length;
   // Shift the hue of dark surfaces without lifting the whole workspace toward the accent.
   const tintDark = (base, strength) => '#' + rgb(base).map((value, i) =>
     Math.max(0, Math.min(255, Math.round(value + (channels[i] - average) * strength)))
       .toString(16).padStart(2, '0')
   ).join('');
   const colors = {};
   for (const mode of ['dark', 'light']) {
     const dark = mode === 'dark';
     const background = dark ? tintDark('#101519', .08) : mix('#f3f6f8', seed, .05);
     const sidebar = dark ? tintDark('#131a1e', .09) : mix('#eaf0f3', seed, .06);
     const panel = dark ? tintDark('#171f24', .05) : mix('#ffffff', seed, .025);
     const surfaces = [background, sidebar, panel];
     colors[mode] = {
       accent: readable(seed, surfaces, dark),
       background,
       sidebar,
       panel,
       text: readable(dark ? '#e4ecee' : '#1e303b', surfaces, dark),
       muted: readable(dark ? '#8a9ca5' : '#536773', surfaces, dark)
     };
   }
   return colors;
 }
 const api={generate,contrast};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.elD90Palette=api;
})(typeof window==='undefined'?globalThis:window);
