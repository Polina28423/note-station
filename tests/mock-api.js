const notebooks = [
  { object_id: 'work', title: 'Рабочие проекты', stack: 'Работа', owner: {uid: 1, display_name: 'Александр'} },
  { object_id: 'ideas', title: 'Идеи и вдохновение', stack: 'Работа', owner: {uid: 1, display_name: 'Александр'} },
  { object_id: 'personal', title: 'Личное', stack: 'Моя полка', owner: {uid: 1, display_name: 'Александр'} },
  { object_id: 'study', title: 'Обучение' },
  { object_id: 'travel', title: 'Путешествия', stack: 'Моя полка', owner: {uid: 1, display_name: 'Александр'} },
  { object_id: 'archive', title: 'Архив' },
];
const titles = ['План проекта на ноябрь', 'Заметки со встречи', 'Полезные материалы', 'Следующие шаги', 'Идеи для интерфейса'];
const notes = notebooks.flatMap((n, index) => Array.from({ length: index === 5 ? 0 : 3 + index }, (_, i) => ({ object_id: `${n.object_id}-${i}`, parent_id: n.object_id, title: titles[i % titles.length], brief: 'Рабочие материалы, обсуждения и следующие шаги по проекту.', mtime: 1794391200 - i * 86400 })));
const scenario = new URL(location.href).searchParams.get('scenario') || 'restore';
const fixtureKey = 'note-station-fixture-session:' + scenario;
let saved = sessionStorage.getItem(fixtureKey) !== 'false';
let active = false;
const overrides = new Map(JSON.parse(sessionStorage.getItem('note-station-editor-fixture') || '[]'));
for (const [id,detail] of overrides) { const summary=notes.find(n=>n.object_id===id); if(summary) summary.title=detail.title; }
function connected(remembered = true) {
 return { notebooks, connection: { server:'https://preview.invalid:5001', account:'Александр', mode:'strict', remembered }, notice:null };
}
window.__TAURI__ = { core: { invoke: async (command, args) => {
  await new Promise(resolve => setTimeout(resolve, 20));
  if (command === 'has_saved_session') return saved;
  if (command === 'restore_session') {
    if (!saved) return null;
    if (scenario === 'offline') throw Error('Тестовый NAS временно недоступен.');
    if (scenario === 'expired') { saved = false; sessionStorage.setItem(fixtureKey,'false'); throw Error('Срок сессии истёк. Войдите снова.'); }
    active = true; return connected();
  }
  if (command === 'login') {
    active = true; saved = args.rememberSession !== false; sessionStorage.setItem(fixtureKey,String(saved));
    return { ...connected(saved), connection:{ ...connected(saved).connection, server:args.server, account:args.account, mode:args.connectionMode } };
  }
  if (command === 'logout') { saved = false; active = false; sessionStorage.setItem(fixtureKey,'false'); return {server_revoked:true,notice:null}; }
  if (!active) throw Error('Войдите в тестовый NAS.');
  if (command === 'set_session_persistence') { saved = args.remember; sessionStorage.setItem(fixtureKey,String(saved)); return connected(saved).connection; }
  if (command === 'list_notebooks') return notebooks;
  if (command === 'list_notes') return notes;
  if (command === 'get_note') return overrides.get(args.id) || { object_id:args.id, ver:'v1', title:notes.find(n=>n.object_id===args.id).title, encrypted:false, content: '<h2>Небольшие шаги, понятный результат</h2><p>Рабочее пространство должно помогать сосредоточиться на содержимом. Слева — блокноты, рядом — заметки, а здесь — всё самое важное.</p><h3>Что обсудили</h3><ul><li>Навигация по блокнотам и закреплённым разделам</li><li>Поиск и сортировка заметок</li><li>Удобное чтение без лишних элементов</li></ul><blockquote>Хороший интерфейс даёт место вашим мыслям.</blockquote><p><strong>Следующий шаг:</strong> проверить библиотеку на реальном NAS.</p>' };
  if (command === 'save_note') {
    if (scenario === 'save-error') throw Error('Тест: NAS недоступен, заметка не сохранена.');
    if (scenario === 'conflict') throw Error('Заметка изменена на NAS с момента открытия.');
    const previous = overrides.get(args.id);
    const version = previous?.ver || 'v1';
    if (args.expectedVersion !== version) throw Error('Конфликт версии заметки.');
    const note = {object_id:args.id,ver:'v'+(Number(version.slice(1))+1),title:args.title,content:args.content,encrypted:false};
    overrides.set(args.id,note); sessionStorage.setItem('note-station-editor-fixture',JSON.stringify([...overrides]));
    const summary = notes.find(n=>n.object_id===args.id); summary.title=args.title; summary.brief=args.brief;
    return {note,notice:null};
  }
  throw Error('Unexpected preview command');
} } };
