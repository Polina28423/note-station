import { NoteEditor } from './editor.js';
import { restoreAtStartup } from './startup.js';
import { bindPanelResizing } from './panels.js';
import { notebookCounts, visibleNotebooks, visibleNotes, noteCountLabel, notebookCountLabel, groupNotebooks, notesInShelf } from './library.js';
import { htmlToText, safeNoteFragment } from './content.js';
import { loadConnection, saveConnection, loadEditorMode, saveEditorMode } from './preferences.js';

const $ = id => document.getElementById(id);
const invoke = (command, args) => {
  if (!window.__TAURI__?.core?.invoke) throw new Error('Откройте приложение через start.ps1. В браузере доступен только макет интерфейса.');
  return window.__TAURI__.core.invoke(command, args);
};
let notebooks = [], notes = [], notebookId = '', selectedId = '', noteRequest = 0, selectedShelf = '';
const collapsedShelves = new Set();
let busy = false, view = 'notes', pinned = new Set(), pinKey = '', fontSize = 16, copyText = '';
let preferredEditor='blocks';
try { preferredEditor=loadEditorMode(localStorage); } catch {}
const noteEditor = new NoteEditor({
  mode: preferredEditor,
  save: args => invoke('save_note', args), status, onBusy: setBusy,
  onSaved: result => {
    currentNote = result.note;
    displayNote(result.note);
    const summary = notes.find(n => n.object_id === result.note.object_id);
    if (summary) { summary.title = result.note.title; summary.brief = htmlToText(result.note.content).slice(0, 300); summary.mtime = Math.floor(Date.now()/1000); }
    renderNotes(); status(result.notice || 'Заметка сохранена на NAS.', !!result.notice);
  },
});
let currentNote = null;
const noteBody=$('note-content');
let bodyPointer=false;
function editableNote(){return currentNote&&!currentNote.encrypted&&currentNote.ver!=null&&!busy&&!noteEditor.active&&!noteEditor.opening;}
function bodyAnchor(event) {
  const block=event.target.closest?.('p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,pre') || noteBody;
  let offset=0;
  const caret=document.caretRangeFromPoint?.(event.clientX,event.clientY);
  if(caret&&block.contains(caret.startContainer)) {
    const before=document.createRange();before.selectNodeContents(block);before.setEnd(caret.startContainer,caret.startOffset);offset=before.toString().length;
  }
  return {text:block.textContent,offset};
}
noteBody.addEventListener('pointerdown',()=>{bodyPointer=true;});
document.addEventListener('pointerup',()=>{setTimeout(()=>{bodyPointer=false;},0);},true);
noteBody.addEventListener('pointercancel',()=>{bodyPointer=false;});
noteBody.addEventListener('click',event=>{
  bodyPointer=false;
  if(!editableNote()||window.getSelection()?.toString())return;
  noteEditor.start(currentNote,{focusBody:true,anchor:bodyAnchor(event)});
});
noteBody.addEventListener('focus',()=>{if(!bodyPointer&&editableNote())noteEditor.start(currentNote,{focusBody:true});});
noteBody.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key==='F2')&&editableNote()){event.preventDefault();noteEditor.start(currentNote,{focusBody:true});}});
$('open-settings').addEventListener('click',()=>{
  if(busy)return;$('editor-mode').value=preferredEditor;$('app-settings').showModal();
});
$('cancel-settings').addEventListener('click',()=>$('app-settings').close());
$('apply-settings').addEventListener('click',async()=>{
  const mode=$('editor-mode').value;$('app-settings').close();
  if(busy||!await noteEditor.switchMode(mode))return;
  preferredEditor=mode;
  let persisted=false;try {persisted=saveEditorMode(localStorage,mode);}catch {}
  status(persisted?'Настройки сохранены.':'Редактор выбран до закрытия приложения: настройки не удалось сохранить.',!persisted);
});
function displayNote(note) {
  $('reader-document').hidden = false; $('reader-empty').hidden = true;
  $('note-title').textContent = note.title || 'Без названия';
  $('note-meta').textContent = note.encrypted ? 'Зашифрованная заметка' : 'Заметка на NAS';
  const editable=!note.encrypted&&note.ver!=null;
  noteBody.classList.toggle('click-to-edit',editable);
  if(editable){noteBody.tabIndex=0;noteBody.title='Нажмите на текст, чтобы редактировать';noteBody.setAttribute('aria-label','Текст заметки. Перейдите сюда для редактирования.');}
  else {noteBody.removeAttribute('tabindex');noteBody.removeAttribute('title');noteBody.removeAttribute('aria-label');}
  if (note.encrypted) { $('note-content').textContent = 'Расшифровка пока не поддерживается. Откройте заметку в официальном клиенте.'; copyText = ''; }
  else { $('note-content').replaceChildren(safeNoteFragment(note.content)); copyText = htmlToText(note.content); }
  $('copy-note').disabled = note.encrypted;
}
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function setView(next) {
  view = next;
  $('workspace').classList.toggle('overview-mode', view === 'notebooks');
  $('notebook-overview').hidden = view !== 'notebooks';
  $('note-list-panel').hidden = view === 'notebooks';
  $('reader').hidden = view === 'notebooks';
  if (view === 'notebooks') setFocusMode(false);
  $('show-notebooks').classList.toggle('selected', view === 'notebooks');
  $('show-all-notes').classList.toggle('selected', view === 'notes' && !notebookId && !selectedShelf);
}
function setFocusMode(enabled) {
  $('workspace').classList.toggle('focus-mode', enabled);
  $('focus-mode').setAttribute('aria-pressed', String(enabled));
  $('focus-mode').title = enabled ? 'Вернуться к списку · Esc' : 'Режим чтения';
  $('focus-mode').textContent = enabled ? '↙' : '⛶';
}
function loadPins(server, account) {
  pinKey = 'note-station.pins.v1:' + JSON.stringify([server, account]);
  pinned = new Set();
  try {
    const values = JSON.parse(localStorage.getItem(pinKey));
    if (Array.isArray(values)) pinned = new Set(values.filter(v => typeof v === 'string').slice(0, 500));
  } catch { /* Pins are optional. */ }
}
function togglePin(id) {
  if (pinned.has(id)) pinned.delete(id); else pinned.add(id);
  try { localStorage.setItem(pinKey, JSON.stringify([...pinned])); } catch { status('Закрепление доступно до закрытия приложения: настройки не удалось сохранить.', true); }
  renderNotebooks();
}
async function chooseNotebook(id) {
  if (busy || !await noteEditor.leave()) return;
  notebookId = id; selectedShelf = ''; $('search').value = ''; clearReader();
  setView('notes'); renderNotebooks(); renderNotes();
}
async function chooseShelf(key) {
  if (busy || !await noteEditor.leave()) return;
  selectedShelf = key; notebookId = ''; $('search').value = ''; clearReader();
  setView('notes'); renderNotebooks(); renderNotes();
}
function selectionTitle() {
  if (notebookId) return notebooks.find(n => n.object_id === notebookId)?.title || 'Без названия';
  if (selectedShelf) return groupNotebooks(notebooks).shelves.find(s => s.key === selectedShelf)?.label || 'Полка';
  return 'Все заметки';
}
function bookIcon(id) {
  let hash = 0;
  for (const letter of id) hash = (hash * 31 + letter.charCodeAt(0)) | 0;
  return make('span', 'book-icon color-' + Math.abs(hash % 5), '▤');
}

try {
  const saved = loadConnection(window.localStorage);
  if (saved) { $('server').value = saved.server; $('account').value = saved.account; }
} catch { /* Storage can be unavailable; login still works. */ }

function updateConnectionMode() {
  const mode = $('connection-mode').value;
  $('insecure-confirm').checked = false;
  $('insecure-confirm').required = mode !== 'strict';
  $('insecure-warning').hidden = mode === 'strict';
  $('certificate-settings').hidden = mode !== 'strict';
  $('insecure-description').textContent = mode === 'plain_http'
    ? 'HTTP передаёт пароль, сессию и заметки без шифрования. Их можно перехватить в сети.'
    : 'Соединение шифруется, но подлинность NAS не проверяется. Возможна подмена сервера и перехват пароля.';
  $('server').placeholder = mode === 'plain_http' ? 'http://nas.example:5000' : 'https://nas.example:5001';
}
$('connection-mode').addEventListener('change', updateConnectionMode);
updateConnectionMode();

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}
function setBusy(value) {
  busy = value;
  for (const id of ['connect', 'refresh', 'logout', 'session-state', 'certificate', 'clear-certificate', 'connection-mode', 'insecure-confirm', 'remember-session', 'restore-session', 'forget-session', 'startup-retry', 'startup-login', 'startup-logout', 'open-settings']) $(id).disabled = value;
}
function clearReader() {
  noteRequest++; selectedId = ''; copyText = ''; currentNote = null; noteEditor.close();
  $('reader-empty').hidden = false; $('reader-document').hidden = true;
  $('note-title').textContent = ''; $('note-meta').textContent = '';
  $('note-content').replaceChildren(); $('copy-note').disabled = true;
  $('reader-breadcrumb').textContent = 'Заметка';
}
function reset() {
  notebooks = []; notes = []; notebookId = ''; selectedShelf = ''; collapsedShelves.clear(); pinned.clear(); clearReader();
  document.body.classList.remove('connected'); setFocusMode(false);
  $('notes').replaceChildren(); $('notebooks').replaceChildren(); $('pinned-notebooks').replaceChildren(); $('notebook-grid').replaceChildren(); $('search').value = '';
  $('notebook-search').value = '';
  $('workspace').hidden = true; $('login-panel').hidden = false;
  $('startup-panel').hidden = true;
  $('refresh').hidden = true; $('logout').hidden = true;
  $('connection').textContent = 'Не подключён'; $('session-state').hidden = true; $('session-state').textContent = '';
  $('certificate').value = ''; $('certificate-status').textContent = ''; $('clear-certificate').hidden = true;
  $('connection-mode').value = 'strict'; updateConnectionMode();
}
function renderNotebooks() {
  const counts = notebookCounts(notes);
  const visible = visibleNotebooks(notebooks, $('notebook-search').value, $('notebook-sort').value, counts);
  const groups = groupNotebooks(visible), allShelves = groupNotebooks(notebooks).shelves;
  // Labels stay stable when search hides another owner's equally named shelf.
  const labels = new Map(allShelves.map(s => [s.key, s.label]));
  $('library-count').textContent = notebooks.length;
  $('notebook-total').textContent = notebooks.length;
  $('note-total').textContent = notes.length;
  $('overview-summary').textContent = `${notebookCountLabel(notebooks.length)} · Полок: ${allShelves.length} · ${noteCountLabel(notes.length)}`;
  $('notebooks').replaceChildren(); $('pinned-notebooks').replaceChildren(); $('notebook-grid').replaceChildren();
  $('pinned-label').hidden = !visible.some(n => pinned.has(n.object_id));
  $('notebook-empty').hidden = visible.length > 0;
  function notebookRow(notebook, nested = false) {
    const id = notebook.object_id, title = notebook.title || 'Без названия';
    const row = make('button', 'notebook-row' + (nested ? ' shelf-notebook' : ''));
    row.title = title; row.classList.toggle('selected', view === 'notes' && notebookId === id);
    row.setAttribute('aria-pressed', String(view === 'notes' && notebookId === id));
    row.append(bookIcon(id), make('span', 'notebook-name', title), make('span', 'nav-count', counts.get(id) || 0));
    row.addEventListener('click', () => chooseNotebook(id));
    return row;
  }
  function notebookCard(notebook) {
    const id = notebook.object_id, title = notebook.title || 'Без названия';
    const card = make('div', 'notebook-card');
    const open = make('button', 'notebook-card-open');
    open.append(bookIcon(id), make('h2', '', title), make('span', 'muted', noteCountLabel(counts.get(id) || 0)));
    open.addEventListener('click', () => chooseNotebook(id));
    const pin = make('button', 'pin-button', pinned.has(id) ? '★' : '☆');
    pin.title = pinned.has(id) ? 'Открепить блокнот' : 'Закрепить блокнот';
    pin.setAttribute('aria-label', `${pin.title}: ${title}`);
    pin.setAttribute('aria-pressed', String(pinned.has(id)));
    pin.addEventListener('click', () => togglePin(id));
    card.append(open, pin); return card;
  }
  for (const notebook of visible) {
    if (pinned.has(notebook.object_id)) $('pinned-notebooks').append(notebookRow(notebook));
  }
  for (const [index, shelf] of groups.shelves.entries()) {
    const label = labels.get(shelf.key) || shelf.label;
    const group = make('div', 'shelf-group');
    const row = make('div', 'shelf-row');
    row.classList.toggle('selected', view === 'notes' && selectedShelf === shelf.key);
    const toggle = make('button', 'shelf-toggle');
    const children = make('div', 'shelf-children'); children.id = `shelf-children-${index}`;
    let expanded = !collapsedShelves.has(shelf.key) || !!$('notebook-search').value.trim();
    function setExpanded(value) {
      expanded = value; children.hidden = !expanded;
      toggle.textContent = expanded ? '▾' : '▸';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', `${expanded ? 'Свернуть' : 'Развернуть'} полку: ${label}`);
    }
    toggle.setAttribute('aria-controls', children.id);
    toggle.addEventListener('click', () => {
      if (expanded) collapsedShelves.add(shelf.key); else collapsedShelves.delete(shelf.key);
      setExpanded(!expanded);
    });
    setExpanded(expanded);
    const select = make('button', 'shelf-select');
    select.setAttribute('aria-label', `Полка: ${label}`);
    select.setAttribute('aria-pressed', String(view === 'notes' && selectedShelf === shelf.key));
    select.title = `${label} · ${notebookCountLabel(shelf.notebooks.length)}`;
    select.append(make('span', 'shelf-icon', '▥'), make('span', 'notebook-name', label), make('span', 'nav-count', shelf.notebooks.length));
    select.addEventListener('click', () => chooseShelf(shelf.key));
    for (const notebook of shelf.notebooks) children.append(notebookRow(notebook, true));
    row.append(toggle, select); group.append(row, children); $('notebooks').append(group);
    const section = make('section', 'shelf-overview-section');
    const heading = make('button', 'shelf-overview-heading');
    heading.append(make('span', 'shelf-icon', '▥'), make('span', '', label), make('span', 'muted', notebookCountLabel(shelf.notebooks.length)));
    heading.addEventListener('click', () => chooseShelf(shelf.key));
    const cards = make('div', 'shelf-card-grid');
    for (const notebook of shelf.notebooks) cards.append(notebookCard(notebook));
    section.append(heading, cards); $('notebook-grid').append(section);
  }
  if (groups.standalone.length) {
    for (const notebook of groups.standalone) $('notebooks').append(notebookRow(notebook));
    if (allShelves.length) {
      const section = make('section', 'shelf-overview-section');
      section.append(make('h2', 'shelf-overview-heading', 'Без полки'));
      const cards = make('div', 'shelf-card-grid');
      for (const notebook of groups.standalone) cards.append(notebookCard(notebook));
      section.append(cards); $('notebook-grid').append(section);
    } else {
      for (const notebook of groups.standalone) $('notebook-grid').append(notebookCard(notebook));
    }
  }
  $('pin-current').hidden = !notebookId;
  $('pin-current').textContent = pinned.has(notebookId) ? '★' : '☆';
  $('pin-current').setAttribute('aria-pressed', String(pinned.has(notebookId)));
  $('pin-current').title = pinned.has(notebookId) ? 'Открепить блокнот' : 'Закрепить блокнот';
  $('pin-current').setAttribute('aria-label', $('pin-current').title);
}
function renderNotes() {
  const filtered = visibleNotes(notesInShelf(notes, notebooks, selectedShelf), notebookId, $('search').value, $('note-sort').value);
  $('list-title').textContent = selectionTitle();
  $('list-title').title = $('list-title').textContent;
  $('count').textContent = noteCountLabel(filtered.length);
  $('notes').replaceChildren();
  if (!filtered.length) {
    const empty = make('div', 'empty-state list-empty');
    empty.append(make('span', 'empty-symbol', '⌕'), make('h2', '', $('search').value ? 'Ничего не найдено' : 'Здесь пока нет заметок'), make('p', '', $('search').value ? 'Попробуйте другой заголовок.' : 'Выберите другой блокнот.'));
    $('notes').append(empty);
  }
  for (const note of filtered) {
    const button = make('button', 'note-row');
    button.classList.toggle('selected', selectedId === note.object_id);
    button.setAttribute('aria-pressed', String(selectedId === note.object_id));
    button.append(make('span', 'note-row-title', note.title || 'Без названия'));
    if (note.brief) button.append(make('span', 'note-row-brief', htmlToText(note.brief)));
    const meta = make('small', 'note-row-meta');
    meta.append(make('span', '', notebooks.find(n => n.object_id === note.parent_id)?.title || 'Заметка'));
    const timestamp = Number(note.mtime);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
      if (!Number.isNaN(date.getTime())) meta.append(make('time', '', date.toLocaleDateString('ru-RU')));
    }
    button.append(meta);
    button.addEventListener('click', () => openNote(note.object_id));
    button.addEventListener('keydown', event => {
      const index = filtered.findIndex(n => n.object_id === note.object_id);
      const next = index + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0);
      if (next !== index && filtered[next] && !busy) { event.preventDefault(); openNote(filtered[next].object_id); $('notes').children[next]?.focus(); }
    });
    $('notes').append(button);
  }
}
async function openNote(id) {
  if (busy || !await noteEditor.leave()) return;
  const request = ++noteRequest;
  currentNote = null;
  selectedId = id; copyText = ''; renderNotes();
  $('reader-empty').hidden = true; $('reader-document').hidden = false;
  $('note-title').textContent = 'Загрузка…'; $('note-content').replaceChildren(); $('copy-note').disabled = true;
  $('note-meta').textContent = '';
  const parent = notebooks.find(n => n.object_id === notes.find(n => n.object_id === id)?.parent_id);
  $('reader-breadcrumb').textContent = parent ? [parent.stack, parent.title || 'Без названия'].filter(Boolean).join(' / ') : 'Все заметки';
  try {
    const note = await invoke('get_note', { id });
    if (request !== noteRequest) return;
    currentNote = note; displayNote(note);
    $('reader-document').scrollTop = 0;
    status('Заметка загружена');
  } catch (error) {
    if (request !== noteRequest) return;
    $('note-title').textContent = 'Не удалось открыть заметку'; status(String(error), true);
  }
}
$('show-notebooks').addEventListener('click', async () => { if (!busy && await noteEditor.leave()) { setView('notebooks'); renderNotebooks(); } });
$('show-all-notes').addEventListener('click', () => chooseNotebook(''));
$('notebook-search').addEventListener('input', renderNotebooks);
$('notebook-sort').addEventListener('change', renderNotebooks);
$('note-sort').addEventListener('change', renderNotes);
$('pin-current').addEventListener('click', () => { if (notebookId) togglePin(notebookId); });
$('focus-mode').addEventListener('click', () => setFocusMode(!$('workspace').classList.contains('focus-mode')));
$('font-smaller').addEventListener('click', () => { fontSize = Math.max(12, fontSize - 1); $('note-content').style.fontSize = `${fontSize}px`; });
$('font-larger').addEventListener('click', () => { fontSize = Math.min(26, fontSize + 1); $('note-content').style.fontSize = `${fontSize}px`; });
$('copy-note').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(copyText); status('Текст заметки скопирован'); }
  catch { status('Не удалось скопировать. Выделите текст и нажмите Ctrl+C.', true); }
});
window.addEventListener('keydown', event => {
  if ($('workspace').hidden) return;
  if (event.key === 'Escape' && !noteEditor.active) setFocusMode(false);
  if (!noteEditor.active && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault(); (view === 'notebooks' ? $('notebook-search') : $('search')).focus();
  }
});
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  setBusy(true); status('Подключение к NAS…');
  // Clear DOM inputs before awaiting; credentials are never put in browser storage.
  const args = { server: $('server').value.trim(), account: $('account').value, password: $('password').value, otp: $('otp').value, connectionMode: $('connection-mode').value, rememberSession: $('remember-session').checked };
  $('password').value = ''; $('otp').value = '';
  try {
    if (args.connectionMode !== 'strict' && !$('insecure-confirm').checked) throw new Error('Подтвердите выбранный режим подключения.');
    const url = new URL(args.server);
    const expectedProtocol = args.connectionMode === 'plain_http' ? 'http:' : 'https:';
    if (url.protocol !== expectedProtocol) throw new Error(`Для выбранного режима укажите адрес ${expectedProtocol}// .`);
    let saved = false;
    try { saved = saveConnection(window.localStorage, args); } catch { /* Optional persistence. */ }
    $('preferences-status').textContent = saved
      ? 'Адрес и имя пользователя сохранены. Пароль не сохраняется.'
      : 'Адрес и имя не удалось сохранить. Подключение доступно без сохранения.';
    const certificate = $('certificate').files[0];
    if (certificate && args.connectionMode === 'strict') {
      if (certificate.size > 64 * 1024) throw new Error('Файл сертификата превышает 64 КБ.');
      args.trustedCertificatePem = await certificate.text();
    }
    let result;
    try { result = await invoke('login', args); }
    finally { args.password = ''; args.otp = ''; }
    await showWorkspace(result);
  } catch (error) { status(String(error), true); }
  finally { args.password = ''; args.otp = ''; $('insecure-confirm').checked = false; setBusy(false); }
});
$('certificate').addEventListener('change', () => {
  const file = $('certificate').files[0];
  $('clear-certificate').hidden = !file;
  $('certificate-status').textContent = file ? `Выбран: ${file.name}. Доверие применяется при подключении.` : '';
});
$('clear-certificate').addEventListener('click', () => {
  $('certificate').value = '';
  $('clear-certificate').hidden = true;
  $('certificate-status').textContent = 'Используются только доверенные сертификаты Windows.';
});
$('search').addEventListener('input', renderNotes);
$('refresh').addEventListener('click', async () => {
  if (busy || !await noteEditor.leave()) return;
  setBusy(true); noteRequest++; status('Обновление библиотеки…');
  try {
    const [nextNotebooks, nextNotes] = await Promise.all([invoke('list_notebooks'), invoke('list_notes')]);
    notebooks = nextNotebooks; notes = nextNotes;
    if (notebookId && !notebooks.some(n => n.object_id === notebookId)) notebookId = '';
    if (selectedShelf && !groupNotebooks(notebooks).shelves.some(s => s.key === selectedShelf)) selectedShelf = '';
    clearReader(); renderNotebooks(); renderNotes(); status('Библиотека обновлена');
  } catch (error) { status(String(error), true); }
  finally { setBusy(false); }
});
async function updateSavedSessionControls() {
  let saved = false;
  try { saved = await invoke('has_saved_session'); } catch { /* An error is shown by the initiating operation. */ }
  $('restore-session').hidden = !saved;
  $('forget-session').hidden = !saved;
}
async function showWorkspace(result) {
  const info = result.connection;
  notebooks = result.notebooks; notes = []; loadPins(info.server, info.account);
  document.body.classList.add('connected'); notebookId = ''; selectedShelf = ''; collapsedShelves.clear(); setView('notes');
  $('user-name').textContent = info.account; $('user-avatar').textContent = info.account.slice(0, 1).toUpperCase();
  $('login-panel').hidden = true; $('workspace').hidden = false;
  $('startup-panel').hidden = true;
  $('refresh').hidden = false; $('logout').hidden = false;
  $('restore-session').hidden = true; $('forget-session').hidden = true;
  updateSessionBadge(info);
  $('connection').textContent = info.server + (info.mode === 'strict' ? '' : info.mode === 'plain_http' ? ' · HTTP без шифрования' : ' · сертификат не проверяется');
  renderNotebooks(); clearReader(); renderNotes();
  try {
    notes = await invoke('list_notes'); renderNotebooks(); renderNotes();
    status(result.notice || `Подключено · ${notebookCountLabel(notebooks.length)} · ${noteCountLabel(notes.length)}`, !!result.notice);
  } catch(error) { status(String(error), true); }
}
async function restoreSession() {
  if (busy) return;
  setBusy(true);
  try { await restoreAtStartup({ invoke, checking: showSessionChecking, connected: showWorkspace, login: showLogin, unavailable: showSessionUnavailable }); }
  finally { setBusy(false); }
}
function showSessionChecking() {
  document.body.classList.remove('connected');
  $('login-panel').hidden = true; $('workspace').hidden = true; $('startup-panel').hidden = false;
  $('startup-panel').setAttribute('aria-busy', 'true'); $('startup-spinner').hidden = false;
  $('startup-title').textContent = 'Открываем библиотеку';
  $('startup-detail').textContent = 'Подключаемся к NAS с сохранённой сессией…';
  $('startup-actions').hidden = true; $('connection').textContent = 'Подключение…';
  for (const id of ['refresh','logout','session-state']) $(id).hidden = true;
  status('Восстановление сессии…');
}
function showLogin(error) {
  document.body.classList.remove('connected');
  $('startup-panel').hidden = true; $('workspace').hidden = true; $('login-panel').hidden = false;
  $('connection').textContent = 'Не подключён';
  $('restore-session').hidden = true; $('forget-session').hidden = true;
  status(error || 'Подключитесь к своему Synology NAS.', !!error);
}
function showSessionUnavailable(error) {
  document.body.classList.remove('connected');
  $('workspace').hidden = true; $('login-panel').hidden = true; $('startup-panel').hidden = false;
  $('startup-panel').setAttribute('aria-busy', 'false'); $('startup-spinner').hidden = true;
  $('startup-title').textContent = 'Не удалось открыть библиотеку';
  $('startup-detail').textContent = error; $('startup-actions').hidden = false;
  $('connection').textContent = 'Нет подключения';
  status('Сохранённая сессия остаётся на компьютере. Можно повторить подключение.', true);
}
function updateSessionBadge(info) {
  $('session-state').hidden = false;
  $('session-state').dataset.remembered = String(info.remembered);
  $('session-state').textContent = info.remembered ? 'Сессия сохранена' : 'Сохранить сессию';
  $('session-state').title = info.remembered ? 'Нажмите, чтобы отключить автоматический вход на этом компьютере. Для полного выхода используйте «Выйти из аккаунта».' : 'Сохранить текущую сессию для входа после перезапуска.';
}
$('session-state').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try {
    const info = await invoke('set_session_persistence', { remember: $('session-state').dataset.remembered !== 'true' });
    updateSessionBadge(info);
    status(info.remembered ? 'Сессия сохранена для следующего запуска.' : 'Автоматический вход отключён. Текущая сессия продолжает работать.');
  } catch(error) { status(String(error), true); }
  finally { setBusy(false); }
});
async function signOut() {
  if (busy || !await noteEditor.leave()) return;
  setBusy(true); clearReader(); status('Выход из аккаунта…');
  try {
    const result = await invoke('logout');
    reset(); $('restore-session').hidden = true; $('forget-session').hidden = true;
    status(result.notice || 'Вы вышли из аккаунта. Сохранённая сессия удалена.', !!result.notice);
  } catch(error) {
    // Keep the workspace available when protected storage could not be cleared.
    status(`Не удалось завершить выход: ${error}`, true);
    if ($('workspace').hidden) await updateSavedSessionControls();
  } finally { setBusy(false); }
}
$('logout').addEventListener('click', signOut);
$('forget-session').addEventListener('click', signOut);
$('restore-session').addEventListener('click', restoreSession);
$('startup-retry').addEventListener('click', restoreSession);
$('startup-logout').addEventListener('click', signOut);
$('startup-login').addEventListener('click', () => { showLogin(); updateSavedSessionControls(); });

bindPanelResizing($('workspace'));
$('toggle-notebooks').addEventListener('click', () => {
  const expanded = $('toggle-notebooks').getAttribute('aria-expanded') !== 'true';
  $('toggle-notebooks').setAttribute('aria-expanded', String(expanded));
  $('tree-arrow').textContent = expanded ? '▾' : '▸';
  $('notebooks').hidden = !expanded;
});

if (window.__TAURI__?.core?.invoke) restoreSession();
else showLogin();

if (window.__TAURI__?.event?.listen) {
  window.__TAURI__.event.listen('request-close', async () => {
    if (await noteEditor.leave()) {
      try { await invoke('close_window'); } catch(error) { status(String(error), true); }
    }
  }).then(() => invoke('register_close_guard')).catch(error => status(String(error), true));
}
