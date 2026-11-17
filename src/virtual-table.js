window.elD90VirtualTable={states:new WeakMap(),mount(container,options){
 const previous=this.states.get(container),key=container.dataset.pageFilter||options.tableOptions.storageKey;
 const saved=previous?.key===key?previous:{key,page:0,size:50};this.states.set(container,saved);
 const sortState=window.elD90Productivity.tableSort(container,options.tableOptions.storageKey);
 const entries=options.items.map((item,index)=>({item,index}));let enhanced;
 container.innerHTML=(options.help||'')+'<div class="resource-pages"><button class="button secondary page-previous" aria-label="Previous page">Previous</button><span class="virtual-table-status" role="status"></span><button class="button secondary page-next" aria-label="Next page">Next</button><div class="resource-page-options"><label>Rows per page <select aria-label="Rows per page"><option>50</option><option>100</option><option>250</option></select></label></div></div><div class="virtual-table-scroll" tabindex="0" aria-label="Scrollable resource table"><table class="'+(options.className||'')+'"><thead><tr>'+options.headers.join('')+'</tr></thead><tbody></tbody></table></div>';
 const viewport=container.querySelector('.virtual-table-scroll'),body=container.querySelector('tbody'),status=container.querySelector('.virtual-table-status'),previousButton=container.querySelector('.page-previous'),nextButton=container.querySelector('.page-next'),size=container.querySelector('[aria-label="Rows per page"]');size.value=String(saved.size);
 function sort(){if(sortState.index===null)return;const values=new Map(entries.map(e=>[e.index,options.values(e.item)[sortState.index]??'']));entries.sort((a,b)=>String(values.get(a.index)).localeCompare(String(values.get(b.index)),undefined,{numeric:true,sensitivity:'base'})*sortState.direction);}
 const itemKey = ({item}) => JSON.stringify([item.metadata.namespace, item.metadata.name]);
 if (options.preserveOrder && sortState.order) {
   const ranks = new Map(sortState.order.map((key, index) => [key, index]));
   entries.sort((a, b) => (ranks.get(itemKey(a)) ?? Infinity) - (ranks.get(itemKey(b)) ?? Infinity));
 } else sort();
 function paint(){
   sortState.order = entries.map(itemKey);const pages=Math.max(1,Math.ceil(entries.length/saved.size));saved.page=Math.max(0,Math.min(saved.page,pages-1));const start=saved.page*saved.size,end=Math.min(entries.length,start+saved.size);body.innerHTML=entries.slice(start,end).map(row=>options.row(row.item,row.index)).join('');enhanced?.apply?.();status.textContent='Page '+(saved.page+1)+' of '+pages+' · '+(start+1)+'–'+end+' of '+entries.length+' resources';previousButton.disabled=saved.page===0;nextButton.disabled=saved.page===pages-1;viewport.scrollTop=0;}
 previousButton.onclick=()=>{saved.page--;paint();};nextButton.onclick=()=>{saved.page++;paint();};size.onchange=()=>{saved.size=Number(size.value);saved.page=0;paint();};
 body.onclick=event=>{const row=event.target.closest('tr[data-index]');if(row)options.open(options.items[Number(row.dataset.index)],event);};body.onkeydown=event=>{if(event.key==='Enter'&&!event.target.closest('button')){event.preventDefault();event.target.closest('tr[data-index]')?.click();}};
 paint();enhanced=options.enhance(container,{...options.tableOptions,onSort:(column,direction)=>{sortState.index=column;sortState.direction=direction;sort();saved.page=0;paint();return sortState.direction;},exportRows:()=>entries.map(row=>options.values(row.item))});if (enhanced?.tools) {
   const columnMenu = enhanced.tools.querySelector('.table-columns');
   if (columnMenu) enhanced.tools.append(columnMenu);
   size.closest('.resource-page-options').append(enhanced.tools);
 }enhanced?.apply?.();if(sortState.index!==null)container.querySelectorAll('th')[sortState.index]?.setAttribute('aria-sort',sortState.direction===1?'ascending':'descending');return{count:entries.length};
}};
