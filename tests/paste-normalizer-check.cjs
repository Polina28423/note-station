const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
module.exports=async(page,base)=>{
  const website=fs.readFileSync(path.join(__dirname,'fixtures/paste-website.html'),'utf8');
  for(const mode of ['blocks','classic']){
    await page.goto(base+'/');await page.locator('.account-open').first().click();
    const original=await page.evaluate(()=>{
      const content='<p>Original text</p><div class="keep-original" data-original="keep">Legacy saved content</div>',invoke=window.__TAURI__.core.invoke;
      window.normalizedPasteWrites=[];
      window.__TAURI__.core.invoke=async(command,args)=>{
        if(command==='get_note')return {object_id:args.id,ver:'v1',title:'Вставка HTML',content,encrypted:false};
        if(command==='save_note'){window.normalizedPasteWrites.push(args);return {note:{object_id:args.id,ver:'v2',title:args.title,content:args.content,encrypted:false}};}
        return invoke(command,args);
      };return content;
    });
    await page.locator('#notes .note-row').first().click();await page.locator('#note-content p').waitFor();
    await page.locator('#profile-menu summary').click();await page.locator('#profile-settings').click();await page.locator('#editor-mode').selectOption(mode);await page.locator('#apply-settings').click();
    await page.locator('#note-content p').click();await page.waitForFunction(()=>!document.getElementById('paste-plain').disabled);
    await page.locator('#note-html-open').click();await page.locator('#note-html-draft').click();await page.waitForFunction(()=>document.getElementById('note-html-code').value.includes('Legacy saved content'));assert.equal(await page.locator('#note-html-code').inputValue(),original);await page.locator('#note-html-close').click();
    const paste=async(html,text,replace=false)=>page.evaluate(({mode,html,text,replace})=>{
      const root=mode==='blocks'?document.querySelector('#block-content .ce-paragraph'):window.tinymce.get('edit-content').getBody().querySelector('p');
      root.focus();const doc=root.ownerDocument,range=doc.createRange();range.selectNodeContents(root);if(!replace)range.collapse(false);
      const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);
      const clipboard=new DataTransfer();clipboard.setData('text/html',html);clipboard.setData('text/plain',text);root.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));
    },{mode,html,text,replace});
    const body=()=>page.evaluate(mode=>(mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody()).textContent,mode);
    await paste(website+'<script>window.normalizedPasteExecuted=true</script>','Website');
    await page.waitForFunction(mode=>(mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody()).textContent.includes('Заголовок статьи'),mode);
    if(mode==='blocks')assert.equal(await page.locator('#block-content .preserved-fragment').count(),1);
    await page.locator('#note-html-open').click();await page.locator('#note-html-draft').click();await page.waitForFunction(()=>document.getElementById('note-html-code').value.includes('Заголовок статьи'));
    const draft=await page.locator('#note-html-code').inputValue();assert.ok(draft.includes('class="keep-original"'));assert.equal((draft.match(/href=/g)||[]).length,2);assert.ok(draft.includes('18pt'),mode+' '+JSON.stringify(draft.match(/font-size[^;"]+/g)));
    for(const token of ['tm-article','ext-gen645','transition:','quotes:','1.5rem','Fira Sans','<script'])assert.ok(!draft.includes(token),mode+' '+token);
    assert.equal(await page.evaluate(()=>window.normalizedPasteExecuted),undefined);await page.locator('#note-html-close').click();
    await page.locator('#editor-undo').click();await page.waitForFunction(mode=>!(mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody()).textContent.includes('Заголовок статьи'),mode);
    assert.ok((await body()).includes('Original text'));await page.locator('#editor-redo').click();await page.waitForFunction(mode=>(mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody()).textContent.includes('Заголовок статьи'),mode);
    await page.locator('#paste-plain').click();await paste('<h1 class="site">Should not appear</h1>','Only plain text',true);
    assert.ok((await body()).includes('Only plain text'));assert.ok(!(await body()).includes('Should not appear'));
    await page.locator('#save-note').click();await page.locator('#note-editor').waitFor({state:'hidden'});
    const writes=await page.evaluate(()=>window.normalizedPasteWrites);assert.equal(writes.length,1);assert.ok(writes[0].content.includes('data-original="keep"'));assert.equal((writes[0].content.match(/href=/g)||[]).length,2);
    console.log('PASS '+mode+' normalized HTML paste: website cleanup, relative size, links, no new protected cards, unchanged loaded content, undo/redo and plain mode');
  }
};
