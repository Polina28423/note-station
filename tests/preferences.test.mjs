import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConnection, saveConnection, noteActivityKey, loadNoteActivity, saveNoteActivity, recordNoteOpen } from '../ui/preferences.js';

function storage() {
  let value = null;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}

test('restores server and username across reload, excluding credentials and insecure mode', () => {
  const store = storage();
  assert.equal(saveConnection(store, {
    server: 'http://nas:5000', account: 'tester', password: 'secret', otp: '123456',
    sid: 'session', connectionMode: 'plain_http', trustedCertificatePem: 'certificate',
  }), true);
  assert.deepEqual(loadConnection(store), { server: 'http://nas:5000', account: 'tester' });
  assert.deepEqual(JSON.parse(store.getItem()), { server: 'http://nas:5000', account: 'tester' });
});

test('does not persist credentials or tokens embedded in server URL', () => {
  for (const server of ['https://user:secret@nas', 'https://nas/?sid=secret', 'file:///notes', 'https://nas/#token']) {
    assert.equal(saveConnection(storage(), { server, account: 'tester' }), false);
  }
});

test('missing, malformed and unavailable storage do not block startup', () => {
  assert.equal(loadConnection(storage()), null);
  assert.equal(loadConnection({ getItem: () => '{broken' }), null);
  assert.equal(loadConnection({ getItem: () => '{"server":3,"account":"x"}' }), null);
  const unavailable = { getItem() { throw Error('disabled'); }, setItem() { throw Error('quota'); } };
  assert.equal(loadConnection(unavailable), null);
  assert.equal(saveConnection(unavailable, { server: 'https://nas:5001', account: 'tester' }), false);
});
test('note activity restores independently for each server and account', () => {
  const entries = new Map();
  const store = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  const key = noteActivityKey({ server: 'https://nas:5001', account: 'one' });
  const otherAccount = noteActivityKey({ server: 'https://nas:5001', account: 'two' });
  const otherServer = noteActivityKey({ server: 'https://other:5001', account: 'one' });
  let activity = loadNoteActivity(store, key);
  activity = recordNoteOpen(activity, 'a', 'book');
  activity = recordNoteOpen(activity, 'b', 'book');
  activity = recordNoteOpen(activity, 'a', 'book');
  saveNoteActivity(store, key, activity);
  assert.deepEqual(loadNoteActivity(store, key), { noteId: 'a', notebookId: 'book', opened: [{ id: 'a', count: 2 }, { id: 'b', count: 1 }] });
  for (const other of [otherAccount, otherServer]) assert.deepEqual(loadNoteActivity(store, other).opened, []);
  entries.set(key, JSON.stringify({ noteId: 9, opened: [null, { id: 'x', count: -3 }, { id: 'y', count: 1 }, { id: 'y', count: 9 }] }));
  assert.deepEqual(loadNoteActivity(store, key), { noteId: '', notebookId: '', opened: [{ id: 'y', count: 1 }] });
});
