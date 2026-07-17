'use strict';
const assert = require('node:assert/strict');
module.exports = async function checkHistory(page, base) {
  await page.goto(base + '/');
  await page.locator('.account-open').first().click();
  await page.locator('#notes .note-row').first().click();
  await page.waitForFunction(() => !document.getElementById('note-history').disabled);
  await page.evaluate(() => {
    const original = window.__TAURI__.core.invoke;
    window.historyCalls = [];
    window.__TAURI__.core.invoke = async (command, args) => {
      if (!['list_note_versions', 'get_note_version', 'restore_note_version'].includes(command)) return original(command, args);
      window.historyCalls.push({ command, args });
      if (command === 'list_note_versions') return [{ ver: 'old-1', mtime: 1700000000 }, { ver: 'old-2' }];
      if (command === 'get_note_version') return { ver: args.version, title: 'Исторический заголовок', content: '<p>Исторический текст</p><script>window.badHistory=true</script><img src=x onerror="window.badHistory=true">' };
      return { note: { object_id: args.id, ver: 'new-3', title: 'Исторический заголовок', content: '<p>Исторический текст</p>', encrypted: false }, notice: null };
    };
  });
  await page.locator('#note-history').click();
  await page.locator('#history-list button').first().waitFor();
  assert.equal(await page.locator('#history-restore').isDisabled(), true);
  await page.locator('#history-list button').first().click();
  await page.waitForFunction(() => !document.getElementById('history-restore').disabled);
  assert.match(await page.locator('#history-preview').textContent(), /Исторический текст/);
  assert.equal(await page.locator('#history-preview script,#history-preview img').count(), 0);
  assert.equal(await page.evaluate(() => !!window.badHistory), false);
  assert.equal(await page.evaluate(() => window.historyCalls.length), 2);
  await page.locator('#history-restore').click();
  await page.locator('#history-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#note-title').textContent(), 'Исторический заголовок');
  assert.match(await page.locator('#status').textContent(), /сохранена как новая/);
  await page.locator('#note-history').click();
  await page.locator('#history-list button').first().waitFor();
  assert.equal(await page.locator('#history-list button').count(), 2);
  await page.keyboard.press('Escape');
  await page.locator('#history-dialog').waitFor({ state: 'hidden' });
  console.log('PASS history preview, sanitized HTML, restore-as-new action, reopening and Escape');
};
