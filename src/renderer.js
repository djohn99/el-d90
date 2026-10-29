/* Original el-d90 implementation. No Lens source or assets are used. */
const $ = id => document.getElementById(id);
const API_VIEWS={'gateway-api':{title:'Gateway API',resources:['gateways.gateway.networking.k8s.io','gatewayclasses.gateway.networking.k8s.io','httproutes.gateway.networking.k8s.io','grpcroutes.gateway.networking.k8s.io','tcproutes.gateway.networking.k8s.io','tlsroutes.gateway.networking.k8s.io','udproutes.gateway.networking.k8s.io','referencegrants.gateway.networking.k8s.io']},'admission-api':{title:'Admission',resources:['validatingwebhookconfigurations.admissionregistration.k8s.io','mutatingwebhookconfigurations.admissionregistration.k8s.io','validatingadmissionpolicies.admissionregistration.k8s.io','validatingadmissionpolicybindings.admissionregistration.k8s.io','mutatingadmissionpolicies.admissionregistration.k8s.io','mutatingadmissionpolicybindings.admissionregistration.k8s.io']},'device-api':{title:'Devices / DRA',resources:['deviceclasses.resource.k8s.io','resourceclaims.resource.k8s.io','resourceclaimtemplates.resource.k8s.io','resourceslices.resource.k8s.io']}};
const SPECIAL_VIEWS=['metrics','helm','forwards','applications','node-sessions',...Object.keys(API_VIEWS)];
const titles = { applications:'Applications', 'node-sessions':'Node sessions',...Object.fromEntries(Object.entries(API_VIEWS).map(([key,v])=>[key,v.title])), overview: 'Overview', pods: 'Pods', deployments: 'Deployments', statefulsets: 'StatefulSets', daemonsets: 'DaemonSets', jobs: 'Jobs', cronjobs: 'CronJobs', services: 'Services', ingresses: 'Ingresses', configmaps: 'ConfigMaps', persistentvolumeclaims: 'Volumes', nodes: 'Nodes', namespaces: 'Namespaces', events: 'Events', replicasets: 'ReplicaSets', replicationcontrollers: 'ReplicationControllers', horizontalpodautoscalers: 'Autoscalers', poddisruptionbudgets: 'Disruption budgets', secrets: 'Secrets', resourcequotas: 'Resource quotas', limitranges: 'Limit ranges', serviceaccounts: 'Service accounts', endpoints: 'Endpoints', endpointslices: 'EndpointSlices', networkpolicies: 'Network policies', persistentvolumes: 'Persistent volumes', storageclasses: 'Storage classes', roles: 'Roles', rolebindings: 'Role bindings', clusterroles: 'Cluster roles', clusterrolebindings: 'Cluster role bindings', customresourcedefinitions: 'Custom definitions', resources: 'API explorer', metrics: 'Metrics', helm: 'Helm releases', forwards: 'Port forwards' };
let requestEpoch = 0, detailEpoch = 0;let sessionUI;
let state = { demo: false, forcedDemo: false, context: '', namespace: '*', view: 'overview', items: [], selected: null, selectedKind: '', tab: 'summary', generation: 0, detailGeneration: 0, streamGeneration: 0, logs: null, terminal: null, terminalInstance: null, loading: false, contexts: [], catalogue: [], dynamicResource: '', namespaceError: '', namespacesKnown: false, discoveryError: '', namespaces: [], namespaceNames: [], logText: '', historySettings: {}, initialized: false };
const escape = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const hidden = (id, hide) => $(id).classList.toggle('hidden', hide);
function notice(text = '', info = false) { $('notice').textContent = text; $('notice').classList.toggle('info', info); hidden('notice', !text); }
function error(e) { notice(e.message || String(e)); }
function age(date) {
  const ms = Math.max(0, Date.now() - new Date(date).getTime());
  if (!Number.isFinite(ms)) return '—';
  const m = Math.floor(ms / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}
function health(r) {
  const s = r.status || {}, spec = r.spec || {};
  if (r.kind === 'Pod') {
    const cs = s.containerStatuses || [];
    const reason = [...(s.initContainerStatuses || []), ...cs].map(c => c.state?.waiting?.reason || (c.state?.terminated?.exitCode ? c.state.terminated.reason : null)).find(Boolean);
    if (s.phase === 'Succeeded') return { label: 'Completed', tone: 'gray', ready: true };
    if (reason && !['ContainerCreating', 'PodInitializing'].includes(reason)) return { label: reason, tone: 'red', ready: false };
    if (s.phase === 'Running' && cs.length && cs.every(c => c.ready)) return { label: 'Running', tone: 'green', ready: true };
    return { label: reason || s.phase || 'Unknown', tone: s.phase === 'Failed' ? 'red' : 'yellow', ready: false };
  }
  if (r.kind === 'Node') return { label: s.conditions?.find(c => c.type === 'Ready')?.status === 'True' ? 'Ready' : 'Not ready', tone: s.conditions?.find(c => c.type === 'Ready')?.status === 'True' ? 'green' : 'red' };
  if (['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'ReplicationController'].includes(r.kind)) { const desired = spec.replicas ?? s.desiredNumberScheduled ?? 1, ready = s.readyReplicas ?? s.numberReady ?? 0; return { label: `${ready} / ${desired} ready`, tone: ready >= desired ? 'green' : 'yellow' }; }
  if (r.kind === 'Job') return { label: s.succeeded ? 'Completed' : s.failed ? 'Failed' : 'Running', tone: s.failed ? 'red' : s.succeeded ? 'gray' : 'green' };
  if (r.kind === 'CronJob') return { label: spec.suspend ? 'Suspended' : 'Scheduled', tone: spec.suspend ? 'gray' : 'green' };
  if (r.kind === 'Event') return { label: r.type || 'Normal', tone: r.type === 'Warning' ? 'yellow' : 'green' };
  if (r.kind === 'HorizontalPodAutoscaler') return { label: `${s.currentReplicas ?? '—'} → ${s.desiredReplicas ?? '—'} replicas`, tone: 'gray' };
  const phase = s.phase || '';
  return { label: phase || (r.kind === 'Service' ? spec.type || 'ClusterIP' : 'Not reported'), tone: /failed|lost|error/i.test(phase) ? 'red' : /pending|terminating|uninstalling/i.test(phase) ? 'yellow' : /running|active|bound|deployed/i.test(phase) || r.kind === 'Service' ? 'green' : 'gray' };
}
const pill = h => `<span class="pill ${h.tone}">${escape(h.label)}</span>`;
async function invoke(channel, data) {
  if (!window.eld90) throw new Error('Open el-d90 as a desktop app using npm start.');
  return window.eld90.invoke(channel, data);
}
async function list(kind) {
  const input = { context: state.context, namespace: state.namespace, namespaces: [...state.namespaces], resource: kind };
  if (!state.demo) return invoke('kube:list', input);
  if (!input.namespaces.length) return window.demoWorkspace.list(kind, '*');
  const all = window.demoWorkspace.list(kind, '*'); return {items:all.items.filter(r=>!r.metadata.namespace || input.namespaces.includes(r.metadata.namespace))};
}
function connection(label, connected = false) { state.connectionLabel=label; state.connected=connected; renderClusterTabs(); $('connection').innerHTML = `<span class="dot ${connected ? 'green' : 'muted'}"></span>${escape(label)}`; }
async function loadContexts() {
  try {
    const result = state.demo ? window.demoWorkspace.contexts : await invoke('kube:contexts');
    state.contexts = result.contexts;
    $('context').innerHTML = '<option value="">Choose a context…</option>' + result.contexts.map(c => `<option value="${escape(c.name)}">${escape(c.name)}</option>`).join('');
    // Connecting is deliberate: never query a real cluster merely on launch.
    if (state.demo) { $('context').value = result.current; await selectContext(result.current); }
    else { state.context = ''; connection(result.contexts.length ? `${result.contexts.length} contexts available` : 'No contexts found'); if (!result.contexts.length) notice('No kubeconfig contexts found. Add a context with kubectl or set KUBECONFIG, then reload contexts.', true); }
  } catch (e) { error(e); connection('kubectl unavailable'); }
}
async function stopStreams() {
  ++state.streamGeneration;
  const ids = [state.logs, state.terminal].filter(Boolean); state.logs = null; state.terminal = null;
  await Promise.all(ids.map(id => invoke('stream:stop', { id }).catch(() => {})));
}
async function closeDrawer() { state.detailGeneration = ++detailEpoch; state.selected = null; hidden('drawer', true); await stopStreams(); }
async function initializeContext(context) {
  await closeDrawer(); state.generation = ++requestEpoch;
  state.loading = false; hidden('busy', true);
  state.context = context; state.namespace = '*'; state.namespaces = []; state.namespaceError = ''; state.namespacesKnown = false; state.discoveryError = ''; state.catalogue = []; state.dynamicResource = ''; hidden('namespace-warning', true); hidden('namespace-manual', true); hidden('discovery-warning', true); $('namespace').innerHTML = '<option value="*">All namespaces</option>';
  $('breadcrumb-context').textContent = context || 'No cluster selected';
  notice();
  if (!context) { hidden('welcome', false); hidden('overview', true); hidden('resource-view', true); hidden('special-view', true); connection('Disconnected'); return; }
  connection(state.demo ? 'Demo · sample data' : 'Connecting…', state.demo);
  const selected = context;
  try {
    const namespaces = await list('namespaces');
    if (state.context !== selected) return;
    state.namespacesKnown = true; state.namespaceNames = (namespaces.items || []).map(n=>n.metadata.name); for (const n of namespaces.items || []) { const option = document.createElement('option'); option.value = n.metadata.name; option.textContent = n.metadata.name; $('namespace').append(option); }
    connection(state.demo ? 'Demo · sample data' : 'Connected', true);
  } catch (e) { if (state.context === selected) { state.namespaceError = `Namespace list unavailable: ${e.message}\nEnter a namespace below to browse resources allowed by your permissions.`; $('namespace-warning').textContent = state.namespaceError; hidden('namespace-warning', false); hidden('namespace-manual', false); } }
  if (state.context === selected) { await discoverResources(selected); if(state.context === selected) { state.initialized=true; await refresh(); saveWorkspacePreferences(); } }
}
function renderTable(target, items, kind, max = Infinity) {
  if(kind==='events'||kind?.startsWith('events.'))return renderEventsTable(target,items,max);
  const list = items.slice(0, max);
  if (!list.length) { $(target).innerHTML = '<div class="empty">No resources in this view.</div>'; return; }
  const extra = kind === 'pods' ? ['Ready', 'Restarts'] : kind === 'nodes' ? ['Kubelet', 'CPU capacity'] : kind === 'services' ? ['Cluster IP', 'Ports'] : kind === 'events' ? ['Reason', 'Message'] : ['Kind', 'Details'];
  $(target).innerHTML = `<table><thead><tr><th>Name</th><th>Namespace</th><th>Status</th><th>${extra[0]}</th><th>${extra[1]}</th><th>Age</th><th></th></tr></thead><tbody>${list.map((r, i) => {
    let a = r.kind, b = r.spec?.replicas !== undefined ? `${r.spec.replicas} desired replicas` : '—';
    if (kind === 'pods') { a = `${r.status?.containerStatuses?.filter(c => c.ready).length || 0}/${r.spec?.containers?.length || 0}`; b = (r.status?.containerStatuses || []).reduce((sum, c) => sum + (c.restartCount || 0), 0); }
    if (kind === 'nodes') { a = r.status?.nodeInfo?.kubeletVersion || '—'; b = r.status?.capacity?.cpu || '—'; }
    if (kind === 'services') { a = r.spec?.clusterIP || '—'; b = (r.spec?.ports || []).map(p => `${p.port}/${p.protocol}`).join(', '); }
    if (kind === 'helm') { a = r.release?.chart || '—'; b = `revision ${r.release?.revision || '—'} · app ${r.release?.app_version || '—'}`; }
    if (r.kind === 'Secret') { a = r.type || 'Opaque'; b = (r._dataKeys || r.dataKeys || []).join(', '); }
    if (kind === 'events') { a = r.reason || '—'; b = r.message || '—'; }
    return `<tr tabindex="0" role="button" aria-label="Open ${escape(r.metadata.name)}" data-index="${i}"><td class="resource-name"><span class="name-symbol">⬡</span>${escape(r.metadata.name)}</td><td>${escape(r.metadata.namespace || '—')}</td><td>${pill(health(r))}</td><td>${escape(a)}</td><td title="${escape(b)}">${escape(String(b).slice(0, 75))}</td><td class="subtle">${age(r.metadata.creationTimestamp)}</td><td>${kind==='nodes'?'<button class="node-shell-shortcut button secondary" type="button">Shell</button>':'<span class="table-action">↗</span>'}</td></tr>`;
  }).join('')}</tbody></table>`;
  $(target).querySelectorAll('tbody tr').forEach(row => { const open = () => openDetail(list[Number(row.dataset.index)], kind); row.onclick = open; row.onkeydown = e => { if (e.key === 'Enter') open(); }; });
  $(target).querySelectorAll('.node-shell-shortcut').forEach(button=>{button.onclick=async event=>{event.stopPropagation();const row=button.closest('tr');await openDetail(list[Number(row.dataset.index)],kind);await tab('terminal');};button.onkeydown=event=>event.stopPropagation();});
  window.elD90Productivity.enhanceTable($(target),{storageKey:kind,onExport:text=>invoke('file:save',{text})});
}
function renderOverview(results) {
  const [pods, deployments, nodes, events] = results.map(r => r.status === 'fulfilled' ? r.value.items || [] : []);
  const good = pods.filter(p => health(p).ready).length, pending = pods.filter(p => !health(p).ready && health(p).tone === 'yellow').length, errors = pods.filter(p => health(p).tone === 'red').length;
  const percent = pods.length ? Math.round(good / pods.length * 100) : 0;
  const readyDeploys = deployments.filter(d => health(d).tone === 'green').length;
  const readyNodes = nodes.filter(n => health(n).tone === 'green').length;
  const cards = [['Total pods', pods.length, `${good} healthy · ${pending + errors} need attention`, '⬡', percent], ['Deployments', deployments.length, `${readyDeploys} available`, '▤', deployments.length ? readyDeploys / deployments.length * 100 : 0], ['Cluster nodes', nodes.length, `${readyNodes} ready`, '▦', nodes.length ? readyNodes / nodes.length * 100 : 0], ['Namespaces', state.namespacesKnown ? $('namespace').options.length - 1 : '—', state.namespaces.length>1 ? `${state.namespaces.length} selected namespaces` : state.namespace === '*' ? 'Across your cluster' : `Viewing ${state.namespace}`, '▱', 100]];
  $('metrics').innerHTML = cards.map(([label, value, foot, icon, progress], i) => `<div class="metric"><div class="metric-top"><span>${label}</span><span class="metric-icon">${icon}</span></div><div class="metric-value">${results[i < 3 ? i : 0].status === 'rejected' && i < 3 ? '—' : value}</div><div class="metric-foot">${escape(i < 3 && results[i].status === 'rejected' ? 'Unavailable · request failed' : i === 3 && !state.namespacesKnown ? 'Unavailable · permission or connection' : foot)}</div><div class="metric-line"><i style="width:${i < 3 && results[i].status === 'rejected' ? 0 : progress}%"></i></div></div>`).join('');
  $('health-percent').textContent = pods.length ? `${percent}%` : '—'; $('health-ring').style.background = `conic-gradient(#afd6a5 0 ${percent}%,#35453c ${percent}% 100%)`;
  $('health-legend').innerHTML = [['Healthy', good, 'green'], ['Pending', pending, 'yellow'], ['Needs attention', errors, 'muted']].map(([label, n, tone]) => `<div class="legend-row"><span class="dot ${tone}"></span>${label}<b>${n}</b></div>`).join('');
  $('health-badge').textContent = errors ? 'Needs attention' : pending ? 'Progressing' : pods.length ? 'Healthy' : 'No pods'; $('health-badge').className = `pill ${errors || pending ? 'yellow' : 'green'}`;
  $('health-caption').textContent = `${good} of ${pods.length} pods ready or completed`;
  $('pods-count').textContent = pods.length;
  events.sort((a, b) => new Date(b.lastTimestamp || b.metadata.creationTimestamp) - new Date(a.lastTimestamp || a.metadata.creationTimestamp));
  $('activity').innerHTML = events.length ? events.slice(0, 4).map(e => `<div class="activity-item"><span class="activity-symbol">${e.type === 'Warning' ? '!' : '✓'}</span><div>${escape(e.reason || e.involvedObject?.name || 'Cluster event')}<p>${escape(e.message || '')}</p></div><time>${age(e.lastTimestamp || e.metadata.creationTimestamp)} ago</time></div>`).join('') : '<div class="empty">No recent events.</div>';
  renderTable('overview-table', pods, 'pods', 6);
  if (results[0].status === 'rejected') { $('health-badge').textContent = 'Unavailable'; $('health-badge').className = 'pill gray'; $('health-percent').textContent = '—'; $('health-caption').textContent = 'Pod readiness unavailable because the request failed'; $('health-legend').innerHTML = '<p>Request failed. Readiness is unknown.</p>'; $('pods-count').textContent = '—'; $('overview-table').innerHTML = '<div class="empty">Pods unavailable. See the request error above.</div>'; }
  if (results[3].status === 'rejected') $('activity').innerHTML = '<div class="empty">Events unavailable. See the request error above.</div>';
}
async function refresh() {
  if (!state.context) return;
  const generation = state.generation = ++requestEpoch; state.loading = true; hidden('busy', false);
  hidden('welcome', true); hidden('overview', state.view !== 'overview'); hidden('resource-view', state.view === 'overview' || SPECIAL_VIEWS.includes(state.view)); hidden('special-view', !SPECIAL_VIEWS.includes(state.view)); hidden('api-resource-picker', state.view !== 'resources');
  try {
    if (state.view === 'overview') {
      const results = await Promise.allSettled(['pods', 'deployments', 'nodes', 'events'].map(list));
      if (generation !== state.generation) return;
      state.overviewResults=results; renderOverview(results);
      const failures = results.map((r, i) => r.status === 'rejected' ? `${['Pods', 'Deployments', 'Nodes', 'Events'][i]}: ${r.reason.message}` : null).filter(Boolean);
      if (failures.length) notice(failures.join('\n')); else if (!state.demo) notice();
      connection(state.demo ? 'Demo · sample data' : failures.length === 4 ? 'Connection failed' : failures.length || state.namespaceError ? 'Connected · partial data' : 'Connected', failures.length < 4);
    } else if (SPECIAL_VIEWS.includes(state.view)) {
      await renderSpecial(generation);
    } else {
      const kind = activeResource(); if (!kind) { $('resource-table').innerHTML = '<div class="empty">No discoverable listable resources. See API discovery status above.</div>'; return; }
      const result = await list(kind);
      if (generation !== state.generation) return;
      state.items = result.items || []; syncSelectedResource(state,kind,state.items); state.listWarnings=result.warnings || []; filterTable(); if (state.listWarnings.length) notice(state.listWarnings.join('\n')); else if (!state.demo) notice(); connection(state.demo ? 'Demo · sample data' : state.namespaceError || state.listWarnings?.length ? 'Connected · partial data' : 'Connected', true);
    }
    if(generation!==state.generation)return;
    await syncWorkspaceWatches(state);if(generation!==state.generation)return;
    $('updated').textContent = `${state.demo ? 'Sample data · ' : ''}Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) { if (generation === state.generation) { error(e); connection('Request failed'); if (SPECIAL_VIEWS.includes(state.view)) $('special-content').innerHTML = '<div class="empty">This view is unavailable. See the request error above.</div>'; $('resource-table').innerHTML = '<div class="empty">Unable to load resources. Check the connection message above.</div>'; } }
  finally { if (generation === state.generation) { state.loading = false; hidden('busy', true); } }
}
function filterTable() {
  const query = $('search').value.trim().toLowerCase();
  const eventView=activeResource()==='events'||activeResource()?.startsWith('events.');const items = state.items.filter(r => eventView?window.elD90Events.matches(r,query):`${r.metadata.name} ${r.metadata.namespace || ''}`.toLowerCase().includes(query));
  $('resource-count').textContent = `${items.length} resource${items.length === 1 ? '' : 's'}`; renderTable('resource-table', items, activeResource());
}
async function navigate(view) {
  document.querySelector('main').scrollTop=0;state.view = view;state.viewTabs=[...new Set([...(state.viewTabs||['overview']),view])].slice(-16);renderViewTabs(); $('page-title').innerHTML = `${escape(titles[view] || view)}<span class="heading-dot">.</span>`;
  $('eyebrow').textContent = view === 'overview' ? 'YOUR CLUSTER, AT A GLANCE' : 'EXPLORE YOUR CLUSTER';
  $('page-description').textContent = view === 'overview' ? 'A clear view of everything running in your cluster.' : `Inspect ${(titles[view] || view).toLowerCase()}, view manifests, and work in context.`;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('search').value = ''; await closeDrawer(); saveWorkspacePreferences(); if (state.context) await refresh();
}
async function openDetail(object, kind, restoring = false) {
  if (!restoring) await closeDrawer(); state.originalYaml='';editorTools?.clear();state.isCreating=false; hidden('create-controls',true);state.selected = structuredClone(object); state.selectedKind = kind;
  $('detail-kind').textContent = object.kind; $('detail-name').textContent = object.metadata.name; $('detail-scope').textContent = `${state.context} / ${object.metadata.namespace || 'cluster scoped'}`;
  const rows = [['Name', object.metadata.name], ['Namespace', object.metadata.namespace || 'Cluster scoped'], ['Status', health(object).label], ['Created', object.metadata.creationTimestamp], ['UID', object.metadata.uid || '—'], ['Node', object.spec?.nodeName || '—'], ['IP', object.status?.podIP || object.spec?.clusterIP || '—']];
  $('detail-summary').innerHTML = `<dl>${rows.map(([a, b]) => `<dt>${a}</dt><dd data-summary-field="${escape(a.toLowerCase())}">${escape(b)}</dd>`).join('')}</dl><h3>Labels</h3>${Object.entries(object.metadata.labels || {}).map(([k, v]) => `<span class="tag">${escape(k)}=${escape(v)}</span>`).join('') || '<p>No labels</p>'}<h3>Containers</h3>${(object.spec?.containers || object.spec?.template?.spec?.containers || []).map(c => `<dl><dt>${escape(c.name)}</dt><dd>${escape(c.image)}</dd></dl>`).join('') || '<p>No workload containers reported</p>'}`;
  const containers=object.spec?.containers || object.spec?.template?.spec?.containers || [];
  for (const id of ['log-container', 'terminal-container']) $(id).innerHTML = (id==='log-container' && kind==='deployments'?'<option value="*">All containers</option>':'')+containers.map(c => `<option value="${escape(c.name)}">${escape(c.name)}</option>`).join('');
  document.querySelector('[data-tab="logs"]').disabled = !['pods','deployments'].includes(kind); document.querySelector('[data-tab="terminal"]').disabled = !['pods','nodes'].includes(kind);
  document.querySelector('[data-tab="forward"]').disabled = !['pods', 'services'].includes(kind);
  document.querySelector('[data-tab="events"]').disabled=!object.metadata.uid||kind==='helm';
  document.querySelector('[data-tab="yaml"]').disabled = false;document.querySelector('[data-tab="node-access"]').classList.toggle('hidden',kind!=='nodes');
  $('apply-yaml').disabled = $('validate-yaml').disabled = kind === 'helm'; $('yaml-editor').readOnly = kind === 'helm'; $('forward-result').textContent = ''; $('forward-remote').value = String(object.spec?.ports?.[0]?.port || object.spec?.containers?.[0]?.ports?.[0]?.containerPort || 80);
  $('open-terminal-session').classList.toggle('hidden',kind!=='pods');
  $('logs-scope').textContent=kind==='deployments'?'All replica pods · pod/container prefixes · new replicas followed · initial 300 lines per pod':'Pod container logs · initial 300 lines';
  if(object.kind==='Event'){const ev=window.elD90Events.normalize(object);$('detail-summary').innerHTML='<dl>'+Object.entries(ev).map(([k,v])=>`<dt>${escape(k)}</dt><dd class="event-message">${escape(v)}</dd>`).join('')+'</dl>';}
  addResourceActions(object, kind); if(kind!=='helm')addManagementActions(object,kind);if(kind==='nodes'){const owner=state,epoch=state.detailGeneration;window.elD90Nodes.render($('detail-node-access'),{node:object,context:owner.context,namespace:owner.namespaces.length===1?owner.namespaces[0]:'',demo:owner.demo,invoke,isCurrent:()=>state===owner&&state.detailGeneration===epoch,onSession:result=>acceptNodeSession(owner,object,result,epoch)});}
  $('yaml-editor').value = restoring ? state.yamlDraft || '' : ''; $('yaml-result').textContent = ''; $('logs-output').textContent = restoring ? state.logText || '' : ''; hidden('drawer', false); await tab(restoring ? state.savedTab || 'summary' : 'summary', restoring);
}
function detailInput() { const r = state.selected; if (!r) throw new Error('No resource selected'); return { context: state.context, namespace: r.metadata.namespace || state.namespace, resource: state.selectedKind, name: r.metadata.name }; }
async function tab(value, restoring = false) {
  state.tab = value; document.querySelectorAll('.detail-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === value));
  for (const t of ['summary', 'yaml', 'logs', 'terminal', 'forward','node-access','events']) hidden(`detail-${t}`, value !== t);
  if (value === 'yaml' && !$('yaml-editor').value) {
    const generation = state.detailGeneration;
    try { const text = state.demo ? window.demoWorkspace.yaml(state.selected) : await invoke(state.selectedKind === 'helm' ? 'helm:manifest' : 'kube:yaml', detailInput()); if (generation === state.detailGeneration){$('yaml-editor').value = text;state.originalYaml=text;} } catch (e) { error(e); }
  }
  if(value==='summary')syncSelectedResource(state,state.selectedKind,state.items);
  if(value==='events')await loadResourceEvents();
  if (value === 'logs' && (!restoring || !state.logs)) await startLogs();
  if (value === 'terminal') {const node=state.selectedKind==='nodes';$('terminal-container').classList.toggle('hidden',node);$('terminal-shell').classList.toggle('hidden',node);hidden('node-shell-options',!node);$('connect-terminal').textContent=node?'Open node shell':'Connect shell';document.querySelector('.terminal-hint').textContent=node?'Node shell through Kubernetes. No SSH configuration required. Closing the terminal cleans up its temporary Pod.':'Interactive shell in this pod. Commands use the pod permissions.';initTerminal();}
}
async function startLogs() {
  const owner = state; const request={...detailInput(),container:$('log-container').value,previous:$('previous-logs').checked};
  const generation = ++state.streamGeneration;
  if (state.logs) { const id = state.logs; state.logs = null; await invoke('stream:stop', { id }).catch(() => {}); }
  $('logs-output').textContent = ''; owner.logText='';
  if (state.demo) { $('logs-output').textContent = `[DEMO · no cluster connection]\n${owner.selectedKind==='deployments'?'[pod/api-7d9-a/web] ':''}${new Date().toISOString()} INFO Server listening on :8080\n${owner.selectedKind==='deployments'?'[pod/api-7d9-b/web] ':''}${new Date().toISOString()} INFO Health check passed\n${new Date().toISOString()} INFO GET /api/v1/health 200 3ms\n\nSelect a real context to stream live pod logs.`; return; }
  try {
    const id = await invoke('logs:start', request);
    if (generation !== owner.streamGeneration) await invoke('stream:stop', { id }); else owner.logs = id;
  } catch (e) { owner.logText=e.message;if(state===owner)$('logs-output').textContent=e.message; }
}
function initTerminal() {
  if (state.terminalInstance) return;
  const term = new Terminal({ cols: 100, rows: 28, fontFamily: 'Menlo, monospace', fontSize: 11, cursorBlink: true, scrollback: 4000, theme: { background: '#101719', foreground: '#c4d6c9', cursor: '#c1edb7', selectionBackground: '#45634b' } });
  const owner = state; const host=document.createElement('div');host.className='workspace-terminal';owner.terminalHost=host;$('terminal').append(host);term.open(host);const fit=new FitAddon.FitAddon();term.loadAddon(fit);owner.fitAddon=fit;owner.resizeObserver=new ResizeObserver(()=>{if(host.offsetWidth>0)fit.fit();});owner.resizeObserver.observe(host);term.onResize(size=>{if(owner.terminal)invoke('terminal:resize',{id:owner.terminal,cols:Math.max(20,Math.min(400,size.cols)),rows:Math.max(5,Math.min(200,size.rows))}).catch(()=>{});});requestAnimationFrame(()=>fit.fit()); term.writeln(state.selectedKind==='nodes'?'el-d90 node terminal\r\nClick Open node shell to connect through Kubernetes.\r\n':'el-d90 pod terminal\r\nSelect a container and click Connect shell.\r\n');
  term.onData(data => { if (owner.terminal) invoke('terminal:write', { id: owner.terminal, data }).catch(error); }); state.terminalInstance = term;if(owner.terminalBuffer)term.write(owner.terminalBuffer);
}
async function connectTerminal() {
  initTerminal();
  if(state.selectedKind==='nodes'){if(state.demo){state.terminalInstance.writeln('[Demo: no node shell or Pod created.]');return;}const owner=state,node=state.selected,epoch=state.detailGeneration,button=$('connect-terminal');button.disabled=true;try{const result=await invoke('node:debug-start',{context:owner.context,nodeName:node.metadata.name,namespace:$('node-shell-namespace').value.trim(),image:$('node-shell-image').value.trim(),hostShell:true});if(!result.cancelled)await acceptNodeSession(owner,node,result,epoch);else owner.terminalInstance?.writeln('[Node shell cancelled.]');}catch(e){owner.terminalInstance?.writeln(e.message);}finally{button.disabled=false;}return;}
  if (state.demo) { state.terminalInstance.writeln('\r\n[Demo mode: no shell is connected.]'); return; }
  const request={...detailInput(),container:$('terminal-container').value,shell:$('terminal-shell').value};const currentOwner=state;
  if (state.terminal) await invoke('stream:stop', { id: state.terminal });
  const owner=currentOwner; const generation = owner.detailGeneration; owner.terminalInstance.clear();owner.terminalBuffer='';
  try { const id = await invoke('terminal:start', request); if (generation !== owner.detailGeneration) await invoke('stream:stop', { id }); else { owner.terminal = id;if(state===owner){owner.fitAddon?.fit();owner.terminalInstance.focus();}await invoke('terminal:resize',{id,cols:Math.max(20,Math.min(400,owner.terminalInstance.cols)),rows:Math.max(5,Math.min(200,owner.terminalInstance.rows))}); } } catch (e) { owner.terminalInstance.writeln(e.message); }
}
async function editYaml(apply) {
  if (state.selectedKind === 'helm') return;
  if (!state.context) return notice('Choose a context before editing resources.', true);
  if (state.demo) { $('yaml-result').textContent = 'Demo mode: manifest changes are not sent to any cluster.'; return; }
  const generation = state.detailGeneration;
  const button = $(apply ? 'apply-yaml' : 'validate-yaml'); button.disabled = true;
  $('yaml-result').textContent = apply ? 'Waiting for confirmation…' : 'Validating with the Kubernetes API…';
  try { const result = await invoke(apply ? 'kube:apply' : 'kube:validate', { context: state.context, namespace: state.isCreating ? ($('create-namespace').value || '*') : state.selected?.metadata.namespace || state.namespace, yaml: $('yaml-editor').value }); if (generation === state.detailGeneration) $('yaml-result').textContent = result.cancelled ? 'Apply cancelled.' : typeof result === 'string' ? result : result.output; if (apply && !result.cancelled) await refresh(); } catch (e) { if (generation === state.detailGeneration) $('yaml-result').textContent = e.message; } finally { button.disabled = false; }
}
async function createResource(restoring = false) {
  if (!state.context) { notice('Choose a context or explore the demo first.', true); return; }
  if(!restoring)await closeDrawer(); state.isCreating=true; state.selected = null; state.selectedKind = ''; $('apply-yaml').disabled = $('validate-yaml').disabled = false; $('yaml-editor').readOnly = false; document.querySelector('[data-tab="yaml"]').disabled = false; document.querySelector('[data-tab="forward"]').disabled = true; $('detail-kind').textContent = 'CREATE RESOURCE'; $('detail-name').textContent = 'A new beginning.'; $('detail-scope').textContent = state.context;
  document.querySelector('[data-tab="logs"]').disabled = true; document.querySelector('[data-tab="terminal"]').disabled = true;document.querySelector('[data-tab="node-access"]').classList.add('hidden');
  document.querySelector('[data-tab="events"]').disabled=true;
  $('detail-summary').textContent = 'Create any Kubernetes resource from YAML. Validate first, then apply.';hidden('create-controls',false);setupCreateControls(restoring);
  $('yaml-editor').value = restoring ? state.yamlDraft || '' : `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: example-config\n  namespace: ${$('create-namespace').value || 'default'}\ndata:\n  greeting: hello\n`; $('yaml-result').textContent = ''; state.originalYaml='';editorTools?.clear();hidden('drawer', false); await tab('yaml');
}
async function toggleDemo() {
  if(state.forcedDemo)return notice('This preview was launched in demo mode. Open el-d90 normally to use real contexts.',true);
  storeWorkspaceUI();if(state.context)clusterWorkspaces.set(workspaceKey(state.context),state);const demo=!state.demo;state=freshWorkspace('',demo);state.generation=++requestEpoch;paintWorkspace();
  $('mode-badge').textContent=demo?'DEMO':'LOCAL';$('workspace-mode').textContent=demo?'Sample workspace':'kubectl workspace';$('demo-toggle').textContent=demo?'Return to my contexts ↗':'Explore demo workspace ↗';
  hidden('overview',true);hidden('resource-view',true);hidden('special-view',true);hidden('welcome',false);await loadContexts();renderClusterTabs();
}
$('resource-type').onchange = () => { state.dynamicResource = $('resource-type').value; updateResourceInfo(); refresh(); };
$('use-namespace').onclick = async () => { const value = $('namespace-input').value.trim(); if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) return notice('Enter a valid namespace name.'); if (![...$('namespace').options].some(o => o.value === value)) $('namespace').add(new Option(value, value)); state.namespaceNames=[...new Set([...state.namespaceNames,value])]; await setNamespaceSelection([value]); };
$('start-forward').onclick = startForward; $('show-forwards').onclick = () => { closeDrawer(); navigate('forwards'); };
$('context').onchange = () => selectContext($('context').value);
$('namespace').onchange = () => setNamespaceSelection($('namespace').value === '*' ? [] : [$('namespace').value]);
$('navigation').onclick = e => { const b = e.target.closest('[data-view]'); if (b) navigate(b.dataset.view); };
$('reload-contexts').onclick = async () => {try{const result=state.demo?window.demoWorkspace.contexts:await invoke('kube:contexts');for(const w of clusterWorkspaces.values())w.contexts=result.contexts;state.contexts=result.contexts;$('context').innerHTML='<option value="">Choose a context…</option>'+result.contexts.map(c=>`<option value="${escape(c.name)}">${escape(c.name)}</option>`).join('');$('context').value=state.context;if(state.context){await discoverResources(state.context);await refresh();}renderClusterTabs();}catch(e){error(e);}};
$('refresh').onclick = refresh; $('search').oninput = filterTable;
$('view-pods').onclick = $('all-workloads').onclick = () => navigate('pods'); $('view-events').onclick = () => navigate('events');
$('demo-toggle').onclick = $('welcome-demo').onclick = toggleDemo;
$('close-drawer').onclick = closeDrawer;
document.querySelector('.detail-tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b && !b.disabled) tab(b.dataset.tab); };
$('new-yaml').onclick = () => createResource(); $('validate-yaml').onclick = () => editYaml(false); $('apply-yaml').onclick = () => editYaml(true);
$('restart-logs').onclick = $('log-container').onchange = $('previous-logs').onchange = startLogs;
$('save-logs').onclick = () => invoke('file:save', { text: $('logs-output').textContent }).catch(error);
$('connect-terminal').onclick = connectTerminal;
$('yaml-editor').onkeydown = e => { if (e.key === 'Tab') { e.preventDefault(); const t = e.target, start = t.selectionStart, end = t.selectionEnd; t.setRangeText('  ', start, end, 'end'); } };
document.addEventListener('keydown', e => {if((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key.toLowerCase()==='p'){e.preventDefault();openCommandPalette();return;} if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (state.view === 'overview' || SPECIAL_VIEWS.includes(state.view)) navigate('pods').then(() => $('search').focus()); else $('search').focus(); } if(e.key==='Escape'){if(!$('namespace-popover').classList.contains('hidden')){hidden('namespace-popover',true);$('namespace-multi').setAttribute('aria-expanded','false');}else closeDrawer();} });
window.eld90?.onStream(message => {
  const owner=[...clusterWorkspaces.values()].find(w=>w.logs===message.id || w.terminal===message.id) || (state.logs===message.id || state.terminal===message.id ? state:null);
  if(!owner) return;
  if(message.id===owner.logs) {owner.logText=((owner.logText||'')+message.data).slice(-1000000);if(owner===state){const pre=$('logs-output'),nearEnd=pre.scrollHeight-pre.scrollTop-pre.clientHeight<80;pre.textContent=owner.logText;if(nearEnd)pre.scrollTop=pre.scrollHeight;}if(message.ended)owner.logs=null;}
  if(message.id===owner.terminal){owner.terminalBuffer=((owner.terminalBuffer||'')+message.data).slice(-1000000);owner.terminalInstance?.write(message.data);if(message.ended)owner.terminal=null;}
});

(async () => { try { const info = await invoke('app:info'); document.querySelector('.version').textContent='LOCAL FIRST · v'+info.version; if (info.demo) { state.forcedDemo = true; state.demo = true; $('mode-badge').textContent = 'DEMO'; $('workspace-mode').textContent = 'Sample workspace'; notice('Demo workspace · sample resources. No connection to your clusters.', true); } await loadContexts(); if(!state.demo) await restoreWorkspacePreferences(); } catch (e) { error(e); } })();

function activeResource() { return state.view === 'resources' ? state.dynamicResource : state.view; }
async function discoverResources(context) {
  try {
    const result = state.demo ? window.demoWorkspace.discovery() : await invoke('kube:discover', { context });
    if (state.context !== context) return;
    state.catalogue = result.resources || [];
    state.dynamicResource = state.catalogue.find(r => !Object.hasOwn(titles, r.key))?.key || state.catalogue[0]?.key || '';
    $('resource-type').innerHTML = state.catalogue.map(r => `<option value="${escape(r.key)}">${escape(r.title || r.kind || r.key)} · ${escape(r.apiVersion || 'core')}</option>`).join('');
    $('resource-type').value = state.dynamicResource; updateResourceInfo();
    if (result.warnings?.length) { $('discovery-warning').textContent = `API discovery is partial: ${result.warnings.join('\n')}`; hidden('discovery-warning', false); }
  } catch (e) {
    if (state.context !== context) return;
    state.discoveryError = e.message;
    $('discovery-warning').textContent = `API discovery unavailable: ${e.message}\nBuilt-in resource views remain available.`; hidden('discovery-warning', false);
  }
}
function updateResourceInfo() {
  const r = state.catalogue.find(r => r.key === state.dynamicResource);
  $('api-resource-info').textContent = r ? `${r.key} · ${r.namespaced ? 'Namespaced' : 'Cluster scoped'} · ${(r.verbs || []).join(', ')}` : 'No resource selected';
}
function metricNumber(value, type) {
  const text = String(value ?? '0'); const amount = parseFloat(text); if (!Number.isFinite(amount)) return 0;
  if (type === 'cpu') return text.endsWith('n') ? amount / 1e9 : text.endsWith('u') ? amount / 1e6 : text.endsWith('m') ? amount / 1000 : amount;
  const units = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1000, M: 1e6, G: 1e9 };
  return amount * (units[text.replace(/^[\d.]+/, '')] || 1);
}
function metricTable(items, pods) {
  if (!items?.length) return '<div class="empty">No metrics samples returned.</div>';
  return `<table><thead><tr><th>Name</th><th>Namespace</th><th>CPU · cores</th><th>Memory · MiB</th><th>Sample window</th></tr></thead><tbody>${items.map(r => {
    const uses = pods ? (r.containers || []).map(c => c.usage || {}) : [r.usage || {}];
    return `<tr><td class="resource-name">${escape(r.metadata.name)}</td><td>${escape(r.metadata.namespace || '—')}</td><td>${uses.reduce((n, u) => n + metricNumber(u.cpu, 'cpu'), 0).toFixed(3)}</td><td>${(uses.reduce((n, u) => n + metricNumber(u.memory, 'memory'), 0) / 1024 ** 2).toFixed(1)}</td><td>${escape(r.window || '—')}</td></tr>`;
  }).join('')}</tbody></table>`;
}
async function renderSpecial(generation) {
  const view = state.view;
  $('special-content').innerHTML = '<div class="empty">Loading…</div>';
  if(view==='applications'){const owner=state;await window.elD90Topology.render($('special-content'),{context:owner.context,namespace:owner.namespace,namespaces:[...owner.namespaces],demo:owner.demo,invoke,isCurrent:()=>state===owner&&state.generation===generation,onOpenResource:ref=>openRelatedResource(owner,ref)});}
  else if(view==='node-sessions'){await renderNodeSessions(generation);}
  else if(API_VIEWS[view]){await renderApiFamily(view,generation);}
  else if (view === 'metrics') {
    const result = state.demo ? window.demoWorkspace.metrics('*') : await invoke('kube:metrics', { context: state.context, namespace: state.namespace, namespaces: [...state.namespaces] });
    if (generation !== state.generation) return;
    if(state.demo && state.namespaces.length && result.pods)result.pods.items=result.pods.items.filter(r=>state.namespaces.includes(r.metadata.namespace));
    $('special-content').innerHTML = `<div class="feature-description">Current CPU and memory usage from the Kubernetes Metrics API. This view shows snapshots, not historical Prometheus charts.${state.demo ? ' DEMO · sample data.' : ''}</div>${(result.errors || []).map(e => `<div class="notice">${escape(e)}</div>`).join('')}<h2 class="special-heading">Pod metrics</h2><div class="panel table-panel">${result.pods ? metricTable(result.pods.items, true) : '<div class="empty">Pod metrics unavailable. Metrics Server and read permission are required.</div>'}</div><h2 class="special-heading">Node metrics</h2><div class="panel table-panel">${result.nodes ? metricTable(result.nodes.items, false) : '<div class="empty">Node metrics unavailable. Metrics Server and read permission are required.</div>'}</div>`;
    const owner=state;const chartHost=document.createElement('div');chartHost.id='historical-metrics';$('special-content').prepend(chartHost);
    await window.elD90History.render(chartHost,{context:owner.context,namespace:owner.namespace,namespaces:[...owner.namespaces],demo:owner.demo,invoke,isCurrent:()=>state===owner && state.generation===generation,settings:owner.historySettings,onSettings:value=>{owner.historySettings=value;saveWorkspacePreferences();}});
  } else if (view === 'helm') {
    const releases = state.demo ? window.demoWorkspace.helm() : await invoke('helm:list', { context: state.context, namespace: state.namespace, namespaces: [...state.namespaces] });
    if (generation !== state.generation) return;
    const visibleReleases=state.namespaces.length?releases.filter(r=>state.namespaces.includes(r.namespace)):releases;
    $('special-content').innerHTML = '<div class="feature-description">Release versions, manifests, chart installation and upgrades. Each change keeps its explicit cluster and release namespace.</div><div id="helm-operation-history"></div><div id="helm-tools"></div><div class="panel table-panel" id="helm-table"></div>';
    const owner=state;await window.elD90Helm.renderTools($('helm-tools'),{context:owner.context,namespace:owner.namespace,namespaces:owner.namespaceNames,demo:owner.demo,invoke,isCurrent:()=>state===owner && state.generation===generation});restoreHelmDrafts(owner);
    const jobs=owner.demo?[]:await invoke('helm:operations',{context:owner.context});if(state!==owner||state.generation!==generation)return;if(jobs.length)$('helm-operation-history').innerHTML='<h2 class="special-heading">Recent operations</h2>'+jobs.slice().reverse().map(job=>`<details class="workflow-panel"><summary>${escape(job.operation)} ${escape(job.namespace)}/${escape(job.name)} · ${escape(job.state)}</summary><pre>${escape(job.output || 'Still running. The operation remains attached to this cluster.')}</pre></details>`).join('');
    renderTable('helm-table', visibleReleases.map(r => ({ kind: 'HelmRelease', apiVersion: 'helm.sh/v3', metadata: { name: r.name, namespace: r.namespace, creationTimestamp: r.updated }, spec: { chart: r.chart, appVersion: r.app_version }, status: { phase: r.status }, release: r })), 'helm');
  } else if (view === 'forwards') {
    const forwards = state.demo ? [] : await invoke('forward:list');
    if (generation !== state.generation) return;
    $('special-content').innerHTML = '<div class="feature-description">Local connections bound to 127.0.0.1. Start a forward from a pod or service detail panel. Connections remain active across resource and context changes until stopped or the app quits.</div><div class="panel table-panel">' + (forwards.length ? `<table><thead><tr><th>Resource</th><th>Context / namespace</th><th>Local address</th><th>Remote port</th><th>Status</th><th></th></tr></thead><tbody>${forwards.map(f => `<tr><td>${escape(f.name)}</td><td title="${escape(f.context)}">${escape(f.namespace)}<br><span class="subtle">${escape(f.context)}</span></td><td>127.0.0.1:${Number(f.localPort)}</td><td>${Number(f.remotePort)}</td><td><span class="pill ${f.state === 'ready' || f.state === 'running' ? 'green' : 'yellow'}">${escape(f.state)}</span><pre class="forward-output">${escape(f.output || '')}</pre></td><td><button class="button secondary stop-forward" data-forward-id="${escape(f.id)}">Stop</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No active port forwards.</div>') + '</div>';
    document.querySelectorAll('.stop-forward').forEach(button => button.onclick = async () => { try { button.disabled = true; await invoke('forward:stop', { id: button.dataset.forwardId }); await refresh(); } catch (e) { error(e); } });
  }
  if(generation!==state.generation)return;
  if (!state.demo) { notice(); connection(state.namespaceError || state.listWarnings?.length ? 'Connected · partial data' : 'Connected', true); }
}
function addResourceActions(object, kind) {
  if (object.release) {
    $('detail-summary').innerHTML = `<dl>${[['Release', object.metadata.name], ['Chart', object.release.chart], ['Application version', object.release.app_version], ['Revision', object.release.revision], ['Status', object.release.status], ['Updated', object.release.updated]].map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v || '—')}</dd>`).join('')}</dl><p>Open YAML to inspect the rendered release manifest. Use the controls below to preview an upgrade or manage release history.</p><div id="helm-release-tools"></div>`;
    const owner=state,generation=state.detailGeneration;window.elD90Helm.openRelease($('helm-release-tools'),{release:object.release,context:owner.context,namespace:object.metadata.namespace,namespaces:owner.namespaceNames,demo:owner.demo,invoke,isCurrent:()=>state===owner && state.detailGeneration===generation}).then(()=>{if(state===owner)restoreHelmDrafts(owner);}).catch(e=>{if(state===owner)error(e);});
    return;
  }
  if (object.kind === 'Secret') {
    const keys = object._dataKeys || object.dataKeys || [];
    $('detail-summary').insertAdjacentHTML('beforeend', `<h3>Secret keys</h3><p>Values are excluded from resource lists. Open YAML to request the manifest with a native reveal confirmation.</p>${keys.map(key => `<span class="tag">${escape(key)}</span>`).join('') || '<p>No key metadata returned.</p>'}`);
  }
  const conditionRows = (object.status?.conditions || []).map(c => `<tr><td>${escape(c.type)}</td><td>${escape(c.status)}</td><td>${escape(c.reason || '')}</td><td>${escape(c.message || '')}</td></tr>`).join('');
  if (conditionRows) $('detail-summary').insertAdjacentHTML('beforeend', `<h3>Conditions</h3><div class="panel table-panel"><table><thead><tr><th>Type</th><th>Status</th><th>Reason</th><th>Message</th></tr></thead><tbody>${conditionRows}</tbody></table></div>`);
  if (['deployments', 'statefulsets', 'daemonsets', 'replicasets', 'replicationcontrollers'].includes(kind)) {
    const scale = kind !== 'daemonsets' ? `<label>Replicas<input id="scale-replicas" type="number" min="0" max="10000" value="${Number(object.spec?.replicas ?? 1)}" aria-label="Desired replicas"></label><button id="scale-resource" class="button secondary">Scale workload</button>` : '';
    $('detail-summary').insertAdjacentHTML('beforeend', `<h3>Workload actions</h3><div class="workload-actions">${scale}${['deployments', 'statefulsets', 'daemonsets'].includes(kind) ? '<button id="restart-resource" class="button secondary">Restart rollout</button>' : ''}</div><pre id="action-result" role="status"></pre>`);
    if ($('scale-resource')) $('scale-resource').onclick = () => workloadAction('scale');
    if ($('restart-resource')) $('restart-resource').onclick = () => workloadAction('restart');
  }
}
async function workloadAction(action) {
  const owner=state;
  if (owner.demo) { $('action-result').textContent = 'Demo mode: no workload changes are sent to a cluster.'; return; }
  if(owner.workloadPending)return;
  const generation=owner.detailGeneration,request={...detailInput(),action,...(action==='scale'?{replicas:Number($('scale-replicas').value)}:{})};owner.workloadPending=true;
  try {
    $('action-result').textContent='Waiting for confirmation…';
    const result=await invoke('kube:action',request);
    if(state===owner&&generation===owner.detailGeneration)$('action-result').textContent=result.cancelled?'Action cancelled.':result.output;
    if(!result.cancelled&&state===owner)await refresh();
    else if(!result.cancelled)owner.watchDirty=true;
  }catch(e){if(state===owner&&generation===owner.detailGeneration)$('action-result').textContent=e.message;}
  finally{owner.workloadPending=false;}
}
function syncSelectedResource(owner,kind,items){
 const selected=owner.selected;if(!selected?.metadata?.uid||owner.selectedKind!==kind)return;
 const fresh=items.find(item=>item.metadata?.uid===selected.metadata.uid&&item.metadata?.namespace===selected.metadata.namespace);
 if(!fresh)return;owner.selected=structuredClone(fresh);
 if(state!==owner)return;
 const status=$('detail-summary').querySelector('[data-summary-field="status"]');if(status)status.textContent=health(fresh).label;
 const replicas=$('scale-replicas');if(replicas&&!owner.workloadPending&&document.activeElement!==replicas)replicas.value=String(fresh.spec?.replicas??1);
}

async function startForward() {
  if (state.demo) { $('forward-result').textContent = 'Demo mode: no local port is opened.'; return; }
  const generation = state.detailGeneration;
  try {
    $('start-forward').disabled = true;
    const result = await invoke('forward:start', { ...detailInput(), localPort: Number($('forward-local').value), remotePort: Number($('forward-remote').value) });
    if (generation === state.detailGeneration) $('forward-result').textContent = `Forward requested at 127.0.0.1:${result.localPort}. Open Port forwards to check readiness or stop the connection.`;
  } catch (e) { if (generation === state.detailGeneration) $('forward-result').textContent = e.message; }
  finally { $('start-forward').disabled = false; }
}

// Workspaces hold independent state and process ownership for each connected context.
const clusterWorkspaces = new Map();
const workspaceTemplate = structuredClone(state);
const workspaceKey = (context, demo=state.demo) => `${demo?'demo':'live'}:${context}`;
function freshWorkspace(context, demo=state.demo) {
  return {...structuredClone(workspaceTemplate),context,demo,forcedDemo:state.forcedDemo,contexts:state.contexts,namespaces:[],namespaceNames:[],historySettings:{},logText:'',generation:++requestEpoch,detailGeneration:++detailEpoch,streamGeneration:0};
}
function shortContext(context) {return context.split('/').at(-1);}
function storeWorkspaceUI(owner=state) {
  if(!owner.context) return;
  owner.search=$('search').value;owner.autoRefresh=$('auto-refresh').checked;
  owner.drawerVisible=!$('drawer').classList.contains('hidden');if(owner.drawerVisible)owner.yamlDraft=$('yaml-editor').value;owner.savedTab=owner.tab;
  owner.helmDraft=captureHelmDrafts();owner.logContainer=$('log-container').value;owner.terminalContainer=$('terminal-container').value;owner.scroll=document.querySelector('main').scrollTop;
}
function saveWorkspacePreferences() {
  if(state.demo)return;
  try {localStorage.setItem('el-d90-workspaces-v1',JSON.stringify({active:state.context,workspaces:[...clusterWorkspaces.values()].filter(w=>!w.demo).map(w=>({context:w.context,namespaces:w.namespaces,view:w.view,historySettings:w.historySettings,autoRefresh:w.autoRefresh || false}))}));}catch{}
}
function renderClusterTabs() {
  const host=$('cluster-tabs');if(!host)return;
  host.innerHTML=[...clusterWorkspaces.values()].filter(w=>w.demo===state.demo).map(w=>`<div class="cluster-tab ${w===state?'selected':''}"><button class="cluster-tab-select" role="tab" aria-selected="${w===state}" data-context="${escape(w.context)}" title="${escape(w.context)}"><span class="dot ${w.connected?'green':'muted'}"></span>${escape(shortContext(w.context))}<small>${escape(w.connectionLabel || 'Connecting')}</small></button><button class="cluster-tab-close" data-context="${escape(w.context)}" aria-label="Disconnect ${escape(shortContext(w.context))}">×</button></div>`).join('');
  host.querySelectorAll('.cluster-tab-select').forEach(b=>b.onclick=()=>selectContext(b.dataset.context));
  host.querySelectorAll('.cluster-tab-close').forEach(b=>b.onclick=()=>disconnectWorkspace(b.dataset.context).catch(error));
}
function renderNamespaceOptions() {
  $('namespace').innerHTML='<option value="*">All namespaces</option>'+state.namespaceNames.map(ns=>`<option value="${escape(ns)}">${escape(ns)}</option>`).join('');
  if(state.namespaces.length>1){$('namespace').add(new Option(`${state.namespaces.length} namespaces`,'__multiple__'));$('namespace').value='__multiple__';}else $('namespace').value=state.namespaces[0] || '*';
  $('namespace-multi').textContent=state.namespaces.length>1?`${state.namespaces.length} namespaces ▾`:state.namespaces[0]?`${state.namespaces[0]} ▾`:'All namespaces ▾';
  $('namespace-selection').textContent=state.namespaces.length?state.namespaces.join(', '):'All namespaces';
}
function paintWorkspace() {
  $('special-content').innerHTML='';$('detail-summary').innerHTML='';$('yaml-editor').value='';$('logs-output').textContent='';
  sessionUI?.setContext();renderViewTabs();$('context').value=state.context;$('breadcrumb-context').textContent=state.context || 'No cluster selected';renderClusterTabs();renderNamespaceOptions();
  $('page-title').innerHTML=`${escape(titles[state.view]||state.view)}<span class="heading-dot">.</span>`;
  $('eyebrow').textContent=state.view==='overview'?'YOUR CLUSTER, AT A GLANCE':'EXPLORE YOUR CLUSTER';
  $('page-description').textContent=state.view==='overview'?'A clear view of everything running in your cluster.':`Inspect ${(titles[state.view]||state.view).toLowerCase()}, view manifests, and work in context.`;
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  $('search').value=state.search || '';$('auto-refresh').checked=Boolean(state.autoRefresh);hidden('drawer',true);hidden('busy',true);
  hidden('namespace-warning',!state.namespaceError);$('namespace-warning').textContent=state.namespaceError;hidden('namespace-manual',!state.namespaceError);
  hidden('discovery-warning',!state.discoveryError);$('discovery-warning').textContent=state.discoveryError || '';
  $('resource-type').innerHTML=state.catalogue.map(r=>`<option value="${escape(r.key)}">${escape(r.title||r.kind)} · ${escape(r.apiVersion)}</option>`).join('');$('resource-type').value=state.dynamicResource;updateResourceInfo();
  if(state.connectionLabel)$('connection').innerHTML=`<span class="dot ${state.connected?'green':'muted'}"></span>${escape(state.connectionLabel)}`;
  document.querySelectorAll('.workspace-terminal').forEach(el=>el.classList.toggle('hidden',el!==state.terminalHost));requestAnimationFrame(()=>state.fitAddon?.fit());
  document.querySelector('main').scrollTop=state.scroll || 0;
}
async function selectContext(context) {
  if(state.context===context && state.initialized)return;
  storeWorkspaceUI();if(state.context)clusterWorkspaces.set(workspaceKey(state.context),state);
  const demo=state.demo,key=workspaceKey(context,demo),known=clusterWorkspaces.get(key);state=known || freshWorkspace(context,demo);
  state.generation=++requestEpoch;state.detailGeneration=++detailEpoch;
  if(context)clusterWorkspaces.set(key,state);paintWorkspace();notice();
  if(!context){hidden('welcome',false);hidden('overview',true);hidden('resource-view',true);hidden('special-view',true);return;}
  const owner=state;
  if(!known || !known.initialized){await initializeContext(context);if(state!==owner)return;renderNamespaceOptions();}
  else {
    await refresh();if(state!==owner)return;
    if(owner.drawerVisible && owner.isCreating){await createResource(true);}else if(owner.drawerVisible && owner.selected){await openDetail(owner.selected,owner.selectedKind,true);if(state!==owner)return;$('log-container').value=owner.logContainer||$('log-container').value;$('terminal-container').value=owner.terminalContainer||$('terminal-container').value;}
  }
  if(state===owner){saveWorkspacePreferences();renderClusterTabs();sessionUI?.setContext();}
}
async function disconnectWorkspace(context) {
  const key=workspaceKey(context),owner=clusterWorkspaces.get(key);if(!owner)return;
  if(owner===state)storeWorkspaceUI(owner);
  if(owner.drawerVisible && owner.yamlDraft && !window.confirm(`Disconnect ${shortContext(context)}? Unsaved editor changes and active pod sessions will be closed.`))return;
  if(!owner.demo)await invoke('workspace:close',{context});await sessionUI?.closeContext(context);
  owner.resizeObserver?.disconnect();owner.terminalInstance?.dispose();owner.terminalHost?.remove();clusterWorkspaces.delete(key);
  if(owner===state){state=freshWorkspace('',owner.demo);const next=[...clusterWorkspaces.values()].find(w=>w.demo===state.demo);if(next)await selectContext(next.context);else{paintWorkspace();hidden('drawer',true);hidden('welcome',false);hidden('overview',true);hidden('resource-view',true);hidden('special-view',true);connection('Disconnected');}}
  renderClusterTabs();saveWorkspacePreferences();
}
async function setNamespaceSelection(values) {
  if(values.includes('__multiple__'))return;
  state.namespaces=[...new Set(values)].filter(v=>v!=='*');state.namespace=state.namespaces.length===1?state.namespaces[0]:'*';state.namespaceNames=[...new Set([...state.namespaceNames,...state.namespaces])];
  renderNamespaceOptions();hidden('namespace-popover',true);$('namespace-multi').setAttribute('aria-expanded','false');await closeDrawer();saveWorkspacePreferences();await refresh();
}
function openNamespacePicker() {
  const opening=$('namespace-popover').classList.contains('hidden');
  const selected=new Set(state.namespaces);$('namespace-options').innerHTML=state.namespaceNames.map(ns=>`<label><input type="checkbox" value="${escape(ns)}" ${selected.has(ns)?'checked':''}>${escape(ns)}</label>`).join('');
  $('namespace-wildcard').checked=state.namespaces.length===0;
  $('namespace-options').querySelectorAll('input').forEach(input=>input.onchange=()=>{$('namespace-wildcard').checked=![...$('namespace-options').querySelectorAll('input:checked')].length;});
  const rect=$('namespace-multi').getBoundingClientRect();$('namespace-popover').style.top=`${rect.bottom+7}px`;$('namespace-popover').style.left=`${Math.max(8,Math.min(rect.right-325,window.innerWidth-335))}px`;$('namespace-options').style.maxHeight=`${Math.max(100,window.innerHeight-rect.bottom-200)}px`;
  hidden('namespace-popover',!opening);$('namespace-multi').setAttribute('aria-expanded',String(opening));if(opening)$('namespace-search').focus();
}
$('namespace-multi').onclick=openNamespacePicker;
$('namespace-wildcard').onchange=()=>{if($('namespace-wildcard').checked)$('namespace-options').querySelectorAll('input').forEach(input=>input.checked=false);};
document.addEventListener('click',event=>{if(!$('namespace-popover').classList.contains('hidden')&&!$('namespace-popover').contains(event.target)&&!$('namespace-multi').contains(event.target)){hidden('namespace-popover',true);$('namespace-multi').setAttribute('aria-expanded','false');}});
$('namespace-all').onclick=()=>setNamespaceSelection([]);
$('namespace-apply').onclick=()=>setNamespaceSelection([...$('namespace-options').querySelectorAll('input:checked')].map(i=>i.value));
$('namespace-search').oninput=()=>{const q=$('namespace-search').value.toLowerCase();$('namespace-options').querySelectorAll('label').forEach(l=>l.hidden=!l.textContent.toLowerCase().includes(q));};
$('auto-refresh').onchange=()=>{state.autoRefresh=$('auto-refresh').checked;saveWorkspacePreferences();syncWorkspaceWatches(state).catch(error);};
async function restoreWorkspacePreferences() {
  let prefs;try{prefs=JSON.parse(localStorage.getItem('el-d90-workspaces-v1')||'null');}catch{return;}
  if(!Array.isArray(prefs?.workspaces))return;
  const contexts=state.contexts;
  for(const pref of prefs.workspaces.slice(0,16)) {
    if(!contexts.some(c=>c.name===pref.context))continue;
    await selectContext(pref.context);
    if(Array.isArray(pref.namespaces))await setNamespaceSelection(pref.namespaces.filter(n=>typeof n==='string' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(n)));
    if(pref.historySettings && typeof pref.historySettings==='object')state.historySettings=pref.historySettings;
    if(Object.hasOwn(titles,pref.view))await navigate(pref.view);state.autoRefresh=Boolean(pref.autoRefresh);
  }
  if(clusterWorkspaces.has(workspaceKey(prefs.active,false)))await selectContext(prefs.active);
}
setInterval(async()=>{
  await Promise.allSettled([...clusterWorkspaces.values()].filter(w=>!w.demo && w.context).map(async owner=>{
    if(owner.healthPending)return;owner.healthPending=true;
    try{await invoke('kube:health',{context:owner.context});owner.connected=true;owner.connectionLabel='Connected';}catch(e){owner.connected=false;owner.connectionLabel='Unavailable';owner.healthError=e.message;}finally{owner.healthPending=false;renderClusterTabs();}
  }));
},30000);

function addManagementActions(object,kind) {
  const node=kind==='nodes',cron=kind==='cronjobs';
  $('detail-summary').insertAdjacentHTML('beforeend',`<h3>Resource management</h3><div class="workload-actions"><button id="describe-resource" class="button secondary">Describe</button>${['deployments','statefulsets','daemonsets'].includes(kind)?'<button id="rollout-status" class="button secondary">Rollout status</button>':''}${node?'<button class="button secondary node-action" data-action="cordon">Cordon</button><button class="button secondary node-action" data-action="uncordon">Uncordon</button><button class="danger-button node-action" data-action="drain">Drain node</button>':''}${cron?`<button class="button secondary node-action" data-action="${object.spec?.suspend?'resume':'suspend'}">${object.spec?.suspend?'Resume schedule':'Suspend schedule'}</button>`:''}<button id="delete-resource" class="danger-button">Delete resource</button></div><label class="confirm-name-label">For deletion or drain, type the exact resource name<input id="resource-confirm-name" aria-label="Confirm resource name" placeholder="${escape(object.metadata.name)}"></label><pre id="resource-management-output" class="console management-output" role="status"></pre>`);
  const owner=state,epoch=state.detailGeneration,target={context:owner.context,namespace:object.metadata.namespace || '*',resource:kind,name:object.metadata.name};
  const display=text=>{if(state===owner && state.detailGeneration===epoch)$('resource-management-output').textContent=text;};
  async function read(channel) {if(owner.demo)return display('Demo resource details · no cluster request.');try{display(await invoke(channel,target));}catch(e){display(e.message);}}
  async function mutate(action) {
    const confirmName=$('resource-confirm-name').value;
    if(['delete','drain'].includes(action)&&confirmName!==target.name)return display('Type the exact resource name before continuing.');
    if(owner.demo)return display('Demo mode: no resources are changed.');
    try{display('Waiting for confirmation…');const result=await invoke('resource:action',{...target,action,confirmName});display(result.cancelled?'Action cancelled.':result.output);if(!result.cancelled && state===owner)await refresh();}catch(e){display(e.message);}
  }
  $('describe-resource').onclick=()=>read('resource:describe');if($('rollout-status'))$('rollout-status').onclick=()=>read('resource:rollout-status');
  $('delete-resource').onclick=()=>mutate('delete');document.querySelectorAll('.node-action').forEach(b=>b.onclick=()=>mutate(b.dataset.action));
}

function captureHelmDrafts() {
  return [...document.querySelectorAll('#helm-tools input,#helm-tools textarea,#helm-release-tools input,#helm-release-tools textarea')].filter(el=>el.id).map(el=>({id:el.id,value:el.value,checked:el.checked}));
}
function restoreHelmDrafts(owner) {
  for(const saved of owner.helmDraft || []){const el=document.getElementById(saved.id);if(el && !el.readOnly){el.value=saved.value;if(el.type==='checkbox')el.checked=saved.checked;el.dispatchEvent(new Event('input'));}}
}

const editorTools=window.elD90Productivity.attachEditor({editor:$('yaml-editor'),toolbar:document.querySelector('#detail-yaml .editor-toolbar'),invoke,context:()=>state.context,resource:()=>state.selectedKind,original:()=>state.originalYaml || '',demo:()=>state.demo});
async function openRelatedResource(owner,reference){
  if(state!==owner)return;
  try{const rows=owner.demo?window.demoWorkspace.list(reference.resource,'*').items:(await invoke('kube:list',{context:owner.context,namespace:reference.namespace || '*',resource:reference.resource})).items;if(state!==owner)return;let object=rows.find(r=>r.metadata.name===reference.name&&(!reference.namespace||r.metadata.namespace===reference.namespace));if(!object&&owner.demo)object={apiVersion:'v1',kind:reference.resourceKind || reference.resource,metadata:{name:reference.name,namespace:reference.namespace,labels:{demo:'generated'}},spec:{},status:{}};if(!object)throw new Error('The related resource no longer exists or is not visible to this context.');await openDetail(object,reference.resource);}catch(e){if(state===owner)error(e);}
}
async function renderApiFamily(view,generation){
  const owner=state,definition=API_VIEWS[view],available=definition.resources.filter(key=>owner.catalogue.some(r=>r.key===key));
  $('special-content').innerHTML=`<p class="feature-description">Dedicated declared references and conditions for ${escape(definition.title)} resources.</p><label class="namespace-label">Resource type<select id="api-family-type" aria-label="API relationship type">${available.map(key=>`<option value="${escape(key)}">${escape(key)}</option>`).join('')}</select></label><div id="api-family-content"></div>`;
  if(!available.length){$('api-family-content').innerHTML='<div class="empty">This API family is not advertised by the selected cluster, or discovery is restricted.</div>';return;}
  const paint=()=>window.elD90Topology.renderApi($('api-family-content'),{context:owner.context,namespace:owner.namespace,namespaces:[...owner.namespaces],resource:$('api-family-type').value,demo:owner.demo,invoke,isCurrent:()=>state===owner&&state.generation===generation,onOpenResource:ref=>openRelatedResource(owner,ref)});$('api-family-type').onchange=paint;await paint();
}
async function acceptNodeSession(owner,node,result,epoch){
  owner.terminal=result.id;owner.nodeSession={...result,node};owner.terminalBuffer='';owner.selected=node;owner.selectedKind='nodes';owner.savedTab='terminal';owner.drawerVisible=true;
  owner.terminalInstance?.clear();
  if(state===owner&&state.detailGeneration===epoch){document.querySelector('[data-tab="terminal"]').disabled=false;await tab('terminal');owner.fitAddon?.fit();owner.terminalInstance?.focus();}
}
async function renderNodeSessions(generation){
  const owner=state,result=owner.demo?{pending:[],ssh:[],debug:[],warnings:[]}:await invoke('node:sessions',{context:owner.context});if(state!==owner||generation!==state.generation)return;
  $('special-content').innerHTML='<p class="feature-description">Start SSH or a Kubernetes debug shell from Nodes → select a node → Node access. SSH uses your existing configuration. Debug Pods have exact ownership and UID cleanup.</p>'+result.warnings.map(w=>`<div class="notice">${escape(w)}</div>`).join('')+result.pending.map(p=>`<div class="workflow-panel">Creating debug session on ${escape(p.nodeName)} in ${escape(p.namespace)}…</div>`).join('')+result.ssh.map(s=>`<div class="workflow-panel"><b>SSH · ${escape(s.nodeName)}</b><p>${escape(s.host)}</p><button class="button secondary node-terminal-open">Open terminal</button><button class="button secondary node-session-stop" data-id="${escape(s.id)}">Disconnect SSH</button></div>`).join('')+result.debug.map(s=>`<div class="workflow-panel"><b>Node debug · ${escape(s.nodeName)}</b><p>${escape(s.namespace)}/${escape(s.podName)}</p>${s.cleanupError?`<div class="notice">Cleanup failed: ${escape(s.cleanupError)}</div>`:''}${owner.terminal&&owner.nodeSession?.podName===s.podName?'<button class="button secondary node-terminal-open">Open terminal</button>':''}<button class="danger-button debug-session-cleanup" data-token="${escape(s.sessionToken)}">Disconnect and clean up Pod</button></div>`).join('')+(!result.pending.length&&!result.ssh.length&&!result.debug.length?'<div class="empty">No node sessions for this cluster.</div>':'');
  document.querySelectorAll('.node-terminal-open').forEach(b=>b.onclick=async()=>{if(owner.nodeSession?.node){await openDetail(owner.nodeSession.node,'nodes',true);document.querySelector('[data-tab="terminal"]').disabled=false;await tab('terminal',true);}});
  document.querySelectorAll('.node-session-stop').forEach(b=>b.onclick=async()=>{try{await invoke('stream:stop',{id:b.dataset.id});if(owner.terminal===b.dataset.id)owner.terminal=null;if(state===owner)await refresh();}catch(e){error(e);}});
  document.querySelectorAll('.debug-session-cleanup').forEach(b=>b.onclick=async()=>{try{b.disabled=true;const response=await invoke('node:debug-cleanup',{context:owner.context,sessionToken:b.dataset.token});if(response.error)throw new Error(response.error);if(state===owner)await refresh();}catch(e){error(e);}finally{b.disabled=false;}});
}
window.eld90?.onNodeCleanup(value=>{const owner=clusterWorkspaces.get(workspaceKey(value.context,false));if(owner)owner.nodeCleanupWarning=value.error;if(state.context===value.context)notice(`Node-debug cleanup needs attention: ${value.podName}\n${value.error}\nOpen Node sessions to retry.`);});
function renderViewTabs(){
 const host=$('view-tabs');if(!host)return;const tabs=state.viewTabs||[state.view||'overview'];host.innerHTML=tabs.map(view=>`<button class="view-tab ${state.view===view?'selected':''}" data-view="${escape(view)}" role="tab" aria-selected="${state.view===view}">${escape(titles[view]||view)}</button>`).join('');host.querySelectorAll('button').forEach(b=>b.onclick=()=>navigate(b.dataset.view));
}
function openCommandPalette(){
 $('command-query').value='';paintCommandPalette();$('command-palette').showModal();$('command-query').focus();
}
function paintCommandPalette(){
 const q=$('command-query').value.toLowerCase(),items=[...Object.entries(titles).map(([view,label])=>({label:'View · '+label,run:()=>navigate(view)})),...state.contexts.map(c=>({label:'Cluster · '+shortContext(c.name),run:()=>selectContext(c.name)}))].filter(i=>i.label.toLowerCase().includes(q));$('command-results').innerHTML=items.slice(0,40).map((item,index)=>`<button type="button" data-index="${index}">${escape(item.label)}</button>`).join('');$('command-results').querySelectorAll('button').forEach(b=>b.onclick=()=>{$('command-palette').close();items[Number(b.dataset.index)].run();});
}
$('command-query').oninput=paintCommandPalette;
$('command-query').onkeydown=event=>{if(event.key==='Enter'){$('command-results').querySelector('button')?.click();}};

async function syncWorkspaceWatches(owner,force=false){
 const resources=owner.autoRefresh&&!owner.demo&&!SPECIAL_VIEWS.includes(owner.view)?owner.view==='overview'?['pods','deployments','nodes','events']:[owner.view==='resources'?owner.dynamicResource:owner.view]:[];
 const signature=JSON.stringify([owner.context,owner.namespaces,resources]);if(!force&&owner.watchSignature===signature)return;owner.watchSignature=signature;const ticket=(owner.watchEpoch||0)+1;owner.watchEpoch=ticket;
 const previous=owner.watchIds||[];owner.watchIds=[];owner.watchStates={};await Promise.all(previous.map(id=>invoke('watch:stop',{id}).catch(()=>{})));
 if(owner.watchEpoch!==ticket)return;
 if(!resources.length){paintWatchStatus();return;}
 const results=await Promise.allSettled(resources.filter(Boolean).map(resource=>invoke('watch:start',{context:owner.context,namespace:owner.namespace,namespaces:[...owner.namespaces],resource})));
 if(owner.watchEpoch!==ticket){await Promise.all(results.filter(r=>r.status==='fulfilled').map(r=>invoke('watch:stop',{id:r.value.id}).catch(()=>{})));return;}
 owner.watchIds=results.filter(r=>r.status==='fulfilled').map(r=>r.value.id);owner.watchStartErrors=results.flatMap(r=>r.status==='rejected'?[r.reason.message]:[]);paintWatchStatus();
}
function paintWatchStatus(){
 if(!$('watch-status'))return;const statuses=Object.values(state.watchStates||{}),errors=[...(state.watchStartErrors||[]),...statuses.filter(s=>s.error).map(s=>s.error)];$('watch-status').textContent=!state.autoRefresh?'':state.demo?'Demo · no watch':errors.length?'Watch needs attention':statuses.some(s=>s.state==='watching')?'Watching live':state.watchIds?.length?'Connecting watch…':'';$('watch-status').title=errors.join('\n');hidden('watch-reconnect',!errors.length);
}
$('watch-reconnect').onclick=()=>syncWorkspaceWatches(state,true).catch(error);
window.eld90?.onWatchStatus(value=>{const owner=clusterWorkspaces.get(workspaceKey(value.context,false));if(!owner)return;owner.watchStates=owner.watchStates||{};if(value.state==='stopped')delete owner.watchStates[value.id];else owner.watchStates[value.id]=value;if(owner===state)paintWatchStatus();});
window.eld90?.onWatch(value=>{const owner=clusterWorkspaces.get(workspaceKey(value.context,false));if(!owner||!owner.watchIds?.includes(value.id))return;owner.watchDirty=true;clearTimeout(owner.watchRefreshTimer);owner.watchRefreshTimer=setTimeout(()=>{if(state===owner&&!state.loading){owner.watchDirty=false;refresh();}},250);});

function setupCreateControls(restoring){
 const types=window.elD90Create.catalogue(state.catalogue);$('create-kind').innerHTML=types.map((r,i)=>`<option value="${i}">${escape(r.kind)} · ${escape(r.apiVersion)}${r.namespaced?'':' · cluster'}</option>`).join('');const chosen=types.findIndex(r=>r.kind==='ConfigMap');$('create-kind').value=String(chosen<0?0:chosen);
 const namespaces=[...new Set(['default',...state.namespaceNames])];$('create-namespace').innerHTML='<option value="">From YAML (each document defines its namespace)</option>'+namespaces.map(n=>`<option value="${escape(n)}">${escape(n)}</option>`).join('');$('create-namespace').value=state.namespaces.length===1?state.namespaces[0]:'';
 $('create-name').value='example';
 $('create-kind').onchange=()=>{const r=types[Number($('create-kind').value)];$('create-namespace').disabled=!r?.namespaced;};
 $('create-template').onclick=()=>{try{if($('yaml-editor').value.trim()&&!confirm('Replace the current editor contents with starter YAML?'))return;const r=types[Number($('create-kind').value)];$('yaml-editor').value=window.elD90Create.template(r,$('create-name').value.trim(),$('create-namespace').value||'default');$('yaml-result').textContent='Starter generated. Review and complete the YAML, then Validate.';editorTools?.clear();}catch(e){$('yaml-result').textContent=e.message;}};
 $('import-yaml').onclick=async()=>{try{if($('yaml-editor').value.trim()&&!confirm('Replace the current editor contents with a YAML file?'))return;const result=await invoke('file:open-yaml');if(!result.cancelled){$('yaml-editor').value=result.text;$('yaml-result').textContent='File loaded locally. Review and Validate before Apply.';editorTools?.clear();}}catch(e){$('yaml-result').textContent=e.message;}};
}

function renderEventsTable(target,items,max=Infinity){
 const rows=window.elD90Events.newest(items).slice(0,max),container=$(target);
 if(!rows.length){container.innerHTML='<div class="empty">No retained events match this view. Check the namespace selection and search. Kubernetes events expire; this is not an audit history.</div>';return;}
 const columns=['Type','Reason','Object','Namespace','Message','Count','Last seen'];
 container.innerHTML='<p class="events-help">Newest events first · select a row for full details · Kubernetes retains events for a limited time.</p><table class="events-table"><thead><tr>'+columns.map(c=>`<th>${c}</th>`).join('')+'</tr></thead><tbody>'+rows.map((event,i)=>{const e=window.elD90Events.normalize(event);return `<tr role="button" tabindex="0" data-index="${i}" aria-label="Event ${escape(e.reason)} ${escape(e.object)}"><td><span class="pill ${e.type==='Warning'?'red':'green'}">${escape(e.type)}</span></td><td>${escape(e.reason)}</td><td>${escape(e.object)}</td><td>${escape(e.namespace)}</td><td class="event-message">${escape(e.message)}</td><td>${escape(e.count)}</td><td title="${escape(e.last)}">${escape(age(e.last))} ago</td></tr>`;}).join('')+'</tbody></table>';
 container.querySelectorAll('tbody tr').forEach(row=>{const open=()=>openDetail(rows[Number(row.dataset.index)],'events');row.onclick=open;row.onkeydown=e=>{if(e.key==='Enter')open();};});
 window.elD90Productivity.enhanceTable(container,{storageKey:'events-v2',onExport:text=>invoke('file:save',{text})});
}
async function loadResourceEvents(){const owner=state,object=owner.selected,epoch=owner.detailGeneration;const container=$('detail-events');container.innerHTML='<p>Loading events for this resource…</p>';try{if(!object?.metadata?.uid)throw Error('This resource has no UID for event lookup');const result=owner.demo?{items:[]}:await invoke('resource:events',{context:owner.context,namespace:object.metadata.namespace||'*',uid:object.metadata.uid});if(state!==owner||epoch!==owner.detailGeneration)return;container.innerHTML='<p>Events for this exact resource UID. Related Pods and ReplicaSets have their own events.</p><button id="refresh-resource-events" class="button secondary">Refresh events</button><div id="resource-events-table"></div>';renderEventsTable('resource-events-table',result.items||[]);$('refresh-resource-events').onclick=loadResourceEvents;}catch(e){if(state===owner&&epoch===owner.detailGeneration)container.textContent='Events unavailable: '+e.message;}}

sessionUI=window.elD90Sessions.create({invoke,subscribe:callback=>window.eld90.onSession(callback),context:()=>state});
$('open-log-session').onclick=async()=>{try{const request={...detailInput(),container:$('log-container').value,previous:$('previous-logs').checked};await sessionUI.openLogs(request);await closeDrawer();sessionUI.show();}catch(e){error(e);}};
$('open-terminal-session').onclick=async()=>{try{const request={...detailInput(),container:$('terminal-container').value,shell:$('terminal-shell').value};await sessionUI.openTerminal(request);await closeDrawer();sessionUI.show();}catch(e){error(e);}};
