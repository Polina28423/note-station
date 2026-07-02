import { htmlToText } from './content.js';
const $ = id => document.getElementById(id);
export class NoteEditor {
  constructor({ save, onSaved, status, onBusy }) {
    Object.assign(this, { send: save, onSaved, status, onBusy });
    this.active = false; this.saving = false; this.note = null; this.editor = null; this.dialogPromise = null;
    $('edit-title').addEventListener('input', () => this.update());
    $('save-note').addEventListener('click', () => this.save());
    $('cancel-edit').addEventListener('click', () => this.leave());
    $('keep-editing').addEventListener('click', () => this.resolveDialog('stay'));
    $('discard-edit').addEventListener('click', () => this.resolveDialog('discard'));
    $('save-and-continue').addEventListener('click', () => this.resolveDialog('save'));
    $('unsaved-dialog').addEventListener('cancel', event => { event.preventDefault(); this.resolveDialog('stay'); });
    window.addEventListener('beforeunload', event => { if (this.dirty() || this.saving) { event.preventDefault(); event.returnValue = ''; } });
    window.addEventListener('keydown', event => {
      if (this.active && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); this.save(); }
    });
  }
  async init() {
    if (this.editor) return;
    if (!window.tinymce || !window.DOMPurify) throw Error('Не удалось загрузить редактор. Перезапустите приложение.');
    window.tinymce.addI18n('ru', { 'Undo':'Отменить','Redo':'Повторить','Bold':'Полужирный','Italic':'Курсив','Underline':'Подчёркнутый','Blocks':'Стиль','Paragraph':'Абзац','Headings':'Заголовки','Heading 1':'Заголовок 1','Heading 2':'Заголовок 2','Heading 3':'Заголовок 3','Bullet list':'Маркированный список','Numbered list':'Нумерованный список','Blockquote':'Цитата','Insert/edit link':'Вставить ссылку','Table':'Таблица','Insert table':'Вставить таблицу','Remove formatting':'Убрать форматирование','Source code':'HTML-код','Save':'Применить','Cancel':'Отмена','Ok':'ОК','Close':'Закрыть','URL':'Адрес','Text to display':'Текст ссылки','Title':'Заголовок','Open link in...':'Открыть ссылку','None':'Нет','New window':'Новое окно','Words':'Слов','Words: {0}':'Слов: {0}' });
    const editors = await window.tinymce.init({
      selector: '#edit-content', base_url: 'vendor/tinymce', suffix: '.min', license_key: 'gpl',
      language: 'ru',
      plugins: 'lists link table code', menubar: false, promotion: false, branding: false,
      toolbar: 'undo redo | blocks | bold italic underline | bullist numlist | blockquote link table | removeformat code',
      toolbar_mode: 'sliding', resize: false, height: '100%',
      convert_urls: false, relative_urls: false, remove_script_host: false,
      paste_data_images: false, automatic_uploads: false,
      noneditable_class: 'mceNonEditable',
      content_security_policy: "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';",
      content_style: 'body{font:15px/1.7 Arial,sans-serif;color:#505a64;margin:20px} .mceNonEditable{display:inline-block;padding:8px 12px;background:#edf3f8;border:1px solid #cfdae5;color:#7a8a99;border-radius:3px} table{border-collapse:collapse} td,th{border:1px solid #d7e1eb;padding:8px}',
      setup: editor => {
        editor.on('input change Undo Redo', () => this.update());
        editor.addShortcut('meta+s', 'Сохранить заметку', () => this.save());
      },
    });
    this.editor = editors[0];
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
  async start(note) {
    if (this.active || this.saving || this.opening) return;
    if (note.encrypted || note.ver == null) { this.status('Эту заметку пока нельзя редактировать: нет доступного текста или версии.', true); return; }
    this.opening = true; this.onBusy(true);
    try {
      $('reader-empty').hidden = true; $('reader-document').hidden = true; $('note-editor').hidden = false;
      await this.init();
      this.note = note;
      $('edit-title').value = note.title;
      this.editor.setContent(this.protectMedia(note.content));
      this.editor.undoManager.clear(); this.baseline = this.editor.getContent();
      this.active = true; $('edit-note').disabled = true; $('save-error').textContent = '';
      for (const id of ['font-smaller','font-larger','copy-note']) $(id).disabled = true;
      this.update(); $('edit-title').focus();
    } catch(error) { $('note-editor').hidden = true; $('reader-document').hidden = false; this.status(String(error), true); }
    finally { this.opening = false; this.onBusy(false); }
  }
  dirty() { return !!(this.active && this.editor && ($('edit-title').value !== this.note.title || this.editor.getContent() !== this.baseline)); }
  update() {
    const dirty = this.dirty();
    $('edit-state').textContent = this.saving ? 'Сохранение…' : dirty ? 'Есть несохранённые изменения' : 'Нет изменений';
    $('save-note').disabled = this.saving || !dirty;
    $('cancel-edit').disabled = this.saving;
  }
  close() {
    this.active = false; this.note = null; this.media?.clear();
    if (this.editor) { this.editor.setContent(''); this.editor.undoManager.clear(); }
    $('edit-title').value = ''; $('save-error').textContent = '';
    $('note-editor').hidden = true;
    for (const id of ['font-smaller','font-larger','copy-note']) $(id).disabled = false;
  }
  async save() {
    if (!this.active || this.saving) return false;
    if (!this.dirty()) return true;
    if (!$('edit-title').value.trim()) { $('save-error').textContent = 'Введите заголовок заметки.'; $('edit-title').focus(); return false; }
    this.saving = true; this.onBusy(true); this.status('Сохранение заметки…'); $('edit-title').disabled = true;
    this.editor.mode.set('readonly'); this.update(); $('save-error').textContent = '';
    try {
      const content = this.output();
      const result = await this.send({ id: this.note.object_id, expectedVersion: this.note.ver,
        title: $('edit-title').value, content, brief: htmlToText(content).slice(0, 300) });
      this.close(); this.onSaved(result);
      return true;
    } catch(error) { $('save-error').textContent = String(error); this.status('Не удалось сохранить заметку. Изменения остаются в редакторе.', true); return false; }
    finally { this.saving = false; $('edit-title').disabled = false; this.editor.mode.set('design'); this.onBusy(false); this.update(); }
  }
  resolveDialog(choice) { $('unsaved-dialog').close(); this.resolve?.(choice); }
  async leave() {
    if (this.saving || this.opening) { this.status('Дождитесь завершения операции с редактором.', true); return false; }
    if (!this.active) return true;
    if (!this.dirty()) { this.close(); $('reader-document').hidden = false; $('edit-note').disabled = false; return true; }
    if (this.dialogPromise) return this.dialogPromise;
    this.dialogPromise = (async () => {
      const choice = await new Promise(resolve => { this.resolve = resolve; $('unsaved-dialog').showModal(); });
      if (choice === 'stay') return false;
      if (choice === 'save') return this.save();
      this.close(); $('reader-document').hidden = false; $('edit-note').disabled = false; return true;
    })();
    try { return await this.dialogPromise; } finally { this.dialogPromise = null; this.resolve = null; }
  }
}
