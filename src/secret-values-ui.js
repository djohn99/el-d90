// Revealed data stays only in this detail panel; it is never added to workspace state.
(function () {
  let clearCurrent = () => {};
  function clear() { clearCurrent(); }
  function attach(host, opts) {
    clear();
    let epoch = 0;
    const disposeRows = [];
    const status = document.createElement('p'), values = document.createElement('div'), reveal = document.createElement('button'), hide = document.createElement('button');
    reveal.id = 'secret-reveal'; reveal.className = hide.className = 'button secondary'; reveal.textContent = 'Reveal decoded values';
    hide.id = 'secret-hide'; hide.textContent = 'Hide values'; hide.hidden = true; values.id = 'secret-values'; status.setAttribute('role', 'status');
    host.append(reveal, hide, status, values);
    const reset = () => { ++epoch; for (const dispose of disposeRows.splice(0)) dispose(); values.replaceChildren(); status.textContent = ''; hide.hidden = true; reveal.disabled = false; reveal.hidden = false; };
    clearCurrent = reset;
    hide.onclick = reset;
    reveal.onclick = async () => {
      const ownEpoch = ++epoch; reveal.disabled = true; status.textContent = 'Requesting Secret values…';
      try {
        const result = opts.demo ? { entries: [{ key: 'username', value: 'demo-user', encoding: 'UTF-8', bytes: 9 }, { key: 'password', value: 'demo-password-only', encoding: 'UTF-8', bytes: 18 }] } : await opts.invoke('secret:reveal', opts.input);
        if (epoch !== ownEpoch || !host.isConnected || !opts.isCurrent()) return;
        if (result.cancelled) { reset(); status.textContent = 'Reveal cancelled.'; return; }
        values.replaceChildren();
        for (const entry of result.entries) {
          const row = document.createElement('section'), heading = document.createElement('h4'), content = document.createElement('pre'), actions = document.createElement('div'), toggle = document.createElement('button'), copy = document.createElement('button'), feedback = document.createElement('span');
          let rawValue = entry.value, visible = true, closeEditor = () => {};
          const isCurrent = () => epoch === ownEpoch && row.isConnected && opts.isCurrent();
          heading.textContent = entry.key + ' · ' + entry.encoding + ' · ' + entry.bytes + ' bytes';
          content.className = 'secret-value'; content.textContent = rawValue === '' ? '(empty value)' : rawValue;
          row.dataset.secretKey = entry.key;
          actions.className = 'workload-actions';
          toggle.className = copy.className = 'button secondary'; toggle.textContent = 'Hide'; toggle.setAttribute('aria-label', 'Hide ' + entry.key); toggle.setAttribute('aria-expanded', 'true');
          copy.textContent = entry.binary ? 'Copy base64' : 'Copy value'; copy.setAttribute('aria-label', 'Copy ' + entry.key);
          feedback.setAttribute('role', 'status');
          toggle.onclick = () => {
            visible = !visible;
            content.textContent = visible ? rawValue === '' ? '(empty value)' : rawValue : 'Value hidden';
            toggle.textContent = visible ? 'Hide' : 'Show'; toggle.setAttribute('aria-label', (visible ? 'Hide ' : 'Show ') + entry.key); toggle.setAttribute('aria-expanded', String(visible));
            if (!visible) closeEditor();
            feedback.textContent = '';
          };
          copy.onclick = async () => {
            if (!isCurrent()) return;
            try { await navigator.clipboard.writeText(rawValue); if (isCurrent()) feedback.textContent = 'Copied'; }
            catch { if (isCurrent()) feedback.textContent = 'Copy unavailable. Select the visible value to copy it.'; }
          };
          actions.append(toggle, copy);
          let editor;
          if (typeof opts.onEdit === 'function') {
            const edit = document.createElement('button'), stage = document.createElement('button'), cancel = document.createElement('button'), editorPanel = document.createElement('div');
            editor = document.createElement('textarea'); editor.rows = 5; editor.className = 'secret-value'; editor.setAttribute('aria-label', 'Edit ' + entry.key); editor.spellcheck = false;
            edit.className = stage.className = cancel.className = 'button secondary'; edit.textContent = 'Edit value'; edit.setAttribute('aria-label', 'Edit ' + entry.key);
            stage.textContent = 'Stage in YAML'; cancel.textContent = 'Cancel edit'; editorPanel.hidden = true;
            editorPanel.append(editor, stage, cancel); actions.append(edit);
            const cancelEdit = () => { editor.value = ''; editorPanel.hidden = true; edit.disabled = false; feedback.textContent = ''; };
            closeEditor = cancelEdit;
            edit.onclick = () => { if (!isCurrent()) return; editor.value = rawValue; editorPanel.hidden = false; edit.disabled = true; editor.focus(); };
            cancel.onclick = cancelEdit;
            stage.onclick = async () => {
              if (!isCurrent()) return;
              stage.disabled = true;
              try { await opts.onEdit({ key: entry.key, value: editor.value, encoding: entry.encoding }); if (isCurrent()) { cancelEdit(); feedback.textContent = 'Staged in YAML. Review and apply the manifest to save.'; } }
              catch { if (isCurrent()) feedback.textContent = 'Could not stage this edit. Refresh the Secret and try again.'; }
              finally { stage.disabled = false; }
            };
            row.append(heading, content, actions, editorPanel, feedback);
          } else row.append(heading, content, actions, feedback);
          disposeRows.push(() => { rawValue = ''; content.textContent = ''; if (editor) editor.value = ''; feedback.textContent = ''; });
          values.append(row);
        }
        status.textContent = result.entries.length ? 'Values are visible in this panel only.' : 'This Secret has no data keys.';
        hide.hidden = false; reveal.hidden = true;
      } catch { if (epoch === ownEpoch && opts.isCurrent()) { reset(); status.textContent = 'Could not reveal values. Check Secret read permission and refresh the resource.'; } }
      finally { if (epoch === ownEpoch) reveal.disabled = false; }
    };
  }
  window.elD90SecretValues = { attach, clear };
})();
