// Exercise the same picker and native File menu that users operate.
async function chooseContext(page,value){await page.locator('#context-trigger').click();await page.locator('#context-search').fill(value);await page.locator('#context-options').getByRole('button',{name:value,exact:true}).click();}
async function fileView(app,view){await app.evaluate(({Menu},view)=>{const item=Menu.getApplicationMenu().getMenuItemById('navigate-'+view);if(!item)throw Error('Missing File menu item: '+view);item.click();},view);}
module.exports={chooseContext,fileView};
async function sidebarView(page,view){const button=page.locator('.nav-item[data-view="'+view+'"]');if(!await button.count()){await page.evaluate(view=>navigate(view),view);return;}const groups=button.locator('xpath=ancestor::details');for(let i=(await groups.count())-1;i>=0;i--){const group=groups.nth(i);if(!await group.evaluate(e=>e.open))await group.locator(':scope > summary').click();}await button.click();}
module.exports.sidebarView=sidebarView;
