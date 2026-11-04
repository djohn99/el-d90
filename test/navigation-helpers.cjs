// Exercise the same picker and native File menu that users operate.
async function chooseContext(page,value){await page.locator('#context-trigger').click();await page.locator('#context-search').fill(value);await page.locator('#context-options').getByRole('button',{name:value,exact:true}).click();}
async function fileView(app,view){await app.evaluate(({Menu},view)=>{const item=Menu.getApplicationMenu().getMenuItemById('navigate-'+view);if(!item)throw Error('Missing File menu item: '+view);item.click();},view);}
module.exports={chooseContext,fileView};
