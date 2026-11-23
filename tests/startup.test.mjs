import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { restoreAtStartup } from '../ui/startup.js';

function views(invoke) {
  const events = [];
  return { events, options: { invoke,
    checking: () => events.push(['checking']),
    connected: async value => events.push(['connected', value]),
    login: error => events.push(['login', error]),
    unavailable: error => events.push(['unavailable', error]),
  } };
}

test('credential form is hidden before JavaScript starts or session check finishes', async () => {
  const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  assert.match(html, /<section\s+id="login-panel"\s+hidden>/);
  assert.match(html, /<main\s+id="workspace"\s+hidden>/);
  assert.doesNotMatch(html.match(/<section\s+id="startup-panel"[^>]*>/)?.[0] || '', /\bhidden\b/);
});

test('delayed active session goes directly from checking to library without showing login', async () => {
  let resolve;
  const result = { notebooks: [], connection: { account: 'fixture' } };
  const pending = new Promise(r => { resolve = r; });
  const { events, options } = views(command => {
    assert.equal(command, 'restore_session');
    return pending;
  });
  const restoring = restoreAtStartup(options);
  assert.deepEqual(events, [['checking']]);
  await Promise.resolve();
  assert.deepEqual(events, [['checking']]);
  resolve(result); await restoring;
  assert.deepEqual(events, [['checking'], ['connected', result]]);
});

test('no session reveals login only after the restore result is known', async () => {
  const { events, options } = views(async command => {
    assert.equal(command, 'restore_session'); return null;
  });
  await restoreAtStartup(options);
  assert.deepEqual(events, [['checking'], ['login', undefined]]);
});

test('expired session reveals login with its reason', async () => {
  const { events, options } = views(async command => {
    if (command === 'restore_session') throw Error('Session expired');
    assert.equal(command, 'has_saved_session'); return false;
  });
  await restoreAtStartup(options);
  assert.equal(events[1][0], 'login');
  assert.match(events[1][1], /Session expired/);
});

test('unavailable NAS preserves session screen instead of asking for credentials', async () => {
  let available = false;
  const { events, options } = views(async command => {
    if (command === 'has_saved_session') return true;
    if (!available) throw Error('Offline');
    return { notebooks: [] };
  });
  await restoreAtStartup(options);
  assert.deepEqual(events.map(e => e[0]), ['checking', 'unavailable']);
  available = true; await restoreAtStartup(options);
  assert.deepEqual(events.map(e => e[0]), ['checking', 'unavailable', 'checking', 'connected']);
});

test('unknown saved-session state does not briefly expose login', async () => {
  const { events, options } = views(async () => { throw Error('Storage unavailable'); });
  await restoreAtStartup(options);
  assert.deepEqual(events.map(e => e[0]), ['checking', 'unavailable']);
});

test('failure after authenticated restore never asks the active user to sign in again', async () => {
  const { events, options } = views(async command => {
    assert.equal(command, 'restore_session'); return { notebooks: [] };
  });
  options.connected = async () => { throw Error('Library unavailable'); };
  await restoreAtStartup(options);
  assert.deepEqual(events.map(e => e[0]), ['checking', 'unavailable']);
});
