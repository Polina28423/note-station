const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async(page,base)=>{
  const source=fs.readFileSync(path.join(__dirname,'fixtures/legacy-generated-note.html'),'utf8');
  await page.setViewportSize({width:1600,height:1000});await page.goto(base+'/');await page.locator('.account-open').first().click();
  await page.evaluate(content=>{
    const original=window.__TAURI__.core.invoke;window.generatedWrites=[];
    window.__TAURI__.core.invoke=async(command,args)=>{
      if(command==='get_note')return {object_id:args.id,ver:'v1',title:'Документация',content,encrypted:false};
      if(command==='save_note'){window.generatedWrites.push(args);return {note:{object_id:args.id,ver:'v2',title:args.title,content:args.content,encrypted:false}};}
      return original(command,args);
    };
    window.generatedPositions=root=>{
      const nodes=[...root.querySelectorAll('b,a')].filter(element=>element.textContent.trim());
      const rendered=element=>element.firstElementChild?.textContent===element.textContent?element.firstElementChild:element;
      const top=rendered(nodes[0]).getBoundingClientRect().top;return nodes.map(element=>({text:element.textContent,top:rendered(element).getBoundingClientRect().top-top,font:getComputedStyle(rendered(element)).fontSize}));
    };
  },source);
  await page.locator('#notes .note-row').first().click();await page.locator('#note-content b').filter({hasText:'Текущий перечень'}).waitFor();
  await page.locator('#profile-menu summary').click();await page.locator('#profile-settings').click();await page.locator('#editor-mode').selectOption('blocks');await page.locator('#apply-settings').click();
  const before=await page.evaluate(()=>window.generatedPositions(document.getElementById('note-content')));
  await page.locator('#note-content b').filter({hasText:'Текущий перечень'}).click();await page.waitForFunction(()=>!document.getElementById('paste-plain').disabled);
  assert.equal(await page.locator('#block-content .preserved-fragment').count(),0);assert.equal(await page.locator('#block-content .ce-paragraph').count(),9);
  assert.equal(await page.locator('#edit-state').textContent(),'Нет изменений');
  const after=await page.evaluate(()=>window.generatedPositions(document.getElementById('block-content')));assert.equal(before.length,after.length);
  before.forEach((row,i)=>{assert.equal(after[i].text,row.text);assert.equal(after[i].font,row.font);assert.ok(Math.abs(after[i].top-row.top)<2,`Row ${i}: reader ${row.top}, editor ${after[i].top}`);});
  await page.locator('#note-html-open').click();assert.equal(await page.locator('#note-html-code').inputValue(),source);await page.locator('#note-html-draft').click();
  await page.waitForFunction(()=>document.getElementById('note-html-code').value.includes('ext-gen514'));assert.equal(await page.locator('#note-html-code').inputValue(),source);await page.locator('#note-html-close').click();
  await page.evaluate(()=>{const label=document.querySelector('#block-content [id="ext-gen514"]');label.closest('.ce-paragraph').focus();const range=document.createRange();range.selectNodeContents(label);range.collapse(false);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);});
  await page.keyboard.type(' updated');await page.locator('#block-content [id="ext-gen514"]').filter({hasText:'updated'}).waitFor();
  await page.locator('#editor-undo').click();await page.waitForFunction(()=>!document.querySelector('#block-content [id="ext-gen514"]').textContent.includes('updated'));
  await page.locator('#editor-redo').click();await page.locator('#block-content [id="ext-gen514"]').filter({hasText:'updated'}).waitFor();
  await page.locator('#save-note').click();await page.locator('#note-editor').waitFor({state:'hidden'});
  const saved=await page.evaluate(()=>window.generatedWrites);assert.equal(saved.length,1);assert.match(saved[0].content,/<b id="ext-gen514">Протокол взаимодействия инструмента и планшета: updated<\/b>/);
  assert.equal((saved[0].content.match(/<div><b><\/b><\/div>/g)||[]).length,6);assert.deepEqual(saved[0].content.match(/href="[^"]+"/g),source.match(/href="[^"]+"/g));
  console.log('PASS supplied legacy structure: generated ID, invisible wrappers, matching row spacing, exact unedited HTML, undo/redo and saved links');
};
