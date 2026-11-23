import {noteTagStrings as strings} from './strings.js';

export const normalizeTagName=value=>value.trim().toLocaleLowerCase();
export function chooseTagName(name,names){return names.find(value=>normalizeTagName(value)===normalizeTagName(name))||name.trim();}

export function bindNoteTags({invoke,getNote,canOpen,setBusy,onSaved,status}){
  const $=id=>document.getElementById(id),dialog=$('note-tags-dialog');
  let note=null,baseline=null,catalog=[],chosen=new Set(),draft=[],request=0,writing=false,loading=false,blocked=false;
  const message=text=>$('note-tags-status').textContent=text;
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  function update(){
    for(const control of dialog.querySelectorAll('input,button'))control.disabled=writing||loading;
    $('note-tags-close').disabled=writing;
    $('note-tags-cancel').disabled=writing;
    $('note-tags-reload').disabled=writing;
    $('note-tags-apply').disabled=writing||loading||blocked||!baseline;
    $('note-tags-create').disabled=writing||loading||!baseline;
    dialog.setAttribute('aria-busy',String(writing||loading));
  }
  function all(){return [...new Set([...catalog,...(baseline?.tags||[]),...draft,...chosen])];}
  function toggle(name){
    if(writing||loading)return;
    chosen.has(name)?chosen.delete(name):chosen.add(name);message(strings.selected(chosen.size));render();
    const button=[...$('note-tags-all').children].find(row=>row.querySelector('.note-tag-name')?.textContent===name);
    (button||$('note-tags-search')).focus();
  }
  function render(){
    $('note-tags-all').replaceChildren();$('note-tags-selected').replaceChildren();
    const query=normalizeTagName($('note-tags-search').value);
    const found=all().filter(name=>normalizeTagName(name).includes(query)).sort((a,b)=>a.localeCompare(b,'ru'));
    for(const name of found){
      const button=make('button','note-tag-option');button.type='button';button.setAttribute('aria-pressed',String(chosen.has(name)));
      button.append(make('span','note-tag-name',name),make('span','note-tag-mark',chosen.has(name)?'✓':'+'));
      button.addEventListener('click',()=>toggle(name));$('note-tags-all').append(button);
    }
    if(!found.length)$('note-tags-all').append(make('p','note-tag-empty',strings.noMatches));
    for(const name of chosen){
      const row=make('div','note-tag-selected');const button=make('button','note-tag-remove','×');button.type='button';button.setAttribute('aria-label',strings.remove(name));button.addEventListener('click',()=>toggle(name));
      row.append(make('span','note-tag-name',name),button);$('note-tags-selected').append(row);
    }
    if(!chosen.size)$('note-tags-selected').append(make('p','note-tag-empty',strings.empty));
    $('note-tags-selected-count').textContent=chosen.size;
    update();
  }
  async function load(){
    if(writing||!note)return;
    const token=++request;loading=true;baseline=null;blocked=true;message(strings.loading);update();
    try{
      const state=await invoke('get_note_tags',{id:note.object_id});
      if(token!==request)return;
      baseline=state;catalog=state.catalog.map(tag=>tag.title);chosen=new Set(state.tags);draft=[];$('note-tags-search').value='';$('note-tags-new').value='';blocked=false;message(strings.loaded);
    }catch(error){if(token===request)message(String(error));}
    finally{if(token===request){loading=false;render();if(dialog.open)$('note-tags-search').focus();}}
  }
  function close(){if(writing)return;request++;dialog.close();note=null;baseline=null;chosen.clear();draft=[];catalog=[];loading=false;$('note-tags-new').setCustomValidity('');}
  $('note-tags-open').addEventListener('click',async()=>{
    if(!canOpen()||!getNote())return;
    note={...getNote()};catalog=[];chosen=new Set();draft=[];$('note-tags-caption').textContent=note.title;
    $('note-tags-search').value='';$('note-tags-new').value='';render();dialog.showModal();load();
  });
  $('note-tags-close').addEventListener('click',close);$('note-tags-cancel').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  $('note-tags-reload').addEventListener('click',load);
  $('note-tags-search').addEventListener('input',render);
  function create(){
    if(writing||loading||!baseline)return;
    const input=$('note-tags-new'),value=input.value.trim();
    if(!value||value.length>64||/[\u0000-\u001f\u007f]/.test(value)){input.setCustomValidity(strings.newTag);input.reportValidity();return;}
    const name=chooseTagName(value,all());const exists=all().includes(name);
    if(!exists)draft.push(name);chosen.add(name);input.value='';$('note-tags-search').value='';message(exists?strings.existing:strings.staged);render();input.focus();
  }
  $('note-tags-create').addEventListener('click',create);
  $('note-tags-new').addEventListener('input',()=>$('note-tags-new').setCustomValidity(''));
  $('note-tags-new').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();create();}});
  $('note-tags-apply').addEventListener('click',async()=>{
    if(writing||loading||blocked||!baseline||!note)return;
    writing=true;setBusy(true);message(strings.saving);update();
    try{
      const result=await invoke('set_note_tags',{id:note.object_id,expectedVersion:baseline.ver,expectedTags:baseline.tags,tags:[...chosen]});
      onSaved(result);status(result.notice||strings.saved,!!result.notice);
      writing=false;close();
    }catch(error){blocked=true;message(`${strings.failed} ${String(error)}`);}
    finally{writing=false;setBusy(false);update();}
  });
  return {
    display(note){
      const tags=$('note-tag-chips');tags.replaceChildren();
      if(Array.isArray(note?.tags))for(const name of note.tags)tags.append(make('span','note-tag-chip',name));
      if(note&&!Array.isArray(note.tags))tags.append(make('span','note-tag-unknown',strings.unknown));
      $('note-tag-chips').closest('.note-tag-bar').hidden=!note||(Array.isArray(note.tags)&&note.tags.length===0);
    },
    reset(){request++;if(dialog.open)dialog.close();note=null;baseline=null;chosen.clear();catalog=[];draft=[];},
  };
}
