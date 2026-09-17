import { spellingStrings, typographyStrings, linkStrings, pasteStrings, noteTagStrings } from './strings.js';
import { snapshotIsCurrent, selectionInSnapshot } from './spelling-adapter.js';
import { htmlToText } from './content.js';
import { ClassicSurface } from './classic-editor.js';
import { BlockSurface } from './block-editor.js';
import { normalizeWebUrl } from './links.js';
import { ALIGNMENTS, normalizeColor, FONT_FAMILIES, FONT_SIZES, normalizeFontFamily, normalizeFontSize } from './editor-styles.js';
const $ = id => document.getElementById(id);
export class NoteEditor {
  constructor({save,onSaved,status,onBusy,openExternal=()=>{throw Error(linkStrings.unavailable);},mode='blocks'}) {
    Object.assign(this,{send:save,onSaved,status,onBusy,openExternal});
    this.active=false;this.saving=false;this.preferredMode=['blocks','classic'].includes(mode)?mode:'blocks';this.mode=this.preferredMode;this.bodyDirty=false;this.saveSequence=0;
    $('edit-title').addEventListener('input',()=>{this.spellingRevision=(this.spellingRevision||0)+1;this.update();});
    $('save-note').addEventListener('click',()=>this.save());
    $('cancel-edit').addEventListener('click',()=>this.leave());
    $('editor-undo').addEventListener('click',()=>this.travel('undo'));
    $('editor-redo').addEventListener('click',()=>this.travel('redo'));
    this.pastePlain=false;
    const pasteButton=$('paste-plain');
    pasteButton.setAttribute('aria-label',pasteStrings.label);
    pasteButton.title=pasteStrings.formatted;
    pasteButton.addEventListener('pointerdown',event=>event.preventDefault());
    pasteButton.addEventListener('click',()=>{
      this.pastePlain=!this.pastePlain;
      if(this.surface)this.surface.pastePlain=this.pastePlain;
      pasteButton.setAttribute('aria-pressed',String(this.pastePlain));
      pasteButton.title=this.pastePlain?pasteStrings.plain:pasteStrings.formatted;
    });
    const formatting=$('editor-formatting');
    formatting.addEventListener('pointerdown',e=>{if(e.target.closest('button'))e.preventDefault();});
    formatting.addEventListener('mousedown',e=>{if(e.target.closest('button'))e.preventDefault();});
    formatting.addEventListener('click',e=>{
      const button=e.target.closest('button');if(!button||button.disabled)return;
      if(button.id==='format-link')this.openLink();
      else if(button.id==='format-text-color')this.openColor('foreColor');
      else if(button.id==='format-background')this.openColor('hiliteColor');
      else if(button.dataset.align)this.align(button.dataset.align);
      else if(button.dataset.format)this.format(button.dataset.format);
    });
    for(const [id,property,values] of [['format-font-family','font-family',FONT_FAMILIES],['format-font-size','font-size',FONT_SIZES.map(size=>`${size}pt`)]]){
      const select=$(id);if(!select)continue;
      for(const value of values){const option=document.createElement('option');option.value=value;option.textContent=property==='font-size'?value.replace('pt',''):value;select.append(option);}
      const remember=()=>{const range=this.surface?.selectionRange();this.typographySelection=range&&!range.collapsed?{surface:this.surface,range}:this.lastTextSelection;};
      select.addEventListener('pointerdown',remember);select.addEventListener('focus',remember);
      select.addEventListener('change',()=>this.applyTypography(property,select.value));
    }
    document.addEventListener('selectionchange',()=>this.updateFormatting());
    document.addEventListener('focusin',()=>this.updateFormatting());
    const palette=$('style-color-palette');
    for(const color of ['#000000','#505a64','#808080','#ffffff','#c62828','#ef6c00','#f9a825','#2e7d32','#00838f','#1565c0','#6a1b9a','#ad1457','#ffcdd2','#ffe0b2','#fff2a8','#c8e6c9','#b3e5fc','#d1c4e9']){
      const button=document.createElement('button');button.type='button';button.className='color-swatch';button.dataset.color=color;button.style.backgroundColor=color;button.title=color;button.setAttribute('aria-label',`Цвет ${color}`);palette.append(button);
    }
    palette.addEventListener('click',event=>{const color=event.target.closest('[data-color]')?.dataset.color;if(color)this.applyColor(color);});
    $('style-color-form').addEventListener('submit',event=>{event.preventDefault();this.applyColor($('style-color-custom').value);});
    $('style-color-reset').addEventListener('click',()=>this.applyColor(this.colorSelection?.command==='hiliteColor'?'transparent':'#505a64'));
    $('style-color-cancel').addEventListener('click',()=>{$('style-color-dialog').close();this.colorSelection=null;});
    $('style-color-dialog').addEventListener('cancel',()=>{this.colorSelection=null;});
    $('format-link-form').addEventListener('submit',async event=>{
      event.preventDefault();
      const href=normalizeWebUrl($('format-link-url').value,true);
      if(!href){$('format-link-error').textContent=linkStrings.invalid;return;}
      const saved=this.linkSelection,text=$('format-link-text').value.trim()||href;
      if(!saved||saved.surface!==this.surface||saved.revision!==(this.spellingRevision||0)){$('format-link-error').textContent=linkStrings.stale;return;}
      $('format-link-dialog').close();this.linkSelection=null;
      this.checking=true;this.onBusy(true);this.update();
      try{if(await this.surface.setLink(href,text,saved.range,saved.link))this.change();else this.status(linkStrings.stale,true);}
      catch(error){$('save-error').textContent=String(error);}
      finally{this.checking=false;this.onBusy(false);this.update();}
    });
    $('format-link-open')?.addEventListener('click',async()=>{
      const href=normalizeWebUrl($('format-link-url').value,true);
      if(!href){$('format-link-error').textContent=linkStrings.invalid;return;}
      const button=$('format-link-open');button.disabled=true;
      try{await this.openExternal(href);}catch{$('format-link-error').textContent=linkStrings.openFailed;}
      finally{button.disabled=false;}
    });
    $('format-link-cancel').addEventListener('click',()=>{$('format-link-dialog').close();this.linkSelection=null;});
    $('format-link-remove').addEventListener('click',()=>{const saved=this.linkSelection;$('format-link-dialog').close();this.linkSelection=null;if(saved?.surface===this.surface&&saved.revision===(this.spellingRevision||0))this.format('unlink',undefined,saved.range);});
    $('format-link-dialog').addEventListener('cancel',()=>{this.linkSelection=null;});
    for(const [id,choice] of [['keep-editing','stay'],['discard-edit','discard'],['save-and-continue','save']]) $(id).addEventListener('click',()=>this.resolveDialog(choice));
    $('unsaved-dialog').addEventListener('cancel',e=>{e.preventDefault();this.resolveDialog('stay');});
    for(const [id,choice] of [['keep-protected',false],['remove-protected',true]]) $(id).addEventListener('click',()=>{ $('protected-dialog').close();this.resolveProtected?.(choice); });
    $('protected-dialog').addEventListener('cancel',e=>{e.preventDefault();$('protected-dialog').close();this.resolveProtected?.(false);});
    const modified=()=>{if(this.active&&!this.saving&&!this.historyBusy){this.bodyDirty=true;this.update();}};
    $('block-content').addEventListener('input',modified,true);
    $('block-content').addEventListener('keydown',e=>{if(e.key==='Backspace'||e.key==='Delete'||e.key==='Enter')modified();},true);
    window.addEventListener('beforeunload',e=>{if(this.dirty()||this.saving){e.preventDefault();e.returnValue='';}});
    window.addEventListener('keydown',e=>{
      if(!this.active)return;
      if($('format-link-dialog').open||$('style-color-dialog').open||$('spelling-dialog')?.open||$('note-tags-dialog')?.open){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s')e.preventDefault();return;}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();this.openLink();return;}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();this.save();}
      if(this.mode==='blocks'&&(e.ctrlKey||e.metaKey)&&e.target.closest?.('#block-content')&&['z','y'].includes(e.key.toLowerCase())) {
        e.preventDefault();this.travel(e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo');
      }
    });
  }
  change(error,changed) {
    this.spellingRevision=(this.spellingRevision||0)+1;
    if(!this.active)return;
    if(error){$('save-error').textContent=String(error);this.bodyDirty=true;}
    else this.bodyDirty=this.mode==='classic'?this.surface.changed():changed===undefined?true:changed;
    this.update();
  }
  async start(note,{focusBody=false,anchor}={}) {
    if(this.active||this.saving||this.opening)return;
    if(note.encrypted||note.ver==null){this.status('Эту заметку пока нельзя редактировать: нет доступного текста или версии.',true);return;}
    this.metadataError='';this.opening=true;this.onBusy(true);this.note=note;this.mode=this.preferredMode;
    try {
      $('reader-empty').hidden=true;$('reader-document').hidden=true;$('note-editor').hidden=false;
      $('edit-title').value=note.title;$('save-error').textContent='';
      await this.loadSurface(note);
      this.active=true;this.bodyDirty=false;
      for(const id of ['font-smaller','font-larger','copy-note'])$(id).disabled=true;
      if(focusBody)this.surface.focus(anchor);else $('edit-title').focus();
    } catch(error) {
      this.surface?.destroy();this.surface=null;this.note=null;
      $('note-editor').hidden=true;$('reader-document').hidden=false;this.status(String(error),true);
    } finally {this.opening=false;this.onBusy(false);this.update();}
  }
  async loadSurface(note) {
    const create=()=>{
      $('block-content').hidden=this.mode!=='blocks';$('classic-surface').hidden=this.mode!=='classic';
      this.surface=this.mode==='blocks'?new BlockSurface((error,changed)=>this.change(error,changed),this.openExternal,this.status):new ClassicSurface(()=>this.change(),()=>this.updateFormatting(),this.openExternal,this.status,()=>this.openLink());
      this.surface.pastePlain=this.pastePlain;
    };
    create();
    try {await this.surface.load(note);}
    catch(error) {
      this.surface?.destroy();
      if(this.mode!=='blocks')throw error;
      this.mode='classic';create();await this.surface.load(note);
      this.status('Не удалось открыть Editor.js. Заметка открыта в классическом редакторе.',true);
    }
  }
  dirty(){return !!(this.active&&this.note&&($('edit-title').value!==this.note.title||(this.mode==='classic'?this.surface.changed():this.bodyDirty)));}
  acceptMetadata(note){
    if(!this.active||this.note?.object_id!==note.object_id)return;
    const unchanged=this.note.content===note.content&&this.note.title===note.title;
    this.note={...this.note,tags:note.tags,ver:unchanged?note.ver:null};
    this.metadataError=!unchanged?noteTagStrings.draftConflict:note.ver==null?noteTagStrings.draftUnknown:'';
    $('save-error').textContent=this.metadataError;this.update();
  }
  update(){
    $('edit-state').textContent=this.saving?'Сохранение…':this.opening?'Открытие редактора…':this.dirty()?'Есть несохранённые изменения':'Нет изменений';
    const locked=this.saving||this.opening||this.historyBusy||this.checking;
    $('paste-plain').disabled=locked||!this.active;
    $('note-tags-open').disabled=locked||!this.active||this.note?.encrypted;
    const spellingButton=$('check-spelling');if(spellingButton)spellingButton.disabled=locked||!this.active||!this.surface?.spellingSnapshot;
    $('save-note').disabled=locked||!this.dirty()||!!this.metadataError;$('cancel-edit').disabled=locked;
    $('editor-undo').disabled=locked;$('editor-redo').disabled=locked;
    this.updateFormatting();
  }
  updateFormatting(){
    let state={};try{if(this.active)state=this.surface?.formatState() || {};}catch{}
    if(this.active&&state.available&&!document.activeElement?.closest('#editor-formatting')){const range=this.surface?.selectionRange();this.lastTextSelection=range&&!range.collapsed?{surface:this.surface,range}:null;}
    const locked=!this.active||this.saving||this.opening||this.historyBusy||this.checking||!state.available;
    for(const button of $('editor-formatting').querySelectorAll('button')) {
      button.disabled=!!locked;
      if(['bold','italic','underline','strikeThrough'].includes(button.dataset.format))button.setAttribute('aria-pressed',String(!!state[button.dataset.format]));
      if(button.dataset.align)button.setAttribute('aria-pressed',String(state.alignment===button.dataset.align));
    }
    for(const [id,value] of [['format-font-family',normalizeFontFamily(state.fontFamily)?.split(',')[0]],['format-font-size',normalizeFontSize(state.fontSize)]]){
      const select=$(id);if(!select)continue;
      select.disabled=!!locked;
      if(document.activeElement!==select)select.value=[...select.options].some(option=>option.value===value)?value:'';
    }
    $('format-text-color').style.setProperty('--selected-color',normalizeColor(state.color) || '#505a64');
    $('format-background').style.setProperty('--selected-color',normalizeColor(state.background) || '#fff2a8');
  }
  async applyTypography(property,value){
    if(!this.active||this.saving||this.opening||this.historyBusy||this.checking)return;
    const saved=this.typographySelection;
    if(!saved||saved.surface!==this.surface||!saved.range||saved.range.collapsed){this.status(typographyStrings.selectText,true);return;}
    this.checking=true;this.onBusy(true);this.update();
    try{if(await this.surface.typography(property,value,saved.range))this.change();}
    catch(error){$('save-error').textContent=String(error);}
    finally{this.checking=false;this.onBusy(false);this.update();}
  }
  format(command,value,range){
    if(!this.active||this.saving||this.opening||this.historyBusy||this.checking)return;
    try{if(this.surface.format(command,value,range))this.change();else this.status('Установите курсор или выделите текст внутри редактируемого блока.',true);}
    catch(error){$('save-error').textContent=String(error);}
    this.updateFormatting();
  }
  align(alignment){
    if(!this.active||this.saving||this.opening||this.historyBusy||this.checking||!ALIGNMENTS.includes(alignment))return;
    try{if(this.surface.align(alignment))this.change();}catch(error){$('save-error').textContent=String(error);}
    this.updateFormatting();
  }
  openColor(command){
    const range=this.surface?.selectionRange();if(!range||!this.surface.formatState().available)return;
    const state=this.surface.formatState(),current=command==='foreColor'?state.color:state.background;
    this.colorSelection={surface:this.surface,command,range};
    $('style-color-title').textContent=command==='foreColor'?'Цвет текста':'Цвет выделения фоном';
    $('style-color-reset').textContent=command==='foreColor'?'Обычный цвет':'Убрать выделение';
    $('style-color-custom').value=/^#[0-9a-f]{6}$/i.test(current)?current:command==='foreColor'?'#505a64':'#fff2a8';
    $('style-color-dialog').showModal();
  }
  applyColor(color){
    const value=normalizeColor(color),saved=this.colorSelection;if(!value||!saved)return;
    $('style-color-dialog').close();this.colorSelection=null;
    if(saved.surface===this.surface)this.format(saved.command,value,saved.range);
  }
  openLink(){
    if(!this.active||this.saving||this.opening||this.historyBusy||this.checking)return;
    const range=this.surface?.selectionRange();if(!range)return;
    const node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const link=node.closest('a');
    if(link)range.selectNodeContents(link);
    this.linkSelection={surface:this.surface,range,link,revision:this.spellingRevision||0};
    $('format-link-url').value=link?.getAttribute('href') || '';
    $('format-link-text').value=link?.textContent || range.toString();
    $('format-link-remove').disabled=!link;
    $('format-link-error').textContent='';
    $('format-link-dialog').showModal();$('format-link-url').focus();
  }
  spellingSnapshot(){
    if(!this.active||this.saving||this.opening||this.historyBusy||this.checking||!this.surface?.spellingSnapshot)throw Error(spellingStrings.unsupported);
    const body=this.surface.spellingSnapshot();
    const input=$('edit-title'),title=input.value;
    const selection=document.activeElement===input&&input.selectionEnd>input.selectionStart
      ? {segment:'title',start:input.selectionStart,length:input.selectionEnd-input.selectionStart}
      : selectionInSnapshot(body,this.surface.selectionRange?.());
    return {selection,surface:this.surface,revision:this.spellingRevision||0,title,body,
      segments:[{id:'title',text:title},...body.map(part=>({id:part.id,text:part.text}))]};
  }
  spellingCurrent(snapshot){
    return this.active&&snapshot.surface===this.surface&&snapshot.revision===(this.spellingRevision||0)&&snapshot.title===$('edit-title').value&&snapshotIsCurrent(snapshot.body);
  }
  async replaceSpelling(snapshot,issue,replacement){
    if(!this.spellingCurrent(snapshot)||this.saving||this.opening||this.historyBusy||this.checking)return false;
    if(issue.segment==='title'){
      const input=$('edit-title');
      if(input.value.slice(issue.start,issue.start+issue.length)!==issue.word)return false;
      input.focus({preventScroll:true});input.setSelectionRange(issue.start,issue.start+issue.length);
      const changed=document.execCommand('insertText',false,replacement);
      if(changed){this.spellingRevision=(this.spellingRevision||0)+1;this.update();}return changed;
    }
    this.checking=true;this.onBusy(true);this.update();
    try{return await this.surface.replaceSpelling(snapshot.body,issue,replacement);}
    finally{this.checking=false;this.onBusy(false);this.update();}
  }
  close(){
    if($('spelling-dialog')?.open)$('spelling-dialog').close();
    this.spellingRevision=(this.spellingRevision||0)+1;
    if($('style-color-dialog').open)$('style-color-dialog').close();this.colorSelection=null;
    if($('format-link-dialog').open)$('format-link-dialog').close();this.linkSelection=null;
    this.active=false;this.surface?.destroy();this.surface=null;this.note=null;this.bodyDirty=false;this.metadataError='';
    $('edit-title').value='';$('save-error').textContent='';$('note-editor').hidden=true;
    $('editor-surface').inert=false;
    for(const id of ['font-smaller','font-larger','copy-note'])$(id).disabled=false;
  }
  async travel(method){
    if(!this.active||this.saving||this.opening||this.historyBusy||this.checking)return;
    this.historyBusy=true;this.onBusy(true);$('editor-surface').inert=true;this.update();
    try {await this.surface[method]();}
    catch(error){$('save-error').textContent=String(error);}
    finally{this.historyBusy=false;$('editor-surface').inert=false;this.onBusy(false);this.update();}
  }
  async save(){
    if(!this.active||this.saving||this.opening||this.historyBusy||this.checking)return false;
    if(this.metadataError){$('save-error').textContent=this.metadataError;return false;}
    if(!$('edit-title').value.trim()){$('save-error').textContent='Введите заголовок заметки.';$('edit-title').focus();return false;}
    this.saving=true;this.onBusy(true);$('edit-title').disabled=true;$('editor-surface').inert=true;this.update();$('save-error').textContent='';
    try {
      let content;
      if(this.mode==='blocks') {
        const state=await this.surface.content();this.bodyDirty=state.changed;
        if(state.removed.length) {
          $('protected-count').textContent=String(state.removed.length);
          const accepted=await new Promise(resolve=>{this.resolveProtected=resolve;$('protected-dialog').showModal();});
          this.resolveProtected=null;if(!accepted)return false;
        }
        content=this.surface.output(state.data,state.removed);
      } else content=this.surface.output();
      if(content===this.note.content&&$('edit-title').value===this.note.title){this.bodyDirty=false;return true;}
      this.status('Сохранение заметки…');
      const result=await this.send({id:this.note.object_id,expectedVersion:this.note.ver,title:$('edit-title').value,content,brief:htmlToText(content).slice(0,300)});
      this.lastSaved=result.note;this.saveSequence++;this.close();
      try {this.onSaved(result);} catch {this.status('Заметка сохранена, но не удалось обновить её отображение.',true);}
      return true;
    } catch(error){$('save-error').textContent=String(error);this.bodyDirty=true;this.status('Не удалось сохранить заметку. Изменения остаются в редакторе.',true);return false;}
    finally{this.saving=false;$('edit-title').disabled=false;$('editor-surface').inert=false;this.onBusy(false);this.update();}
  }
  resolveDialog(choice){$('unsaved-dialog').close();this.resolve?.(choice);}
  async leave(){
    if(this.dialogPromise)return this.dialogPromise;
    if(this.saving||this.opening||this.historyBusy||this.checking){this.status('Дождитесь завершения операции с редактором.',true);return false;}
    if(!this.active)return true;
    if(this.mode==='blocks') {
      this.checking=true;this.onBusy(true);this.update();
      try {this.bodyDirty=(await this.surface.content()).changed;}
      catch(error){$('save-error').textContent=String(error);this.bodyDirty=true;}
      finally{this.checking=false;this.onBusy(false);this.update();}
    }
    const finish=()=>{this.close();$('reader-document').hidden=false;return true;};
    if(!this.dirty())return finish();
    this.dialogPromise=(async()=>{
      const choice=await new Promise(resolve=>{this.resolve=resolve;$('unsaved-dialog').showModal();});
      if(choice==='stay')return false;
      if(choice==='save'){
        const saved=await this.save();
        if(saved&&this.active)return finish();
        return saved;
      }
      return finish();
    })();
    try{return await this.dialogPromise;}finally{this.dialogPromise=null;this.resolve=null;}
  }
  async switchMode(mode){
    if(!['blocks','classic'].includes(mode)||this.saving||this.opening||this.historyBusy||this.checking)return false;
    if(!this.active||mode===this.mode){this.preferredMode=mode;this.mode=mode;return true;}
    const note=this.note,sequence=this.saveSequence,previous=this.preferredMode;
    if(!await this.leave())return false;
    this.preferredMode=mode;await this.start(this.saveSequence>sequence?this.lastSaved:note,{focusBody:true});
    if(!this.active){this.preferredMode=previous;return false;}
    return true;
  }
}
