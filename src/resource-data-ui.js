// Original ConfigMap data cards and local draft editor.
(function () {
  let clearCurrent = () => {}, updateCurrent = () => {};
  const drafts=new Map(); // ConfigMap drafts stay in memory, scoped to context and immutable UID.
  function clear() { clearCurrent(); }
  function attach(host, opts) {
    clear(); let epoch = 0, baseline = '', editing = false, originalFields='';
    const draftKey=JSON.stringify([opts.input.context,opts.identity.namespace,opts.identity.name,opts.identity.uid]);
    const fields=()=>Array.from(cards.querySelectorAll('.resource-data-card')).map(row=>({key:row.querySelector('.data-key').value,value:row.querySelector('.data-value').value,binary:row.querySelector('.data-type').value==='binary'}));
    const status = document.createElement('p'), tools = document.createElement('div'), cards = document.createElement('div');
    tools.className = 'resource-data-tools'; cards.id = 'configmap-data'; status.setAttribute('role', 'status');
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Find a data key…'; search.setAttribute('aria-label', 'Find ConfigMap data key');
    function button(text, fn) { const el = document.createElement('button'); el.className = 'button secondary'; el.textContent = text; el.onclick = fn; return el; }
    const edit = button('Edit data', startEdit); edit.id = 'configmap-edit-data'; edit.disabled = opts.object.immutable === true;
    const save = button('Save', () => stage('save')), saveClose = button('Save & Close', () => stage('close'));save.id='configmap-save-data';saveClose.id='configmap-save-close';save.className='button primary';
    const review = button('Review YAML changes', () => stage('review')), cancel = button('Cancel data edits', reset), add = button('Add data key', () => card({ key: '', value: '', binary: false }, true));
    review.id = 'configmap-review-data'; cancel.id = 'configmap-cancel-data'; add.id = 'configmap-add-data';
    tools.append(search, edit, add, save, saveClose, review, cancel); host.append(tools, status, cards);
    function available() { return host.isConnected && opts.isCurrent(); }
    function card(field, editable) {
      const section = document.createElement('section'); section.className = 'resource-data-card'; section.dataset.key = field.key;
      const heading = document.createElement('div'); heading.className = 'resource-data-heading';
      if (editable) {
        const key = document.createElement('input'); key.className = 'data-key'; key.value = field.key; key.setAttribute('aria-label', 'Data key');
        const type = document.createElement('select'); type.className = 'data-type'; type.setAttribute('aria-label', 'Data encoding'); type.add(new Option('Text', 'text')); type.add(new Option('Binary (base64)', 'binary')); type.value = field.binary ? 'binary' : 'text';
        heading.append(key, type, button('Remove key', () => section.remove()));
        const value = document.createElement('textarea'); value.className = 'data-value'; value.value = field.value; value.rows = Math.max(3, Math.min(30, Math.max(8,field.value.split('\n').length + 1))); value.setAttribute('aria-label', 'Value for ' + (field.key || 'new key')); section.append(heading, value);
      } else {
        const key = document.createElement('strong'); key.textContent = field.key;
        const encoding = document.createElement('span'); encoding.className = 'subtle'; encoding.textContent = field.binary ? 'Binary · base64' : 'Text';
        heading.append(key, encoding, button('Edit', async () => {if(opts.object.immutable)return;await startEdit();if(editing){const row=[...cards.children].find(row=>row.querySelector('.data-key')?.value===field.key);row?.querySelector('.data-value')?.focus();}}), button('Copy value', async () => { try { await navigator.clipboard.writeText(field.value); if (available()) status.textContent = 'Value copied.'; } catch { if (available()) status.textContent = 'Copy unavailable. Select the value to copy it.'; } }));
        const content = document.createElement('pre'); content.className = 'resource-data-value'; const short = field.value.length > 5000;
        content.textContent = field.value === '' ? '(empty value)' : short ? field.value.slice(0, 5000) + '\n…' : field.value;
        if (short) heading.append(button('Show full value', event => { const expanded = event.target.textContent === 'Show full value'; content.textContent = expanded ? field.value : field.value.slice(0, 5000) + '\n…'; event.target.textContent = expanded ? 'Collapse value' : 'Show full value'; }));
        section.append(heading, content);
      }
      cards.append(section);
    }
    function paint(fields) { cards.replaceChildren(); for (const field of fields) card(field, editing); if (!fields.length && !editing) cards.textContent = 'No data keys.'; search.value = ''; search.disabled = editing; edit.hidden = editing; for (const el of [add, save, saveClose, review, cancel]) el.hidden = !editing; }
    function initial() { return ['data', 'binaryData'].flatMap(property => Object.entries(opts.object[property] || {}).map(([key, value]) => ({ key, value, binary: property === 'binaryData' }))); }
    function reset() { drafts.delete(draftKey);++epoch; baseline = ''; editing = false; edit.disabled = opts.object.immutable === true; status.textContent = opts.object.immutable ? 'This ConfigMap is immutable. Values can be viewed and copied.' : ''; paint(initial()); }
    clearCurrent = () => { if(editing&&JSON.stringify(fields())!==originalFields){drafts.set(draftKey,{baseline,fields:fields(),originalFields});if(drafts.size>20)drafts.delete(drafts.keys().next().value);}++epoch; baseline = ''; editing = false; cards.replaceChildren(); };
    updateCurrent = object => { if (object.kind!=='ConfigMap'||object.metadata?.uid!==opts.object.metadata?.uid)return;const changed=object.metadata.resourceVersion!==opts.object.metadata.resourceVersion;opts.object=object;if(!editing&&changed)reset();else if(editing&&changed)status.textContent='The cluster resource changed while you were editing. Your local draft is retained; review before applying.'; };
    search.oninput = () => { const query = search.value.toLowerCase(); for (const row of cards.querySelectorAll('.resource-data-card')) row.hidden = !row.dataset.key.toLowerCase().includes(query); };
    async function startEdit() {
      if (opts.hasDraft()) { status.textContent = 'Review or reset the existing YAML draft before editing data here.'; return; }
      const retained=drafts.get(draftKey);if(retained){baseline=retained.baseline;originalFields=retained.originalFields;editing=true;paint(retained.fields);status.textContent='Restored unsaved data edits. Review and Save when ready.';return;}
      const own = ++epoch; edit.disabled = true; status.textContent = 'Loading the current manifest…';
      try {
        const text = opts.demo ? JSON.stringify(opts.object, null, 2) : await opts.invoke('kube:yaml', opts.input);
        if (epoch !== own || !available()) return;
        const parsed = await opts.invoke('resource-data:read', { text, identity: opts.identity });
        if (epoch !== own || !available()) return;
        if (parsed.immutable) throw Error('This ConfigMap is immutable');
        baseline = text;originalFields=JSON.stringify(parsed.fields); editing = true; status.textContent = 'Edit values below, then Save. Multiline text is preserved.'; paint(parsed.fields);
      } catch (error) { if (epoch === own && available()) { status.textContent = error.message; edit.disabled = false; } }
    }
    async function stage(action) {
      const own = epoch;if(save.disabled)return;for(const control of [save,saveClose,review,add,cancel])control.disabled=true;for(const field of cards.querySelectorAll('input,textarea,select,button'))field.disabled=true;status.textContent=action==='review'?'Preparing YAML…':'Validating changes…';
      try {
        if (opts.hasDraft()) throw Error('The YAML editor has a newer draft. Review it before replacing data.');
        const fields = Array.from(cards.querySelectorAll('.resource-data-card')).map(row => ({ key: row.querySelector('.data-key').value, value: row.querySelector('.data-value').value, binary: row.querySelector('.data-type').value === 'binary' }));
        const result = await opts.invoke('resource-data:write', { text: baseline, identity: opts.identity, fields });
        if (epoch !== own || !available()) return;
        if (opts.hasDraft()) throw Error('The YAML editor has a newer draft. Review it first.');
        const draft={ original: baseline, text: result.text };
        if(action==='review'){reset();opts.onReview(draft);return;}
        const saved=await opts.onSave(draft);if(epoch!==own||!available()){const retained=drafts.get(draftKey);if(!saved.cancelled&&retained&&JSON.stringify(retained.fields)===JSON.stringify(fields))drafts.delete(draftKey);return;}
        if(saved.cancelled){status.textContent='Save cancelled. Your edits are still here.';return;}
        const data=Object.create(null),binaryData=Object.create(null);for(const field of saved.fields)(field.binary?binaryData:data)[field.key]=field.value;
        opts.object={...opts.object,data,binaryData,metadata:{...opts.object.metadata,resourceVersion:saved.resourceVersion}};reset();status.textContent='Saved.';if(action==='close')opts.onClose?.();
      } catch (error) { if (epoch === own && available()) status.textContent = error.message; }
      finally { for(const control of [save,saveClose,review,add,cancel])control.disabled=control.dataset.permissionDenied==='true'||control.dataset.policyBlocked==='true';for(const field of cards.querySelectorAll('input,textarea,select,button'))field.disabled=false; }
    }
    cards.addEventListener('keydown',event=>{if(editing&&(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='s'){event.preventDefault();stage('save');}});
    const retained=drafts.get(draftKey);reset();if(retained){drafts.set(draftKey,retained);startEdit();}
  }
  window.elD90ResourceData = { attach, clear, update: object => updateCurrent(object) };
})();
