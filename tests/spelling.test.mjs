import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindSpelling } from '../ui/spelling.js';
class Element {
  constructor() { this.children = []; this.listeners = {}; this.attributes = {}; this.disabled = false; this.value = 'mixed'; this.textContent = ''; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
  async click() { if (!this.disabled) await this.listeners.click?.(); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const issue = { segment: 'title', start: 0, length: 6, word: 'helllo', languages: ['en'], mixed_alphabet: false };
function setup(invoke) {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  globalThis.document = { getElementById: get, createElement: () => new Element(), createTextNode: text => ({ textContent: text }) };
  const snapshot = { segments: [{ id: 'title', text: 'helllo' }] };
  const editor = { active: true, valid: true, replacements: [], spellingSnapshot: () => snapshot, spellingCurrent: () => editor.valid, replaceSpelling: async (...args) => { editor.replacements.push(args); return true; } };
  bindSpelling({ editor, invoke });
  return { get, editor };
}
test('shared panel checks the requested language and replaces only through the editor adapter', async () => {
  const calls = [];
  const ui = setup(async (command, args) => {
    calls.push([command, args]);
    return command === 'check_spelling' ? { issues: [issue], truncated: false } : ['hello'];
  });
  await ui.get('check-spelling').click(); await tick();
  assert.equal(calls[0][1].language, 'mixed');
  await ui.get('spelling-issues').children[0].click();
  await ui.get('spelling-suggestions').children[0].click();
  assert.equal(ui.editor.replacements.length, 1);
  assert.equal(ui.editor.replacements[0][2], 'hello');
  assert.ok(calls.every(([command]) => command !== 'save_note'));
  ui.get('spelling-language').value = 'uk';
  await ui.get('spelling-language').listeners.change(); await tick();
  assert.equal(calls.at(-1)[1].language, 'uk');
});
test('closing while checking discards late results', async () => {
  let resolve;
  const ui = setup(() => new Promise(done => { resolve = done; }));
  await ui.get('check-spelling').click();
  await ui.get('spelling-close').click();
  resolve({ issues: [issue], truncated: false }); await tick();
  assert.equal(ui.get('spelling-issues').children.length, 0);
  assert.equal(ui.get('spelling-dialog').open, false);
});
test('a changed draft blocks stale replacements', async () => {
  const ui = setup(async command => command === 'check_spelling' ? { issues: [issue], truncated: false } : ['hello']);
  await ui.get('check-spelling').click(); await tick();
  await ui.get('spelling-issues').children[0].click();
  const replace = ui.get('spelling-suggestions').children[0];
  ui.editor.valid = false;
  await replace.click();
  assert.equal(ui.editor.replacements.length, 0);
  assert.match(ui.get('spelling-status').textContent, /Текст изменился/);
});
test('backend failures are displayed and skipping never modifies the draft', async () => {
  let fail = true;
  const ui = setup(async command => {
    if (fail) throw Error('Тестовая ошибка');
    return command === 'check_spelling' ? { issues: [issue, { ...issue, start: 7 }], truncated: false } : [];
  });
  await ui.get('check-spelling').click(); await tick();
  assert.match(ui.get('spelling-status').textContent, /Тестовая ошибка/);
  fail = false;
  await ui.get('spelling-recheck').click(); await tick();
  await ui.get('spelling-issues').children[0].click();
  await ui.get('spelling-ignore').click();
  assert.equal(ui.get('spelling-issues').children.length, 0);
  assert.equal(ui.editor.replacements.length, 0);
});
