import { ImageSession } from './images.js';
import { normalizePastedHtml } from './paste-normalizer.js';
import { normalizeImportedText } from './editor-document.js';
import { bindExternalLinks, updateLink } from './links.js';
import { captureTextRegions, spellingRange } from './spelling-adapter.js';
import { focusContent } from './editor-focus.js';
import { ALIGNMENTS, normalizeColor, normalizeFontFamily, normalizeFontSize } from './editor-styles.js';
const $ = id => document.getElementById(id);
export class ClassicSurface {
  constructor(onChange,onSelection=()=>{},onOpenLink=()=>{},onLinkError=()=>{},onEditLink=()=>{}) { this.editLink=onEditLink;this.openExternal=onOpenLink;this.linkError=onLinkError;this.update = onChange; this.selectionChanged=onSelection; this.editor = null; }
  async init() {
    if (this.editor) return;
    if (!window.tinymce || !window.DOMPurify) throw Error('Не удалось загрузить редактор. Перезапустите приложение.');
    window.tinymce.addI18n('ru', { 'Undo':'Отменить','Redo':'Повторить','Bold':'Полужирный','Italic':'Курсив','Underline':'Подчёркнутый','Blocks':'Стиль','Paragraph':'Абзац','Headings':'Заголовки','Heading 1':'Заголовок 1','Heading 2':'Заголовок 2','Heading 3':'Заголовок 3','Bullet list':'Маркированный список','Numbered list':'Нумерованный список','Blockquote':'Цитата','Insert/edit link':'Вставить ссылку','Table':'Таблица','Insert table':'Вставить таблицу','Remove formatting':'Убрать форматирование','Source code':'HTML-код','Save':'Применить','Cancel':'Отмена','Ok':'ОК','Close':'Закрыть','URL':'Адрес','Text to display':'Текст ссылки','Title':'Заголовок','Open link in...':'Открыть ссылку','None':'Нет','New window':'Новое окно','Words':'Слов','Words: {0}':'Слов: {0}' });
    const editors = await window.tinymce.init({
      selector: '#edit-content', base_url: 'vendor/tinymce', suffix: '.min', license_key: 'gpl',
      language: 'ru',
      plugins: 'lists link table code', menubar: false, promotion: false, branding: false,
      toolbar: 'undo redo | blocks | bold italic underline | bullist numlist | blockquote noteLink table | removeformat code',
      toolbar_mode: 'sliding', resize: false, height: '100%',
      convert_urls: false, relative_urls: false, remove_script_host: false,
      paste_data_images: false, automatic_uploads: false,
      noneditable_class: 'mceNonEditable',
      content_security_policy: "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';",
      content_style: 'body{font:15px/1.7 Arial,sans-serif;color:#505a64;margin:20px} h1,h2,h3,h4{font-family:Arial,sans-serif;line-height:1.45;margin:1.4em 0 .6em;font-weight:650}h1{font-size:1.6em}h2{font-size:1.35em}h3{font-size:1.15em} a{color:#176b94;text-decoration:underline;overflow-wrap:anywhere} .note-image{display:inline-flex;flex-direction:column;max-width:100%;color:#637585}.note-image img{display:block;max-width:100%;height:auto}.note-image-status{padding:8px;border:1px solid #c8d5e2;font-size:12px}[data-note-image]{display:inline-block;position:relative;max-width:100%;vertical-align:middle}.note-image-size{position:absolute;left:4px;top:4px;width:30px;height:30px;padding:0;background:white;border:1px solid #c8d5e2;border-radius:3px;color:#176b94;font-size:20px;cursor:pointer}.note-image-remove{position:absolute;right:4px;top:4px;min-width:30px;min-height:30px;background:white;border:1px solid #c8d5e2;cursor:pointer;font-size:22px}.mceNonEditable{display:inline-block;padding:8px 12px;background:#edf3f8;border:1px solid #cfdae5;color:#7a8a99;border-radius:3px} table{border-collapse:collapse} td,th{border:1px solid #d7e1eb;padding:8px}',
      contextmenu: false,
      setup: editor => {
        editor.ui.registry.addButton('noteLink',{icon:'link',tooltip:'Ссылка',onAction:()=>this.editLink()});
        editor.on('input change Undo Redo', () => {this.images?.paint(editor.getBody());this.update();});
        editor.on('PreProcess',event=>{for(const element of event.node.querySelectorAll('[data-note-image]'))element.textContent='[Изображение]';});
        editor.on('PastePreProcess',event=>{
          if(this.pastePlain)return;
          try{
            const html=normalizePastedHtml(this.images?this.images.clipboardHtml(event.content):event.content,{baseFontSize:Number.parseFloat(editor.getWin().getComputedStyle(editor.getBody()).fontSize)});
            if(!html){event.preventDefault?.();event.content='';return;}
            event.content=this.clean(this.images?this.images.encode(html):html);
          }catch(error){event.preventDefault?.();event.content='';this.linkError(String(error),true);}
        });
        editor.on('NodeChange SelectionChange focus blur keyup mouseup',()=>this.selectionChanged?.());
        editor.addShortcut('meta+s', 'Сохранить заметку', () => this.save());
      },
    });
    this.editor = editors[0];
    this.editor.getBody().addEventListener('paste',event=>{
      if(!event.clipboardData||event.clipboardData.files.length)return;
      if(!this.pastePlain){
        const html=event.clipboardData.getData('text/html');if(!html)return;
        // Read the original clipboard before TinyMCE discards relative font sizes.
        event.preventDefault();event.stopImmediatePropagation();
        try{
          const normalized=normalizePastedHtml(this.images?this.images.clipboardHtml(html):html,{baseFontSize:Number.parseFloat(this.editor.getWin().getComputedStyle(this.editor.getBody()).fontSize)});
          if(!normalized)return;
          const content=this.clean(this.images?this.images.encode(normalized):normalized);
          const range=this.selectionRange(),node=range&&(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement);
          const media=node?.closest('[data-note-image],.mceNonEditable');
          if(media){range.setStartAfter(media);range.collapse(true);this.editor.selection.setRng(range);}
          this.editor.undoManager.add();this.editor.undoManager.transact(()=>this.editor.insertContent(content));this.images?.paint(this.editor.getBody());this.update();
        }catch(error){this.linkError(String(error),true);}
        return;
      }
      event.preventDefault();event.stopImmediatePropagation();
      const text=event.clipboardData.getData('text/plain');
      if(!text)return;
      const escaped=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r\n?/g,'\n').replace(/\n/g,'<br>');
      this.editor.undoManager.add();
      this.editor.undoManager.transact(()=>this.editor.insertContent(escaped));
      this.update();
    },true);
    this.editor.addShortcut('meta+k','Добавить или изменить ссылку',()=>this.editLink());
    this.unbindLinks=bindExternalLinks(this.editor.getBody(),this.openExternal,this.linkError);
  }
  clean(html) {
    return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style','form','input','button','textarea','iframe','object','embed'], ADD_ATTR: ['data-note-protected','data-note-image','contenteditable'] });
  }
  protectMedia(html) {
    const template = document.createElement('template'); template.innerHTML = normalizeImportedText(this.images ? this.images.encode(html) : html);
    this.media = new Map();
    for (const element of [...template.content.querySelectorAll('img,iframe,object,embed,audio,video')]) {
      if (!template.content.contains(element)) continue;
      const id = crypto.randomUUID(); this.media.set(id, element.outerHTML);
      const placeholder = document.createElement('span');
      placeholder.className = 'mceNonEditable'; placeholder.dataset.noteProtected = id;
      placeholder.textContent = element.tagName === 'IMG' ? '[Изображение сохранится]' : '[Вложение сохранится]';
      element.replaceWith(placeholder);
    }
    return this.clean(template.innerHTML);
  }
  output() {
    if (this.editor.getContent() === this.baseline) return this.note.content;
    const template = document.createElement('template'); template.innerHTML = this.clean(this.editor.getContent());
    for (const element of template.content.querySelectorAll('[data-note-protected]')) {
      const original = this.media.get(element.dataset.noteProtected);
      if (original) {
        const inert = document.createElement('template'); inert.innerHTML = original;
        element.replaceWith(inert.content);
      } else { element.removeAttribute('data-note-protected'); }
    }
    return this.images ? this.images.decode(template.innerHTML) : template.innerHTML;
  }
  async load(note) {
    await this.init(); this.note = note;
    this.images=new ImageSession(note,this.loadImage);this.images.background=true;
    this.images.onResize=(element,width,height)=>{
      if(!element.isConnected)return;
      this.editor.undoManager.add();this.editor.undoManager.transact(()=>{element.dataset.noteImage=this.images.resized(element.dataset.noteImage,width,height);element.replaceChildren();});
      this.images.paint(this.editor.getBody());this.update();
    };
    this.images.onRemove=element=>{this.editor.undoManager.transact(()=>element.remove());this.update();};
    this.editor.setContent(this.protectMedia(note.content));
    this.editor.undoManager.clear();this.editor.undoManager.add(); this.baseline = this.editor.getContent();
    this.images.paint(this.editor.getBody());
    this.unbindImages?.();this.unbindImages=this.images.bind(this.editor.getBody(),file=>this.insertImage(file),error=>this.linkError(String(error),true));
  }
  async insertImage(file){
    const editor=this.editor;let range=this.selectionRange();
    const token=await this.images.add(file);if(editor!==this.editor)return;
    editor.focus();
    if(!range||!editor.getBody().contains(range.startContainer)||!editor.getBody().contains(range.endContainer)){range=editor.getDoc().createRange();range.selectNodeContents(editor.getBody());range.collapse(false);}
    const node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const protectedElement=node.closest?.('[data-note-image],.mceNonEditable');
    if(protectedElement){range=editor.getDoc().createRange();range.setStartAfter(protectedElement);range.collapse(true);}
    editor.undoManager.add();
    editor.undoManager.transact(()=>{
      const template=editor.getDoc().createElement('template');template.innerHTML=token;
      const element=template.content.firstChild;range.deleteContents();range.insertNode(element);
      const spacer=editor.getDoc().createTextNode(' ');element.after(spacer);range.setStart(spacer,1);range.collapse(true);editor.selection.setRng(range);
    });
    this.images.paint(editor.getBody());this.update();
  }
  changed() { return this.editor.getContent() !== this.baseline; }
  spellingSnapshot(){
    const body=this.editor.getBody();
    // A single body region retains offsets across inline formatting and nested lists.
    return captureTextRegions([body]);
  }
  async replaceSpelling(snapshot,issue,replacement){
    const target=spellingRange(snapshot,issue);if(!target?.range)return false;
    this.editor.undoManager.transact(()=>{
      this.editor.selection.setRng(target.range);
      this.editor.insertContent(this.editor.dom.encode(replacement));
    });
    this.update();return true;
  }
  selectionRange(){return this.editor?.selection.getRng().cloneRange();}
  formatState(){
    const editor=this.editor,node=editor?.selection.getNode();
    const available=!!(editor&&node&&editor.getBody().contains(node)&&!node.closest?.('.mceNonEditable')&&(document.activeElement?.closest('#classic-surface,#editor-formatting')));
    const styles=available?editor.getWin().getComputedStyle(node):null;
    const alignment={start:'left',end:'right'}[styles?.textAlign] || styles?.textAlign;
    return {available,bold:available&&editor.formatter.match('bold'),italic:available&&editor.formatter.match('italic'),underline:available&&editor.formatter.match('underline'),strikeThrough:available&&editor.formatter.match('strikethrough'),alignment,color:normalizeColor(styles?.color),background:normalizeColor(styles?.backgroundColor),fontFamily:styles?.fontFamily,fontSize:styles?.fontSize};
  }
  format(command,value,range=this.selectionRange()){
    const commands={bold:'Bold',italic:'Italic',underline:'Underline',strikeThrough:'Strikethrough',removeFormat:'RemoveFormat',createLink:'mceInsertLink',unlink:'Unlink',foreColor:'ForeColor',hiliteColor:'HiliteColor'};
    if(!commands[command]||!range||!this.editor.getBody().contains(range.startContainer)||!this.editor.getBody().contains(range.endContainer))return false;
    this.editor.focus();this.editor.selection.setRng(range);
    if(['foreColor','hiliteColor'].includes(command)&&!normalizeColor(value))return false;
    this.editor.undoManager.transact(()=>this.editor.execCommand(commands[command],false,command==='createLink'?{href:value}:['foreColor','hiliteColor'].includes(command)?normalizeColor(value):undefined));
    this.update();return true;
  }
  async setLink(href,text,range,existing){
    if(!range||!this.editor.getBody().contains(range.startContainer)||!this.editor.getBody().contains(range.endContainer)||existing&&!this.editor.getBody().contains(existing))return false;
    this.editor.focus();let changed=false;
    this.editor.undoManager.transact(()=>{changed=updateLink(range,href,text,existing);});
    if(changed)this.update();return changed;
  }
  async typography(property,value,range=this.selectionRange()){
    const clean=property==='font-family'?normalizeFontFamily(value):property==='font-size'?normalizeFontSize(value):'';
    if(!clean||!range||range.collapsed||!this.editor.getBody().contains(range.startContainer)||!this.editor.getBody().contains(range.endContainer))return false;
    this.editor.focus();this.editor.selection.setRng(range);
    this.editor.undoManager.transact(()=>this.editor.execCommand(property==='font-family'?'FontName':'FontSize',false,clean));
    this.update();return true;
  }
  align(alignment){if(!ALIGNMENTS.includes(alignment)||!this.formatState().available)return false;this.editor.execCommand({left:'JustifyLeft',center:'JustifyCenter',right:'JustifyRight',justify:'JustifyFull'}[alignment]);this.update();return true;}
  focus(anchor) { this.editor.focus(); focusContent(this.editor.getBody(),anchor); }
  undo() { this.editor.undoManager.undo(); this.update(); }
  redo() { this.editor.undoManager.redo(); this.update(); }
  destroy() { this.unbindImages?.();this.unbindLinks?.();this.editor?.remove(); this.editor=null; this.media?.clear(); }
}
