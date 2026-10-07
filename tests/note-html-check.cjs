const assert=require('node:assert/strict');
module.exports=async(page,base)=>{
  for(const mode of ['blocks','classic']){
    await page.goto(base+'/');await page.locator('.account-open').first().click();
    assert.equal(await page.locator('#note-html-open').isDisabled(),true);
    const source=await page.evaluate(()=>{
      const content='<div data-origin="legacy"><h3 style="font-weight:700">Протокол</h3></div><p>Draft text</p><script>window.htmlSourceExecuted=true</script>';
      const original=window.__TAURI__.core.invoke;window.htmlWrites=[];
      window.__TAURI__.core.invoke=async(command,args)=>{
        if(command==='get_note')return {object_id:args.id,ver:'v1',title:'Диагностика HTML',content,encrypted:false};
        if(command==='save_note')window.htmlWrites.push(args);
        return original(command,args);
      };
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.htmlCopied=text;}}});
      return content;
    });
    await page.locator('#notes .note-row').first().click();await page.locator('#note-content p').waitFor();
    await page.locator('#note-html-open').click();await page.locator('#note-html-dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('#note-html-code').inputValue(),source);assert.equal(await page.locator('#note-html-code').getAttribute('readonly'),'');
    assert.equal(await page.locator('#note-html-draft').isDisabled(),true);
    await page.locator('#note-html-copy').click();assert.equal(await page.evaluate(()=>window.htmlCopied),source);
    assert.equal(await page.evaluate(()=>window.htmlSourceExecuted),undefined);assert.equal(await page.evaluate(()=>window.htmlWrites.length),0);
    await page.keyboard.press('Escape');await page.locator('#note-html-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#note-html-code').inputValue(),'');
    await page.locator('#profile-menu summary').click();await page.locator('#profile-settings').click();await page.locator('#editor-mode').selectOption(mode);await page.locator('#apply-settings').click();
    await page.locator('#note-content p').click();await page.waitForFunction(()=>!document.getElementById('paste-plain').disabled);
    if(mode==='blocks')await page.locator('#block-content .ce-paragraph').fill('Edited draft');
    else await page.evaluate(()=>{const editor=window.tinymce.get('edit-content');editor.getBody().querySelector('p').textContent='Edited draft';editor.fire('change');});
    await page.locator('#note-html-open').click();assert.equal(await page.locator('#note-html-code').inputValue(),source);
    await page.locator('#note-html-draft').click();await page.waitForFunction(()=>document.getElementById('note-html-code').value.includes('Edited draft'));
    const draft=await page.locator('#note-html-code').inputValue();assert.ok(draft.includes('data-origin="legacy"'));
    if(mode==='blocks')assert.ok(draft.includes('<script>window.htmlSourceExecuted=true</script>'));else assert.ok(!draft.includes('<script>'));
    await page.keyboard.press('Control+s');assert.equal(await page.evaluate(()=>window.htmlWrites.length),0);
    await page.locator('#note-html-original').click();assert.equal(await page.locator('#note-html-code').inputValue(),source);
    await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('Fixture denied');};});await page.locator('#note-html-copy').click();
    await page.waitForFunction(()=>document.getElementById('note-html-status').textContent.includes('Ctrl+C'));
    assert.equal(await page.evaluate(()=>{const field=document.getElementById('note-html-code');return field.selectionEnd-field.selectionStart;}),source.length);
    await page.locator('#note-html-close').click();assert.equal(await page.locator('#note-editor').isVisible(),true);
    assert.equal(await page.evaluate(()=>window.htmlSourceExecuted),undefined);assert.equal(await page.evaluate(()=>window.htmlWrites.length),0);
    console.log('PASS '+mode+' HTML diagnostics: exact NAS source, draft, copying/fallback, inert markup, no writes, Ctrl+S guard and Escape');
  }
};
