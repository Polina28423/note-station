const assert=require('node:assert/strict');
module.exports=async(page,base)=>{
  for(const mode of ['blocks','classic']){
    await page.goto(base+'/');
    await page.locator('.account-open').first().click();await page.locator('#notes .note-row').first().waitFor();
    await page.evaluate(async mode=>{
      const {BlockSurface}=await import('/block-editor.js'),{ClassicSurface}=await import('/classic-editor.js');
      for(const id of ['workspace','reader','note-editor'])document.getElementById(id).hidden=false;
      document.getElementById('startup-panel').hidden=true;
      document.getElementById('welcome-panel').hidden=true;document.getElementById('notebook-overview').hidden=true;document.getElementById('workspace').classList.remove('overview-mode');
      document.getElementById('block-content').hidden=mode!=='blocks';document.getElementById('classic-surface').hidden=mode!=='classic';
      const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100;const context=canvas.getContext('2d');context.fillStyle='#dff0f8';context.fillRect(0,0,200,100);context.fillStyle='#176b94';context.fillText('Test image',20,50);const url=canvas.toDataURL(),data=url.split(',')[1];
      const raw='<p>Before <img ref="original" alt="Test" width="64" height="32"> After</p>';
      const surface=mode==='blocks'?new BlockSurface(()=>{}):new ClassicSurface(()=>{});
      surface.loadImage=async()=>({data_url:url});await surface.load({object_id:'resize',ver:'v1',content:raw,images:[{reference:'original',file_id:'image-one'}]});
      const root=mode==='blocks'?document.getElementById('block-content'):surface.editor.getBody();
      const output=async()=>mode==='blocks'?surface.content().then(state=>surface.output(state.data,state.removed)):surface.output();
      window.resizeCheck={surface,root,output,raw,data,open:()=>root.querySelector('.note-image-size').click()};
    },mode);
    await page.waitForFunction(()=>window.resizeCheck.root.querySelector('.note-image')?.dataset.naturalWidth);
    assert.equal(await page.evaluate(()=>resizeCheck.output()),await page.evaluate(()=>resizeCheck.raw));
    await page.evaluate(()=>resizeCheck.open());
    const panel=page.locator('.image-size-panel:visible');
    await panel.getByRole('spinbutton').fill('120');await panel.getByRole('button',{name:'Применить',exact:true}).click();
    await page.waitForFunction(async()=>/width="120" height="60"/.test(await resizeCheck.output()));
    assert.equal(await page.evaluate(async()=>resizeCheck.surface.images.removed(await resizeCheck.output())),0);
    await page.evaluate(()=>resizeCheck.surface.undo());assert.equal(await page.evaluate(()=>resizeCheck.output()),await page.evaluate(()=>resizeCheck.raw));
    await page.evaluate(()=>resizeCheck.surface.redo());
    await page.waitForFunction(()=>resizeCheck.root.querySelector('.note-image')?.dataset.naturalWidth);
    await page.evaluate(()=>resizeCheck.open());
    const handle=page.locator('.image-size-overlay:visible .se');
    const box=await handle.boundingBox();await page.mouse.move(box.x+7,box.y+7);await page.mouse.down();await page.mouse.move(box.x+47,box.y+27,{steps:5});await page.mouse.up();
    await page.waitForFunction(async()=>/width="160" height="80"/.test(await resizeCheck.output()));
    await page.waitForFunction(()=>resizeCheck.root.querySelector('.note-image')?.dataset.naturalWidth);
    await panel.getByRole('button',{name:'Исходный размер',exact:true}).click();
    await page.waitForFunction(async()=>/width="200" height="100"/.test(await resizeCheck.output()));
    await page.waitForFunction(()=>resizeCheck.root.querySelector('.note-image')?.dataset.naturalWidth);
    await panel.getByRole('button',{name:'По ширине заметки',exact:true}).click();
    await page.waitForFunction(async()=>Number((await resizeCheck.output()).match(/width="(\d+)"/)[1])>200);
    const saved=await page.evaluate(()=>resizeCheck.output());assert.ok(saved.includes('Before ')&&saved.includes(' After'));assert.ok(!saved.includes('image-size-')&&!saved.includes('data-note-image'));
    await page.waitForFunction(()=>resizeCheck.root.querySelector('.note-image')?.dataset.naturalWidth);
    await panel.getByRole('spinbutton').fill('20000');await panel.getByRole('button',{name:'Применить',exact:true}).click();assert.equal(await page.evaluate(()=>resizeCheck.output()),saved);
    await page.evaluate(async()=>{
      const {surface,data,root}=resizeCheck;
      await surface.insertImage(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'local.png',{type:'image/png'}));
      const element=[...root.querySelectorAll('[data-note-image]')].find(node=>surface.images.records.get(node.dataset.noteImage)?.includes('ns-image-'));
      await surface.images.onResize(element,90,45);
    });
    const local=await page.evaluate(async()=>{const content=await resizeCheck.output();return {uploads:resizeCheck.surface.images.uploads(content).length,removed:resizeCheck.surface.images.removed(content),sized:/alt="local.png" width="90" height="45"/.test(content)};});
    assert.deepEqual(local,{uploads:1,removed:0,sized:true});
    await page.evaluate(()=>resizeCheck.surface.destroy());assert.equal(await page.locator('.image-size-panel').count(),0);
    console.log('PASS image resize '+mode+': width, proportional drag, fit, original, undo/redo, unchanged neighbors, local upload, removal accounting and cleanup');
  }
};
