'use strict';
const assert=require('node:assert/strict');
module.exports=async function checkLinks(page,base){
 for(const mode of ['blocks','classic']){
  await page.goto(base+'/');await page.locator('.account-open').first().click();
  await page.evaluate(()=>{
   const original=window.__TAURI__.core.invoke;
   window.openedLinks=[];window.linkWrites=[];
   window.__TAURI__.core.invoke=async(command,args)=>{
    if(command==='get_note')return {object_id:args.id,ver:'v1',title:'Link fixture',encrypted:false,content:'<p>Начало <strong>выделенный текст</strong> конец.</p><p><a href="https://example.org/old">Старый сайт</a></p>'};
    if(command==='open_external_url'){window.openedLinks.push(args.url);return null;}
    if(command==='save_note'){window.linkWrites.push(args);return {note:{object_id:args.id,ver:'v2',title:args.title,content:args.content,encrypted:false},notice:null};}
    return original(command,args);
   };
  });
  await page.locator('#notes .note-row').first().click();await page.locator('#note-content a').click();
  await page.waitForFunction(()=>window.openedLinks.length===1);
  assert.equal(await page.locator('#note-editor').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.openedLinks[0]),'https://example.org/old');
  await page.locator('#open-settings').click();await page.locator('#editor-mode').selectOption(mode);await page.locator('#apply-settings').click();
  await page.locator('#note-content p').first().click();await page.waitForFunction(()=>!document.getElementById('format-link').disabled);
  const choose=async existing=>page.evaluate(({mode,existing})=>{
   const root=mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody();
   const target=root.querySelector(existing?'a':'strong,b');const doc=target.ownerDocument,range=doc.createRange();
   if(mode==='classic')window.tinymce.get('edit-content').focus();else target.closest('[contenteditable="true"]').focus();
   range.selectNodeContents(target);if(existing)range.collapse(true);
   const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);
   doc.dispatchEvent(new Event('selectionchange'));target.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  },{mode,existing});
  await choose(false);await page.locator('#format-link').click();
  assert.equal(await page.locator('#format-link-text').inputValue(),'выделенный текст');
  await page.locator('#format-link-url').fill('javascript:alert(1)');await page.locator('#format-link-form button[type="submit"]').click();
  assert.equal(await page.locator('#format-link-dialog').isVisible(),true);
  await page.locator('#format-link-url').fill('example.org/new');await page.locator('#format-link-form button[type="submit"]').click();
  await page.locator('#format-link-dialog').waitFor({state:'hidden'});await page.waitForFunction(()=>document.getElementById('edit-state').textContent.includes('Есть'));
  const links=()=>mode==='blocks'?page.locator('#block-content a'):page.locator('#classic-surface iframe').contentFrame().locator('body a');
  assert.equal(await links().filter({hasText:'выделенный текст'}).count(),1);
  await page.evaluate(mode=>{
   const root=mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody();
   const selection=root.ownerDocument.getSelection();selection.removeAllRanges();
  },mode);
  await links().filter({hasText:'выделенный текст'}).click();await page.waitForFunction(()=>window.openedLinks.length===2);
  assert.equal(await page.evaluate(()=>window.openedLinks.at(-1)),'https://example.org/new');
  await choose(true);await page.keyboard.press('Control+Enter');await page.waitForFunction(()=>window.openedLinks.length===3);
  await choose(true);await page.keyboard.press('Control+k');await page.locator('#format-link-dialog').waitFor({state:'visible'});
  await page.locator('#format-link-url').fill('https://example.org/changed');await page.locator('#format-link-text').fill('Новый сайт');
  await page.locator('#format-link-form button[type="submit"]').click();await page.locator('#format-link-dialog').waitFor({state:'hidden'});
  assert.equal(await links().filter({hasText:'Новый сайт'}).count(),1);
  await page.locator('#editor-undo').click();await page.waitForFunction(()=>!document.getElementById('editor-undo').disabled);assert.equal(await links().filter({hasText:'Новый сайт'}).count(),0);
  await page.locator('#editor-redo').click();await page.waitForFunction(()=>!document.getElementById('editor-redo').disabled);assert.equal(await links().filter({hasText:'Новый сайт'}).count(),1);
  // Insert a complete link at a plain-text caret without a prior selection.
  await page.evaluate(mode=>{
   const root=mode==='blocks'?document.querySelector('#block-content .ce-paragraph'):window.tinymce.get('edit-content').getBody().querySelector('p');
   if(mode==='classic')window.tinymce.get('edit-content').focus();else root.focus();
   const doc=root.ownerDocument,range=doc.createRange();range.selectNodeContents(root);range.collapse(false);
   const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);doc.dispatchEvent(new Event('selectionchange'));
  },mode);
  await page.locator('#format-link').click();await page.locator('#format-link-url').fill('https://example.org/insert');await page.locator('#format-link-text').fill('Вставленный сайт');
  await page.locator('#format-link-form button[type="submit"]').click();await page.locator('#format-link-dialog').waitFor({state:'hidden'});
  assert.equal(await links().filter({hasText:'Вставленный сайт'}).count(),1);
  await page.locator('#save-note').click();await page.locator('#note-editor').waitFor({state:'hidden'});
  const saved=await page.evaluate(()=>window.linkWrites[0]);assert.match(saved.content,/https:\/\/example.org\/changed/);assert.match(saved.content,/https:\/\/example.org\/insert/);assert.match(saved.content,/<(?:b|strong)>/);
  const href=await page.locator('#note-content a').filter({hasText:'Вставленный сайт'}).getAttribute('href');assert.equal(href,'https://example.org/insert');
  console.log(`PASS ${mode}: reader/editor link click, selected text, URL validation, edit, insertion at caret, undo/redo and saved links`);
 }
};
