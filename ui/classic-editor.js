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
      content_style: 'body{font:15px/1.7 Arial,sans-serif;color:#505a64;margin:20px} a{color:#176b94;text-decoration:underline;overflow-wrap:anywhere} .mceNonEditable{display:inline-block;padding:8px 12px;background:#edf3f8;border:1px solid #cfdae5;color:#7a8a99;border-radius:3px} table{border-collapse:collapse} td,th{border:1px solid #d7e1eb;padding:8px}',
      contextmenu: false,
      setup: editor => {
        editor.ui.registry.addButton('noteLink',{icon:'link',tooltip:'Ссылка',onAction:()=>this.editLink()});
        editor.on('input change Undo Redo', () => this.update());
        editor.on('NodeChange SelectionChange focus blur keyup mouseup',()=>this.selectionChanged?.());
        editor.addShortcut('meta+s', 'Сохранить заметку', () => this.save());
      },
    });
    this.editor = editors[0];
    this.editor.getBody().addEventListener('paste',event=>{
      if(!this.pastePlain||!event.clipboardData)return;
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
    return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style','form','input','button','textarea','iframe','object','embed'], ADD_ATTR: ['data-note-protected'] });
  }
  protectMedia(html) {
    const template = document.createElement('template'); template.innerHTML = html;
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
    return template.innerHTML;
  }
  async load(note) {
    await this.init(); this.note = note;
    this.editor.setContent(this.protectMedia(note.content));
    this.editor.undoManager.clear(); this.baseline = this.editor.getContent();
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
  destroy() { this.unbindLinks?.();this.editor?.remove(); this.editor=null; this.media?.clear(); }
}
