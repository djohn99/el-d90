/* Original el-d90 Prometheus history controls and charts. */
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const palette = ['#b6e3ac', '#8cc8df', '#e4c08f', '#c6a9e8', '#e7a6af', '#87d2c4', '#d7df94', '#a1b2ed'];
  const metrics = { cpu: ['CPU usage', 'cores'], memory: ['Memory working set', 'bytes'], filesystem: ['Filesystem usage','bytes'], network: ['Network receive', 'bytes/s'], restarts: ['Container restarts · rolling 5 minutes', 'restarts / 5m'] };
  const {presets:ranges,resolve:resolveTime}=window.elD90HistoryTime;
  const localDate=value=>{const d=new Date(value*1000);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')+'T'+[d.getHours(),d.getMinutes()].map(n=>String(n).padStart(2,'0')).join(':');};
  const sourceKey = source => source ? `${source.scheme || 'http'}:${source.namespace}/${source.name}:${source.port}` : '';
  function installStyles() {
    if (document.getElementById('eld90-history-style')) return;
    const style = document.createElement('style'); style.id = 'eld90-history-style';
    style.textContent = `.history-panel{padding:20px;border:1px solid var(--line);border-radius:8px;background:var(--panel);margin-bottom:22px}.history-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:18px 0}.history-controls label,.history-manual label{display:flex;flex-direction:column;gap:7px;font-size:10px;color:var(--muted)}.history-controls select{max-width:330px;min-width:140px}.history-manual{display:flex;flex-wrap:wrap;gap:12px;margin:10px 0 18px}.history-manual[hidden]{display:none}.history-custom input{min-width:220px}.history-manual input{padding:9px;max-width:170px}.history-copy{font-size:11px;line-height:1.7;color:var(--muted)}.history-chart{width:100%;display:block;min-height:260px}.history-chart text{font-family:inherit;font-size:11px;fill:#8a9ca5}.history-chart line{stroke:#304047}.history-legend{display:flex;flex-wrap:wrap;gap:8px 15px;margin-top:12px}.history-legend button{font-size:10px;display:flex;align-items:center;gap:7px;color:var(--text);padding:4px}.history-legend i{width:8px;height:8px;border-radius:50%;display:inline-block}.history-legend button[aria-pressed=false]{opacity:.35}.history-summary{display:flex;justify-content:space-between;gap:15px;margin:13px 0;color:var(--muted);font-size:10px}.history-chart-wrap{overflow:auto}.history-chart-wrap svg{min-width:600px}.history-status{font-size:11px;line-height:1.6;white-space:pre-wrap;color:var(--muted);padding:15px 0}.history-source-note{overflow-wrap:anywhere;font-size:10px;color:var(--muted)}.history-heading{display:flex;gap:12px;justify-content:space-between;align-items:center}`;
    document.head.append(style);
  }
  function formatValue(value, unit) {
    if (unit === 'bytes' || unit === 'bytes/s') {
      const suffix = unit.endsWith('/s') ? '/s' : '';
      if (Math.abs(value) >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB${suffix}`;
      if (Math.abs(value) >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB${suffix}`;
      if (Math.abs(value) >= 1024) return `${(value / 1024).toFixed(1)} KiB${suffix}`;
      return `${value.toFixed(0)} B${suffix}`;
    }
    return `${value.toFixed(unit === 'cores' ? (Math.abs(value)>0&&Math.abs(value)<.1?3:2) : 1)}${unit === 'cores' ? ' cores' : ''}`;
  }
  function csvCell(value) { return window.elD90Productivity.csvCell(value); }
  function csv(result) {
    return [`timestamp,${result.resourceTarget||result.aggregate?'series':'namespace'},metric,value,unit`, ...result.series.flatMap(series => series.values.map(([timestamp, value]) => [new Date(timestamp * 1000).toISOString(), series.name, result.metric, value, result.unit].map(csvCell).join(',')))].join('\n');
  }
  function demoQuery(settings, namespaces) {
    const {start,end}=resolveTime(settings),step=Math.max(1,Math.ceil((end-start)/120));
    const names = namespaces?.length && !namespaces.includes('*') ? namespaces : ['production', 'observability'];
    const multiplier = { cpu: 4, memory: 1024 ** 3 * 2, network: 1024 ** 2 * 3, restarts: 2, filesystem:1024**3 }[settings.metric];
    return { metric: settings.metric, unit: metrics[settings.metric][1], start, end, step, source: settings.source, errors: [], series: names.slice(0, 6).map((name, index) => ({ name, labels: { namespace: name }, values: Array.from({ length: Math.floor((end-start)/step)+1 }, (_, i) => [start + i * step, Math.max(0, multiplier * (0.7 + index * .2 + Math.sin(i / 9 + index) * .15))]) })) };
  }
  function chartMarkup(result, excluded) {
    const series = result.series.filter((_, index) => !excluded.has(index));
    const values = series.flatMap(row => row.values.map(pair => pair[1])).filter(Number.isFinite);
    if (!values.length) return '<div class="history-status">No samples for this metric and selection. The exporter, namespace labels, or retention window may not cover this request.</div>';
    const W = 1000, H = 330, left = 100, right = 24, top = 22, bottom = 48;
    const max = Math.max(...values, .001) * 1.1, min = Math.min(0, ...values);
    const x = t => left + ((t - result.start) / (result.end - result.start)) * (W - left - right);
    const y = v => top + (1 - (v - min) / (max - min)) * (H - top - bottom);
    const metricTitle=result.resourceTarget?.resource==='nodes'&&result.metric==='memory'?'Memory usage':metrics[result.metric][0];
    let svg = `<svg class="history-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Historical ${escape(metricTitle)} chart"><title>${escape(metricTitle)}${result.resourceTarget?' for this resource':result.aggregate?' across workloads':' by namespace'}</title>`;
    for (let i = 0; i <= 4; i++) {
      const value = min + (max - min) * i / 4, yy = y(value);
      svg += `<line x1="${left}" x2="${W-right}" y1="${yy}" y2="${yy}"/><text x="${left-10}" y="${yy+4}" text-anchor="end">${escape(formatValue(value,result.unit))}</text>`;
    }
    for (let i = 0; i <= 4; i++) {
      const timestamp = result.start + (result.end - result.start) * i / 4;
      const label = new Date(timestamp * 1000).toLocaleString([], result.end-result.start > 86400 ? {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'} : {hour:'2-digit',minute:'2-digit'});
      svg += `<text x="${x(timestamp)}" y="${H-17}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${escape(label)}</text>`;
    }
    result.series.forEach((row,index) => {
      if (excluded.has(index)) return;
      let previous = null, d = '',segments=[],segment=[];
      for (const [timestamp,value] of row.values) {
        if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {if(segment.length)segments.push(segment);segment=[];previous=null;continue;}
        const command = previous !== null && timestamp - previous <= result.step * 1.6 ? 'L' : 'M';
        if(command==='M'&&segment.length){segments.push(segment);segment=[];}segment.push([x(timestamp),y(value)]);
        d += `${command}${x(timestamp).toFixed(2)},${y(value).toFixed(2)} `; previous=timestamp;
      }
      if(segment.length)segments.push(segment);if(row.area||result.aggregate)for(const points of segments)if(points.length>1){const path=points.map(([xx,yy],i)=>(i?'L':'M')+xx.toFixed(2)+','+yy.toFixed(2)).join(' ')+` L${points.at(-1)[0]},${y(0)} L${points[0][0]},${y(0)} Z`;svg+=`<path d="${path}" fill="${palette[index%palette.length]}" opacity="0.14"/>`;}
      for(const points of segments)if(points.length===1)svg+=`<circle cx="${points[0][0]}" cy="${points[0][1]}" r="3" fill="${palette[index%palette.length]}"><title>${escape(row.name)} · single sample</title></circle>`;
      svg += `<path d="${d}" fill="none" stroke="${palette[index%palette.length]}" stroke-width="2" vector-effect="non-scaling-stroke"><title>${escape(row.name)}</title></path>`;
    });
    return svg + '</svg>';
  }
  const sourceCache=new Map(),instances=new Map();
  async function discoverSources(options){
    let entry=sourceCache.get(options.context);
    if(!entry||entry.expires<Date.now()){
      entry={expires:Date.now()+30000};entry.promise=options.invoke('history:sources',{context:options.context}).catch(error=>{if(sourceCache.get(options.context)===entry)sourceCache.delete(options.context);throw error;});sourceCache.set(options.context,entry);
    }
    return structuredClone(await entry.promise);
  }
  async function render(container, options) {
    installStyles();
    instances.get(container)?.destroy();for(const[host,instance]of instances)if(!host.isConnected)instance.destroy();
    const active = () => container.isConnected && (!options.isCurrent || options.isCurrent());
    const isNode=options.target?.resource==='nodes',hasContainers=!!options.target&&!isNode;
    const settings = { metric: 'cpu', range: '1h', ...options.settings };
    if (!Object.hasOwn(metrics,settings.metric)) settings.metric='cpu'; if (settings.range!=='custom'&&!Object.hasOwn(ranges,settings.range)) settings.range='1h';
    if(options.target&&!(isNode?['cpu','memory']:['cpu','memory','network','filesystem']).includes(settings.metric))settings.metric='cpu';
    if(options.aggregate&&!['cpu','memory'].includes(settings.metric))settings.metric='cpu';
    const demo = !!options.demo;
    let candidates = [], result = null, ticket = 0, excluded = new Set(),activeReadId=null,zoomBack=[];
    container.innerHTML = `<section class="history-panel"><div class="history-heading"><h2>${options.target?'Resource usage history':options.aggregate?'Workload usage history':'Historical charts'}</h2><span class="mode-badge">${demo?'DEMO · GENERATED SAMPLES':'PROMETHEUS HISTORY'}</span></div><p class="history-copy">${isNode?'Node CPU usage is busy cores from node-exporter; memory usage is total minus available memory. Capacity is shown as a reference. Requires node-exporter with node_uname_info or matching node labels.':options.target?'Workload history combines owned Pods using Prometheus ownership records and requires kube-state-metrics and cAdvisor metrics. CPU/memory include usage and container-level requests/limits. Pod-level budgets are separate. Job history depends on retained scrape samples; short or completed runs can have gaps.':options.aggregate?'Total workload usage from Prometheus; node-role filtering requires kube-state-metrics. These container samples can differ from total node usage shown alongside.':'Real query-range samples from your selected Prometheus service, grouped by namespace.'} Gaps remain gaps. Sources and settings are kept separately for each cluster.</p><div class="history-controls"><label>Prometheus source<select id="history-source" aria-label="Prometheus source"><option value="">Discovering services…</option></select></label><label>Metric<select id="history-metric" aria-label="Historical metric">${Object.entries(metrics).filter(([key])=>options.target?(isNode?['cpu','memory']:['cpu','memory','network','filesystem']).includes(key):!options.aggregate||['cpu','memory'].includes(key)).map(([key,[label]])=>`<option value="${key}">${escape(isNode&&key==='memory'?'Memory usage':label)}</option>`).join('')}</select></label><label>Time range<select id="history-range" aria-label="Historical time range">${Object.entries(ranges).map(([key,value])=>`<option value="${key}">${value.label}</option>`).join('')}<option value="custom">Custom…</option></select></label>${hasContainers?`<label>Container<select id="history-container"><option value="*">All containers</option>${(options.containers||[]).map(name=>`<option>${escape(name)}</option>`).join('')}</select></label>`:''}<button id="history-refresh" class="button secondary">Refresh history</button><button id="history-export" class="button secondary" disabled>Export CSV</button><button id="history-png" class="button secondary" disabled>Export PNG</button><button id="history-reset-zoom" class="button secondary" disabled>Reset zoom</button><button id="history-diagnose" class="button secondary">Diagnose metrics</button></div><div class="history-custom history-manual" hidden><label>Start · local time<input id="history-start" type="datetime-local" aria-label="History start time"></label><label>End · local time<input id="history-end" type="datetime-local" aria-label="History end time"></label><span class="history-copy">Up to 31 days, subject to Prometheus retention.</span></div><div class="history-manual history-source-manual" hidden><label>Namespace<input id="history-source-namespace" aria-label="Prometheus namespace" placeholder="monitoring"></label><label>Service<input id="history-source-service" aria-label="Prometheus service" placeholder="prometheus-server"></label><label>Port<input id="history-source-port" aria-label="Prometheus port" type="number" min="1" max="65535" value="9090"></label><label>Transport<select id="history-source-scheme" aria-label="Prometheus transport"><option>http</option><option>https</option></select></label></div><div class="history-source-note"></div><div class="history-summary"></div><p class="history-copy">Hover for sample values. Drag across at least one minute to zoom.</p><div class="history-chart-wrap"></div><pre class="history-diagnostics" hidden></pre><div class="history-legend"></div><div class="history-status" role="status">Discovering Prometheus services…</div></section>`;
    if(options.target)container.innerHTML=container.innerHTML.replace(/id="history-/g,'id="detail-history-');
    const el = selector => container.querySelector(options.target?selector.replace(/^#history-/,'#detail-history-'):selector);
    const sourceSelect = el('#history-source'), status = el('.history-status');
    el('#history-metric').value=settings.metric;el('#history-range').value=settings.range;
    const initialEnd=Math.floor(Date.now()/60000)*60;el('#history-start').value=localDate(Number.isFinite(settings.customStart)?settings.customStart:initialEnd-3600);el('#history-end').value=localDate(Number.isFinite(settings.customEnd)?settings.customEnd:initialEnd);
    el('.history-custom').hidden=settings.range!=='custom';
    if(hasContainers){const picker=el('#history-container');if([...picker.options].some(o=>o.value===settings.container))picker.value=settings.container;el('#history-metric').querySelector('option[value=network]').disabled=picker.value!=='*';if(picker.value!=='*'&&el('#history-metric').value==='network')el('#history-metric').value='cpu';}
    let discoveryError = '',backgroundDiscovery=null;
    try { if(!demo&&settings.source){candidates=[settings.source];backgroundDiscovery=discoverSources(options).catch(error=>{discoveryError=error.message||String(error);return null;});}else candidates = demo ? [{namespace:'observability',name:'demo-prometheus',port:9090,scheme:'http',label:'observability/demo-prometheus:9090'}] : await discoverSources(options); }
    catch(error) {discoveryError=error.message||String(error);}
    if (!active()) return;
    sourceSelect.innerHTML = `<option value="">Choose a source…</option>${candidates.map((source,index)=>`<option value="${index}">${escape(source.label||sourceKey(source))}</option>`).join('')}<option value="manual">Enter service manually…</option>`;
    if((demo||options.autoSelectSingle&&candidates.length===1)&&!settings.source)settings.source=candidates[0];
    if (settings.source) {
      const index=candidates.findIndex(source=>sourceKey(source)===sourceKey(settings.source)); sourceSelect.value=index>=0?String(index):'manual';
      el('#history-source-namespace').value=settings.source.namespace||'';el('#history-source-service').value=settings.source.name||'';el('#history-source-port').value=settings.source.port||9090;el('#history-source-scheme').value=settings.source.scheme||'http';
    }
    function currentSettings() {
      const manual=sourceSelect.value==='manual';
      const source=manual?{namespace:el('#history-source-namespace').value.trim(),name:el('#history-source-service').value.trim(),port:Number(el('#history-source-port').value),scheme:el('#history-source-scheme').value}:candidates[Number(sourceSelect.value)];
      return {metric:el('#history-metric').value,range:el('#history-range').value,source:sourceSelect.value?source:null,customStart:Date.parse(el('#history-start').value)/1000,customEnd:Date.parse(el('#history-end').value)/1000,...(hasContainers?{container:el('#history-container').value}: {})};
    }
    function saveSettings() {const value=currentSettings();options.onSettings?.(value);return value;}
    function repaint() {
      if(!active()||!result)return;
      el('.history-chart-wrap').innerHTML=chartMarkup(result,excluded);
      window.elD90HistoryInteraction.attach(el('.history-chart-wrap'),{result,excluded,onZoom:(start,end)=>{start=Math.floor(start/60)*60;end=Math.floor(end/60)*60;if(end-start<60){status.textContent='Select at least one minute to zoom.';return;}zoomBack.push(currentSettings());el('#history-reset-zoom').disabled=false;el('#history-range').value='custom';el('#history-start').value=localDate(start);el('#history-end').value=localDate(end);load();}});
      el('.history-legend').innerHTML=result.series.map((row,index)=>`<button type="button" data-series="${index}" aria-pressed="${!excluded.has(index)}"><i style="background:${palette[index%palette.length]}"></i>${escape(row.name)}</button>`).join('');
      el('.history-legend').querySelectorAll('button').forEach(button=>button.onclick=()=>{const index=Number(button.dataset.series);excluded.has(index)?excluded.delete(index):excluded.add(index);repaint();});
    }
    async function load() {
      if(hasContainers&&el('#history-container').value!=='*'&&el('#history-metric').value==='network'){status.textContent='Network metrics are Pod scoped. Choose All containers.';return;}const localTicket=++ticket, value=saveSettings();if(activeReadId&&!demo)options.invoke('read:cancel',{context:options.context,requestId:activeReadId}).catch(()=>{});activeReadId=crypto.randomUUID();el('.history-custom').hidden=value.range!=='custom';
      el('.history-source-manual').hidden=sourceSelect.value!=='manual';
      el('#history-export').disabled=true;el('#history-png').disabled=true;el('.history-chart-wrap').innerHTML='';el('.history-legend').innerHTML='';el('.history-summary').textContent='';result=null;
      try{resolveTime(value);}catch(error){status.textContent=error.message;el('#history-refresh').disabled=false;return;}
      if(!value.source){status.textContent=discoveryError?`Service discovery unavailable: ${discoveryError}\nChoose “Enter service manually” to use a known Prometheus service.`:candidates.length?'Choose a Prometheus source to load historical samples.':'No Prometheus service was discovered. Enter a known service manually; this app will not install an exporter or invent past samples.';return;}
      el('.history-source-note').textContent=`${options.context} · ${sourceKey(value.source)}${demo?' · GENERATED DEMO DATA':''}`;
      status.textContent='Loading historical samples…';el('#history-refresh').disabled=true;
      try {
        const response=demo?demoQuery(value,options.namespaces || (options.namespace&&options.namespace!=='*'?[options.namespace]:[])):await options.invoke(options.target?'resource:history':'history:query',{requestId:activeReadId,...(options.target?{target:options.target}:{}),context:options.context,namespace:options.namespace,namespaces:options.namespaces,...value,aggregate:!!options.aggregate,...(options.nodeNames!==undefined?{nodeNames:options.nodeNames}:{})});
        if(!active()||ticket!==localTicket)return;
        if(demo&&options.aggregate){const points=new Map();for(const row of response.series)for(const[t,v]of row.values)points.set(t,(points.get(t)||0)+v);response.series=options.nodeNames?.length===0?[]:[{name:'Cluster workload',labels:{},values:[...points]}];}
        if(demo&&options.target){response.resourceTarget=options.target;const points=new Map();for(const row of response.series)for(const[t,v]of row.values)points.set(t,(points.get(t)||0)+v);const values=[...points];response.series=[{name:value.metric==='network'?'Receive':'Usage',labels:{category:'usage'},area:true,values},...(isNode?[{name:'Capacity',labels:{category:'capacity'},values:values.map(([t])=>[t,value.metric==='cpu'?4:16*1024**3])}]:['cpu','memory'].includes(value.metric)?[{name:'Requests',labels:{category:'requests'},values:values.map(([t,v])=>[t,v*1.25])},{name:'Limits',labels:{category:'limits'},values:values.map(([t,v])=>[t,v*2])}]:value.metric==='network'?[{name:'Transmit',labels:{category:'transmit'},values:values.map(([t,v])=>[t,v*.6])}]:[])];}
        result=response;excluded=new Set();repaint();
        const count=result.series.reduce((sum,row)=>sum+row.values.length,0);
        el('.history-summary').textContent=`${result.series.length} ${options.aggregate?'aggregate':options.target?'resource':'namespace'} series · ${count} samples · ${result.step}s resolution · ${demo?'Generated demo values':'Prometheus stored values'}`;
        status.textContent=(response.errors||[]).join('\n') || (count?'':'No historical samples were returned. Check the exporter, selected namespaces, retention and chosen metric.');
        el('#history-export').disabled=!count;el('#history-png').disabled=!count;
      } catch(error){if(active()&&ticket===localTicket)status.textContent=`History unavailable: ${error.message||error}`;}
      finally{if(active()&&ticket===localTicket)el('#history-refresh').disabled=false;}
    }
    sourceSelect.onchange=()=>{el('.history-source-manual').hidden=sourceSelect.value!=='manual';if(sourceSelect.value==='manual'){saveSettings();status.textContent='Enter the Prometheus service and click Refresh history.';return;}load();};
    el('#history-metric').onchange=el('#history-start').onchange=el('#history-end').onchange=load;el('#history-range').onchange=()=>{zoomBack=[];el('#history-reset-zoom').disabled=true;load();};if(hasContainers)el('#history-container').onchange=()=>{el('#history-metric').querySelector('option[value=network]').disabled=el('#history-container').value!=='*';if(el('#history-container').value!=='*'&&el('#history-metric').value==='network')el('#history-metric').value='cpu';load();};
    el('#history-reset-zoom').onclick=()=>{const previous=zoomBack.pop();if(!previous)return;el('#history-range').value=previous.range;if(Number.isFinite(previous.customStart))el('#history-start').value=localDate(previous.customStart);if(Number.isFinite(previous.customEnd))el('#history-end').value=localDate(previous.customEnd);el('#history-reset-zoom').disabled=!zoomBack.length;load();};
    el('#history-png').onclick=()=>window.elD90HistoryInteraction.png(el('.history-chart-wrap'),{invoke:options.invoke,title:(options.target?options.target.name:'Cluster')+' · '+el('#history-metric').selectedOptions[0].textContent}).catch(e=>{status.textContent=e.message;});
    el('#history-diagnose').onclick=async()=>{const panel=el('.history-diagnostics');panel.hidden=false;panel.textContent='Checking metrics coverage…';try{const data=demo?{metricsApi:true,sources:candidates,series:['container_cpu_usage_seconds_total','container_memory_working_set_bytes','kube_pod_owner','kube_job_owner','node_cpu_seconds_total','node_memory_MemAvailable_bytes'],warnings:[],note:'Generated demo diagnostics; no cluster was queried.'}:await options.invoke('workspace:monitoring',{context:options.context,source:currentSettings().source});if(!active())return;const expected=['container_cpu_usage_seconds_total','container_memory_working_set_bytes','kube_pod_owner','kube_job_owner','node_cpu_seconds_total','node_memory_MemAvailable_bytes'];panel.textContent=['Metrics API: '+(data.metricsApi?'available':'unavailable or no node samples'),'Prometheus sources: '+data.sources.length,...expected.map(name=>(data.series.includes(name)?'Present: ':'Missing: ')+name),...(data.warnings||[]),data.note].join('\n');}catch(e){if(active())panel.textContent=e.message;}};
    el('#history-refresh').onclick=load;
    el('#history-export').onclick=()=>{if(result)options.invoke('file:save',{text:csv(result)}).catch(error=>{if(active())status.textContent=error.message;});};
    const controller={context:options.context,destroy(){++ticket;if(activeReadId&&!demo)options.invoke('read:cancel',{context:options.context,requestId:activeReadId}).catch(()=>{});instances.delete(container);}};instances.set(container,controller);
    await load();
    if(backgroundDiscovery)backgroundDiscovery.then(found=>{
      if(!active()||!found)return;const selected=currentSettings().source;candidates=found;
      sourceSelect.innerHTML=`<option value="">Choose a source…</option>${candidates.map((source,index)=>`<option value="${index}">${escape(source.label||sourceKey(source))}</option>`).join('')}<option value="manual">Enter service manually…</option>`;
      const index=candidates.findIndex(source=>sourceKey(source)===sourceKey(selected));sourceSelect.value=selected?(index>=0?String(index):'manual'):'';el('.history-source-manual').hidden=sourceSelect.value!=='manual';
    });
    return controller;
  }
  window.elD90History={render,clearSources(){sourceCache.clear();},stop(container){instances.get(container)?.destroy();},stopContext(context){for(const instance of [...instances.values()])if(instance.context===context)instance.destroy();}};
})();
