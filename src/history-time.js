/* Shared time-window validation for stored metrics and generated demo charts. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.elD90HistoryTime=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 const presets=Object.freeze({'5m':{label:'5 minutes',seconds:300,step:5},'30m':{label:'30 minutes',seconds:1800,step:10},'1h':{label:'1 hour',seconds:3600,step:15},'2h':{label:'2 hours',seconds:7200,step:30},'4h':{label:'4 hours',seconds:14400,step:60},'6h':{label:'6 hours',seconds:21600,step:60},'24h':{label:'24 hours',seconds:86400,step:300},'7d':{label:'7 days',seconds:604800,step:1800}});
 function resolve(input,now=Date.now()){
  const range=input.range||'1h',current=Math.floor(now/1000);
  if(range!=='custom'){if(!Object.hasOwn(presets,range))throw Error('Unsupported historical time range');const preset=presets[range];return{start:current-preset.seconds,end:current,step:preset.step};}
  const start=input.customStart,end=input.customEnd;
  if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end))throw Error('Choose valid custom start and end times');
  if(start<0||end<=start)throw Error('End time must be after start time');
  if(end>current)throw Error('End time cannot be in the future');
  if(end-start<60)throw Error('Choose a time window of at least 1 minute');
  if(end-start>31*86400)throw Error('Custom time windows can cover at most 31 days');
  return{start:Math.floor(start),end:Math.floor(end),step:Math.max(1,Math.ceil((end-start)/480))};
 }
 return{presets,resolve};
});
