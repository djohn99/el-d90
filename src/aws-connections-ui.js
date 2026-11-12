window.elD90AWSConnections = { async render(host, opts) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const current = () => host.isConnected && (!opts.isCurrent || opts.isCurrent()); let preferredProfile=/^el-d90:([^:]+):/.exec(opts.context||'')?.[1]||'';try{preferredProfile ||= opts.demo?'':localStorage.getItem('el-d90-aws-profile')||'';}catch{}
  let profiles = [], epoch = 0, job = null, timer, imported = null, connectPending=false, namespaceJob=null, namespaceEpoch=0;
  host.innerHTML = '<h2>AWS SSO → EKS</h2><details id="aws-saved-profiles"><summary>Use a saved AWS profile</summary><div class="aws-connect-fields"><label>AWS profile<select id="aws-profile" aria-label="AWS profile"></select></label><button id="aws-profiles-reload" class="button secondary">Reload profiles</button></div><p id="aws-profile-info"></p><div class="aws-connect-actions"><button id="aws-login" class="button primary" disabled>Sign in with AWS SSO</button><button id="aws-login-cancel" class="button secondary" hidden>Cancel sign-in</button></div></details><section class="aws-cluster-stage"><h3>Select cluster</h3><div class="aws-connect-actions"><label>EKS region<input id="aws-region" aria-label="EKS region" placeholder="eu-west-1"></label><button id="aws-clusters-load" class="button secondary" disabled>Load EKS clusters</button></div><div class="aws-connect-fields"><label>EKS cluster<select id="aws-cluster" aria-label="EKS cluster" disabled><option value="">Load clusters first…</option></select></label><label>Cluster name (if not listed)<input id="aws-cluster-name" aria-label="Manual EKS cluster name" placeholder="Optional"></label><div class="sso-picker"><label>Namespace<input id="aws-namespace" aria-label="EKS namespace" placeholder="Search namespaces or enter a known namespace"></label><div id="aws-namespace-options" class="sso-choice-list connection-popover" popover="auto" role="group" aria-label="Accessible namespaces"></div><small id="aws-namespace-status">Choose a cluster to load namespaces.</small></div><button id="aws-connect" class="button primary" disabled>Connect to cluster</button><button id="aws-open" class="button secondary" hidden disabled>Open this cluster</button></div><pre id="aws-status" role="status"></pre></section><details><summary>AWS diagnostics</summary><button id="aws-diagnostics" class="button secondary" disabled>Check AWS connection</button></details><details id="aws-sso-setup"><summary>Set up a new SSO profile</summary><p>One-time setup using your organization’s AWS access portal information. This adds a named AWS CLI profile and keeps existing profiles unchanged. No password or access token is entered here.</p><div class="aws-connect-fields"><label>Profile name<input id="aws-new-profile" aria-label="New AWS profile name" placeholder="my-company-sso"></label><label>SSO start / issuer URL<input id="aws-start-url" aria-label="SSO start URL" placeholder="https://your-company.awsapps.com/start"></label><label>SSO region<input id="aws-sso-region" aria-label="SSO region" placeholder="eu-west-1"></label><label>AWS account ID<input id="aws-account" aria-label="AWS account ID" inputmode="numeric" placeholder="12 digits"></label><label>SSO role / permission-set name<input id="aws-role" aria-label="SSO role name" placeholder="Your assigned role"></label></div><button id="aws-profile-create" class="button secondary">Save named SSO profile</button><p>The EKS region above is saved as the profile’s default region. Ask your AWS administrator for portal/account/role information if needed.</p></details>';
  const q = selector => host.querySelector(selector), status = message => { if (current()) q('#aws-status').textContent = message; };
  const demo = { available: true, profiles: [{ name: 'demo-company-sso', region: 'eu-west-1', sso: true, account: '000000000000', role: 'DemoAccess' }], message: 'Demo only. No AWS login or configuration changes occur.' };
  function invalidate() { namespaceNames=[];clearTimeout(manualClusterTimer);++epoch; clearTimeout(timer); imported = null; q('#aws-open').disabled = true; q('#aws-connect').disabled = true; q('#aws-cluster').disabled = true; q('#aws-cluster').innerHTML = '<option value="">Load clusters first…</option>';q('#aws-cluster-name').value='';q('#aws-namespace').value='';namespacePopover.close();q('#aws-namespace-options').replaceChildren();q('#aws-namespace-status').textContent='Choose a cluster to load namespaces.';namespaceEpoch++;namespaceJob=null;q('#aws-connect').textContent='Connect to cluster'; }
  function selected() { return profiles.find(profile => profile.name === q('#aws-profile').value); }
  function provider() { const profile = selected(); q('#aws-login').disabled = !profile?.sso; q('#aws-clusters-load').disabled = !profile;q('#aws-diagnostics').disabled=!profile; q('#aws-profile-info').textContent = profile ? (profile.sso ? 'SSO profile' : 'Existing AWS profile · uses its configured credentials') + (profile.account ? ' · Account ' + profile.account : '') + (profile.role ? ' · ' + profile.role : '') : 'Choose a saved profile or use Sign in & discover roles above.'; }
  async function overview(preferred, valid = () => true) {
    const own = ++epoch; clearTimeout(timer); status('Reading AWS profile metadata…');
    try { const data = opts.demo ? demo : await opts.invoke('aws:profiles'); if (!current() || own !== epoch || !valid()) return; profiles = data.profiles; q('#aws-profile').innerHTML = '<option value="">Choose profile…</option>' + profiles.map(profile => '<option value="' + esc(profile.name) + '">' + esc(profile.name) + (profile.sso ? ' · SSO' + (profile.role ? ' · ' + esc(profile.role) : '') + (profile.account ? ' · ' + esc(profile.account) : '') : '') + '</option>').join(''); q('#aws-profile').value = profiles.some(profile => profile.name === preferred) ? preferred : profiles.find(profile => profile.sso)?.name || profiles[0]?.name || ''; const profile = selected(); q('#aws-region').value = profile?.region || /^arn:[^:]+:eks:([^:]+):/.exec(opts.context || '')?.[1] || ''; provider();q('#aws-sso-setup').open=data.available&&!profiles.some(item=>item.sso);status(data.available&&!profiles.some(item=>item.sso)?'No saved SSO profile yet. Use Sign in & discover roles above.':data.message); const active = data.jobs?.find(item => item.profile === profile?.name); if (active) { job = active; q('#aws-login-cancel').hidden = false; q('#aws-login').disabled = true; poll(own); } }
    catch (error) { status(error.message); }
  }
  async function loadClusters() {
    const own = ++epoch, profile = q('#aws-profile').value, region = q('#aws-region').value.trim(); namespaceNames=[];q('#aws-clusters-load').disabled = true;q('#aws-cluster').disabled=true;q('#aws-cluster').innerHTML='<option value="">Loading clusters…</option>';q('#aws-connect').disabled=true;q('#aws-namespace').value='';namespacePopover.close();q('#aws-namespace-options').replaceChildren();q('#aws-namespace-status').textContent='Loading clusters…';++namespaceEpoch;namespaceJob=null; imported = null; q('#aws-open').disabled = true; status('Loading EKS clusters…');
    try { const result = opts.demo ? { clusters: ['demo-platform', 'demo-staging'] } : await opts.invoke('aws:clusters', { profile, region }); if (!current() || own !== epoch) return; if(!activeRole){verifiedProfile=selected();progress();}q('#aws-cluster').innerHTML = '<option value="">Choose cluster…</option>' + result.clusters.map(name => '<option value="'+esc(name)+'">' + esc(name) + '</option>').join(''); q('#aws-cluster').disabled = false; q('#aws-cluster').value = result.clusters[0] || ''; q('#aws-connect').disabled = !result.clusters.length; status(result.clusters.length ? 'Choose an EKS cluster.' : 'No EKS clusters were returned in this profile and region. Check the region/account or enter the cluster name if listing is restricted.'); if (!result.clusters.length) {q('#aws-cluster').innerHTML = '<option value="">No clusters in this region</option>';q('#aws-namespace-status').textContent='Enter a known cluster name to check namespaces.';}else await prepareNamespaces(); }
    catch (error) { if (current() && own === epoch) {verifiedProfile=null;progress();status(error.message);q('#aws-cluster').innerHTML='<option value="">Cluster list unavailable</option>';q('#aws-namespace-status').textContent='Cluster list unavailable. Retry loading clusters or enter a known cluster name.';} }
    finally { if (current() && own === epoch) q('#aws-clusters-load').disabled = !selected(); }
  }
  async function poll(own) {
    if (!current() || own !== epoch || !job) return;
    try { const result = opts.demo ? { ...job, state: 'complete', message: 'Demo sign-in succeeded. No AWS browser or credentials were accessed.' } : await opts.invoke('aws:login-status', { id: job.id }); if (!current() || own !== epoch) return; job = result; status(result.message + (result.account ? '\nAccount: ' + result.account : '') + (result.arn ? '\nIdentity: ' + result.arn : '')); if (result.state === 'running') timer = setTimeout(() => poll(own), 600); else { q('#aws-login-cancel').hidden = true; provider(); if (result.state === 'complete' && q('#aws-region').value.trim()) await loadClusters(); } }
    catch (error) { if (own === epoch) { status(error.message); q('#aws-login-cancel').hidden = true; provider(); } }
  }
  q('#aws-profile').onchange = () => { activeRole='';verifiedProfile=null;progress(); try{if(!opts.demo)localStorage.setItem('el-d90-aws-profile',q('#aws-profile').value);}catch{} invalidate(); job = null; q('#aws-login-cancel').hidden = true; q('#aws-region').value = selected()?.region || q('#aws-region').value; provider(); if(selected()&&q('#aws-region').value.trim())loadClusters(); };
  q('#aws-region').oninput = () => { invalidate(); provider(); status('Load EKS clusters for the new region.'); };
  let namespaceNames=[];
  const namespaceField=q('#aws-namespace'), namespaceMenu=q('#aws-namespace-options');
  namespaceField.setAttribute('aria-controls',namespaceMenu.id);
  namespaceField.setAttribute('aria-expanded','false');
  namespaceField.setAttribute('aria-describedby','aws-namespace-status');
  const namespacePopover=floatingChoices(namespaceField,namespaceMenu);
  namespaceField.onclick=()=>{if(namespaceNames.length){paintNamespaces();namespacePopover.open();}};

  function paintNamespaces(){const value=q('#aws-namespace').value.trim(),query=value.toLowerCase(),matches=namespaceNames.filter(name=>name.toLowerCase().includes(query));q('#aws-namespace-options').innerHTML=matches.length?matches.map(name=>'<button type="button" class="sso-choice" data-namespace="'+esc(name)+'" aria-pressed="'+(name===value)+'">'+esc(name)+'</button>').join(''):'<p>'+esc(namespaceNames.length?'No matching namespaces. Clear the search to see all choices.':'No accessible namespaces discovered. Enter a known namespace to check access.')+'</p>';q('#aws-namespace-options').querySelectorAll('[data-namespace]').forEach(button=>button.onclick=()=>{q('#aws-namespace').value=button.dataset.namespace;namespacePopover.close(true);paintNamespaces();});}
  async function prepareNamespaces(){
    const ticket=++namespaceEpoch,own=epoch,input={profile:q('#aws-profile').value,region:q('#aws-region').value.trim(),cluster:q('#aws-cluster-name').value.trim()||q('#aws-cluster').value};
    imported=null;namespaceNames=[];q('#aws-namespace').value='';q('#aws-connect').disabled=true;namespacePopover.close();q('#aws-namespace-options').replaceChildren();q('#aws-namespace-status').textContent='Loading namespaces and checking access…';
    if(!input.cluster||!input.profile){namespacePopover.close();q('#aws-namespace-options').replaceChildren();q('#aws-namespace-status').textContent='Choose a cluster to load namespaces.';return;}
    const valid=()=>current()&&own===epoch&&ticket===namespaceEpoch;
    const work=(async()=>{try{status('Loading accessible namespaces…');const result=opts.demo?{context:'demo-eu-west'}:await opts.invoke('aws:connect',input);if(!valid())return;
      const data=opts.demo?{namespaces:['demo'],message:'Choose a namespace.'}:await opts.invoke('connections:namespaces',{context:result.context,candidates:opts.namespaces||[]});if(!valid())return;
      imported=result;namespaceNames=data.namespaces;paintNamespaces();q('#aws-namespace-status').textContent=namespaceNames.length?'Choose or enter a namespace.':'Enter a known namespace to check access.';status(data.message);q('#aws-connect').disabled=false;
    }catch(error){if(valid()){status(error.message);q('#aws-namespace-status').textContent='Namespace discovery failed. Check sign-in or retry Connect.';q('#aws-connect').disabled=false;}}
    })();namespaceJob=work;try{await work;}finally{if(namespaceJob===work)namespaceJob=null;}
  }
  q('#aws-cluster').onchange=()=>{++epoch;q('#aws-cluster-name').value='';prepareNamespaces();};
  let manualClusterTimer;
  q('#aws-cluster-name').oninput=()=>{++epoch;++namespaceEpoch;imported=null;namespaceJob=null;clearTimeout(manualClusterTimer);q('#aws-namespace').value='';namespaceNames=[];q('#aws-connect').disabled=true;namespacePopover.close();q('#aws-namespace-options').replaceChildren();q('#aws-namespace-status').textContent='Waiting for cluster name…';manualClusterTimer=setTimeout(()=>{if(current())prepareNamespaces();},500);};
  q('#aws-namespace').oninput=()=>{paintNamespaces();if(namespaceNames.length)namespacePopover.open();};
  q('#aws-profiles-reload').onclick = () => { invalidate(); overview(q('#aws-profile').value); };
  q('#aws-clusters-load').onclick = loadClusters;
  q('#aws-diagnostics').onclick=async()=>{const own=epoch;q('#aws-diagnostics').disabled=true;status('Checking the AWS executable, identity and EKS listing…');try{if(opts.demo){status('Demo only. AWS connection checks require a real profile.');return;}const result=await opts.invoke('aws:diagnostics',{profile:q('#aws-profile').value,region:q('#aws-region').value.trim()});if(!current()||own!==epoch)return;status('AWS executable: '+result.executable+'\nVersion: '+result.version+'\nProfile: '+result.profile+'\nEKS region: '+result.region+'\nEnvironment: proxy '+(result.environment.proxyConfigured?'configured':'not configured')+', CA bundle '+(result.environment.caBundleConfigured?'configured':'not configured')+'\n'+result.checks.map(check=>(check.ok?'OK':'FAILED')+' — '+check.name+': '+check.message+(check.exitCode?' (exit '+check.exitCode+')':'')).join('\n'));}catch(error){if(current()&&own===epoch)status(error.message);}finally{if(current()&&own===epoch)q('#aws-diagnostics').disabled=!selected();}};

  q('#aws-login').onclick = async () => { const own = epoch; q('#aws-login').disabled = true; status('Opening AWS SSO sign-in in your browser…'); try { const result = opts.demo ? { id: 'demo-login', state: 'running' } : await opts.invoke('aws:login-start', { profile: q('#aws-profile').value }); if (!current() || own !== epoch) return; job = result; q('#aws-login-cancel').hidden = false; poll(own); } catch (error) { if (own === epoch) { status(error.message); provider(); } } };
  q('#aws-login-cancel').onclick = async () => { const id = job?.id; ++epoch; clearTimeout(timer); if (id && !opts.demo) await opts.invoke('aws:login-cancel', { id }).catch(() => {}); if (!current()) return; q('#aws-login-cancel').hidden = true; provider(); status('Sign-in cancelled. You may close the AWS browser tab.'); };
  q('#aws-connect').onclick = async () => {
    if(connectPending)return;connectPending=true;
    const own=epoch,input={profile:q('#aws-profile').value,region:q('#aws-region').value.trim(),cluster:q('#aws-cluster-name').value.trim()||q('#aws-cluster').value};
    q('#aws-connect').disabled=true;
    try{
      if(namespaceJob)await namespaceJob;if(!current()||own!==epoch)return;
      if(!imported){await prepareNamespaces();return;}
      const namespace=q('#aws-namespace').value.trim();if(!namespace){status('Enter a namespace you have access to, then choose Connect to cluster.');q('#aws-namespace').focus();return;}
      const check=opts.demo?{canListPods:true}:await opts.invoke('connections:test',{context:imported.context,namespace});if(!current()||own!==epoch)return;
      if(!check.canListPods){status(check.message);return;}
      status('Opening cluster workspace…');
      await opts.onEKSConnect?.(imported.context,namespace);
      if(current()&&own===epoch)q('#sso-summary').textContent='Connected';
    }catch(error){if(current()&&own===epoch)status(error.message);}finally{connectPending=false;if(current()&&own===epoch)q('#aws-connect').disabled=false;}
  };
  q('#aws-open').onclick=()=>q('#aws-connect').click();
  q('#aws-profile-create').onclick = async () => { const own = epoch; const input = { name: q('#aws-new-profile').value.trim(), startUrl: q('#aws-start-url').value.trim(), ssoRegion: q('#aws-sso-region').value.trim(), region: q('#aws-region').value.trim(), account: q('#aws-account').value.trim(), role: q('#aws-role').value.trim() }; q('#aws-profile-create').disabled = true; try { const result = opts.demo ? { profile: 'demo-company-sso' } : await opts.invoke('aws:profile-create', input); if (!current() || own !== epoch) return; q('#aws-sso-setup').open = false; await overview(result.profile); status('Named SSO profile created. Choose Sign in with AWS SSO.'); } catch (error) { if (own === epoch) status(error.message); } finally { if (current()) q('#aws-profile-create').disabled = false; } };
  // Account/role discovery starts with portal information, before any role profile exists.
  const discovery = document.createElement('section'); discovery.className = 'aws-sso-discovery';
  discovery.innerHTML = `
    <p id="sso-summary" aria-live="polite">AWS sign-in required</p>
    <ol class="aws-steps" aria-label="AWS connection progress">
      <li>Sign in</li><li>Select account</li><li>Select role</li><li>Select cluster</li>
    </ol>
    <section class="aws-step-card">
      <h3>Sign in</h3>
      <div id="sso-configured" hidden><span id="sso-portal-summary"></span> <button id="sso-edit" class="button secondary">Edit SSO details</button></div>
      <div id="sso-settings" class="aws-connect-fields">
        <label>SSO portal URL<input id="sso-portal" aria-label="Discover SSO portal URL" placeholder="https://your-company.awsapps.com/start"></label>
        <label>SSO region<input id="sso-region" aria-label="Discover SSO region" placeholder="eu-west-1"><small>IAM Identity Center region, which can differ from the EKS region.</small></label>
      </div>
      <p>Sign in opens AWS in your browser.</p>
      <div class="aws-connect-actions">
        <button id="sso-start" class="button primary">Sign in &amp; discover roles</button>
        <button id="sso-reopen" class="button secondary" hidden>Open approval page again</button>
        <button id="sso-cancel" class="button secondary" hidden>Cancel discovery</button>
      </div>
      <p id="sso-status" role="status"></p>
    </section>
    <div class="aws-assignment-grid">
      <section class="aws-step-card">
        <h3>Select account</h3>
        <button id="sso-account-trigger" aria-describedby="sso-account-status" class="button secondary connection-picker" aria-controls="sso-account-menu" aria-expanded="false" disabled>Choose account…</button>
        <small id="sso-account-status"></small>
        <div id="sso-account-menu" class="connection-popover" popover="auto">
          <input type="search" id="sso-account-search" aria-label="Search assigned AWS accounts" placeholder="Search account name or ID">
          <div id="sso-account" class="sso-choice-list" role="group" aria-label="Assigned AWS accounts"></div>
        </div>
      </section>
      <section class="aws-step-card">
        <h3>Select role</h3>
        <button id="sso-role-trigger" aria-describedby="sso-role-status" class="button secondary connection-picker" aria-controls="sso-role-menu" aria-expanded="false" disabled>Choose role…</button>
        <small id="sso-role-status"></small>
        <div id="sso-role-menu" class="connection-popover" popover="auto">
          <input type="search" id="sso-role-search" aria-label="Search assigned SSO roles" placeholder="Search role name">
          <div id="sso-role" class="sso-choice-list" role="group" aria-label="Assigned SSO roles"></div>
        </div>
        <button id="sso-use" class="button secondary" hidden disabled>Retry selected role</button>
        <button id="sso-retry-roles" class="button secondary" hidden>Retry loading roles</button>
      </section>
    </div>`;
  host.querySelector('h2').after(discovery);
  let discoveryId, discoveryEpoch = 0, discoveryTimer;
  const ds = message => { if(current())q('#sso-status').textContent = message; };
  function floatingChoices(anchor, panel, search = anchor) {
    function position() {
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const width = Math.min(Math.max(220, rect.width), window.innerWidth - 16);
      const above = spaceBelow < 220 && spaceAbove > spaceBelow;
      Object.assign(panel.style, {
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px',
        width: width + 'px',
        maxHeight: Math.max(0, Math.min(340, above ? spaceAbove : spaceBelow)) + 'px',
        top: above ? 'auto' : rect.bottom + 4 + 'px',
        bottom: above ? window.innerHeight - rect.top + 4 + 'px' : 'auto',
      });
    }
    function close(restoreFocus = false) {
      if (panel.matches(':popover-open')) panel.hidePopover();
      if (restoreFocus) anchor.focus();
    }
    function open() {
      position();
      if (!panel.matches(':popover-open')) panel.showPopover({source: anchor});
    }
    function onLayoutChange(event) {
      if (event.target instanceof Node && panel.contains(event.target)) return;
      const rect = anchor.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) close();
      else position();
    }
    panel.addEventListener('toggle', () => {
      const open = panel.matches(':popover-open');
      anchor.setAttribute('aria-expanded', String(open));
      const listener = open ? 'addEventListener' : 'removeEventListener';
      host[listener]('scroll', onLayoutChange, true);
    });
    function keys(event) {
      if (event.key === 'Escape' && panel.matches(':popover-open')) {
        event.preventDefault();
        close(true);
      }
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const buttons = [...panel.querySelectorAll('[data-choice], [data-namespace]')];
      if (!buttons.length) return;
      event.preventDefault();
      open();
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length);
      buttons[next].focus();
    }
    panel.addEventListener('keydown', keys);
    if (!panel.contains(search)) search.addEventListener('keydown', keys);
    return {open, close};
  }

  let authenticated = false, verifiedProfile = null, activeRole = '';
  function progress() {
    const stage = verifiedProfile ? 3 : !authenticated ? 0 : !accountPicker.value ? 1 : !activeRole ? 2 : 3;
    [...discovery.querySelectorAll('.aws-steps li')].forEach((step, index) => {
      step.classList.toggle('complete', index < stage);
      if (index === stage) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
    q('#sso-summary').textContent = verifiedProfile
      ? [verifiedProfile.sso ? 'AWS signed in' : 'AWS profile verified', verifiedProfile.account, verifiedProfile.role || verifiedProfile.name].filter(Boolean).join(' · ')
      : authenticated
      ? ['AWS signed in', accountPicker.selection?.label, activeRole].filter(Boolean).join(' · ')
      : 'AWS sign-in required';
  }

  function choiceList(id, onSelect) {
    let items = [], value = '';
    const search = q('#'+id+'-search'), list = q('#'+id), trigger = q('#'+id+'-trigger');
    const menu = q('#'+id+'-menu'), popover = floatingChoices(trigger, menu, search);
    const placeholder = trigger.textContent;
    function paint() {
      const query = search.value.trim().toLowerCase();
      const matches = items.filter(item => [item.label,item.value,item.detail].some(part => part?.toLowerCase().includes(query)));
      list.innerHTML = matches.length ? matches.map(item => `
        <button type="button" class="sso-choice" data-choice="${esc(item.value)}" aria-pressed="${item.value===value}">
          <span aria-hidden="true" class="sso-check">✓</span><span><strong>${esc(item.label)}</strong>
          ${item.detail ? '<small>'+esc(item.detail)+'</small>' : ''}</span>
        </button>`).join('') : '<p>No matches. Clear the search to see all choices.</p>';
      trigger.textContent = items.find(item => item.value===value)?.label || placeholder;
    }
    trigger.onclick = () => {
      if(menu.matches(':popover-open')) return popover.close();
      search.value='';
      paint();
      popover.open();
      search.focus();
    };
    search.oninput = paint;
    list.onclick = event => {
      const button = event.target.closest('[data-choice]');
      if (!button) return;
      value = button.dataset.choice;
      popover.close(true);
      paint();
      onSelect(value);
    };
    return {
      get value(){return value;},
      get selection(){return items.find(item=>item.value===value);},
      set(next,message,selected=''){
        popover.close();
        items=next;
        value=items.some(item=>item.value===selected)?selected:'';
        search.value='';
        trigger.disabled=search.disabled=!items.length;
        q('#'+id+'-status').textContent=items.length?'':message;
        paint();
      }
    };
  }
  function showConfiguredPortal() {
    const portal=q('#sso-portal').value, region=q('#sso-region').value;
    if (!portal || !region) return;
    q('#sso-portal-summary').textContent=portal+' · '+region;
    q('#sso-settings').hidden=true;
    q('#sso-configured').hidden=false;
  }
  q('#sso-edit').onclick=()=>{
    q('#sso-configured').hidden=true;
    q('#sso-settings').hidden=false;
    q('#sso-portal').focus();
  };
  function invalidateRoleConnection(){verifiedProfile=null;activeRole='';progress();invalidate();q('#aws-profile').value='';provider();}
  const accountPicker=choiceList('sso-account',loadRoles),rolePicker=choiceList('sso-role',()=>{++discoveryEpoch;invalidateRoleConnection();q('#sso-use').disabled=!rolePicker.value;if(rolePicker.value)q('#sso-use').click();});
  const resetRoles = () => { rolePicker.set([],'Choose an account first.');q('#sso-retry-roles').hidden=true;q('#sso-use').hidden=true;q('#sso-use').disabled=true; };
  const resetDiscovery = () => { ++discoveryEpoch; clearTimeout(discoveryTimer); authenticated=false;verifiedProfile=null;activeRole='';accountPicker.set([],'Sign in to load accounts.');resetRoles();progress(); };
  async function pollDiscovery(own) {
    if(!current()||own!==discoveryEpoch)return;
    try { const result=await opts.invoke('aws:sso-status',{id:discoveryId});if(!current()||own!==discoveryEpoch)return;ds(result.message);
      if(result.state==='running'){discoveryTimer=setTimeout(()=>pollDiscovery(own),700);return;}
      q('#sso-start').disabled=false;q('#sso-cancel').hidden=true;q('#sso-reopen').hidden=true;
      if(result.state==='complete'){authenticated=true;showConfiguredPortal();q('#sso-start').textContent='Sign in again';accountPicker.set(result.accounts.map(item=>({value:item.id,label:item.name,detail:[item.name.match(/(?:^|[-_])(stg|staging|prod|prd|dev|uat|test|nonprod)\d*(?=$|[-_])/gi)?.at(-1)?.replace(/^[-_]|\d+$/g,'').toUpperCase(),item.id].filter(Boolean).join(' · ')})),'No AWS accounts are assigned to this sign-in.',result.selection?.account);if(accountPicker.value)await loadRoles(accountPicker.value,result.selection?.role||'',true);progress();}
    }catch(error){if(current()&&own===discoveryEpoch){ds(error.message);q('#sso-start').disabled=false;q('#sso-cancel').hidden=true;q('#sso-reopen').hidden=true;}}
  }
  q('#sso-start').onclick=async()=>{if(activeRole)invalidateRoleConnection();resetDiscovery();const own=discoveryEpoch;q('#sso-start').disabled=true;ds('Opening browser sign-in…');try{if(opts.demo)throw Error('Discovery requires a live AWS SSO sign-in.');const result=await opts.invoke('aws:sso-start',{startUrl:q('#sso-portal').value.trim(),ssoRegion:q('#sso-region').value.trim()});if(!current()||own!==discoveryEpoch)return;discoveryId=result.id;q('#sso-cancel').hidden=false;q('#sso-reopen').hidden=false;pollDiscovery(own);}catch(error){if(current()&&own===discoveryEpoch){ds(error.message);q('#sso-start').disabled=false;}}};
  q('#sso-reopen').onclick=async()=>{try{await opts.invoke('aws:sso-reopen',{id:discoveryId});ds('Approval page reopened. Sign in, then choose Allow access for el-d90 Kubernetes desktop.');}catch(error){ds(error.message);}};
  q('#sso-cancel').onclick=async()=>{const id=discoveryId;resetDiscovery();if(id)await opts.invoke('aws:sso-cancel',{id}).catch(()=>{});if(current()){q('#sso-start').disabled=false;q('#sso-cancel').hidden=true;q('#sso-reopen').hidden=true;ds('SSO discovery cancelled.');}};
  for(const selector of ['#sso-portal','#sso-region'])q(selector).oninput=()=>{const id=discoveryId;if(activeRole)invalidateRoleConnection();resetDiscovery();discoveryId=null;q('#sso-start').disabled=false;q('#sso-cancel').hidden=true;q('#sso-reopen').hidden=true;if(id)opts.invoke('aws:sso-cancel',{id}).catch(()=>{});ds('Sign in to discover assignments for this portal.');};
  async function loadRoles(account,restoreRole='',restoring=false){const own=++discoveryEpoch;if(!restoring)invalidateRoleConnection();resetRoles();progress();if(!account)return;q('#sso-role-status').textContent='Loading assigned roles…';ds('Loading assigned roles…');try{const result=await opts.invoke('aws:sso-roles',{id:discoveryId,account});if(!current()||own!==discoveryEpoch)return;rolePicker.set(result.roles.map(role=>({value:role,label:role})),'No roles assigned to this account.',restoreRole);if(rolePicker.value){activeRole=rolePicker.value;progress();ds('Signed in · '+account+' · '+rolePicker.value+'. Choose another role or connect to a cluster.');return;}ds(result.roles.length?'Choose the role to use for this connection.':'No roles assigned to this account.');}catch(error){if(current()&&own===discoveryEpoch){ds(error.message);q('#sso-role-status').textContent='Could not load roles.';q('#sso-retry-roles').hidden=false;}}}
  q('#sso-retry-roles').onclick=()=>loadRoles(accountPicker.value);
  q('#sso-use').onclick=async()=>{const own=discoveryEpoch;q('#sso-use').disabled=true;q('#sso-use').hidden=true;ds('Saving a separate profile for the selected role…');try{const result=await opts.invoke('aws:sso-select',{id:discoveryId,account:accountPicker.value,role:rolePicker.value,region:q('#aws-region').value.trim()||q('#sso-region').value.trim()});if(!current()||own!==discoveryEpoch)return;try{if(!opts.demo)localStorage.setItem('el-d90-aws-profile',result.profile);}catch{}invalidate();await overview(result.profile,()=>own===discoveryEpoch);if(!current()||own!==discoveryEpoch)return;activeRole=result.role;progress();ds(result.role+' selected.');await loadClusters();}catch(error){if(current()&&own===discoveryEpoch){ds(error.message);q('#sso-use').hidden=false;}}finally{if(current()&&own===discoveryEpoch)q('#sso-use').disabled=!rolePicker.value;}};
  const network=document.createElement('details');network.id='aws-network-settings';network.innerHTML='<summary>AWS connection settings · automatic + overrides</summary><p>el-d90 imports exported proxy and CA settings from your login shell when launched normally. Use overrides here when needed. Blank fields use automatic settings. TLS certificate verification stays enabled.</p><div class="aws-connect-fields"><label>AWS CLI executable<input id="aws-executable-path" aria-label="AWS CLI executable path" placeholder="/Users/your-name/.local/bin/aws"></label><label>HTTPS proxy<input id="aws-https-proxy" aria-label="AWS HTTPS proxy" placeholder="http://proxy.example:8080"></label><label>Proxy bypass hosts<input id="aws-no-proxy" aria-label="AWS proxy bypass hosts" placeholder="localhost,127.0.0.1"></label><label>Company CA bundle<input id="aws-ca-bundle" aria-label="AWS CA bundle path" placeholder="/absolute/path/company-ca.pem"></label></div><button id="aws-network-refresh" class="button secondary">Refresh automatic settings</button><button id="aws-network-reset" class="button secondary">Use automatic settings for all fields</button><p id="aws-network-origins"></p><button id="aws-network-save" class="button secondary">Save connection settings</button><p id="aws-network-status" role="status"></p>';q('#aws-sso-setup').before(network);
  function showNetwork(value){q('#aws-network-origins').textContent=Object.entries({awsExecutable:'AWS CLI',httpsProxy:'Proxy',noProxy:'Proxy bypass',caBundle:'CA bundle'}).map(([key,label])=>label+': '+(value.origins?.[key]||'Automatic')).join(' · ');q('#aws-executable-path').value=value.awsExecutable||'';q('#aws-https-proxy').value=value.httpsProxy||'';q('#aws-no-proxy').value=value.noProxy||'';q('#aws-ca-bundle').value=value.caBundle||'';q('#aws-network-status').textContent=(value.warning?value.warning+' ':'')+'Automatic settings: proxy '+(value.source?.proxy?'available':'not detected')+', CA bundle '+(value.source?.caBundle?'available':'not detected')+'.';}
  if(!opts.demo)try{const value=await opts.invoke('aws:network-get');if(current())showNetwork(value);}catch(error){if(current())q('#aws-network-status').textContent=error.message;}
  q('#aws-network-save').onclick=async()=>{q('#aws-network-save').disabled=true;try{if(opts.demo){q('#aws-network-status').textContent='Demo only. Connection settings were not saved.';return;}const preferred=q('#aws-profile').value;const value=await opts.invoke('aws:network-save',{awsExecutable:q('#aws-executable-path').value,httpsProxy:q('#aws-https-proxy').value,noProxy:q('#aws-no-proxy').value,caBundle:q('#aws-ca-bundle').value});if(!current())return;invalidate();job=null;q('#aws-login-cancel').hidden=true;showNetwork(value);await overview(preferred);if(current())q('#aws-network-status').textContent='Saved. Network settings apply immediately. Add the EKS connection again if you changed its AWS executable. Choose Check AWS connection, then Load EKS clusters.';}catch(error){if(current())q('#aws-network-status').textContent=error.message;}finally{if(current())q('#aws-network-save').disabled=false;}};
  q('#aws-network-refresh').onclick=async()=>{q('#aws-network-refresh').disabled=true;try{if(opts.demo){q('#aws-network-status').textContent='Demo only. Automatic settings require a real connection.';return;}const value=await opts.invoke('aws:network-refresh');if(current()){const drafts=['#aws-executable-path','#aws-https-proxy','#aws-no-proxy','#aws-ca-bundle'].map(id=>q(id).value);showNetwork(value);drafts.forEach((draft,i)=>q(['#aws-executable-path','#aws-https-proxy','#aws-no-proxy','#aws-ca-bundle'][i]).value=draft);invalidate();q('#aws-network-status').textContent=value.warning||'Terminal settings refreshed. Manual overrides and unsaved edits are retained. Choose Check AWS connection.';}}catch(error){if(current())q('#aws-network-status').textContent=error.message;}finally{if(current())q('#aws-network-refresh').disabled=false;}};
  q('#aws-network-reset').onclick=()=>{for(const id of ['#aws-executable-path','#aws-https-proxy','#aws-no-proxy','#aws-ca-bundle'])q(id).value='';q('#aws-network-status').textContent='Automatic settings selected. Save connection settings to apply.';};
  q('#aws-sso-setup').hidden=true;
  resetDiscovery();
  await overview(preferredProfile);
  if(!opts.demo)try{ds('Checking your existing AWS SSO sign-in…');const resumeEpoch=discoveryEpoch,resumeProfileEpoch=epoch;const data=await opts.invoke('aws:sso-portals',{profile:q('#aws-profile').value});if(!current()||resumeEpoch!==discoveryEpoch||resumeProfileEpoch!==epoch)return;if(current()&&data.portals.length){q('#sso-portal').value=data.portals[0].startUrl;q('#sso-region').value=data.portals[0].ssoRegion;showConfiguredPortal();}if(current()&&data.active){if(data.active.selection?.profile&&q('#aws-profile').value!==data.active.selection.profile)await overview(data.active.selection.profile);if(!current()||resumeEpoch!==discoveryEpoch)return;discoveryId=data.active.id;q('#sso-portal').value=data.active.startUrl;q('#sso-region').value=data.active.ssoRegion;q('#sso-start').disabled=data.active.state==='running';q('#sso-cancel').hidden=data.active.state!=='running';q('#sso-reopen').hidden=data.active.state!=='running';await pollDiscovery(discoveryEpoch);}else if(current())ds(selected()?'Your saved AWS profile is available below. Sign in above only to discover accounts and roles.':'Sign in to discover your assigned accounts and roles.');if(current()&&selected()&&q('#aws-region').value.trim())await loadClusters();}catch{ds('Enter your SSO portal URL and region to begin.');}

} };
