const assert=require('node:assert/strict');
module.exports=async(page,base)=>{
  await page.goto(base+'/');await page.locator('.account-open').first().click();
  await page.locator('#notes .note-row').first().waitFor();
  await page.evaluate(()=>{
    const original=window.__TAURI__.core.invoke;window.createdCalls=[];
    window.__TAURI__.core.invoke=async(command,args)=>{
      if(command==='list_todos'&&window.failTaskRead)throw Error('Read fixture failed');
      if(command==='create_todo'){
        window.createdCalls.push(args);await new Promise(resolve=>setTimeout(resolve,100));
        if(window.failTaskCreate)throw Error('Write fixture failed');
        const result=await original(command,args);
        if(window.failTaskReadAfterCreate)window.failTaskRead=true;
        return result;
      }
      return original(command,args);
    };
  });
  await page.locator('#show-todos').click();await page.waitForFunction(()=>!document.getElementById('todo-create-submit').disabled);
  await page.locator('#todo-title').fill('   ');await page.locator('#todo-create-submit').click();
  assert.equal(await page.evaluate(()=>window.createdCalls.length),0);
  await page.locator('#todo-title').fill('  Новая задача <текст>  ');
  await page.locator('#todo-details summary').click();
  await page.locator('#todo-due').fill('2026-11-20');
  const noteId=await page.locator('#todo-note option').nth(1).getAttribute('value');
  await page.locator('#todo-note').selectOption(noteId);
  for(const [width,height] of [[1440,1000],[900,600]]){
    await page.setViewportSize({width,height});
    const sizes=await page.locator('#todo-title,#todo-due,#todo-note,#todo-create-submit').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
    assert.ok(sizes.every(size=>size===38),JSON.stringify(sizes));
  }
  await page.locator('#todo-title').press('Enter');
  await page.evaluate(()=>document.getElementById('todo-create-form').requestSubmit());
  await page.waitForFunction(()=>document.getElementById('collection-status').textContent==='Задача создана на NAS.');
  const calls=await page.evaluate(()=>window.createdCalls);
  assert.equal(calls.length,1);assert.equal(calls[0].title,'Новая задача <текст>');assert.equal(calls[0].noteId,noteId);
  assert.equal(calls[0].dueDate,await page.evaluate(()=>Math.floor(new Date(2026,10,20,23,59,59).getTime()/1000)));
  assert.match(await page.locator('.collection-row').first().textContent(),/Новая задача <текст>.*20.11.2026/);
  assert.equal(await page.locator('#todo-title').inputValue(),'');
  assert.equal(await page.locator('#todo-due').inputValue(),'');
  assert.equal(await page.locator('#todo-note').inputValue(),'');
  await page.evaluate(()=>window.failTaskCreate=true);
  await page.locator('#todo-title').fill('Сохранить черновик');await page.locator('#todo-create-submit').click();
  await page.waitForFunction(()=>document.getElementById('collection-status').textContent.includes('не создать дубликат'));
  assert.equal(await page.locator('#todo-title').inputValue(),'Сохранить черновик');
  assert.equal(await page.locator('#todo-create-submit').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.createdCalls.length),2);
  await page.evaluate(()=>window.failTaskCreate=false);
  await page.locator('#collection-refresh').click();await page.waitForFunction(()=>!document.getElementById('todo-create-submit').disabled);
  await page.locator('#show-tags').click();assert.equal(await page.locator('#todo-create-form').isVisible(),false);
  await page.locator('#show-todos').click();await page.waitForFunction(()=>!document.getElementById('todo-create-submit').disabled);
  assert.equal(await page.locator('#todo-title').inputValue(),'Сохранить черновик');
  await page.evaluate(()=>window.failTaskReadAfterCreate=true);
  await page.locator('#todo-create-submit').click();
  await page.waitForFunction(()=>document.getElementById('collection-status').textContent.includes('Задача создана, но'));
  assert.equal(await page.locator('#todo-title').inputValue(),'');assert.equal(await page.locator('#todo-create-submit').isDisabled(),true);
  await page.evaluate(()=>{window.failTaskRead=false;window.failTaskReadAfterCreate=false;});
  await page.locator('#collection-refresh').click();await page.waitForFunction(()=>!document.getElementById('todo-create-submit').disabled);
  assert.equal(await page.evaluate(()=>window.createdCalls.length),3);
  await page.setViewportSize({width:1440,height:1000});
  console.log('PASS task creation: real fields, local due time, double submission, draft preservation, ambiguous errors, confirmed creation with refresh failure, equal heights and navigation');
};
