import { htmlStrings as strings } from './strings.js';

export function bindNoteHtml({getNote,editor,canOpen=()=>true}){
  const $=id=>document.getElementById(id),dialog=$('note-html-dialog');
  let note=null,request=0,loading=false;
  const message=text=>{$('note-html-status').textContent=text;};
  function reset(){
    request++;note=null;loading=false;$('note-html-code').value='';$('note-html-name').textContent='';message('');
    if(dialog.open)dialog.close();
    update();
  }
  function update(){const current=getNote();$('note-html-open').disabled=!canOpen()||!current||current.encrypted;}
  async function show(draft){
    const token=++request;loading=true;$('note-html-copy').disabled=true;$('note-html-code').value='';
    $('note-html-original').setAttribute('aria-pressed',String(!draft));$('note-html-draft').setAttribute('aria-pressed',String(draft));
    message(draft?strings.loading:strings.originalHint);
    try{
      const content=draft?await editor.htmlSnapshot():note.content;
      if(token!==request||!dialog.open)return;
      $('note-html-code').value=content;message(draft?strings.draftHint:strings.originalHint);
    }catch(error){if(token===request)message(String(error));}
    finally{if(token===request){loading=false;$('note-html-copy').disabled=!$('note-html-code').value;}}
  }
  $('note-html-open').title=strings.title;$('note-html-open').setAttribute('aria-label',strings.title);
  $('note-html-open').addEventListener('click',()=>{
    if(!canOpen())return;const current=getNote();if(!current||current.encrypted)return;
    note={content:current.content,title:current.title};$('note-html-name').textContent=current.title;
    $('note-html-draft').disabled=!editor.active;dialog.showModal();show(false);
  });
  $('note-html-original').addEventListener('click',()=>show(false));
  $('note-html-draft').addEventListener('click',()=>{if(editor.active)show(true);});
  $('note-html-copy').addEventListener('click',async()=>{
    if(loading)return;const token=request;
    try{await navigator.clipboard.writeText($('note-html-code').value);if(token===request)message(strings.copied);}
    catch{if(token===request){$('note-html-code').focus();$('note-html-code').select();message(strings.copyFailed);}}
  });
  $('note-html-close').addEventListener('click',reset);
  dialog.addEventListener('cancel',event=>{event.preventDefault();reset();});
  dialog.addEventListener('close',reset);
  return {update,reset};
}
