'use strict';
const assert=require('node:assert/strict');
module.exports=async function checkTypography(page,base){
 for(const mode of ['blocks','classic']){
  if(page.url().startsWith(base))await page.evaluate(()=>sessionStorage.removeItem('note-station-editor-fixture'));
  await page.goto(base+'/');await page.locator('.account-open').first().click();
  await page.locator('#notes .note-row').first().click();await page.waitForFunction(()=>document.getElementById('note-content').textContent.length>0);
  await page.locator('#open-settings').click();await page.locator('#editor-mode').selectOption(mode);await page.locator('#apply-settings').click();
  await page.locator('#note-content p').first().click();
  await page.waitForFunction(()=>!document.getElementById('format-font-family').disabled);
  const selectText=async()=>page.evaluate(mode=>{
   const root=mode==='blocks'?document.querySelector('#block-content .ce-paragraph'):window.tinymce.get('edit-content').getBody().querySelector('p');
   if(mode==='classic')window.tinymce.get('edit-content').focus();else root.focus();
   const doc=root.ownerDocument,range=doc.createRange();range.selectNodeContents(root);
   const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);
   root.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));doc.dispatchEvent(new Event('selectionchange'));
  },mode);
  await selectText();
  await page.locator('#format-font-family').click();await page.locator('#format-font-family').selectOption('Georgia');
  const readStyle=()=>page.evaluate(mode=>{
   const root=mode==='blocks'?document.querySelector('#block-content .ce-paragraph'):window.tinymce.get('edit-content').getBody().querySelector('p');
   const doc=root.ownerDocument,walker=doc.createTreeWalker(root,4);let text;while((text=walker.nextNode()))if(text.textContent.trim())break;
   const styles=doc.defaultView.getComputedStyle(text.parentElement);return {family:styles.fontFamily,size:styles.fontSize};
  },mode);
  await page.waitForFunction(mode=>{
   const root=mode==='blocks'?document.querySelector('#block-content .ce-paragraph'):window.tinymce.get('edit-content').getBody().querySelector('p');return root.innerHTML.includes('Georgia');
  },mode);
  assert.match((await readStyle()).family,/Georgia/);
  await selectText();await page.locator('#format-font-size').click();await page.locator('#format-font-size').selectOption('24pt');
  await page.waitForFunction(mode=>{
   const root=mode==='blocks'?document.querySelector('#block-content .ce-paragraph'):window.tinymce.get('edit-content').getBody().querySelector('p');return root.innerHTML.includes('24pt');
  },mode);
  assert.ok(Math.abs(parseFloat((await readStyle()).size)-32)<.1);
  await page.locator('#editor-undo').click();assert.ok(Math.abs(parseFloat((await readStyle()).size)-32)>.1);
  await page.locator('#editor-redo').click();assert.ok(Math.abs(parseFloat((await readStyle()).size)-32)<.1);
  await page.locator('#save-note').click();await page.locator('#note-editor').waitFor({state:'hidden'});
  const style=await page.locator('#note-content p').first().evaluate(root=>{const walker=document.createTreeWalker(root,4);let text;while((text=walker.nextNode()))if(text.textContent.trim())break;const style=getComputedStyle(text.parentElement);return {family:style.fontFamily,size:style.fontSize};});
  assert.match(style.family,/Georgia/);assert.ok(Math.abs(parseFloat(style.size)-32)<.1);
  await page.locator('#note-content p').first().click();
  await page.waitForFunction(()=>!document.getElementById('format-font-family').disabled);
  await selectText();assert.match((await readStyle()).family,/Georgia/);assert.ok(Math.abs(parseFloat((await readStyle()).size)-32)<.1);
  await page.locator('#cancel-edit').click();
  console.log(`PASS ${mode}: font family and exact point size, undo/redo, saved reader and reopening`);
 }
};
