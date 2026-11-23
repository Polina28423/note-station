const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async(page,base)=>{
  const source=fs.readFileSync(path.join(__dirname,'fixtures/legacy-adb-note.html'),'utf8');
  for(const mode of ['blocks','classic']){
    await page.goto(base+'/');await page.locator('.account-open').first().click();
    await page.evaluate(content=>{
      const original=window.__TAURI__.core.invoke;window.adbWrites=[];
      window.__TAURI__.core.invoke=async(command,args)=>{
        if(command==='get_note')return {object_id:args.id,ver:'v1',title:'ADB',content,encrypted:false};
        if(command==='save_note'){window.adbWrites.push(args);return {note:{object_id:args.id,ver:'v2',title:args.title,content:args.content,encrypted:false}};}
        return original(command,args);
      };
    },source);
    await page.locator('#notes .note-row').first().click();await page.locator('#note-content b').waitFor();
    await page.locator('#profile-menu summary').click();await page.locator('#profile-settings').click();await page.locator('#editor-mode').selectOption(mode);await page.locator('#apply-settings').click();
    const before=await page.locator('#note-content').innerText();assert.ok(before.includes('--es <имя переменой> "<значение>"'));assert.ok(before.includes('--ei <имя переменой> <значение>'));
    await page.locator('#note-content b').click();await page.waitForFunction(()=>!document.getElementById('paste-plain').disabled);
    if(mode==='blocks')assert.equal(await page.locator('#block-content .preserved-fragment').count(),0);
    await page.locator('#note-html-open').click();await page.locator('#note-html-draft').click();await page.waitForFunction(()=>document.getElementById('note-html-code').value.includes('целочисленная'));assert.equal(await page.locator('#note-html-code').inputValue(),source);await page.locator('#note-html-close').click();
    await page.evaluate(mode=>{
      const root=mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody();
      const span=[...root.querySelectorAll('span')].find(node=>node.textContent.startsWith('--ei <имя переменой>'));
      if(mode==='blocks')span.closest('.ce-paragraph').focus();else window.tinymce.get('edit-content').focus();
      const range=span.ownerDocument.createRange();range.selectNodeContents(span);range.collapse(false);
      const selection=span.ownerDocument.getSelection();selection.removeAllRanges();selection.addRange(range);
    },mode);
    await page.keyboard.type(' updated');
    const text=()=>page.evaluate(mode=>(mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody()).textContent,mode);
    assert.ok((await text()).includes('целочисленная переменная updated'));
    await page.locator('#editor-undo').click();assert.ok(!(await text()).includes(' updated'));
    await page.locator('#editor-redo').click();assert.ok((await text()).includes(' updated'));
    await page.locator('#save-note').click();await page.locator('#note-editor').waitFor({state:'hidden'});
    const writes=await page.evaluate(()=>window.adbWrites);assert.equal(writes.length,1);
    const saved=writes[0].content;assert.ok(saved.includes('целочисленная переменная updated'));assert.ok(saved.includes('&lt;имя переменой&gt;'));assert.ok(saved.includes('&lt;значение&gt;'));assert.ok(saved.includes('org.example.app/org.example.Receiver'));assert.ok(!saved.includes('Сохранённый фрагмент'));
    const rendered=await page.locator('#note-content').innerText();assert.ok(rendered.includes('--es <имя переменой> "<значение>"'));assert.ok(rendered.includes('--ei <имя переменой> <значение>'));
    console.log('PASS ADB import '+mode+': editable copied styles, exact unchanged HTML, literal command placeholders, NBSP, undo/redo and save');
  }
};
