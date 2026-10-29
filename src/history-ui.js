/* Original el-d90 Prometheus history controls and charts. */
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const palette = ['#b6e3ac', '#8cc8df', '#e4c08f', '#c6a9e8', '#e7a6af', '#87d2c4', '#d7df94', '#a1b2ed'];
  const metrics = { cpu: ['CPU usage', 'cores'], memory: ['Memory working set', 'bytes'], network: ['Network receive', 'bytes/s'], restarts: ['Container restarts · rolling 5 minutes', 'restarts / 5m'] };
  const ranges = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800 };
  const sourceKey = source => source ? `${source.scheme || 'http'}:${source.namespace}/${source.name}:${source.port}` : '';
  function installStyles() {
    if (document.getElementById('eld90-history-style')) return;
    const style = document.createElement('style'); style.id = 'eld90-history-style';
    style.textContent = `.history-panel{padding:20px;border:1px solid var(--line);border-radius:8px;background:var(--panel);margin-bottom:22px}.history-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:18px 0}.history-controls label,.history-manual label{display:flex;flex-direction:column;gap:7px;font-size:10px;color:var(--muted)}.history-controls select{max-width:330px;min-width:140px}.history-manual{display:flex;flex-wrap:wrap;gap:12px;margin:10px 0 18px}.history-manual[hidden]{display:none}.history-manual input{padding:9px;max-width:170px}.history-copy{font-size:11px;line-height:1.7;color:var(--muted)}.history-chart{width:100%;display:block;min-height:260px}.history-chart text{font-family:inherit;font-size:11px;fill:#8a9ca5}.history-chart line{stroke:#304047}.history-legend{display:flex;flex-wrap:wrap;gap:8px 15px;margin-top:12px}.history-legend button{font-size:10px;display:flex;align-items:center;gap:7px;color:var(--text);padding:4px}.history-legend i{width:8px;height:8px;border-radius:50%;display:inline-block}.history-legend button[aria-pressed=false]{opacity:.35}.history-summary{display:flex;justify-content:space-between;gap:15px;margin:13px 0;color:var(--muted);font-size:10px}.history-chart-wrap{overflow:auto}.history-chart-wrap svg{min-width:600px}.history-status{font-size:11px;line-height:1.6;white-space:pre-wrap;color:var(--muted);padding:15px 0}.history-source-note{overflow-wrap:anywhere;font-size:10px;color:var(--muted)}.history-heading{display:flex;gap:12px;justify-content:space-between;align-items:center}`;
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
    return `${value.toFixed(unit === 'cores' ? 2 : 1)}${unit === 'cores' ? ' cores' : ''}`;
  }
  function csvCell(value) { return window.elD90Productivity.csvCell(value); }
  function csv(result) {
    return ['timestamp,namespace,metric,value,unit', ...result.series.flatMap(series => series.values.map(([timestamp, value]) => [new Date(timestamp * 1000).toISOString(), series.name, result.metric, value, result.unit].map(csvCell).join(',')))].join('\n');
  }
  function demoQuery(settings, namespaces) {
    const end = Math.floor(Date.now() / 1000), start = end - ranges[settings.range], step = Math.ceil(ranges[settings.range] / 120);
    const names = namespaces?.length && !namespaces.includes('*') ? namespaces : ['production', 'observability'];
    const multiplier = { cpu: 4, memory: 1024 ** 3 * 2, network: 1024 ** 2 * 3, restarts: 2 }[settings.metric];
    return { metric: settings.metric, unit: metrics[settings.metric][1], start, end, step, source: settings.source, errors: [], series: names.slice(0, 6).map((name, index) => ({ name, labels: { namespace: name }, values: Array.from({ length: 121 }, (_, i) => [start + i * step, Math.max(0, multiplier * (0.7 + index * .2 + Math.sin(i / 9 + index) * .15))]) })) };
  }
  function chartMarkup(result, excluded) {
    const series = result.series.filter((_, index) => !excluded.has(index));
    const values = series.flatMap(row => row.values.map(pair => pair[1])).filter(Number.isFinite);
    if (!values.length) return '<div class="history-status">No samples for this metric and selection. The exporter, namespace labels, or retention window may not cover this request.</div>';
    const W = 1000, H = 330, left = 100, right = 24, top = 22, bottom = 48;
    const max = Math.max(...values, .001) * 1.1, min = Math.min(0, ...values);
    const x = t => left + ((t - result.start) / (result.end - result.start)) * (W - left - right);
    const y = v => top + (1 - (v - min) / (max - min)) * (H - top - bottom);
    let svg = `<svg class="history-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Historical ${escape(metrics[result.metric][0])} chart"><title>${escape(metrics[result.metric][0])} by namespace</title>`;
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
      let previous = null, d = '';
      for (const [timestamp,value] of row.values) {
        if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {previous=null;continue;}
        const command = previous !== null && timestamp - previous <= result.step * 1.6 ? 'L' : 'M';
        d += `${command}${x(timestamp).toFixed(2)},${y(value).toFixed(2)} `; previous=timestamp;
      }
      svg += `<path d="${d}" fill="none" stroke="${palette[index%palette.length]}" stroke-width="2" vector-effect="non-scaling-stroke"><title>${escape(row.name)}</title></path>`;
    });
    return svg + '</svg>';
  }
  async function render(container, options) {
    installStyles();
    const active = () => container.isConnected && (!options.isCurrent || options.isCurrent());
    const settings = { metric: 'cpu', range: '1h', ...options.settings };
    if (!Object.hasOwn(metrics,settings.metric)) settings.metric='cpu'; if (!Object.hasOwn(ranges,settings.range)) settings.range='1h';
    const demo = !!options.demo;
    let candidates = [], result = null, ticket = 0, excluded = new Set();
    container.innerHTML = `<section class="history-panel"><div class="history-heading"><h2>Historical charts</h2><span class="mode-badge">${demo?'DEMO · GENERATED SAMPLES':'PROMETHEUS HISTORY'}</span></div><p class="history-copy">Real query-range samples from your selected Prometheus service, grouped by namespace. Gaps remain gaps. Sources and settings are kept separately for each cluster.</p><div class="history-controls"><label>Prometheus source<select id="history-source" aria-label="Prometheus source"><option value="">Discovering services…</option></select></label><label>Metric<select id="history-metric" aria-label="Historical metric">${Object.entries(metrics).map(([key,[label]])=>`<option value="${key}">${escape(label)}</option>`).join('')}</select></label><label>Time range<select id="history-range" aria-label="Historical time range"><option value="1h">Last hour</option><option value="6h">Last 6 hours</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option></select></label><button id="history-refresh" class="button secondary">Refresh history</button><button id="history-export" class="button secondary" disabled>Export CSV</button></div><div class="history-manual" hidden><label>Namespace<input id="history-source-namespace" aria-label="Prometheus namespace" placeholder="monitoring"></label><label>Service<input id="history-source-service" aria-label="Prometheus service" placeholder="prometheus-server"></label><label>Port<input id="history-source-port" aria-label="Prometheus port" type="number" min="1" max="65535" value="9090"></label><label>Transport<select id="history-source-scheme" aria-label="Prometheus transport"><option>http</option><option>https</option></select></label></div><div class="history-source-note"></div><div class="history-summary"></div><div class="history-chart-wrap"></div><div class="history-legend"></div><div class="history-status" role="status">Discovering Prometheus services…</div></section>`;
    const el = selector => container.querySelector(selector);
    const sourceSelect = el('#history-source'), status = el('.history-status');
    el('#history-metric').value=settings.metric;el('#history-range').value=settings.range;
    let discoveryError = '';
    try { candidates = demo ? [{namespace:'observability',name:'demo-prometheus',port:9090,scheme:'http',label:'observability/demo-prometheus:9090'}] : await options.invoke('history:sources',{context:options.context}); }
    catch(error) {discoveryError=error.message||String(error);}
    if (!active()) return;
    sourceSelect.innerHTML = `<option value="">Choose a source…</option>${candidates.map((source,index)=>`<option value="${index}">${escape(source.label||sourceKey(source))}</option>`).join('')}<option value="manual">Enter service manually…</option>`;
    if (demo&&!settings.source)settings.source=candidates[0];
    if (settings.source) {
      const index=candidates.findIndex(source=>sourceKey(source)===sourceKey(settings.source)); sourceSelect.value=index>=0?String(index):'manual';
      el('#history-source-namespace').value=settings.source.namespace||'';el('#history-source-service').value=settings.source.name||'';el('#history-source-port').value=settings.source.port||9090;el('#history-source-scheme').value=settings.source.scheme||'http';
    }
    function currentSettings() {
      const manual=sourceSelect.value==='manual';
      const source=manual?{namespace:el('#history-source-namespace').value.trim(),name:el('#history-source-service').value.trim(),port:Number(el('#history-source-port').value),scheme:el('#history-source-scheme').value}:candidates[Number(sourceSelect.value)];
      return {metric:el('#history-metric').value,range:el('#history-range').value,source:sourceSelect.value?source:null};
    }
    function saveSettings() {const value=currentSettings();options.onSettings?.(value);return value;}
    function repaint() {
      if(!active()||!result)return;
      el('.history-chart-wrap').innerHTML=chartMarkup(result,excluded);
      el('.history-legend').innerHTML=result.series.map((row,index)=>`<button type="button" data-series="${index}" aria-pressed="${!excluded.has(index)}"><i style="background:${palette[index%palette.length]}"></i>${escape(row.name)}</button>`).join('');
      el('.history-legend').querySelectorAll('button').forEach(button=>button.onclick=()=>{const index=Number(button.dataset.series);excluded.has(index)?excluded.delete(index):excluded.add(index);repaint();});
    }
    async function load() {
      const localTicket=++ticket, value=saveSettings();
      el('.history-manual').hidden=sourceSelect.value!=='manual';
      el('#history-export').disabled=true;el('.history-chart-wrap').innerHTML='';el('.history-legend').innerHTML='';el('.history-summary').textContent='';result=null;
      if(!value.source){status.textContent=discoveryError?`Service discovery unavailable: ${discoveryError}\nChoose “Enter service manually” to use a known Prometheus service.`:candidates.length?'Choose a Prometheus source to load historical samples.':'No Prometheus service was discovered. Enter a known service manually; this app will not install an exporter or invent past samples.';return;}
      el('.history-source-note').textContent=`${options.context} · ${sourceKey(value.source)}${demo?' · GENERATED DEMO DATA':''}`;
      status.textContent='Loading historical samples…';el('#history-refresh').disabled=true;
      try {
        const response=demo?demoQuery(value,options.namespaces || (options.namespace&&options.namespace!=='*'?[options.namespace]:[])):await options.invoke('history:query',{context:options.context,namespace:options.namespace,namespaces:options.namespaces,...value});
        if(!active()||ticket!==localTicket)return;
        result=response;excluded=new Set();repaint();
        const count=result.series.reduce((sum,row)=>sum+row.values.length,0);
        el('.history-summary').textContent=`${result.series.length} namespace series · ${count} samples · ${result.step}s resolution · ${demo?'Generated demo values':'Prometheus stored values'}`;
        status.textContent=(response.errors||[]).join('\n') || (count?'':'No historical samples were returned. Check the exporter, selected namespaces, retention and chosen metric.');
        el('#history-export').disabled=!count;
      } catch(error){if(active()&&ticket===localTicket)status.textContent=`History unavailable: ${error.message||error}`;}
      finally{if(active()&&ticket===localTicket)el('#history-refresh').disabled=false;}
    }
    sourceSelect.onchange=()=>{el('.history-manual').hidden=sourceSelect.value!=='manual';if(sourceSelect.value==='manual'){saveSettings();status.textContent='Enter the Prometheus service and click Refresh history.';return;}load();};
    el('#history-metric').onchange=el('#history-range').onchange=load;
    el('#history-refresh').onclick=load;
    el('#history-export').onclick=()=>{if(result)options.invoke('file:save',{text:csv(result)}).catch(error=>{if(active())status.textContent=error.message;});};
    await load();
    return { destroy(){++ticket;} };
  }
  window.elD90History={render};
})();
