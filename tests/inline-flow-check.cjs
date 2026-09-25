const assert=require('node:assert/strict');
module.exports=async(page,base)=>{
  await page.goto(base+'/');await page.locator('.account-open').first().click();await page.locator('#notes .note-row').first().waitFor();
  const original=await page.evaluate(async()=>{
    const {BlockSurface}=await import('/block-editor.js');
    const html='<div><a href="https://example.org/one">Єдиний державний реєстр судових рішень</a></div><div><a href="https://example.org/two">Єдиний реєстр боржників</a></div><a href="https://example.org/three" style="color:red;font-size:15px">Автоматизована система виконавчого провадження</a>';
    const {safeNoteFragment}=await import('/content.js');document.getElementById('note-content').replaceChildren(safeNoteFragment(html));
    document.getElementById('reader-empty').hidden=true;document.getElementById('reader-document').hidden=true;document.getElementById('note-editor').hidden=false;
    window.inlineSurface=new BlockSurface(()=>{});await window.inlineSurface.load({content:html});
    return html;
  });
  assert.equal(await page.locator('#block-content .preserved-fragment').count(),0);
  assert.equal(await page.locator('#block-content .ce-paragraph[contenteditable="true"]').count(),3);
  const colors=await page.evaluate(()=>{const original=document.querySelectorAll('#note-content a')[2],link=document.querySelectorAll('#block-content a')[2];return {reader:getComputedStyle(original).color,editor:getComputedStyle(link.firstElementChild||link).color};});
  assert.equal(colors.reader,colors.editor);
  const initial=await page.evaluate(async()=>{const state=await window.inlineSurface.content();return window.inlineSurface.output(state.data,state.removed);});assert.equal(initial,original);
  await page.locator('#block-content .ce-paragraph').nth(2).press('End');await page.keyboard.type(' updated');
  await page.evaluate(()=>window.inlineSurface.capture());
  const edited=await page.evaluate(async()=>{const state=await window.inlineSurface.content();return window.inlineSurface.output(state.data,state.removed);});
  assert.ok((await page.locator('#block-content .ce-paragraph').nth(2).textContent()).replace(/\s+/g,' ').includes('провадження updated'),edited);assert.ok(edited.startsWith(original.slice(0,original.lastIndexOf('<a href='))));
  assert.match(edited,/href="https:\/\/example.org\/three"/);
  await page.evaluate(()=>window.inlineSurface.undo());
  const undone=await page.evaluate(async()=>{const state=await window.inlineSurface.content();return window.inlineSurface.output(state.data,state.removed);});assert.equal(undone,original);
  await page.evaluate(()=>window.inlineSurface.redo());
  const redone=await page.evaluate(async()=>{const state=await window.inlineSurface.content();return window.inlineSurface.output(state.data,state.removed);});assert.equal(redone,edited);
  await page.evaluate(()=>window.inlineSurface.destroy());
  console.log('PASS standalone link edits without protected card, unchanged HTML, surrounding lines, href and undo/redo');
};
