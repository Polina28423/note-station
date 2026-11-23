const assert = require('node:assert/strict');
module.exports = async (page, base) => {
  await page.setViewportSize({width:1600,height:1000});
  await page.goto(base + '/');
  await page.locator('.account-open').first().click();
  await page.locator('#notes .note-row').first().click();await page.locator('#note-content p').first().waitFor();
  const result = await page.evaluate(async () => {
    const { BlockSurface } = await import('/block-editor.js');
    const { safeNoteFragment } = await import('/content.js');
    const html='<div>Описание</div><div><a href="https://example.org/one">Первая ссылка</a></div><div><br></div><div>Ещё описание</div><div><a href="https://example.org/two">Вторая ссылка</a></div><p>Отдельный абзац</p>';
    const reader=document.getElementById('note-content');reader.replaceChildren(safeNoteFragment(html));
    document.getElementById('reader-empty').hidden=true;document.getElementById('reader-document').hidden=false;
    const gaps = elements => {const top=elements[0].getBoundingClientRect().top;return elements.map(el=>el.getBoundingClientRect().top-top);};
    const before=gaps([...reader.children]);
    const color=getComputedStyle(reader.querySelector('a')).color;
    document.getElementById('note-editor').hidden=false;
    const surface=new BlockSurface(()=>{});await surface.load({content:html});
    const paragraphs=[...document.querySelectorAll('#block-content .ce-paragraph')];
    const after=gaps(paragraphs);
    const editorColor=getComputedStyle(document.querySelector('#block-content a')).color;
    const state=await surface.content();
    const unchanged=surface.output(state.data,state.removed);
    surface.destroy();
    const { ClassicSurface } = await import('/classic-editor.js');
    document.getElementById('block-content').hidden=true;
    document.getElementById('classic-surface').hidden=false;
    const classic=new ClassicSurface(()=>{});await classic.load({content:html});
    const classicColor=classic.editor.getWin().getComputedStyle(classic.editor.getBody().querySelector('a')).color;
    const classicGaps=gaps([...classic.editor.getBody().children]);
    classic.destroy();
    return {before,after,classicGaps,color,editorColor,classicColor,source:html,unchanged};
  });
  assert.equal(result.color,result.editorColor);
  assert.equal(result.color,result.classicColor);
  assert.equal(result.before.length,result.after.length);
  result.before.forEach((value,index)=>assert.ok(Math.abs(value-result.after[index])<2,`Block ${index}: reader ${value}, editor ${result.after[index]}`));
  result.before.forEach((value,index)=>assert.ok(Math.abs(value-result.classicGaps[index])<2,`Classic block ${index}: reader ${value}, editor ${result.classicGaps[index]}`));
  assert.equal(result.unchanged,result.source);
  console.log('PASS reader and block editor link colors, div/p/blank-line spacing and unchanged HTML');
  const nested=await page.evaluate(async()=>{
    const {BlockSurface}=await import('/block-editor.js');const {safeNoteFragment}=await import('/content.js');
    const html='<div>Описание элементов<div><a href="https://composeunstyled.com">https://composeunstyled.com</a></div></div><div>Примеры<div><a href="https://github.com/android/compose-samples">https://github.com/android/compose-samples</a></div></div><div><a href="https://www.sinasamaki.com/pager-animations/">https://www.sinasamaki.com/pager-animations/</a><div>Очень интересный сайт<div><a href="https://kotlinandroid.org/kotlin-android/">https://kotlinandroid.org/kotlin-android/</a></div></div></div>';
    const $=id=>document.getElementById(id),reader=$('note-content');reader.replaceChildren(safeNoteFragment(html));
    $('note-editor').hidden=false;$('reader-document').hidden=false;
    $('classic-surface').hidden=true;$('block-content').hidden=false;
    const surface=new BlockSurface(()=>{});window.nestedSurface=surface;await surface.load({content:html});
    const positions=root=>{
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),rows=[];let node;
      while((node=walker.nextNode()))if(node.textContent.trim()){
        const range=document.createRange();range.selectNodeContents(node);rows.push({text:node.textContent,top:range.getBoundingClientRect().top});
      }
      return rows.map(row=>({...row,top:row.top-rows[0].top}));
    };
    const state=await surface.content();
    return {html,reader:positions(reader),editor:positions($('block-content').querySelector('.codex-editor__redactor')),protected:$('block-content').querySelectorAll('.preserved-fragment').length,unchanged:surface.output(state.data,state.removed)};
  });
  assert.equal(nested.protected,0);assert.equal(nested.unchanged,nested.html);assert.equal(nested.reader.length,nested.editor.length);
  nested.reader.forEach((row,index)=>{assert.equal(nested.editor[index].text,row.text);assert.ok(Math.abs(row.top-nested.editor[index].top)<2,`Nested row ${index}: reader ${row.top}, editor ${nested.editor[index].top}`);});
  await page.evaluate(()=>{
    const link=[...document.querySelectorAll('#block-content a')].at(-1),range=document.createRange();
    link.closest('.ce-paragraph').focus();range.selectNodeContents(link);range.collapse(false);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);
  });
  await page.keyboard.type(' edited');
  const changed=await page.evaluate(async()=>{const surface=window.nestedSurface;await surface.capture();const state=await surface.content();return surface.output(state.data,state.removed);});
  assert.match(changed,/edited/);assert.equal((changed.match(/href=/g)||[]).length,4);assert.match(changed,/<div>Очень интересный сайт<div>/);
  const restored=await page.evaluate(async()=>{const surface=window.nestedSurface;await surface.undo();const state=await surface.content();const html=surface.output(state.data,state.removed);surface.destroy();return html;});
  assert.equal(restored,nested.html);
  console.log('PASS nested Compose UI text/link containers remain editable with matching line positions, exact unchanged HTML and undo');
};
