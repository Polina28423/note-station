import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWebUrl, bindExternalLinks } from '../ui/links.js';

test('website URLs are canonicalized without allowing executable schemes or credentials', () => {
  assert.equal(normalizeWebUrl('https://example.org/a?q=1#part'), 'https://example.org/a?q=1#part');
  assert.equal(normalizeWebUrl('example.org/path', true), 'https://example.org/path');
  assert.equal(normalizeWebUrl('http://example.org'), 'http://example.org/');
  for (const value of ['javascript:alert(1)', 'file:///C:/file.exe', 'shell:AppsFolder', 'data:text/html,x', 'mailto:a@example.org', '//example.org', 'https://user:secret@example.org', 'https://example.org/\nx', 'https://example.org/a b', 'https://', '']) {
    assert.equal(normalizeWebUrl(value, true), '', value);
  }
  assert.equal(normalizeWebUrl('https://example.org/' + 'x'.repeat(8193)), '');
});

test('delegated clicks use the injected opener and never navigate the editor', async () => {
  const handlers = new Map(), opened = [], errors = [];
  const link = { getAttribute: () => 'https://example.org' };
  const root = { contains: target => target === link, ownerDocument: { getSelection: () => ({ toString: () => '' }) }, addEventListener: (type, fn) => handlers.set(type, fn), removeEventListener: type => handlers.delete(type) };
  const unbind = bindExternalLinks(root, async url => opened.push(url), error => errors.push(error));
  let prevented = false, stopped = false;
  const event = { target: { closest: () => link }, type: 'click', detail: 1, preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } };
  handlers.get('click')(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(opened, ['https://example.org/']);
  assert.ok(prevented && stopped);
  link.getAttribute = () => 'javascript:bad()';
  handlers.get('click')(event);
  assert.equal(opened.length, 1);
  assert.equal(errors.length, 1);
  unbind(); assert.equal(handlers.size, 0);
});

test('drag selection does not follow a link and browser failures are surfaced', async () => {
  const handlers = new Map(), errors = [];
  const link = { getAttribute: () => 'https://example.org' };
  let selection = 'selected', attempts = 0;
  const root = { contains: () => true, ownerDocument: { getSelection: () => ({ toString: () => selection }) }, addEventListener: (type, fn) => handlers.set(type, fn), removeEventListener: () => {} };
  bindExternalLinks(root, async () => { attempts++; throw Error('private detail'); }, error => errors.push(error));
  const event = { target: { closest: () => link }, type: 'click', detail: 1, preventDefault() {}, stopImmediatePropagation() {} };
  handlers.get('click')(event); assert.equal(attempts, 0);
  selection = ''; handlers.get('click')(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1); assert.equal(errors.length, 1); assert.ok(!errors[0].includes('private detail'));
});
