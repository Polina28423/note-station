const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
export function notebookCounts(notes) {
  const counts = new Map();
  for (const note of notes) counts.set(note.parent_id, (counts.get(note.parent_id) || 0) + 1);
  return counts;
}
export function visibleNotebooks(notebooks, query, order, counts) {
  const needle = query.trim().toLocaleLowerCase();
  return notebooks.filter(n => n.title.toLocaleLowerCase().includes(needle) || (n.stack || '').toLocaleLowerCase().includes(needle)).sort((a, b) =>
    (order === 'count' ? (counts.get(b.object_id) || 0) - (counts.get(a.object_id) || 0) : 0)
    || collator.compare(a.title, b.title));
}
export function visibleNotes(notes, notebookId, query, order) {
  const needle = query.trim().toLocaleLowerCase();
  const result = notes.filter(n => (!notebookId || n.parent_id === notebookId) && n.title.toLocaleLowerCase().includes(needle));
  if (order !== 'original') result.sort((a, b) => collator.compare(a.title, b.title) * (order === 'desc' ? -1 : 1));
  return result;
}

export function frequentNotes(notes, activity) {
  const byId = new Map(notes.map(note => [note.object_id, note]));
  return activity.opened.filter(entry => byId.has(entry.id))
    .sort((a, b) => b.count - a.count).map(entry => byId.get(entry.id));
}

export function restoredNoteLocation(notes, notebooks, activity) {
  const note = notes.find(item => item.object_id === activity.noteId);
  const parent = note?.parent_id || activity.notebookId;
  const notebookId = notebooks.some(item => item.object_id === parent) ? parent : '';
  return { notebookId, noteId: note?.object_id || '' };
}
export function noteCountLabel(count) {
  const end = count % 100, digit = count % 10;
  return `${count} ${end >= 11 && end <= 14 ? 'заметок' : digit === 1 ? 'заметка' : digit >= 2 && digit <= 4 ? 'заметки' : 'заметок'}`;
}

export function notebookCountLabel(count) {
  const end = count % 100, digit = count % 10;
  return `${count} ${end >= 11 && end <= 14 ? 'блокнотов' : digit === 1 ? 'блокнот' : digit >= 2 && digit <= 4 ? 'блокнота' : 'блокнотов'}`;
}

export function shelfKey(notebook) {
  if (typeof notebook.stack !== 'string' || !notebook.stack.trim()) return '';
  const owner = notebook.owner;
  const identity = owner?.uid != null ? `uid:${owner.uid}` : `name:${owner?.display_name || ''}`;
  return JSON.stringify([identity, notebook.stack]);
}

export function groupNotebooks(notebooks) {
  const shelves = new Map(), standalone = [];
  for (const notebook of notebooks) {
    const key = shelfKey(notebook);
    if (!key) { standalone.push(notebook); continue; }
    if (!shelves.has(key)) shelves.set(key, { key, name: notebook.stack, label: notebook.stack, owner: notebook.owner?.display_name || '', notebooks: [] });
    shelves.get(key).notebooks.push(notebook);
  }
  const result = [...shelves.values()];
  const nameCounts = new Map();
  for (const shelf of result) nameCounts.set(shelf.name, (nameCounts.get(shelf.name) || 0) + 1);
  for (const shelf of result) {
    if (nameCounts.get(shelf.name) > 1) shelf.label += ` · ${shelf.owner || 'Владелец не указан'}`;
  }
  result.sort((a, b) => collator.compare(a.label, b.label));
  return { shelves: result, standalone };
}

export function notesInShelf(notes, notebooks, key) {
  if (!key) return notes;
  const members = new Set(notebooks.filter(n => shelfKey(n) === key).map(n => n.object_id));
  return notes.filter(note => members.has(note.parent_id));
}
