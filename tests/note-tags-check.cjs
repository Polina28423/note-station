const assert=require('node:assert/strict');
module.exports=async(page,base)=>{
  await page.goto(base+'/');await page.locator('.account-open').first().click();
  await page.locator('#notes .note-row').first().click();await page.locator('#note-content p').first().waitFor();
  const content=await page.locator('#note-content').innerHTML();
  await page.evaluate(()=>{
    const original=window.__TAURI__.core.invoke;window.tagWrites=[];
    window.__TAURI__.core.invoke=async(command,args)=>{
      if(command==='get_note_tags'&&window.tagLoadDelay)await new Promise(resolve=>setTimeout(resolve,150));
      if(command==='set_note_tags'){
        window.tagWrites.push(args);await new Promise(resolve=>setTimeout(resolve,80));
        if(window.tagWriteFail)throw Error('Fixture: connection lost');
      }
      return original(command,args);
    };
  });
  const open=async()=>{await page.locator('#note-tags-open').click();await page.waitForFunction(()=>!document.getElementById('note-tags-apply').disabled);};
  const create=async name=>{await page.locator('#note-tags-new').fill(name);await page.locator('#note-tags-new').press('Enter');};
  assert.match(await page.locator('#note-tag-chips').textContent(),/Работа/);
  await open();
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
  console.log('PASS tag dialog: existing tags, search, staged creation/cancel, duplicates, metadata-only apply, double click, errors/reload, clear associations, preserved catalog and late loads');
};
