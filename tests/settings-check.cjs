'use strict';
const assert=require('node:assert/strict');
module.exports=async function checkSettings(page,base){
 await page.goto(base+'/');await page.locator('.account-open').first().click();
 await page.locator('#open-settings').click();
 assert.equal(await page.locator('#settings-editor-tab').getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('#settings-editor-panel').isVisible(),true);
 assert.match(await page.locator('#settings-editor-panel').textContent(),/Editor.js/);
 await page.locator('#editor-mode').selectOption('classic');
 await page.evaluate(()=>{
  const original=window.__TAURI__.core.invoke;window.settingsCommands=[];
  window.__TAURI__.core.invoke=async(command,args)=>{
   window.settingsCommands.push(command);
   if(command==='list_accounts'){
    if(window.settingsError)throw Error('fixture');
    if(window.settingsEmpty)return [];
    return [{account:'Александр',server:'https://nas.example:5001',mode:'strict'},{account:'Рабочий аккаунт',server:'https://office.example:5001',mode:'unverified_tls'}];
   }
   return original(command,args);
  };
 });
 await page.locator('#settings-sessions-tab').click();await page.waitForFunction(()=>document.querySelectorAll('.settings-session-card').length===2);
 assert.equal(await page.locator('#settings-editor-panel').isVisible(),false);
 assert.ok((await page.evaluate(()=>window.settingsCommands)).every(command=>command==='list_accounts'));
 await page.locator('#settings-sessions-tab').focus();await page.keyboard.press('ArrowLeft');
 assert.equal(await page.locator('#settings-editor-tab').getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('#editor-mode').inputValue(),'classic');
 await page.locator('#settings-sessions-tab').click();await page.waitForFunction(()=>document.querySelectorAll('.settings-session-card').length===2);
 for(const [width,height]of[[1440,1000],[900,600],[450,300]]){
  await page.setViewportSize({width,height});const box=await page.locator('#app-settings').boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1);
  const apply=await page.locator('#apply-settings').boundingBox();assert.ok(apply.y+apply.height<=height+1);
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>window.settingsError=true);await page.locator('#settings-sessions-refresh').click();await page.waitForFunction(()=>document.getElementById('settings-sessions-status').textContent.includes('Не удалось'));
 await page.evaluate(()=>{window.settingsError=false;window.settingsEmpty=true;});await page.locator('#settings-sessions-refresh').click();await page.waitForFunction(()=>document.getElementById('settings-sessions-status').textContent.includes('пока нет'));
 await page.keyboard.press('Escape');await page.locator('#app-settings').waitFor({state:'hidden'});
 await page.locator('#open-settings').click();assert.equal(await page.locator('#settings-editor-tab').getAttribute('aria-selected'),'true');
 await page.locator('#cancel-settings').click();
 console.log('PASS settings tabs, keyboard, public saved sessions, errors, empty state, cancellation and viewport sizes');
};
