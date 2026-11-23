const assert = require('node:assert/strict');

module.exports = async (page, base) => {
  const key = 'note-station.activity.v1:' + JSON.stringify(['https://preview.invalid:5001', 'Александр']);
  const title = page.locator('#note-title');
  const frequent = page.locator('#show-frequent-notes');
  const notebook = page.locator('#notebooks').getByRole('button', { name: /Рабочие проекты/ });
  const rows = page.locator('#notes .note-row-title');
  async function connect() {
    await page.locator('.account-open').first().click();
    await page.waitForFunction(() => !document.getElementById('workspace').hidden && !document.getElementById('refresh').disabled);
  }
  async function open(name) {
    await page.locator('#notes').getByText(name, { exact: true }).click();
    await title.filter({ hasText: name }).waitFor();
  }

  await page.goto(base + '/?scenario=note-activity');
  await page.evaluate(key => {
    localStorage.removeItem(key);
    sessionStorage.removeItem('note-station-editor-fixture');
  }, key);
  await page.reload();
  await connect();
  await frequent.click();
  await page.getByText('Пока нет открытых заметок', { exact: true }).waitFor();
  await notebook.click();
  const first = 'План проекта на ноябрь', second = 'Заметки со встречи', third = 'Полезные материалы';
  await open(first);
  await open(second);
  await open(first);
  await open(third);
  await frequent.click();
  await page.locator('#list-title').filter({ hasText: 'Часто открываемые заметки' }).waitFor();
  assert.deepEqual(await rows.allTextContents(), [first, third, second]);
  assert.equal(await frequent.getAttribute('aria-pressed'), 'true');
  await page.locator('#search').fill('со встречи');
  assert.deepEqual(await rows.allTextContents(), [second]);

  const last = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  await page.reload();
  await connect();
  await title.filter({ hasText: third }).waitFor();
  assert.equal(await notebook.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#notes .note-row.selected .note-row-title').textContent(), third);
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key), last);

  await page.evaluate(key => {
    const activity = JSON.parse(localStorage.getItem(key));
    activity.noteId = 'missing-note';
    activity.opened.unshift({ id: 'missing-note', count: 40 });
    localStorage.setItem(key, JSON.stringify(activity));
  }, key);
  await page.reload();
  await connect();
  assert.equal(await notebook.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#reader-empty').isVisible(), true);
  await frequent.click();
  assert.deepEqual(await rows.allTextContents(), [first, third, second]);

  await page.locator('#profile-menu summary').click();
  await page.locator('#switch-account').click();
  await page.locator('#add-account').click();
  await page.locator('#server').fill('https://preview.invalid:5001');
  await page.locator('#account').fill('Другой пользователь');
  await page.locator('#password').fill('fixture');
  await page.locator('#remember-session').uncheck();
  await page.locator('#connect').click();
  await page.waitForFunction(() => !document.getElementById('workspace').hidden && !document.getElementById('refresh').disabled);
  assert.equal(await page.locator('#reader-empty').isVisible(), true);
  await frequent.click();
  await page.getByText('Пока нет открытых заметок', { exact: true }).waitFor();
  console.log('PASS frequent notes, ranking and search, last notebook and note restoration, unavailable notes and account isolation');
};
