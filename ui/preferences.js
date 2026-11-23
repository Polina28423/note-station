const KEY = 'note-station.connection.v1';

function fields(value) {
  if (!value || typeof value.server !== 'string' || typeof value.account !== 'string'
      || value.server.length > 2048 || value.account.length > 256) return null;
  try {
    const url = new URL(value.server);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname
        || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return { server: value.server, account: value.account };
  } catch { return null; }
}

export function loadConnection(storage) {
  try { return fields(JSON.parse(storage.getItem(KEY))); }
  catch { return null; }
}

export function saveConnection(storage, value) {
  const safe = fields(value);
  if (!safe) return false;
  try { storage.setItem(KEY, JSON.stringify(safe)); return true; }
  catch { return false; }
}

const EDITOR_KEY='note-station.editor.v1';
export function loadEditorMode(storage) {
  try {return storage.getItem(EDITOR_KEY)==='classic'?'classic':'blocks';}
  catch {return 'blocks';}
}
export function saveEditorMode(storage,mode) {
  if(!['blocks','classic'].includes(mode))return false;
  try {storage.setItem(EDITOR_KEY,mode);return true;} catch {return false;}
}

const activityLimit = 500;
const safeId = id => typeof id === 'string' && id.length <= 512 ? id : '';

export function noteActivityKey(connection) {
  const value = fields(connection);
  return value ? 'note-station.activity.v1:' + JSON.stringify([new URL(value.server).origin, value.account]) : '';
}

export function loadNoteActivity(storage, key) {
  const empty = { notebookId: '', noteId: '', opened: [] };
  if (!key) return empty;
  try {
    const saved = JSON.parse(storage.getItem(key));
    const entries = new Map();
    for (const entry of Array.isArray(saved?.opened) ? saved.opened.slice(0, activityLimit) : []) {
      if (typeof entry !== 'object' || !entry) continue;
      const id = safeId(entry.id);
      if (id && !entries.has(id) && Number.isSafeInteger(entry.count) && entry.count > 0) entries.set(id, { id, count: entry.count });
    }
    return { notebookId: safeId(saved?.notebookId), noteId: safeId(saved?.noteId), opened: [...entries.values()] };
  } catch { return empty; }
}

export function saveNoteActivity(storage, key, activity) {
  if (!key) return;
  try { storage.setItem(key, JSON.stringify(activity)); } catch { /* Activity still works for this run. */ }
}

export function recordNoteOpen(activity, id, notebookId) {
  if (!safeId(id)) return activity;
  const count = activity.opened.find(entry => entry.id === id)?.count || 0;
  const opened = [{ id, count: Math.min(count + 1, Number.MAX_SAFE_INTEGER) }, ...activity.opened.filter(entry => entry.id !== id)];
  return { notebookId: safeId(notebookId), noteId: id, opened: opened.slice(0, activityLimit) };
}
