const assert=require('node:assert/strict');
module.exports=async(page,base)=>{
 for(const mode of ['blocks','classic']){
  await page.goto(base+'/');await page.locator('.account-open').first().click();
  await page.locator('#notes .note-row').first().click();await page.locator('#note-content p').first().waitFor();
  const content=await page.locator('#note-content').innerHTML();
  assert.equal(await page.locator('#reader-document #note-tags-open').count(),0);
  await page.locator('#profile-menu summary').click();await page.locator('#profile-settings').click();await page.locator('#editor-mode').selectOption(mode);await page.locator('#apply-settings').click();
  await page.locator('#note-content p').first().click();await page.waitForFunction(()=>!document.getElementById('note-tags-open').disabled);
  assert.equal(await page.locator('.editor-controls-right #note-tags-open').count(),1);
  await page.locator('#edit-title').fill('Черновик '+mode);
  await page.evaluate(()=>{
    const original=window.__TAURI__.core.invoke;window.tagWrites=[];window.tagBodyWrites=[];
    window.__TAURI__.core.invoke=async(command,args)=>{
      if(command==='get_note_tags'&&window.tagLoadDelay)await new Promise(resolve=>setTimeout(resolve,150));
      if(command==='set_note_tags'){
        window.tagWrites.push(args);await new Promise(resolve=>setTimeout(resolve,80));
        if(window.tagWriteFail)throw Error('Fixture: connection lost');
      }
      if(command==='save_note')window.tagBodyWrites.push(args);
      const result=await original(command,args);
      if(command==='set_note_tags'&&window.tagRemoteChange)return {...result,note:{...result.note,content:'<p>Remote content changed</p>'}};
      if(command==='set_note_tags'&&window.tagUnknownVersion)return {...result,note:{...result.note,ver:null,tags:null},notice:'Fixture: read unavailable'};
      return result;
    };
  });
  const open=async()=>{await page.locator('#note-tags-open').click();await page.waitForFunction(()=>!document.getElementById('note-tags-apply').disabled);};
  const create=async name=>{await page.locator('#note-tags-new').fill(name);await page.locator('#note-tags-new').press('Enter');};
  assert.match(await page.locator('#note-tag-chips').textContent(),/Работа/);
  await open();
  for(const id of ['note-tags-search','note-tags-new']){
    await page.locator('#'+id).focus();
    const clipped=await page.locator('#'+id).evaluate(input=>{
      const style=getComputedStyle(input),ring=parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset),rect=input.getBoundingClientRect();
      for(let parent=input.parentElement;parent;parent=parent.parentElement){
        const css=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
        if(/auto|scroll|hidden|clip/.test(css.overflowX)&&(rect.left-ring<bounds.left+parent.clientLeft-.5||rect.right+ring>bounds.left+parent.clientLeft+parent.clientWidth+.5))return true;
      }
      return false;
    });
    assert.equal(clipped,false,id+' focus ring must fit inside scrolling containers');
  }
  await page.keyboard.press('Control+s');assert.equal(await page.evaluate(()=>window.tagBodyWrites.length),0);
  await page.locator('#note-tags-search').fill('иде');assert.equal(await page.locator('.note-tag-option').count(),1);
  await page.locator('.note-tag-option').click();
  await create('Reference');await create('REFERENCE');
  assert.equal(await page.locator('#note-tags-selected .note-tag-selected').filter({hasText:'Reference'}).count(),1);
  assert.equal(await page.evaluate(()=>window.tagWrites.length),0);
  await page.locator('#note-tags-cancel').click();assert.ok(!(await page.locator('#note-tag-chips').textContent()).includes('Reference'));
  await open();assert.ok(!(await page.locator('#note-tags-all').textContent()).includes('Reference'));
  await create('Reference');
  for(const [width,height] of [[1440,1000],[900,600]]){
    await page.setViewportSize({width,height});
    const heights=await page.locator('#note-tags-search,#note-tags-new,#note-tags-create').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));assert.ok(heights.every(value=>value===38),JSON.stringify(heights));
    const dialog=await page.locator('#note-tags-dialog').boundingBox();assert.ok(dialog.y>=0&&dialog.y+dialog.height<=height+1);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#note-tags-apply').click();
  await page.evaluate(()=>document.getElementById('note-tags-apply').click());
  await page.locator('#note-tags-dialog').waitFor({state:'hidden'});
  const writes=await page.evaluate(()=>window.tagWrites);assert.equal(writes.length,1);
  assert.deepEqual(writes[0].expectedTags,['Работа']);assert.deepEqual(writes[0].tags,['Работа','Reference']);
  assert.ok(!('content' in writes[0])&&!('title' in writes[0]));
  assert.equal(await page.locator('#note-editor').isVisible(),true);assert.equal(await page.locator('#reader-document').isVisible(),false);assert.equal(await page.locator('#edit-title').inputValue(),'Черновик '+mode);assert.equal(await page.locator('#unsaved-dialog').isVisible(),false);
  assert.equal(await page.locator('#note-content').innerHTML(),content);assert.match(await page.locator('#note-tag-chips').textContent(),/Reference/);
  await open();await page.locator('#note-tags-selected button[aria-label="Снять тег Reference"]').click();
  await page.evaluate(()=>window.tagWriteFail=true);await page.locator('#note-tags-apply').click();
  await page.waitForFunction(()=>document.getElementById('note-tags-status').textContent.includes('перед повторной')||document.getElementById('note-tags-status').textContent.includes('Перед повторной'));
  assert.equal(await page.locator('#note-tags-apply').isDisabled(),true);
  assert.equal(await page.locator('#note-tags-selected .note-tag-selected').count(),1);
  await page.evaluate(()=>window.tagWriteFail=false);await page.locator('#note-tags-reload').click();await page.waitForFunction(()=>!document.getElementById('note-tags-apply').disabled);
  assert.equal(await page.locator('#note-tags-selected .note-tag-selected').count(),2);
  while(await page.locator('#note-tags-selected button').count())await page.locator('#note-tags-selected button').first().click();
  await page.locator('#note-tags-apply').click();await page.locator('#note-tags-dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('#note-tag-chips .note-tag-chip').count(),0);
  await open();assert.match(await page.locator('#note-tags-all').textContent(),/Reference/);await page.locator('#note-tags-cancel').click();
  await page.evaluate(()=>window.tagLoadDelay=true);await page.locator('#note-tags-open').click();await page.locator('#note-tags-close').click();
  await page.waitForTimeout(200);assert.equal(await page.locator('#note-tags-dialog').isVisible(),false);
  await page.locator('#save-note').click();await page.locator('#note-editor').waitFor({state:'hidden'});
  assert.equal(await page.locator('#note-title').textContent(),'Черновик '+mode);
  const saved=await page.evaluate(()=>window.tagBodyWrites);assert.equal(saved.length,1);assert.notEqual(saved[0].expectedVersion,writes[0].expectedVersion);
  await page.evaluate(()=>{window.tagLoadDelay=false;});
  await page.locator('#note-content p').first().click();await page.waitForFunction(()=>!document.getElementById('note-tags-open').disabled);
  await page.locator('#edit-title').fill('Сохранить этот черновик');
  await open();await create('guard-'+mode);
  await page.evaluate(mode=>{window.tagRemoteChange=mode==='blocks';window.tagUnknownVersion=mode==='classic';},mode);
  await page.locator('#note-tags-apply').click();await page.locator('#note-tags-dialog').waitFor({state:'hidden'});
  assert.equal(await page.locator('#edit-title').inputValue(),'Сохранить этот черновик');assert.equal(await page.locator('#save-note').isDisabled(),true);
  await page.keyboard.press('Control+s');assert.equal(await page.evaluate(()=>window.tagBodyWrites.length),1);
  if(mode==='classic'){await page.evaluate(()=>window.tagUnknownVersion=false);await open();await page.locator('#note-tags-apply').click();await page.locator('#note-tags-dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#save-note').isDisabled(),false);}
  await page.locator('#cancel-edit').click();await page.locator('#discard-edit').click();
  console.log('PASS '+mode+' tag dialog: existing tags, search, staged creation/cancel, duplicates, metadata-only apply, double click, errors/reload, clear associations, preserved catalog and late loads, editor draft preservation and version rebasing');
 }
};
