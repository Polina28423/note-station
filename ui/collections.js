import { collectionStrings as strings } from './strings.js';
import { safeNoteFragment } from './content.js';
import { bindExternalLinks } from './links.js';

export function flattenTodos(items, depth = 0, result = [], seen = new Set()) {
  if (depth > 20 || result.length > 10000) throw Error('Слишком большой или глубоко вложенный список задач.');
  for (const item of items) {
    if (seen.has(item.object_id)) continue;
    seen.add(item.object_id); result.push({ ...item, depth });
    flattenTodos(item.items || [], depth + 1, result, seen);
  }
  return result;
}
export function filteredCollection(items, query, state = 'all') {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter(item => (item.title || '').toLocaleLowerCase().includes(needle)
    && (state === 'all' || (state === 'done' ? item.done : !item.done)));
}
export function accessContext(item) {
  return { ...(item.perm_from != null ? { perm_from: item.perm_from } : {}), ...(item.smart_id ? { smart_id: item.smart_id } : {}) };
}

export function bindCollections({ invoke, prepare, activate, setBusy, onRestored }) {
  const $ = id => document.getElementById(id);
  let kind = '', route = null, items = [], generation = 0, previewRequest = 0, selected = '', loading = false, writing = false, blocked = false, loadError = false;
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const message = value => { $('collection-status').textContent = value; };
  bindExternalLinks($('collection-preview-body'), url => invoke('open_external_url', { url }), message);
  function clearPreview() { previewRequest++; selected = ''; $('collection-preview').hidden = true; $('collection-preview-body').replaceChildren(); $('collection-preview-title').textContent = ''; }
  async function preview(item) {
    if (writing) return;
    const token = ++previewRequest, current = generation;
    selected = item.object_id; $('collection-preview').hidden = false;
    $('collection-preview-title').textContent = item.title || strings.untitled;
    $('collection-preview-body').textContent = strings.previewLoading;
    try {
      const note = await invoke('get_section_note', { id: item.object_id, context: accessContext(item) });
      if (token !== previewRequest || current !== generation) return;
      $('collection-preview-title').textContent = note.title || strings.untitled;
      if (note.encrypted) $('collection-preview-body').textContent = strings.encrypted;
      else $('collection-preview-body').replaceChildren(safeNoteFragment(note.content));
    } catch (error) { if (token === previewRequest && current === generation) $('collection-preview-body').textContent = String(error); }
  }
  async function mutate(item, done) {
    if (writing || loading || blocked) return;
    writing = true; setBusy(true); message(kind === 'todos' ? strings.savingTask : strings.restoring); render();
    try {
      if (kind === 'todos') {
        const result = await invoke('set_todo_done', { id: item.object_id, done, expectedDone: item.done });
        item.done = result.done; message(result.notice || strings.taskSaved);
      } else {
        const result = await invoke('restore_recycled_note', { id: item.object_id, context: accessContext(item) });
        items = items.filter(note => note.object_id !== item.object_id);
        if (selected === item.object_id) clearPreview();
        $('trash-count').textContent = items.length;
        message(result.notice || strings.restored);
        await onRestored?.(item.object_id);
      }
    } catch (error) { blocked = true; message(`${strings.retryWrite} ${String(error)}`); }
    finally {
      writing = false; setBusy(false); render();
      const row=[...$('collection-list').children].find(node=>node.dataset.objectId===item.object_id);
      (row?.querySelector('input:not(:disabled),button:not(:disabled)')||$('collection-refresh')).focus();
    }
  }
  function render() {
    const rows = filteredCollection(items, $('collection-search').value, kind === 'todos' ? $('collection-filter').value : 'all');
    $('collection-list').replaceChildren();
    if (!rows.length && !loading && !loadError) {
      $('collection-list').append(make('p', 'collection-empty', items.length ? strings.noMatches : route ? strings.emptyNotes : strings.empty[kind]));
    }
    for (const item of rows) {
      const row = make('div', 'collection-row'); row.dataset.objectId=item.object_id||item.tag_id;
      if (kind === 'todos') {
        const label = make('label', 'collection-task');
        label.style.setProperty('--task-depth', Math.min(item.depth, 8));
        const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = !!item.done;
        checkbox.disabled = writing || loading || blocked; checkbox.setAttribute('aria-label', strings.taskLabel(item.title || strings.untitled));
        checkbox.addEventListener('change', () => { const next = checkbox.checked; checkbox.checked = item.done; mutate(item, next); });
        const title = make('span', item.done ? 'task-done' : '', item.title || strings.untitled);
        label.append(checkbox, title); row.append(label);
        if (item.note_id) { const button = make('button', 'collection-small-action', strings.openNote); button.disabled = writing || loading; button.addEventListener('click', () => preview({ object_id: item.note_id, title: item.title })); row.append(button); }
      } else {
        const button = make('button', 'collection-item'); button.disabled = writing || loading;
        button.append(make('strong', '', item.title || strings.untitled));
        if (kind === 'shared' && !route && item.owner?.display_name) button.append(make('small', '', item.owner.display_name));
        button.addEventListener('click', () => {
          if (!route && (kind === 'shared' || kind === 'tags')) {
            route = { id: kind === 'tags' ? item.tag_id : item.object_id, title: item.title };
            $('collection-search').value = ''; clearPreview(); load(true);
          } else preview(item);
        });
        row.append(button);
        if (kind === 'trash') { const restore = make('button', 'collection-small-action', strings.restore); restore.disabled = writing || loading || blocked; restore.addEventListener('click', () => mutate(item)); row.append(restore); }
      }
      $('collection-list').append(row);
    }
  }
  async function load(clear = false) {
    if (writing || !kind) return;
    const token = ++generation;
    clearPreview(); if (clear) items = [];
    loading = true; loadError = false;
    $('collection-refresh').disabled = true; $('collection-panel').setAttribute('aria-busy', 'true');
    $('collection-title').textContent = route ? (kind === 'tags' ? strings.tagTitle(route.title || strings.untitled) : route.title || strings.untitled) : strings.titles[kind];
    $('collection-description').textContent = strings.descriptions[kind];
    $('collection-back').hidden = !route; $('collection-back').textContent = strings.back;
    $('collection-filter').hidden = kind !== 'todos';
    message(strings.loading); render();
    try {
      const command = kind === 'todos' ? 'list_todos' : kind === 'trash' ? 'list_recycled_notes' : kind === 'tags' ? (route ? 'list_tag_notes' : 'list_tags') : (route ? 'list_shared_notes' : 'list_shared_notebooks');
      let data = await invoke(command, route ? { id: route.id } : {});
      if (token !== generation) return;
      if (kind === 'todos') data = flattenTodos(data);
      items = data; blocked = false;
      if (!route) $(`${kind}-count`).textContent = data.length;
      message(strings.count(data.length));
    } catch (error) { if (token === generation) { loadError = true; message(String(error)); } }
    finally {
      if (token === generation) { loading = false; $('collection-refresh').disabled = false; $('collection-panel').setAttribute('aria-busy', 'false'); render(); }
    }
  }
  async function enter(next) {
    if (writing || !await prepare()) return;
    activate(); kind = next; route = null; items = []; $('collection-search').value = ''; $('collection-filter').value = 'all';
    for (const name of ['todos', 'shared', 'trash', 'tags']) { $(`show-${name}`).classList.toggle('selected', name === kind); $(`show-${name}`).setAttribute('aria-pressed', String(name === kind)); }
    load(true);
  }
  for (const name of ['todos', 'shared', 'trash', 'tags']) $(`show-${name}`).addEventListener('click', () => enter(name));
  $('collection-refresh').addEventListener('click', () => load());
  $('collection-search').addEventListener('input', render); $('collection-filter').addEventListener('change', render);
  $('collection-back').addEventListener('click', () => { if (!writing) { route = null; $('collection-search').value = ''; load(true); } });
  function leave() {
    generation++; clearPreview(); kind = ''; route = null; items = [];
    for (const name of ['todos', 'shared', 'trash', 'tags']) { $(`show-${name}`).classList.remove('selected'); $(`show-${name}`).setAttribute('aria-pressed', 'false'); }
  }
  return { leave, reset() { leave(); for (const name of ['todos', 'shared', 'trash', 'tags']) $(`${name}-count`).textContent = '—'; }, refresh() { if (kind) load(); } };
}
