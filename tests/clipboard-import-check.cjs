const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async(page,base)=>{
  const source=fs.readFileSync(path.join(__dirname,'fixtures/legacy-clipboard-note.html'),'utf8');
  await page.setViewportSize({width:1600,height:1000});await page.goto(base+'/');await page.locator('.account-open').first().click();
  await page.evaluate(content=>{
    const original=window.__TAURI__.core.invoke;window.clipboardImportWrites=[];
    window.__TAURI__.core.invoke=async(command,args)=>{
      if(command==='get_note')return {object_id:args.id,ver:'v1',title:'Тест импорта',content,encrypted:false};
      if(command==='save_note'){window.clipboardImportWrites.push(args);return {note:{object_id:args.id,ver:'v2',title:args.title,content:args.content,encrypted:false}};}
      return original(command,args);
    };
    window.clipboardImportRows=root=>{
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),rows=[];let node;
      while((node=walker.nextNode()))if(node.textContent.trim()){
        const range=document.createRange();range.selectNodeContents(node);rows.push({text:node.textContent,top:range.getBoundingClientRect().top,font:getComputedStyle(node.parentElement).fontSize});
      }
      return rows.map(row=>({...row,top:row.top-rows[0].top}));
    };
  },source);
  await page.locator('#notes .note-row').first().click();await page.locator('#note-content b').filter({hasText:'Сервис один'}).waitFor();
  await page.locator('#profile-menu summary').click();await page.locator('#profile-settings').click();await page.locator('#editor-mode').selectOption('blocks');await page.locator('#apply-settings').click();
  const before=await page.evaluate(()=>window.clipboardImportRows(document.getElementById('note-content')));
  await page.locator('#note-content b').filter({hasText:'Сервис один'}).click();await page.waitForFunction(()=>!document.getElementById('paste-plain').disabled);
  assert.equal(await page.locator('#block-content .preserved-fragment').count(),0);assert.equal(await page.locator('#block-content .ce-paragraph').count(),11);
  assert.equal(await page.locator('#block-content u').count(),3);assert.equal(await page.locator('#block-content [data-pm-slice],#block-content [data-en-clipboard]').count(),0);
  const after=await page.evaluate(()=>window.clipboardImportRows(document.querySelector('#block-content .codex-editor__redactor')));assert.equal(before.length,after.length);
  before.forEach((row,i)=>{assert.equal(after[i].text,row.text);assert.equal(after[i].font,row.font);assert.ok(Math.abs(row.top-after[i].top)<2,`Clipboard row ${i}: reader ${row.top}, editor ${after[i].top}`);});
  await page.locator('#note-html-open').click();assert.equal(await page.locator('#note-html-code').inputValue(),source);await page.locator('#note-html-draft').click();
  await page.waitForFunction(()=>document.getElementById('note-html-code').value.includes('ext-gen607'));assert.equal(await page.locator('#note-html-code').inputValue(),source);await page.locator('#note-html-close').click();
  await page.evaluate(()=>{const label=document.querySelector('#block-content [id="ext-gen607"]');label.closest('.ce-paragraph').focus();const range=document.createRange();range.selectNodeContents(label);range.collapse(false);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);});
  await page.keyboard.type(' updated');await page.locator('#block-content [id="ext-gen607"]').filter({hasText:'updated'}).waitFor();
  await page.locator('#editor-undo').click();await page.waitForFunction(()=>!document.querySelector('#block-content [id="ext-gen607"]').textContent.includes('updated'));
  await page.locator('#editor-redo').click();await page.locator('#block-content [id="ext-gen607"]').filter({hasText:'updated'}).waitFor();
  await page.waitForFunction(()=>!document.getElementById('paste-plain').disabled);
  await page.evaluate(()=>{
    const span=[...document.querySelectorAll('#block-content span')].find(element=>element.lastChild?.nodeType===Node.TEXT_NODE&&element.lastChild.textContent==='example-password-three');
    span.closest('.ce-paragraph').focus();const range=document.createRange();range.selectNodeContents(span.lastChild);range.collapse(false);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);
  });
  await page.keyboard.type('!');await page.locator('#save-note').click();await page.locator('#note-editor').waitFor({state:'hidden'});
  const writes=await page.evaluate(()=>window.clipboardImportWrites);assert.equal(writes.length,1);const saved=writes[0].content;
  assert.match(saved,/<b id="ext-gen607">Сервис один updated<\/b>/);assert.ok(saved.includes('example-password-three!'));assert.ok(saved.includes('demo.one@example.org'));
  assert.ok(!saved.includes('data-pm-slice'));assert.ok(!saved.includes('data-en-clipboard'));assert.deepEqual(saved.match(/href="[^"]+"/g),source.match(/href="[^"]+"/g));
  assert.equal((saved.match(/class="syno-fontsize-x-small"/g)||[]).length,(source.match(/class="syno-fontsize-x-small"/g)||[]).length);
  console.log('PASS clipboard import: nested metadata, size classes, underline, exact original HTML, row layout, generated ID, field edits and saved links');
};
