import { captureTextRegions, spellingRange } from './spelling-adapter.js';
import { EditorDocument, documentSignature } from './editor-document.js';
import { safeNoteFragment } from './content.js';
import { focusContent, editableTarget } from './editor-focus.js';
import { ALIGNMENTS, normalizeColor } from './editor-styles.js';

const INLINE_RULES={b:true,strong:true,i:true,em:true,u:true,s:true,strike:true,del:true,a:{href:true,title:true},br:true,code:true,mark:{style:true},span:{style:true},font:{color:true}};
const $=id=>document.getElementById(id);
export class BlockSurface {
  constructor(onChange) {this.notify=onChange;this.ready=false;this.history=[];this.historyIndex=-1;this.queue=Promise.resolve();}
  async load(note) {
    const lib=window.NoteStationBlocks;
    if(!lib)throw Error('Не удалось загрузить Editor.js.');
    this.document=new EditorDocument(note.content);
    this.alignments=new Map();
    const surface=this;
    class AlignmentTune {
      static get isTune(){return true;}
      constructor({data,block}){this.block=block;this.alignment=ALIGNMENTS.includes(data?.alignment)?data.alignment:'left';surface.alignments.set(block.id,this);}
      wrap(content){this.wrapper=document.createElement('div');this.wrapper.className='note-alignment';this.wrapper.style.textAlign=this.alignment;this.wrapper.append(content);return this.wrapper;}
      save(){return {alignment:this.alignment};}
      set(alignment){this.alignment=alignment;this.wrapper.style.textAlign=alignment;this.block.dispatchChange();surface.notify();surface.scheduleHistory();}
      render(){return ALIGNMENTS.map((alignment,index)=>({label:['По левому краю','По центру','По правому краю','По ширине'][index],isActive:this.alignment===alignment,onActivate:()=>this.set(alignment)}));}
    }
    class Preserved {
      static get isReadOnlySupported(){return true;}
      static get sanitize(){return {key:false};}
      constructor({data}){this.data={key:data.key};}
      render(){
        const box=document.createElement('section');box.className='preserved-fragment';box.contentEditable='false';
        const label=document.createElement('strong');label.textContent='Сохранённый фрагмент';box.append(label);
        const raw=surface.document.fragments.get(this.data.key);
        if(raw===undefined)throw Error('Неизвестный защищённый фрагмент.');
        const preview=document.createElement('div');preview.className='preserved-preview';preview.append(safeNoteFragment(raw.slice(0,100000)));
        if(!preview.textContent.trim())preview.textContent=/\bimg\b/i.test(raw)?'Изображение':'Вложение или особое оформление';
        const hint=document.createElement('small');hint.textContent='Исходное содержимое сохранится. Для изменения используйте классический редактор.';
        box.append(preview,hint);return box;
      }
      save(){return {...this.data};}
      validate(data){return typeof data.key==='string';}
    }
    class Paragraph extends lib.Paragraph {static get sanitize(){return {text:INLINE_RULES};}}
    class Header extends lib.Header {static get sanitize(){return {text:INLINE_RULES,level:false};}}
    class Quote extends lib.Quote {static get sanitize(){return {text:INLINE_RULES,caption:INLINE_RULES,alignment:false};}renderSettings(){return [];}}
    function inlineFormat(command,label,tag,rules) {
      return class {
        static get isInline(){return true;}
        static get title(){return label;}
        static get sanitize(){return rules;}
        constructor({api}){this.api=api;}
        render(){this.button=document.createElement('button');this.button.type='button';this.button.className=this.api.styles.inlineToolButton;const text=document.createElement(tag);text.textContent=tag==='u'?'U':'S';this.button.append(text);return this.button;}
        surround(){document.execCommand(command);}
        checkState(){const active=document.queryCommandState(command);this.button?.classList.toggle(this.api.styles.inlineToolButtonActive,active);return active;}
      };
    }
    class ColorSanitizer {
      static get isInline(){return true;}
      static get title(){return 'Цвет текста';}
      static get sanitize(){return {span:{style:true},font:{color:true},mark:{style:true}};}
      constructor({api}){this.api=api;}
      render(){const button=document.createElement('button');button.type='button';button.className=this.api.styles.inlineToolButton;button.textContent='A';return button;}
      surround(){document.getElementById('format-text-color').click();}
      checkState(){return false;}
    }
    const holder=$('block-content');holder.replaceChildren();
    this.onLink=event=>{if(event.target.closest('a'))event.preventDefault();};
    holder.addEventListener('click',this.onLink,true);
    this.onPaste=event=>{
      if(!this.ready)return;
      const html=event.clipboardData?.getData('text/html');
      if(!html)return;
      try {
        if(html.length>2*1024*1024)throw Error('Слишком большой вставляемый HTML.');
        const cleaned=window.DOMPurify.sanitize(html,{USE_PROFILES:{html:true},FORBID_TAGS:['script','style','iframe','object','embed','form'],FORBID_ATTR:['srcdoc']});
        const incoming=new EditorDocument(cleaned);
        if(!incoming.fragments.size&&!incoming.blocks.some(block=>block.tunes))return; // Native paste handles ordinary inline text.
        event.preventDefault();event.stopImmediatePropagation();
        this.pasteQueue=(this.pasteQueue || Promise.resolve()).then(()=>this.pasteDocument(incoming)).catch(error=>this.notify(error));
      } catch(error){event.preventDefault();event.stopImmediatePropagation();this.notify(error);}
    };
    holder.addEventListener('paste',this.onPaste,true);
    this.editor=new lib.EditorJS({
      holder, data:{blocks:this.document.blocks}, minHeight:180, autofocus:false,
      logLevel:'ERROR',inlineToolbar:['bold','italic','underline','strike','link','inlineCode','marker','textColor'],
      tools:{
        alignment:AlignmentTune,
        paragraph:{class:Paragraph,config:{preserveBlank:true},tunes:['alignment']},
        header:{class:Header,config:{levels:[1,2,3,4,5,6],defaultLevel:2},tunes:['alignment']},
        list:{class:lib.List,inlineToolbar:true,tunes:['alignment'],config:{defaultStyle:'unordered',maxLevel:12,counterTypes:['numeric','lower-alpha','upper-alpha','lower-roman','upper-roman']}},
        table:{class:lib.Table,inlineToolbar:true,tunes:['alignment'],config:{rows:2,cols:2}},
        quote:{class:Quote,inlineToolbar:true,tunes:['alignment']},code:lib.Code,delimiter:lib.Delimiter,
        marker:lib.Marker,inlineCode:lib.InlineCode,
        textColor:ColorSanitizer,
        underline:inlineFormat('underline','Подчёркнутый','u',{u:true}),strike:inlineFormat('strikeThrough','Зачёркнутый','s',{s:true,strike:true,del:true}),
        preserved:{class:Preserved,toolbox:false,inlineToolbar:false}
      },
      i18n:{messages:{
        ui:{blockTunes:{toggler:{'Click to tune':'Настройки блока','or drag to move':'или перетащите'}},inlineToolbar:{converter:{'Convert to':'Преобразовать'}},toolbar:{toolbox:{Add:'Добавить блок'}},popover:{Filter:'Найти блок','Nothing found':'Ничего не найдено','Convert to':'Преобразовать'}},
        toolNames:{Text:'Текст',Heading:'Заголовок',List:'Список','Ordered List':'Нумерованный список','Unordered List':'Маркированный список',Checklist:'Чеклист',Table:'Таблица',Quote:'Цитата',Code:'Код',Delimiter:'Разделитель',Marker:'Выделение','Inline Code':'Код в строке',Bold:'Полужирный',Italic:'Курсив',Link:'Ссылка'},
        blockTunes:{delete:{Delete:'Удалить'},moveUp:{'Move up':'Выше'},moveDown:{'Move down':'Ниже'}},
        tools:{link:{'Add a link':'Введите ссылку'},header:{'Heading 1':'Заголовок 1','Heading 2':'Заголовок 2','Heading 3':'Заголовок 3','Heading 4':'Заголовок 4','Heading 5':'Заголовок 5','Heading 6':'Заголовок 6'},quote:{'Enter a quote':'Текст цитаты','Enter a caption':'Автор'},table:{'Add row above':'Строка выше','Add row below':'Строка ниже','Delete row':'Удалить строку','Add column to left':'Столбец слева','Add column to right':'Столбец справа','Delete column':'Удалить столбец','With headings':'С заголовками','Without headings':'Без заголовков'},list:{'Ordered':'Нумерованный','Unordered':'Маркированный','Checklist':'Чеклист','Start with':'Начать с','Counter type':'Нумерация'}}
      }},
      onChange:()=>{if(this.ready){this.notify();this.scheduleHistory();}}
    });
    await this.editor.isReady;
    const snapshot=await this.snapshot();this.document.bindBaseline(snapshot.blocks);
    this.baseline=documentSignature(snapshot.blocks);this.history=[snapshot];this.historySizes=new WeakMap([[snapshot,JSON.stringify(snapshot).length*2]]);this.historyBytes=this.historySizes.get(snapshot);this.historyIndex=0;this.ready=true;
  }
  async snapshot() {
    const result=await this.editor.save();
    const live=Array.from({length:this.editor.blocks.getBlocksCount()},(_,i)=>this.editor.blocks.getBlockByIndex(i).id);
    if(result.blocks.length!==live.length||result.blocks.some((b,i)=>b.id!==live[i]))throw Error('Один из блоков не удалось сохранить. Заполните пустой блок или удалите его явно.');
    // Prevent silent invalid/unknown-data loss during the save pipeline.
    this.document.missingProtected(result.blocks);
    return result;
  }
  scheduleHistory() {
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.capture().catch(error=>this.notify(error));},350);
  }
  capture() {
    const editor=this.editor;
    this.queue=this.queue.catch(()=>{}).then(async()=>{
      if(!this.ready||this.editor!==editor)return;
      const data=await this.snapshot();
      if(!this.ready||this.editor!==editor)return;
      if(documentSignature(data.blocks)!==documentSignature(this.history[this.historyIndex].blocks)) {
        this.history.splice(this.historyIndex+1);this.historyBytes=this.history.reduce((size,item)=>size+this.historySizes.get(item),0);
        this.history.push(data);const size=JSON.stringify(data).length*2;this.historySizes.set(data,size);this.historyBytes+=size;
        while(this.history.length>1&&(this.history.length>60||this.historyBytes>20*1024*1024))this.historyBytes-=this.historySizes.get(this.history.shift());
        this.historyIndex=this.history.length-1;
      }
      this.notify(null,documentSignature(data.blocks)!==this.baseline);
    });
    return this.queue;
  }
  async travel(delta) {
    await this.capture();
    const next=this.historyIndex+delta;
    if(next<0||next>=this.history.length)return;
    this.ready=false;clearTimeout(this.timer);
    try {await this.editor.blocks.render(this.history[next]);this.historyIndex=next;}
    finally {this.ready=true;}
    this.notify(null,documentSignature(this.history[next].blocks)!==this.baseline);
  }
  undo(){return this.travel(-1);}
  redo(){return this.travel(1);}
  async content() {
    await this.pasteQueue;
    await this.queue.catch(()=>{});
    const data=await this.snapshot();
    return {data,removed:this.document.missingProtected(data.blocks),changed:documentSignature(data.blocks)!==this.baseline};
  }
  output(data,removed){return this.document.serialize(data.blocks,removed);}
  spellingSnapshot(){
    const elements=[...$('block-content').querySelectorAll('[contenteditable="true"],textarea')]
      .filter(element=>!element.closest('.preserved-fragment,.ce-code,pre,code') && !element.parentElement.closest('[contenteditable="true"]'));
    return captureTextRegions(elements);
  }
  async replaceSpelling(snapshot,issue,replacement){
    const target=spellingRange(snapshot,issue);if(!target)return false;
    await this.capture();
    if(!spellingRange(snapshot,issue))return false;
    const element=target.region.element,doc=element.ownerDocument;
    element.focus({preventScroll:true});
    let changed;
    if(target.range){const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(target.range);changed=doc.execCommand('insertText',false,replacement);}
    else {element.setSelectionRange(target.start,target.end);element.setRangeText(replacement,target.start,target.end,'end');element.dispatchEvent(new Event('input',{bubbles:true}));changed=true;}
    if(changed){this.notify();await this.capture();}
    return !!changed;
  }
  selectionRange(){
    const selection=document.getSelection();if(!selection?.rangeCount)return null;
    const range=selection.getRangeAt(0);return this.validRange(range)?range.cloneRange():null;
  }
  validRange(range){
    const root=$('block-content');
    const editable=node=>(node.nodeType===1?node:node.parentElement)?.closest('[contenteditable="true"]');
    return range&&root.contains(range.startContainer)&&root.contains(range.endContainer)&&editable(range.startContainer)&&editable(range.startContainer)===editable(range.endContainer);
  }
  formatState(){
    const range=this.selectionRange();
    const focus=document.activeElement;
    const rangeNode=range&&(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement);
    const matchingEditable=rangeNode?.closest('[contenteditable="true"]')===focus?.closest('[contenteditable="true"]');
    const toolbarFocus=focus?.closest('#editor-formatting,.ce-inline-toolbar')&&!['INPUT','TEXTAREA'].includes(focus.tagName);
    const available=!!(this.ready&&range&&(toolbarFocus||($('block-content').contains(focus)&&matchingEditable&&!['INPUT','TEXTAREA'].includes(focus.tagName))));
    const block=rangeNode?this.editor.blocks.getBlockByElement(rangeNode):null;
    return {available,bold:available&&document.queryCommandState('bold'),italic:available&&document.queryCommandState('italic'),underline:available&&document.queryCommandState('underline'),strikeThrough:available&&document.queryCommandState('strikeThrough'),alignment:available&&this.alignments.get(block?.id)?.alignment,color:available&&normalizeColor(document.queryCommandValue('foreColor')),background:available&&normalizeColor(document.queryCommandValue('hiliteColor'))};
  }
  format(command,value,range=this.selectionRange()){
    if(!['bold','italic','underline','strikeThrough','removeFormat','createLink','unlink','foreColor','hiliteColor'].includes(command)||!this.validRange(range))return false;
    const node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const editable=node.closest('[contenteditable="true"]');editable.focus({preventScroll:true});
    const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);
    const color=['foreColor','hiliteColor'].includes(command);
    if(color&&!normalizeColor(value))return false;
    const css=document.queryCommandState('styleWithCSS');let changed;
    try{if(color)document.execCommand('styleWithCSS',false,true);changed=document.execCommand(command,false,color?normalizeColor(value):value);}
    finally{if(color)document.execCommand('styleWithCSS',false,css);}
    if(!changed)return false;
    this.notify();this.scheduleHistory();return true;
  }
  align(alignment){
    const range=this.selectionRange();if(!this.validRange(range)||!ALIGNMENTS.includes(alignment))return false;
    const element=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const block=this.editor.blocks.getBlockByElement(element),tune=this.alignments.get(block?.id);if(!tune)return false;
    tune.set(alignment);return true;
  }
  focus(anchor){
    const root=$('block-content'),target=editableTarget(root,anchor);
    const block=target?this.editor.blocks.getBlockByElement(target):null;
    if(block)this.editor.caret.setToBlock(block.id,'start');
    focusContent(root,anchor);
  }
  async pasteDocument(incoming) {
    if(!this.ready)return;
    if(incoming.blocks.length>1000)throw Error('Слишком большой вставляемый фрагмент.');
    this.notify();
    for(const [key,value] of incoming.fragments)this.document.fragments.set(key,value);
    for(const [key,value] of incoming.records)this.document.records.set(key,value);
    let index=this.editor.blocks.getCurrentBlockIndex()+1;
    for(const block of incoming.blocks){
      this.editor.blocks.insert(block.type,block.data,{},index++,false,false,block.id);
      if(block.tunes)await this.editor.blocks.update(block.id,undefined,block.tunes);
    }
    await this.capture();
  }
  destroy(){this.ready=false;clearTimeout(this.timer);const holder=$('block-content');holder.removeEventListener('click',this.onLink,true);holder.removeEventListener('paste',this.onPaste,true);this.editor?.destroy?.();this.editor=null;this.history=[];this.document=null;}
}
