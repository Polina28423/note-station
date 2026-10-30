const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async(page,base)=>{
  const source=fs.readFileSync(path.join(__dirname,'fixtures/legacy-social-heading.html'),'utf8');
  for(const mode of ['blocks','classic']){
    await page.goto(base+'/');await page.locator('.account-open').first().click();
    await page.evaluate(content=>{
      const original=window.__TAURI__.core.invoke;window.headingWrites=[];
      window.__TAURI__.core.invoke=async(command,args)=>{
        if(command==='get_note')return {object_id:args.id,ver:'v1',title:'Контакт',content,encrypted:false};
        if(command==='save_note'){window.headingWrites.push(args);return {note:{object_id:args.id,ver:'v2',title:args.title,content:args.content,encrypted:false}};}
        return original(command,args);
      };
      window.headingPresentation=heading=>{
        const walker=heading.ownerDocument.createTreeWalker(heading,NodeFilter.SHOW_TEXT),node=walker.nextNode(),style=heading.ownerDocument.defaultView.getComputedStyle(node.parentElement);
        return {text:heading.textContent,size:style.fontSize,family:style.fontFamily,weight:style.fontWeight,color:style.color,align:style.textAlign};
      };
    },source);
    await page.locator('#notes .note-row').first().click();await page.locator('#note-content h1').waitFor();
    await page.locator('#profile-menu summary').click();await page.locator('#profile-settings').click();await page.locator('#editor-mode').selectOption(mode);await page.locator('#apply-settings').click();
    const before=await page.evaluate(()=>headingPresentation(document.querySelector('#note-content h1')));
    await page.locator('#note-content h1').click();await page.waitForFunction(()=>!document.getElementById('paste-plain').disabled);
    const after=await page.evaluate(mode=>{
      const root=mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody();return {presentation:headingPresentation(root.querySelector('h1')),protected:root.querySelectorAll('.preserved-fragment').length,classes:root.querySelector('h1').getAttribute('class')||''};
    },mode);
    assert.deepEqual(after.presentation,before);assert.equal(after.protected,0);assert.ok(!after.classes.includes('gmql0nx0'));
    await page.locator('#note-html-open').click();await page.locator('#note-html-draft').click();await page.waitForFunction(()=>document.getElementById('note-html-code').value.includes('Мастер'));assert.equal(await page.locator('#note-html-code').inputValue(),source);await page.locator('#note-html-close').click();
    await page.evaluate(mode=>{
      const root=mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody(),heading=root.querySelector('h1');
      if(mode==='blocks')heading.focus();else window.tinymce.get('edit-content').focus();
      const range=heading.ownerDocument.createRange();range.selectNodeContents(heading.querySelector('span')||heading);range.collapse(false);
      const selection=heading.ownerDocument.getSelection();selection.removeAllRanges();selection.addRange(range);
    },mode);
    await page.keyboard.type(' updated');
    const text=()=>page.evaluate(mode=>(mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody()).querySelector('h1').textContent,mode);
    assert.ok((await text()).endsWith(' updated'));await page.locator('#editor-undo').click();assert.equal(await text(),before.text);await page.locator('#editor-redo').click();assert.ok((await text()).endsWith(' updated'));
    await page.locator('#save-note').click();await page.locator('#note-editor').waitFor({state:'hidden'});
    const writes=await page.evaluate(()=>window.headingWrites);assert.equal(writes.length,1);const saved=writes[0].content;
    assert.ok(saved.includes(' updated'));assert.ok(saved.includes('text-align: center')||saved.includes('text-align:center'));assert.ok(saved.includes('href="https://example.org/profile?id=123"'));assert.ok(saved.includes('https://example.org/about'));assert.ok(!saved.includes('gmql0nx0'));assert.ok(!saved.includes('display: flex'));assert.ok(!saved.includes('Сохранённый фрагмент'));
    console.log('PASS social heading '+mode+': editable heading, matching typography/alignment, exact unchanged HTML, original links, undo/redo and save');
  }
};
