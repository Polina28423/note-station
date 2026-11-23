const assert = require('node:assert/strict');

module.exports = async (page, base) => {
  for (const mode of ['blocks', 'classic']) {
    await page.goto(base + '/');
    await page.locator('.account-open').first().click();
    await page.evaluate(() => {
      const call = window.__TAURI__.core.invoke;
      window.tableWrites = [];
      window.__TAURI__.core.invoke = async (command, args) => {
        if (command === 'get_note') return { object_id: args.id, ver: 'v1', title: 'Таблица', content: '<div>Описание заметки</div>', encrypted: false };
        if (command === 'save_note') {
          window.tableWrites.push(args.content);
          return { note: { object_id: args.id, ver: 'v2', title: args.title, content: args.content, encrypted: false } };
        }
        return call(command, args);
      };
    });
    await page.locator('#profile-menu summary').click();
    await page.locator('#profile-settings').click();
    await page.locator('#editor-mode').selectOption(mode);
    await page.locator('#apply-settings').click();
    await page.locator('#notes .note-row').first().click();
    await page.locator('#note-content').getByText('Описание заметки').click();
    await page.waitForFunction(() => !document.getElementById('editor-table').disabled);
    const toolbar = page.locator('#editor-table');
    await toolbar.click();
    const insert = page.getByRole('dialog', { name: 'Вставить таблицу' });
    await insert.getByRole('spinbutton', { name: 'Строки' }).fill('51');
    await insert.getByRole('button', { name: 'Вставить таблицу' }).click();
    await insert.getByRole('status').getByText(/от 1 до 50/).waitFor();
    await insert.getByRole('spinbutton', { name: 'Строки' }).fill('3');
    await insert.getByRole('spinbutton', { name: 'Столбцы' }).fill('2');
    await insert.getByRole('checkbox').check();
    await insert.getByRole('button', { name: 'Вставить таблицу' }).click();
    await insert.waitFor({ state: 'hidden' });
    const root = mode === 'blocks' ? page.locator('#block-content') : page.frameLocator('#edit-content_ifr');
    const rows = root.locator(mode === 'blocks' ? '.tc-row' : 'table tr');
    const cells = root.locator(mode === 'blocks' ? '.tc-cell' : 'table td,table th');
    assert.equal(await rows.count(), 3);
    assert.equal(await cells.count(), 6);
    await cells.first().click();
    await page.keyboard.type('Name');
    const run = async (index, name) => {
      await cells.nth(index).click();
      await toolbar.click();
      const dialog = page.getByRole('dialog', { name: 'Таблица', exact: true });
      await dialog.getByRole('button', { name }).click();
      await Promise.race([
        dialog.waitFor({ state: 'hidden' }),
        dialog.getByRole('status').waitFor().then(async () => assert.fail(`${mode} ${name}: ${await dialog.getByRole('status').textContent()}`)),
      ]);
    };
    await run(0, 'Добавить строку ниже');
    assert.equal(await rows.count(), 4);
    await run(0, 'Добавить столбец справа');
    assert.equal(await cells.count(), 12);
    await run(3, 'Удалить строку');
    await run(1, 'Удалить столбец');
    assert.equal(await cells.count(), 6);
    assert.equal((await cells.first().textContent()).trim(), 'Name');
    await run(0, 'Удалить таблицу');
    assert.equal(await cells.count(), 0);
    await page.locator('#editor-undo').click();
    await cells.first().waitFor();
    assert.equal(await cells.count(), 6);
    await page.locator('#editor-redo').click();
    await cells.first().waitFor({ state: 'detached' });
    await page.locator('#editor-undo').click();
    await cells.first().waitFor();
    await page.locator('#save-note').click();
    await page.locator('#note-editor').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#note-content table th').count(), 2);
    assert.equal((await page.locator('#note-content table th').first().textContent()).trim(), 'Name');
    const saved = await page.evaluate(async () => {
      const { EditorDocument } = await import('/editor-document.js');
      const html = window.tableWrites.at(-1);
      return { text: html.includes('Описание заметки'), tables: new EditorDocument(html).blocks.filter(block => block.type === 'table').length };
    });
    assert.deepEqual(saved, { text: true, tables: 1 }, await page.evaluate(() => window.tableWrites.at(-1)));
    console.log(`PASS table ${mode}: insertion, headers, cells, row/column operations, Undo/Redo and interoperable HTML`);
  }
};
