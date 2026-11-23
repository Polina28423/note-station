const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async(page,base)=>{
  const source=fs.readFileSync(path.join(__dirname,'fixtures/legacy-copied-lists.html'),'utf8');
  for(const mode of ['blocks','classic']){
    await page.goto(base+'/');await page.locator('.account-open').first().click();
    await page.evaluate(content=>{
      const original=window.__TAURI__.core.invoke;window.copiedListWrites=[];
      window.__TAURI__.core.invoke=async(command,args)=>{
        if(command==='get_note')return {object_id:args.id,ver:'v1',title:'Вложенные списки',content,encrypted:false};
        if(command==='save_note'){window.copiedListWrites.push(args);return {note:{object_id:args.id,ver:'v2',title:args.title,content:args.content,encrypted:false}};}
        return original(command,args);
      };
    },source);
    await page.locator('#notes .note-row').first().click();await page.locator('#note-content ul').first().waitFor();
    await page.locator('#profile-menu summary').click();await page.locator('#profile-settings').click();await page.locator('#editor-mode').selectOption(mode);await page.locator('#apply-settings').click();
    const originalText=await page.locator('#note-content').textContent();
    await page.locator('#note-content b').first().click();await page.waitForFunction(()=>!document.getElementById('paste-plain').disabled);
    const check=await page.evaluate(mode=>{
      const root=mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody();
      return {text:root.textContent,protected:root.querySelectorAll('.preserved-fragment').length,items:root.querySelectorAll(mode==='blocks'?'.cdx-list__item-content':'li').length,metadata:root.querySelectorAll('[data-path-to-node],[data-index-in-node],[data-math]').length};
    },mode);
    assert.equal(check.protected,0);assert.equal(check.items,16);assert.equal(check.metadata,0);assert.ok(check.text.includes('$\\mu$'));
    for(const match of originalText.matchAll(/Текст \d+ – пример/g))assert.ok(check.text.includes(match[0]),match[0]);
    await page.locator('#note-html-open').click();await page.locator('#note-html-draft').click();await page.waitForFunction(()=>document.getElementById('note-html-code').value.includes('data-path-to-node'));assert.equal(await page.locator('#note-html-code').inputValue(),source.replace(/\r\n/g,'\n'));await page.locator('#note-html-close').click();
    await page.evaluate(mode=>{
      const root=mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody();
      const line=[...root.querySelectorAll(mode==='blocks'?'.cdx-list__item-content':'li')].find(node=>node.textContent.includes('$\\mu$')&&!node.querySelector('ul,ol'));
      line.focus();if(mode==='classic')window.tinymce.get('edit-content').focus();
      const walker=line.ownerDocument.createTreeWalker(line,NodeFilter.SHOW_TEXT);let target,node;while((node=walker.nextNode()))target=node;
      const range=line.ownerDocument.createRange();range.setStart(target,target.length);range.collapse(true);const selection=line.ownerDocument.getSelection();selection.removeAllRanges();selection.addRange(range);
    },mode);
    await page.keyboard.type(' updated');
    const text=()=>page.evaluate(mode=>(mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody()).textContent,mode);
    assert.ok((await text()).includes(' updated'));await page.locator('#editor-undo').click();assert.ok(!(await text()).includes(' updated'));await page.locator('#editor-redo').click();assert.ok((await text()).includes(' updated'));
    await page.locator('#save-note').click();await page.locator('#note-editor').waitFor({state:'hidden'});
    const writes=await page.evaluate(()=>window.copiedListWrites);assert.equal(writes.length,1);assert.ok(writes[0].content.includes('$\\mu$'));assert.ok(writes[0].content.includes(' updated'));
    const saved=await page.evaluate(()=>{const root=document.getElementById('note-content');return {items:root.querySelectorAll('li').length,nested:root.querySelectorAll('li ul').length,text:root.textContent};});
    assert.equal(saved.items,16);assert.equal(saved.nested,1);for(const match of originalText.matchAll(/Текст \d+ – пример/g))assert.ok(saved.text.includes(match[0]),match[0]);
    console.log('PASS copied lists '+mode+': editable nested structure, all text retained, formula text, source metadata cleanup, exact unchanged HTML, undo/redo and save');
  }
};
