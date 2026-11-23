const assert=require('node:assert/strict');
module.exports=async(page,base)=>{
  await page.setViewportSize({width:1600,height:1000});await page.goto(base+'/');await page.locator('.account-open').first().click();await page.locator('#notes .note-row').first().click();await page.locator('#note-content p').first().waitFor();
  const result=await page.evaluate(async()=>{
    const {BlockSurface}=await import('/block-editor.js'),{safeNoteFragment}=await import('/content.js');
    const html=Array.from({length:6},(_,i)=>`<div><h${i+1}>Вложенный заголовок ${i+1}</h${i+1}></div>`).join('')+'<div><strong style="font-weight:700;font-size:12pt">Протокол взаимодействия:</strong></div><div><b style="font-weight:normal">Обычный текст внутри b</b></div><div><span style="font-weight:bold;font-style:italic;text-decoration:underline">Документация</span></div><div><a href="https://example.org/document">Документ</a></div>';
    const $=id=>document.getElementById(id),reader=$('note-content');reader.replaceChildren(safeNoteFragment(html));reader.style.fontSize='15px';$('reader-document').hidden=false;$('note-editor').hidden=false;
    const surface=new BlockSurface(()=>{});window.headingSurface=surface;await surface.load({content:html});
    const styles=root=>{
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),result=[];let node;
      while((node=walker.nextNode()))if(node.textContent.trim()){const range=document.createRange();range.selectNodeContents(node);const style=getComputedStyle(node.parentElement);result.push({text:node.textContent,top:range.getBoundingClientRect().top,font:style.fontSize,weight:style.fontWeight,italic:style.fontStyle,decoration:style.textDecorationLine});}
      return result.map(row=>({...row,top:row.top-result[0].top}));
    };
    const state=await surface.content();return {source:html,output:surface.output(state.data,state.removed),protected:surface.document.fragments.size,reader:styles(reader),editor:styles($('block-content').querySelector('.codex-editor__redactor'))};
  });
  assert.equal(result.protected,0);assert.equal(result.output,result.source);assert.equal(result.reader.length,result.editor.length);
  result.reader.forEach((row,i)=>{const actual=result.editor[i];assert.equal(actual.text,row.text);for(const key of ['font','weight','italic','decoration'])assert.equal(actual[key],row[key],`${i} ${key}`);assert.ok(Math.abs(row.top-actual.top)<2,`${i}: reader ${row.top}, editor ${actual.top}`);});
  await page.evaluate(()=>{const element=document.querySelector('#block-content strong');element.closest('.ce-paragraph').focus();const range=document.createRange();range.selectNodeContents(element);range.collapse(false);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);});
  await page.keyboard.type(' updated');
  const edited=await page.evaluate(async()=>{const surface=window.headingSurface;await surface.capture();const state=await surface.content();return surface.output(state.data,state.removed);});
  assert.match(edited,/updated/);assert.match(edited,/<strong style="font-weight:700;font-size:12pt">/);assert.equal((edited.match(/<h[1-6]>/g)||[]).length,6);
  const undone=await page.evaluate(async()=>{const surface=window.headingSurface;await surface.undo();const state=await surface.content();const result=surface.output(state.data,state.removed);surface.destroy();return result;});assert.equal(undone,result.source);
  console.log('PASS nested H1–H6 and styled labels: editable import, reader typography and line positions, preserved styles and undo');
};
