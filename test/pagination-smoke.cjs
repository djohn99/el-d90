const{_electron}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'eld90-pages-'));let app;
(async()=>{try{app=await _electron.launch({executablePath:process.env.EL_D90_APP_EXECUTABLE||require('electron'),args:process.env.EL_D90_APP_EXECUTABLE?[]:[root],env:{...process.env,ELECTRON_RUN_AS_NODE:'',EL_D90_USER_DATA:profile,EL_D90_KUBECTL:path.join(root,'test/mock-kubectl.cjs')}});const p=await app.firstWindow();p.setDefaultTimeout(20000);await p.locator('#context option[value=fixture-a]').waitFor({state:'attached'});await require('./navigation-helpers.cjs').chooseContext(p,'fixture-a');await p.waitForFunction(()=>!state.loading);
await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('kube:list');ipcMain.handle('kube:list',(_e,input)=>new Promise(resolve=>{global.pageRequest={input,resolve};}));});
await p.evaluate(()=>{navigate('pods');});await p.waitForFunction(()=>state.loading);const id=await p.evaluate(()=>state.readRequestId);await app.evaluate(({BrowserWindow},id)=>{const pods=Array.from({length:120},(_,i)=>({apiVersion:'v1',kind:'Pod',metadata:{name:'page-pod-'+String(i).padStart(3,'0'),namespace:i%2?'prod':'stg'},spec:{containers:[{name:'web'}]},status:{phase:'Running'}}));global.pagePods=pods;BrowserWindow.getAllWindows()[0].webContents.send('kube:list-page',{context:'fixture-a',requestId:id,resource:'pods',items:pods});},id);
await p.locator('#resource-count').filter({hasText:'120 resources loaded'}).waitFor();
await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setSize(1080, 700));
await p.waitForFunction(() => outerWidth === 1080);
const layout = await p.evaluate(() => {
  const workspace = document.querySelector('main');
  const footer = document.querySelector('.content-footer');
  const table = document.querySelector('#resource-table .virtual-table-scroll');
  workspace.style.height = '1400px';
  try {
    const bottomPadding = parseFloat(getComputedStyle(footer.parentElement).paddingBottom);
    const usableBottom = workspace.getBoundingClientRect().top + workspace.clientHeight;
    return {
      unusedHeight: usableBottom - footer.getBoundingClientRect().bottom - bottomPadding,
      height: table.clientHeight,
      scrolls: table.scrollHeight > table.clientHeight
    };
  } finally {
    workspace.style.removeProperty('height');
  }
});
assert.ok(layout.unusedHeight <= 2, 'paginated table leaves unused workspace below the footer: '+JSON.stringify(layout));
assert.ok(layout.height > 560, 'table can grow beyond the old height cap');
assert.equal(layout.scrolls, true);
assert.equal(await p.locator('#resource-table tbody tr').count(),50);assert.ok(await p.locator('.virtual-table-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'paginated table overflowed');assert.equal(await p.locator('#resource-table .container-square').count(),50);assert.match(await p.locator('#resource-table .container-square').first().getAttribute('aria-label'),/web.*Status unavailable/);assert.equal(await p.evaluate(()=>state.loading),true);await p.getByRole('button',{name:'Next page',exact:true}).click();await p.locator('tr[aria-label="Open page-pod-050"]').waitFor();
await app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows()[0].webContents.send('kube:list-page',{context:'fixture-a',requestId:'stale-'+id,resource:'pods',items:[{metadata:{name:'STALE'}}]}),id);assert.equal(await p.locator('#resource-table').textContent().then(t=>t.includes('STALE')),false);
await app.evaluate(()=>global.pageRequest.resolve({items:global.pagePods}));await p.waitForFunction(()=>!state.loading);assert.equal(await p.getByRole('button',{name:'Previous page',exact:true}).isDisabled(),false);await p.getByLabel('Rows per page',{exact:true}).selectOption('100');assert.equal(await p.locator('#resource-table tbody tr').count(),100);await p.getByRole('button',{name:'Next page',exact:true}).click();assert.equal(await p.locator('#resource-table tbody tr').count(),20);assert.equal(await p.getByRole('button',{name:'Next page',exact:true}).isDisabled(),true);
await p.locator('#resource-table').getByRole('button',{name:'Name ↕',exact:true}).click();await p.locator('#resource-table').getByRole('button',{name:'Namespace ↕',exact:true}).click();await p.locator('#resource-table').getByRole('button',{name:'Name ↕',exact:true}).click();assert.equal(await p.locator('#resource-table th[data-pod-column=name]').getAttribute('aria-sort'),'ascending');await p.evaluate(()=>filterTable());await p.locator('#resource-table').getByRole('button',{name:'Name ↕',exact:true}).click();assert.equal(await p.locator('#resource-table th[data-pod-column=name]').getAttribute('aria-sort'),'descending');await p.locator('tr[aria-label="Open page-pod-119"]').waitFor();
await p.locator('#search').fill('page-pod-119');await p.locator('tr[aria-label="Open page-pod-119"]').waitFor();await p.waitForFunction(()=>document.querySelectorAll('#resource-table tbody tr').length===1);await p.locator('#search').fill('');await p.waitForFunction(()=>document.querySelectorAll('#resource-table tbody tr').length===100);await p.locator('tr[aria-label="Open page-pod-000"]').waitFor();await p.locator('#search').fill('page-pod-119');await p.waitForFunction(()=>document.querySelectorAll('#resource-table tbody tr').length===1);await p.locator('tr[aria-label="Open page-pod-119"]').click();await p.waitForFunction(()=>state.selected.metadata.namespace==='prod');console.log('PASS: resource first paint before final API response, page size/boundaries, page retention, global search, exact Pod namespace and stale progress isolation');
for (const count of [4, 52]) {
  const result = await p.evaluate(count => {
    const host = document.createElement('div');
    host.id = 'pod-age-fixture';
    document.body.append(host);
    const pod = i => ({
      kind: 'Pod', metadata: {name: 'pod-'+i, namespace: i%2 ? 'a' : 'b',
        creationTimestamp: new Date(Date.now() - i*12*3600000).toISOString()},
      status: {phase: i%2 ? 'Succeeded' : 'Running'}
    });
    const rows = Array.from({length:count}, (_, i) => pod(i)).reverse();
    const first = () => host.querySelector('tbody tr').getAttribute('aria-label');
    const toggle = () => host.querySelector('th[data-pod-column=age] button').click();
    try {
      renderTable(host.id, rows, 'pods');
      toggle();
      const youngest = first();
      toggle();
      const oldest = first();
      renderTable(host.id, [...rows, pod(count)], 'pods', Infinity, true);
      return [youngest, oldest, first()];
    } finally {
      host.remove();
    }
  }, count);
  assert.deepEqual(result, ['Open pod-0', 'Open pod-'+(count-1), 'Open pod-'+count]);
}
for (const count of [4, 52]) {
  for (const descending of [false, true]) {
    const result = await p.evaluate(({count, descending}) => {
      const host = document.createElement('div');
      host.id = 'pod-status-fixture';
      document.body.append(host);
      const pod = (index, phase) => ({
        kind: 'Pod', metadata: {name: 'status-'+index, namespace: index%2 ? 'a' : 'b',
          creationTimestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()},
        status: {phase}
      });
      try {
        const pods = Array.from({length: count}, (_, index) => pod(index, 'Running'));
        renderTable(host.id, pods, 'pods');
        const toggle = host.querySelector('th[data-pod-column=status] button');
        toggle.click();
        if (descending) toggle.click();
        const visibleNames = () => [...host.querySelectorAll('tbody td[data-pod-column=name]')].map(cell => cell.textContent);
        const before = visibleNames();
        renderTable(host.id, [...pods].reverse(), 'pods', Infinity, true);
        const after = visibleNames();
        pods[count-1] = pod(count-1, 'Succeeded');
        pods.push(pod(count, 'Pending'));
        renderTable(host.id, pods, 'pods', Infinity, true);
        const labels = () => [...host.querySelectorAll('tbody td[data-pod-column=status]')].map(cell => cell.textContent);
        const result = labels();
        const next = host.querySelector('.page-next');
        if (next && !next.disabled) {
          next.click();
          result.push(...labels());
        }
        return {before, after, labels: result};
      } finally {
        host.remove();
      }
    }, {count, descending});
    const expected = ['Completed', 'Pending', ...Array(count-1).fill('Running')];
    assert.deepEqual(result.before, Array.from({length:Math.min(count, 50)}, (_, i) => 'status-'+(count-1-i)));
    assert.deepEqual(result.after, result.before);
    assert.deepEqual(result.labels, descending ? expected.reverse() : expected);
  }
}
const ordering = await p.evaluate(() => {
  const host = document.createElement('div');
  host.id = 'sort-regression-fixture';
  document.body.append(host);
  try {
    const make = (name, group) => ({
      kind: 'Node', metadata: {name, labels: {'eks.amazonaws.com/nodegroup': group}}
    });
    const rows = () => [...host.querySelectorAll('tbody tr')].map(row => row.getAttribute('aria-label'));
    renderTable(host.id, [make('alpha', 'prod'), make('beta', 'general')], 'nodes');
    host.querySelector('th[data-node-column=group] button').click();
    const before = rows();
    renderTable(host.id, [make('alpha', 'aaa'), make('beta', 'zzz'), make('gamma', 'bbb')], 'nodes', Infinity, true);
    const after = rows();
    const sort = host.querySelector('th[data-node-column=group]').getAttribute('aria-sort');
    const services = Array.from({length: 52}, (_, index) => ({
      kind: 'Service', metadata: {name: 'service-'+index, namespace: index % 2 ? 'a' : 'z'}
    }));
    renderTable(host.id, services, 'services');
    host.querySelector('th[data-resource-column=namespace] button').click();
    const pagedBefore = rows();
    renderTable(host.id, services.map(item => ({...item, metadata: {...item.metadata}})).reverse(), 'services', Infinity, true);
    return {before, after, sort, pagedBefore, pagedAfter: rows()};
  } finally {
    host.remove();
  }
});
assert.deepEqual(ordering.before, ['Open beta', 'Open alpha']);
assert.deepEqual(ordering.after, ['Open beta', 'Open alpha', 'Open gamma']);
assert.equal(ordering.sort, 'ascending');
assert.deepEqual(ordering.pagedAfter, ordering.pagedBefore);
}finally{await app?.close();fs.rmSync(profile,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
