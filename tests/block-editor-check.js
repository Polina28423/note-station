import { NoteEditor } from '/editor.js';
const checks=[];
const check=(value,name)=>{if(!value)throw Error(name);checks.push(name);};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(condition){for(let i=0;i<150;i++){if(condition())return;await delay(20);}throw Error('Timed out waiting for dialog');}
let sent=[],fail=false,slow=false,saved;
document.body.classList.add('connected');
document.getElementById('workspace').hidden=false;document.getElementById('reader').hidden=false;
document.getElementById('startup-panel').hidden=true;
const editor=new NoteEditor({
  save:async args=>{sent.push(args);if(slow)await delay(100);if(fail)throw Error('Fixture: offline');return {note:{object_id:args.id,ver:'v2',content:args.content,title:args.title,encrypted:false},notice:null};},
  onSaved:result=>{saved=result.note;},status:()=>{},onBusy:()=>{}
});
const html='<h2>Title</h2><p>First <b>bold</b> text</p><ul><li>One<ul><li>Nested</li></ul></li></ul><table><tr><th>A</th></tr><tr><td>B</td></tr></table><p style="text-align:center;font-family:UnknownCustomFont">Special layout</p><img src="relative.png" file_id="legacy"><embed src="document.pdf">';
const note={object_id:'fixture',ver:'v1',title:'Fixture',content:html,encrypted:false};
const title=()=>document.getElementById('edit-title');
const bodyInput=(value)=>{const p=document.querySelector('#block-content .ce-paragraph');p.textContent=value;p.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));};
try {
  await editor.start(note);
  check(editor.mode==='blocks'&&editor.surface.ready,'Editor.js opens without classic fallback');
  await delay(650);
  check(!editor.dirty(),'initial normalization does not mark note dirty');
  check(!document.querySelector('#block-content img,#block-content embed,#block-content iframe'),'protected media is never loaded in editor');
  check(document.querySelectorAll('.preserved-fragment').length===3,'all unsupported fragments have a protected preview');
  title().value='Only title';title().dispatchEvent(new Event('input'));
  check(await editor.save(),'title-only save succeeds');
  check(sent.at(-1).content===html,'title-only save preserves exact full HTML');
  check(sent.at(-1).expectedVersion==='v1','server conflict version is retained');

  await editor.start(note);bodyInput('Latest immediate edit');
  check(editor.dirty(),'input is dirty immediately before debounced events');
  const save=editor.save();
  check(document.getElementById('editor-surface').inert,'surface is frozen while extracting/saving');
  check(await save,'immediate Ctrl+S path succeeds');
  check(sent.at(-1).content.includes('<p>Latest immediate edit</p>'),'latest keystroke reaches saved HTML');
  check(sent.at(-1).content.includes('<img src="relative.png" file_id="legacy">')&&sent.at(-1).content.includes('<embed src="document.pdf">'),'original media attributes and relative URLs survive other block edits');
  check(sent.at(-1).content.includes('<p style="text-align:center;font-family:UnknownCustomFont">Special layout</p>'),'unrelated styled HTML remains exact');
  check(!sent.at(-1).content.includes('data-note-protected')&&!sent.at(-1).content.includes('preserved-fragment'),'editor implementation markers are never sent to NAS');

  await editor.start(note);
  await editor.surface.editor.blocks.insert('list',{style:'checklist',meta:{},items:[{content:'Done',meta:{checked:true},items:[]}]});
  check(await editor.save(),'checklist can be serialized with the installed List tool');
  check(sent.at(-1).content.includes('type="checkbox" disabled checked'),'new checklist checked state is exported');

  for(const [content,word] of [['<ul><li>List text</li></ul>','List text'],['<table><tr><td>Cell text</td></tr></table>','Cell text']]) {
    await editor.start({...note,content});
    const editable=[...document.querySelectorAll('#block-content [contenteditable="true"]')].find(n=>n.textContent===word);editable.focus();
    const range=document.createRange();range.selectNodeContents(editable);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);
    editor.format('underline');editor.format('strikeThrough');
    check(await editor.save(),'formatted '+word+' block can be saved');
    check(sent.at(-1).content.includes('<u>')&&/<(?:strike|s)>/.test(sent.at(-1).content),'underline and strike survive '+word+' tool sanitization');
  }
  const selectText=editable=>{editable.focus();const range=document.createRange();range.selectNodeContents(editable);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);editor.updateFormatting();};
  for(const [content,selector] of [['<p>Colored text</p>','.ce-paragraph'],['<ul><li>Colored item</li></ul>','[contenteditable="true"]'],['<table><tr><td>Colored cell</td></tr></table>','[contenteditable="true"]'],['<blockquote>Colored quote</blockquote>','.cdx-quote__text']]){
    await editor.start({...note,content});
    const editable=document.querySelector('#block-content '+selector);selectText(editable);
    for(const alignment of ['center','right','justify','left','right']){
      document.querySelector(`[data-align="${alignment}"]`).click();
      check(editable.closest('.note-alignment').style.textAlign===alignment,selector+' applies '+alignment+' alignment');
      check(getComputedStyle(editable).textAlign===alignment,selector+' displays '+alignment+' alignment');
    }
    document.getElementById('format-text-color').click();
    check(document.getElementById('style-color-dialog').open,'text color palette opens for '+selector);
    document.querySelector('[data-color="#c62828"]').click();
    selectText(editable);document.getElementById('format-background').click();
    document.querySelector('[data-color="#fff2a8"]').click();
    check(await editor.save(),'colors and alignment save for '+selector);
    const output=sent.at(-1).content;
    check(output.includes('color:#c62828')&&output.includes('background-color:#fff2a8')&&output.includes('text-align:right'),'tool retains color, highlight and alignment for '+selector);
    await editor.start({...note,content:output});
    const reopened=document.querySelector('#block-content '+selector);
    check(reopened&&!document.querySelector('.preserved-fragment')&&reopened.closest('.note-alignment').style.textAlign==='right','formatted '+selector+' reopens as an editable block');
    selectText(reopened);document.getElementById('format-background').click();document.getElementById('style-color-reset').click();
    check(await editor.save(),'highlight reset saves for '+selector);
    check(!sent.at(-1).content.includes('background-color:#fff2a8'),'highlight reset removes the previous color for '+selector);
  }
  await editor.start({...note,content:'<p>Text selection</p><pre><code>Code</code></pre>'});
  const paragraph=document.querySelector('#block-content .ce-paragraph');paragraph.focus();
  const selection=document.getSelection(),range=document.createRange();range.selectNodeContents(paragraph);selection.removeAllRanges();selection.addRange(range);
  document.querySelector('#block-content textarea').focus();editor.updateFormatting();
  check(document.querySelector('#editor-formatting [data-format="bold"]').disabled,'formatting cannot affect an old text selection while the code block has focus');
  editor.close();

  await editor.start(note);
  const clipboard=new DataTransfer();clipboard.setData('text/html','<table><tr><td colspan="2">Pasted merged cell</td></tr></table><script>window.compromised=true</script>');
  document.getElementById('block-content').dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));
  await editor.surface.pasteQueue;
  check(!window.compromised&&!document.querySelector('#block-content script'),'complex paste does not execute its original HTML');
  check(await editor.save(),'complex pasted HTML can be saved as a protected block');
  check(sent.at(-1).content.includes('colspan="2"')&&sent.at(-1).content.includes('Pasted merged cell')&&!sent.at(-1).content.includes('<script>'),'merged pasted table survives without active content');

  await editor.start({...note,content:'<p>Before paste</p>'});
  const alignedPaste=new DataTransfer();alignedPaste.setData('text/html','<p style="text-align:center"><span style="color:#123456">Pasted alignment</span></p>');
  document.getElementById('block-content').dispatchEvent(new ClipboardEvent('paste',{clipboardData:alignedPaste,bubbles:true,cancelable:true}));
  await editor.surface.pasteQueue;
  check([...document.querySelectorAll('.note-alignment')].some(n=>n.textContent.includes('Pasted alignment')&&getComputedStyle(n.querySelector('[contenteditable]')).textAlign==='center'),'pasted alignment is visible before saving');
  check(await editor.save()&&sent.at(-1).content.includes('text-align:center')&&sent.at(-1).content.includes('color:#123456'),'pasted alignment and colors survive export');

  await editor.start(note);
  editor.surface.editor.blocks.insert('header',{text:'',level:2});const beforeInvalid=sent.length;
  check(!await editor.save()&&sent.length===beforeInvalid,'a Tool-skipped invalid block prevents a partial NAS write');
  check(editor.active&&document.getElementById('save-error').textContent.includes('блок'),'invalid block leaves the draft open for correction');
  editor.close();

  await editor.start(note);bodyInput('Draft text');
  await editor.surface.capture();
  await editor.travel('undo');
  check((await editor.surface.content()).changed===false,'undo restores the baseline document');
  await editor.travel('redo');
  check((await editor.surface.content()).changed===true,'redo restores edited blocks');
  fail=true;const count=sent.length;
  check(!await editor.save(),'network failure is reported as unsaved');
  check(editor.active&&editor.dirty()&&document.querySelector('#block-content .ce-paragraph').textContent==='Draft text','draft remains editable after save failure');
  check(!document.getElementById('editor-surface').inert,'failed save restores input');
  fail=false;slow=true;const first=editor.save(),second=editor.save();
  check(await second===false,'parallel save attempt is rejected');await first;
  check(sent.length===count+2,'no duplicate NAS write during parallel saves');slow=false;

  await editor.start(note);
  const preservedIndex=Array.from({length:editor.surface.editor.blocks.getBlocksCount()},(_,i)=>i).find(i=>editor.surface.editor.blocks.getBlockByIndex(i).name==='preserved');
  editor.surface.editor.blocks.delete(preservedIndex);
  const pending=editor.save();await until(()=>document.getElementById('protected-dialog').open);
  document.getElementById('keep-protected').click();
  check(!await pending&&editor.active,'protected deletion can be cancelled without writing');
  const accepted=editor.save();await until(()=>document.getElementById('protected-dialog').open);
  document.getElementById('remove-protected').click();
  check(await accepted,'explicit protected-fragment removal can be saved');
  check(!sent.at(-1).content.includes('Special layout')&&sent.at(-1).content.includes('file_id="legacy"'),'only the explicitly removed fragment is omitted');

  await editor.start(note);bodyInput('Keep draft');
  const switching=editor.switchMode('classic');await until(()=>document.getElementById('unsaved-dialog').open);
  document.getElementById('keep-editing').click();await switching;
  check(editor.mode==='blocks'&&editor.active,'mode switch respects keep-editing choice');
  const switchingAgain=editor.switchMode('classic');await until(()=>document.getElementById('unsaved-dialog').open);
  document.getElementById('discard-edit').click();await switchingAgain;
  check(editor.mode==='classic'&&editor.active&&!!editor.surface.editor,'classic fallback can be selected after discarding draft');
  title().value='Classic title';title().dispatchEvent(new Event('input'));
  check(await editor.save()&&sent.at(-1).content===html,'classic fallback still preserves title-only HTML');

  await editor.start({...note,content:'<p>Classic colors</p>'});
  const classic=editor.surface.editor;classic.focus();classic.selection.select(classic.getBody().querySelector('p'),true);editor.updateFormatting();
  document.querySelector('[data-align="center"]').click();
  document.getElementById('format-text-color').click();document.querySelector('[data-color="#c62828"]').click();
  classic.selection.select(classic.getBody().querySelector('p'),true);editor.updateFormatting();
  document.getElementById('format-background').click();document.getElementById('style-color-custom').value='#123456';
  document.getElementById('style-color-form').requestSubmit();
  check(await editor.save(),'classic editor supports the shared color palette and alignment');
  check(/text-align:\s*center/.test(sent.at(-1).content)&&/color:\s*#c62828/.test(sent.at(-1).content)&&/background-color:\s*#123456/.test(sent.at(-1).content),'classic formatting saves custom background color and alignment');

  editor.preferredMode='blocks';await editor.start({ ...note,content:'<p>Text</p>' });
  const before=sent.length;
  check(await editor.save()&&sent.length===before,'saving unchanged content does not write to NAS');
  await editor.leave();check(!editor.active,'unchanged note closes without a false dirty dialog');
  window.testResult={ok:true,checks};
} catch(error) {
  console.error(error);window.testResult={ok:false,checks,error:String(error),stack:error.stack};
} finally {
  editor.close();
  const out=document.createElement('pre');out.id='test-results';out.textContent=JSON.stringify(window.testResult,null,2);document.body.append(out);
}
