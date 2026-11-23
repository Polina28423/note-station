const assert=require('node:assert/strict');
module.exports=async(page,base)=>{
  for(const mode of ['blocks','classic']){
    await page.goto(base+'/');
    const result=await page.evaluate(async mode=>{
      const {BlockSurface}=await import('/block-editor.js');const {ClassicSurface}=await import('/classic-editor.js');
      const {safeNoteFragment}=await import('/content.js');
      const $=id=>document.getElementById(id);
      $('startup-panel').hidden=true;$('workspace').hidden=false;$('reader').hidden=false;$('note-editor').hidden=false;
      $('block-content').hidden=mode!=='blocks';$('classic-surface').hidden=mode!=='classic';
      const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
      const calls=[],url='data:image/png;base64,'+data;
      const load=async args=>{calls.push(args);return {data_url:url};};
      const raw='<p>Before <img ref="original-ref" src="https://untrusted.invalid/secret" alt="Original" width="32"> After</p>';
      const note={object_id:'image-note',ver:'old-version',content:raw,images:[{file_id:'file-one',reference:'original-ref'}]};
      const surface=mode==='blocks'?new BlockSurface(()=>{}):new ClassicSurface(()=>{},()=>{},()=>{},error=>console.log("IMAGE ERROR",String(error)));
      surface.loadImage=load;await surface.load(note);
      const output=async()=>mode==='blocks'?await surface.content().then(state=>surface.output(state.data,state.removed)):surface.output();
      const root=mode==='blocks'?$('block-content'):surface.editor.getBody();
      for(let i=0;i<100&&!root.querySelector('img,.image-bitmap');i++)await new Promise(r=>setTimeout(r,20));
      const checks={initialExact:await output()===raw,preview:mode==='blocks'?root.querySelector('img')?.src===url:root.querySelector('.image-bitmap')?.style.backgroundImage.includes(url),mixedEditable:!root.querySelector('.preserved-fragment'),version:calls[0]?.version,file:calls[0]?.fileId};
      const file=new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'тест.png',{type:'image/png'});
      await surface.insertImage(file);
      const added=await output();checks.uploadCount=surface.images.uploads(added).length;checks.added=added.includes('ref="ns-image-');checks.originalKept=added.includes(raw.match(/<img[^>]+>/)[0]);checks.noInternalMarkers=!added.includes('data-note-image')&&!added.includes('data:image');
      await surface.undo();checks.undo=await output()===raw;await surface.redo();checks.redo=(await output()).includes('ref="ns-image-');
      [...root.querySelectorAll('[data-note-image]')].find(element=>surface.images.records.get(element.dataset.noteImage)?.includes('original-ref')).querySelector('.note-image-remove').click();
      await new Promise(r=>setTimeout(r,80));
      const removed=await output();checks.removedOriginal=!removed.includes('original-ref');checks.neighbors=removed.includes('Before ')&&removed.includes(' After');
      await surface.undo();checks.undoRemoval=(await output()).includes('original-ref');
      const reader=safeNoteFragment(raw,{note,load});checks.reader=reader.querySelector('.note-image')!==null;
      let rejected=false;try{await surface.insertImage(new File(['<svg/>'],'x.svg',{type:'image/svg+xml'}));}catch{rejected=true;}checks.svgRejected=rejected;
      for(const type of ['drop','paste']){
        if(mode==='classic'){surface.editor.selection.select(root,true);surface.editor.selection.collapse(false);}
        const transfer=new DataTransfer();transfer.items.add(file);
        root.dispatchEvent(type==='drop'?new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}):new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));
        await surface.images.pending;
      }
      checks.clipboardAndDrop=surface.images.uploads(await output()).length===3;
      const originalImage=[...root.querySelectorAll('[data-note-image]')].find(element=>surface.images.records.get(element.dataset.noteImage)?.includes('original-ref'));
      if(mode==='classic'){surface.editor.selection.select(root,true);surface.editor.selection.collapse(false);}
      const htmlClipboard=new DataTransfer();htmlClipboard.setData('text/html',originalImage.outerHTML);htmlClipboard.setData('text/plain','Image');
      root.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:htmlClipboard}));
      await surface.pasteQueue;
      const copied=await output();checks.normalizedImageCopy=(copied.match(/ref="original-ref"/g)||[]).length===2&&!copied.includes('note-image-remove');
      surface.destroy();return checks;
    },mode);
    for(const [key,value] of Object.entries(result)){
      if(key==='version')assert.equal(value,'old-version');else if(key==='file')assert.equal(value,'file-one');else if(key==='uploadCount')assert.equal(value,1);else assert.equal(value,true,mode+': '+key+' '+JSON.stringify(result));
    }
    console.log('PASS images '+mode+': '+Object.keys(result).join(', '));
  }
  await page.goto(base+'/');
  await page.evaluate(async()=>{
    const {NoteEditor}=await import('/editor.js');
    for(const id of ['workspace','reader'])document.getElementById(id).hidden=false;
    document.getElementById('startup-panel').hidden=true;
    const input=document.getElementById('image-file');input.replaceWith(input.cloneNode(true));
    window.imageSaves=[];window.failImageSave=true;
    window.imageEditor=new NoteEditor({save:async args=>{window.imageSaves.push(args);if(window.failImageSave)throw Error('Fixture offline');return {note:{object_id:args.id,title:args.title,content:args.content,ver:'v2'},notice:null};},onSaved:()=>{},onBusy:()=>{},status:()=>{}});
    await window.imageEditor.start({object_id:'file-button-note',ver:'v1',title:'Images',content:'<p>Text</p>'});
  });
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  assert.equal(await page.locator('#insert-image').isEnabled(),true);
  await page.locator('#image-file').setInputFiles({name:'button.png',mimeType:'image/png',buffer:pixel});
  await page.waitForFunction(()=>window.imageEditor.surface.images.local.size===1&&!window.imageEditor.checking);
  assert.equal(await page.evaluate(()=>window.imageEditor.save()),false);
  assert.equal(await page.evaluate(()=>window.imageEditor.active&&window.imageEditor.dirty()),true);
  const upload=await page.evaluate(()=>window.imageSaves[0]);assert.equal(upload.images.length,1);assert.equal(upload.images[0].data,pixel.toString('base64'));assert.equal(upload.expectedVersion,'v1');assert.ok(!upload.content.includes('data-note-image'));
  await page.evaluate(()=>{window.failImageSave=false;});
  assert.equal(await page.evaluate(()=>window.imageEditor.save()),true);
  assert.equal(await page.evaluate(()=>window.imageSaves[0].images[0].reference===window.imageSaves[1].images[0].reference),true);
  console.log('PASS image file button, save payload, retained draft on error, stable retry reference');
  for(const mode of ['blocks','classic']){
    await page.goto(base+'/');
    await page.evaluate(async mode=>{
      const {NoteEditor}=await import('/editor.js');
      for(const id of ['workspace','reader'])document.getElementById(id).hidden=false;
      document.getElementById('startup-panel').hidden=true;
      window.imageSaves=[];window.imageEditor=new NoteEditor({mode,save:async args=>{window.imageSaves.push(args);return {note:{object_id:args.id,title:args.title,content:args.content,ver:'v2'}};},onSaved:()=>{},onBusy:()=>{},status:()=>{}});
      await window.imageEditor.start({object_id:'remove',ver:'v1',title:'Remove image',content:'<p>Before <img file_id="legacy" src="relative.png"> After</p>'});
      const root=mode==='blocks'?document.getElementById('block-content'):window.imageEditor.surface.editor.getBody();root.querySelector('.note-image-remove').click();
      await new Promise(r=>setTimeout(r,100));window.pendingImageSave=window.imageEditor.save();
    },mode);
    await page.locator('#protected-dialog').waitFor({state:'visible'});await page.locator('#keep-protected').click();
    assert.equal(await page.evaluate(()=>window.pendingImageSave),false);assert.equal(await page.evaluate(()=>window.imageSaves.length),0);
    await page.evaluate(()=>{window.pendingImageSave=window.imageEditor.save();});
    await page.locator('#protected-dialog').waitFor({state:'visible'});await page.locator('#remove-protected').click();
    assert.equal(await page.evaluate(()=>window.pendingImageSave),true);
    const saved=await page.evaluate(()=>window.imageSaves[0]);assert.ok(!saved.content.includes('<img'));assert.ok(saved.content.includes('Before ')&&saved.content.includes(' After'));assert.deepEqual(saved.images,[]);
    console.log('PASS '+mode+' image removal confirmation, cancellation and reference-only save');
  }
};
