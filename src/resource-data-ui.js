// Original ConfigMap data cards and local draft editor.
(function () {
  let clearCurrent = () => {}, updateCurrent = () => {};
  function clear() { clearCurrent(); }
  function attach(host, opts) {
    clear(); let epoch = 0, baseline = '', editing = false;
    const status = document.createElement('p'), tools = document.createElement('div'), cards = document.createElement('div');
    tools.className = 'resource-data-tools'; cards.id = 'configmap-data'; status.setAttribute('role', 'status');
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Find a data key…'; search.setAttribute('aria-label', 'Find ConfigMap data key');
    function button(text, fn) { const el = document.createElement('button'); el.className = 'button secondary'; el.textContent = text; el.onclick = fn; return el; }
    const edit = button('Edit data', startEdit); edit.id = 'configmap-edit-data'; edit.disabled = opts.object.immutable === true;
    const review = button('Review YAML changes', stage), cancel = button('Cancel data edits', reset), add = button('Add data key', () => card({ key: '', value: '', binary: false }, true));
    review.id = 'configmap-review-data'; cancel.id = 'configmap-cancel-data'; add.id = 'configmap-add-data';
    tools.append(search, edit, add, review, cancel); host.append(tools, status, cards);
    function available() { return host.isConnected && opts.isCurrent(); }
    function card(field, editable) {
      const section = document.createElement('section'); section.className = 'resource-data-card'; section.dataset.key = field.key;
      const heading = document.createElement('div'); heading.className = 'resource-data-heading';
      if (editable) {
        const key = document.createElement('input'); key.className = 'data-key'; key.value = field.key; key.setAttribute('aria-label', 'Data key');
        const type = document.createElement('select'); type.className = 'data-type'; type.setAttribute('aria-label', 'Data encoding'); type.add(new Option('Text', 'text')); type.add(new Option('Binary (base64)', 'binary')); type.value = field.binary ? 'binary' : 'text';
        heading.append(key, type, button('Remove key', () => section.remove()));
        const value = document.createElement('textarea'); value.className = 'data-value'; value.value = field.value; value.rows = Math.max(3, Math.min(12, field.value.split('\n').length + 1)); value.setAttribute('aria-label', 'Value for ' + (field.key || 'new key')); section.append(heading, value);
      } else {
        const key = document.createElement('strong'); key.textContent = field.key;
        const encoding = document.createElement('span'); encoding.className = 'subtle'; encoding.textContent = field.binary ? 'Binary · base64' : 'Text';
        heading.append(key, encoding, button('Copy value', async () => { try { await navigator.clipboard.writeText(field.value); if (available()) status.textContent = 'Value copied.'; } catch { if (available()) status.textContent = 'Copy unavailable. Select the value to copy it.'; } }));
        const content = document.createElement('pre'); content.className = 'resource-data-value'; const short = field.value.length > 5000;
        content.textContent = field.value === '' ? '(empty value)' : short ? field.value.slice(0, 5000) + '\n…' : field.value;
        if (short) heading.append(button('Show full value', event => { const expanded = event.target.textContent === 'Show full value'; content.textContent = expanded ? field.value : field.value.slice(0, 5000) + '\n…'; event.target.textContent = expanded ? 'Collapse value' : 'Show full value'; }));
        section.append(heading, content);
      }
      cards.append(section);
    }
    function paint(fields) { cards.replaceChildren(); for (const field of fields) card(field, editing); if (!fields.length && !editing) cards.textContent = 'No data keys.'; search.value = ''; search.disabled = editing; edit.hidden = editing; for (const el of [add, review, cancel]) el.hidden = !editing; }
    function initial() { return ['data', 'binaryData'].flatMap(property => Object.entries(opts.object[property] || {}).map(([key, value]) => ({ key, value, binary: property === 'binaryData' }))); }
    function reset() { ++epoch; baseline = ''; editing = false; edit.disabled = opts.object.immutable === true; status.textContent = opts.object.immutable ? 'This ConfigMap is immutable. Values can be viewed and copied.' : ''; paint(initial()); }
    clearCurrent = () => { ++epoch; baseline = ''; editing = false; cards.replaceChildren(); };
    updateCurrent = object => { if (object.kind!=='ConfigMap'||object.metadata?.uid!==opts.object.metadata?.uid)return;const changed=object.metadata.resourceVersion!==opts.object.metadata.resourceVersion;opts.object=object;if(!editing&&changed)reset();else if(editing&&changed)status.textContent='The cluster resource changed while you were editing. Your local draft is retained; review before applying.'; };
    search.oninput = () => { const query = search.value.toLowerCase(); for (const row of cards.querySelectorAll('.resource-data-card')) row.hidden = !row.dataset.key.toLowerCase().includes(query); };
    async function startEdit() {
      if (opts.hasDraft()) { status.textContent = 'Review or reset the existing YAML draft before editing data here.'; return; }
      const own = ++epoch; edit.disabled = true; status.textContent = 'Loading the current manifest…';
      try {
        const text = opts.demo ? JSON.stringify(opts.object, null, 2) : await opts.invoke('kube:yaml', opts.input);
        if (epoch !== own || !available()) return;
        const parsed = await opts.invoke('resource-data:read', { text, identity: opts.identity });
        if (epoch !== own || !available()) return;
        if (parsed.immutable) throw Error('This ConfigMap is immutable');
        baseline = text; editing = true; status.textContent = 'Local draft. Review YAML, validate and apply to save cluster changes.'; paint(parsed.fields);
      } catch (error) { if (epoch === own && available()) { status.textContent = error.message; edit.disabled = false; } }
    }
    async function stage() {
      const own = epoch; review.disabled = true;
      try {
        if (opts.hasDraft()) throw Error('The YAML editor has a newer draft. Review it before replacing data.');
        const fields = Array.from(cards.querySelectorAll('.resource-data-card')).map(row => ({ key: row.querySelector('.data-key').value, value: row.querySelector('.data-value').value, binary: row.querySelector('.data-type').value === 'binary' }));
        const result = await opts.invoke('resource-data:write', { text: baseline, identity: opts.identity, fields });
        if (epoch !== own || !available()) return;
        if (opts.hasDraft()) throw Error('The YAML editor has a newer draft. Review it first.');
        const draft={ original: baseline, text: result.text };reset();opts.onReview(draft);
      } catch (error) { if (epoch === own && available()) status.textContent = error.message; }
      finally { review.disabled = false; }
    }
    reset();
  }
  window.elD90ResourceData = { attach, clear, update: object => updateCurrent(object) };
})();
