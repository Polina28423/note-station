import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindNoteHistory } from '../ui/history.js';

class Element {
  constructor() { this.children = []; this.listeners = {}; this.attributes = {}; this.disabled = false; this.content = { childNodes: [] }; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  async click() { if (!this.disabled) await this.listeners.click?.(); }
}
function setup(invoke) {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  globalThis.document = { getElementById: get, createElement: () => new Element(), createDocumentFragment: () => new Element() };
  let restored = null;
  const busy = [];
  bindNoteHistory({ invoke, getNote: () => ({ object_id: 'note', ver: 'v3' }), canOpen: () => true, leave: async () => true, setBusy: value => busy.push(value), onRestored: value => { restored = value; } });
  return { get, busy, restored: () => restored };
}
test('history previews without writes and restores with the current revision as conflict token', async () => {
  const calls = [];
  const ui = setup(async (command, args) => {
    calls.push([command, args]);
    if (command === 'list_note_versions') return [{ ver: 'v1' }, { ver: 'v2' }];
    if (command === 'get_note_version') return { title: 'Old title', content: '' };
    return { note: { ver: 'v4' }, notice: null };
  });
  await ui.get('note-history').click();
  assert.equal(ui.get('history-list').children.length, 2);
  assert.equal(ui.get('history-restore').disabled, true);
  await ui.get('history-list').children[0].click();
  assert.equal(calls.length, 2);
  assert.equal(ui.get('history-note-title').textContent, 'Old title');
  await ui.get('history-restore').click();
  assert.deepEqual(calls[2], ['restore_note_version', { id: 'note', version: 'v1', expectedVersion: 'v3' }]);
  assert.equal(ui.restored().note.ver, 'v4');
  assert.deepEqual(ui.busy, [true, false]);
  assert.equal(ui.get('history-dialog').open, false);
});
test('late previews cannot replace the selected version or reopen a closed history', async () => {
  let resolveFirst;
  const ui = setup(async (command, args) => {
    if (command === 'list_note_versions') return [{ ver: 'v1' }, { ver: 'v2' }];
    if (args.version === 'v1') return new Promise(resolve => { resolveFirst = resolve; });
    return { title: 'Second', content: '' };
  });
  await ui.get('note-history').click();
  const first = ui.get('history-list').children[0].click();
  await ui.get('history-list').children[1].click();
  resolveFirst({ title: 'First', content: '' });
  await first;
  assert.equal(ui.get('history-note-title').textContent, 'Second');
  await ui.get('history-close').click();
  assert.equal(ui.get('history-dialog').open, false);
  assert.equal(ui.get('history-restore').disabled, true);
});
test('failed restoration retains the dialog and blocks accidental repeated writes', async () => {
  let writes = 0;
  const ui = setup(async command => {
    if (command === 'list_note_versions') return [{ ver: 0 }];
    if (command === 'get_note_version') return { title: 'Old', content: '' };
    writes++; throw Error('Конфликт версии');
  });
  await ui.get('note-history').click();
  await ui.get('history-list').children[0].click();
  await ui.get('history-restore').click();
  await ui.get('history-restore').click();
  assert.equal(writes, 1);
  assert.match(ui.get('history-status').textContent, /Конфликт/);
  assert.equal(ui.get('history-dialog').open, true);
  assert.equal(ui.get('history-close').disabled, false);
  assert.deepEqual(ui.busy, [true, false]);
});
test('empty history and API errors leave restoration disabled', async () => {
  for (const result of [[], Error('История недоступна')]) {
    const ui = setup(async () => { if (result instanceof Error) throw result; return result; });
    await ui.get('note-history').click();
    assert.equal(ui.get('history-list').children.length, 0);
    assert.equal(ui.get('history-restore').disabled, true);
    assert.ok(ui.get('history-status').textContent.length > 0);
  }
});
