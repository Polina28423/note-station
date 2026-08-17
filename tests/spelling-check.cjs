'use strict';
const assert = require('node:assert/strict');
module.exports = async function checkSpelling(page, base) {
  for (const mode of ['blocks', 'classic']) {
    await page.goto(base + '/');
    await page.locator('.account-open').first().click();
    await page.waitForFunction(() => document.querySelector('#notes .note-row'));
    await page.evaluate(mode => {
      localStorage.setItem('note-station.editor.v1', mode);
      const original = window.__TAURI__.core.invoke;
      window.spellingCalls = []; window.spellingWrites = [];
      window.__TAURI__.core.invoke = async (command, args) => {
        if (command === 'get_note') return { object_id: args.id, ver: 'v1', title: 'Заголовок helllo', encrypted: false, content: '<p>😀 <strong>hel</strong><em>llo</em> world. Это русский текст: превет.</p><p style="text-align:right"><span style="color:#c62828">Український текст: привітт.</span></p><pre>helllo code</pre><img data-file-id="kept" src="old.png">' };
        if (command === 'check_spelling') {
          window.spellingCalls.push(args);
          if (window.spellingError) throw Error('Тест: проверка недоступна');
          await new Promise(resolve => setTimeout(resolve, window.spellingDelay || 10));
          const issues = [];
          for (const segment of args.segments) for (const match of segment.text.matchAll(/helllo|превет|привітт/g)) {
            issues.push({ segment: segment.id, start: match.index, length: match[0].length, word: match[0], languages: [match[0] === 'helllo' ? 'en' : match[0] === 'превет' ? 'ru' : 'uk'], mixed_alphabet: false });
          }
          return { issues, truncated: false };
        }
        if (command === 'spelling_suggestions') return [{ helllo: 'hello', превет: 'привет', привітт: 'привіт' }[args.word]];
        if (command === 'save_note') { window.spellingWrites.push(args); return { note: { object_id: args.id, ver: 'v2', title: args.title, content: args.content, encrypted: false }, notice: null }; }
        return original(command, args);
      };
    }, mode);
    await page.locator('#notes .note-row').first().click();
    await page.waitForFunction(() => document.getElementById('note-title').textContent === 'Заголовок helllo');
    await page.locator('#profile-menu summary').click();await page.locator('#profile-settings').click();
    await page.locator('#editor-mode').selectOption(mode);
    await page.locator('#apply-settings').click();
    await page.locator('#note-content p').first().click();
    await page.waitForFunction(() => !document.getElementById('check-spelling').disabled);
    await page.evaluate(mode => {
      const root = mode === 'blocks' ? document.getElementById('block-content') : window.tinymce.get('edit-content').getBody();
      if (mode === 'classic') window.tinymce.get('edit-content').focus();
      const doc = root.ownerDocument, walker = doc.createTreeWalker(root, 4);
      let node; while ((node = walker.nextNode())) if (node.data.includes('привітт')) break;
      if (mode === 'blocks') node.parentElement.closest('[contenteditable="true"]').focus();
      const start = node.data.indexOf('привітт'), range = doc.createRange();
      range.setStart(node, start); range.setEnd(node, start + 7);
      const selection = doc.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }, mode);
    await page.locator('#check-spelling').click();
    await page.waitForFunction(() => document.querySelectorAll('#spelling-issues button').length === 4);
    await page.locator('#spelling-scope').selectOption('selection');
    await page.waitForFunction(() => window.spellingCalls.at(-1).segments.length === 1 && window.spellingCalls.at(-1).segments[0].text === 'привітт');
    await page.locator('#spelling-language').selectOption('uk');
    await page.waitForFunction(() => window.spellingCalls.at(-1).language === 'uk');
    await page.locator('#spelling-issues button').first().click();
    await page.getByRole('button', { name: 'Заменить на «привіт»', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#spelling-issues button').length === 0);
    await page.locator('#spelling-close').click();
    await page.locator('#editor-undo').click();
    await page.locator('#check-spelling').click();
    await page.locator('#spelling-language').selectOption('mixed');
    await page.waitForFunction(() => document.querySelectorAll('#spelling-issues button').length === 4);
    assert.equal(await page.evaluate(() => window.spellingCalls[0].language), 'mixed');
    assert.equal(await page.evaluate(() => window.spellingCalls[0].segments.some(segment => segment.text.includes('helllo code') || segment.text.includes('Изображение'))), false);
    await page.locator('#spelling-issues button').filter({ hasText: /^helllo$/ }).nth(1).click();
    await page.getByRole('button', { name: 'Заменить на «hello»', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#spelling-issues button').length === 3);
    assert.equal(await page.evaluate(() => window.spellingWrites.length), 0);
    await page.locator('#spelling-close').click();
    await page.locator('#editor-undo').click();
    const bodyText = () => mode === 'blocks' ? page.locator('#block-content').textContent() : page.locator('#classic-surface iframe').contentFrame().locator('body').textContent();
    assert.match(await bodyText(), /helllo/);
    await page.locator('#editor-redo').click();
    assert.match(await bodyText(), /hello/);
    await page.locator('#check-spelling').click();
    await page.waitForFunction(() => document.querySelectorAll('#spelling-issues button').length === 3);
    await page.locator('#spelling-issues button').filter({ hasText: /^helllo$/ }).click();
    await page.getByRole('button', { name: 'Заменить на «hello»', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#spelling-issues button').length === 2);
    await page.locator('#spelling-language').selectOption('uk');
    await page.waitForFunction(() => window.spellingCalls.at(-1).language === 'uk');
    await page.locator('#spelling-issues button').filter({ hasText: /^привітт$/ }).click();
    await page.getByRole('button', { name: 'Заменить на «привіт»', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#spelling-issues button').length === 1);
    await page.locator('#spelling-issues button').first().click();
    await page.locator('#spelling-ignore').click();
    assert.equal(await page.locator('#spelling-issues button').count(), 0);
    await page.locator('#spelling-close').click();
    assert.equal(await page.locator('#edit-title').inputValue(), 'Заголовок hello');
    await page.locator('#save-note').click();
    await page.locator('#note-editor').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => window.spellingWrites[0]);
    assert.match(saved.content, /data-file-id="kept"/);
    assert.match(saved.content, /helllo code/);
    assert.match(saved.content, /text-align:\s*right/);
    assert.match(saved.content, /#c62828|rgb\(198, 40, 40\)/);
    assert.match(saved.content, /привіт/);
    console.log(`PASS ${mode}: mixed check, title/body fixes, inline ranges, undo/redo, language switch, ignore, HTML and media preservation`);
  }
};
