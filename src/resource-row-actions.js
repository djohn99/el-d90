(function(root, createRowActions) {
  if (typeof module === 'object' && module.exports) module.exports = createRowActions;
  else root.elD90RowActions = createRowActions;
})(typeof window !== 'undefined' ? window : globalThis, function createRowActions(opts) {
  const prefix = opts.onAction ? 'resource-actions-' + crypto.randomUUID() : '';

  function markup(resource, index) {
    const id = prefix + '-' + index;
    const buttons = opts.actions(resource).map(([action, label], index) =>
      `<button type="button"${index === 0 ? ' autofocus' : ''}${action === 'delete' ? ' class="danger-button"' : ''} data-row-action="${action}">${label}</button>`
    ).join('');
    return `<div class="resource-row-actions">
      <button type="button" class="resource-row-menu-button" popovertarget="${id}" aria-label="Actions for ${opts.escape(resource.metadata.name)}">⋮</button>
      <div id="${id}" class="resource-row-menu" popover aria-label="Resource actions">${buttons}</div>
    </div>`;
  }

  function position(trigger, menu) {
    const rect = trigger.getBoundingClientRect();
    const height = Math.min(menu.scrollHeight || 270, 270);
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    const openAbove = below < height + 8 && above > below;
    menu.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
    menu.style.top = openAbove ? 'auto' : rect.bottom + 4 + 'px';
    menu.style.bottom = openAbove ? window.innerHeight - rect.top + 4 + 'px' : 'auto';
    menu.style.maxHeight = Math.max(32, (openAbove ? above : below) - 12) + 'px';
  }

  function bindContext(host, rowSelector = 'tr[data-index]') {
    host.oncontextmenu = event => {
      const trigger = event.target.closest(rowSelector)?.querySelector('.resource-row-menu-button');
      if (!trigger) return;
      event.preventDefault();
      const menu = document.getElementById(trigger.getAttribute('popovertarget'));
      menu.showPopover({source: trigger});
      position(trigger, menu);
    };
  }

  function enhance(host, options) {
    if (opts.onAction) bindContext(host.querySelector('table'));
    return opts.enhance(host, options);
  }

  function open(resource, event) {
    const actions = event.target.closest('.resource-row-actions');
    if (!actions) return opts.onOpen(resource);

    const menu = actions.querySelector('.resource-row-menu');
    const trigger = event.target.closest('.resource-row-menu-button');
    if (trigger) {
      position(trigger, menu);
      return;
    }
    const action = event.target.closest('[data-row-action]')?.dataset.rowAction;
    if (!action) return;
    menu.hidePopover();
    opts.onAction(resource, action);
  }

  return {markup, bindContext, enhance, open};
});
