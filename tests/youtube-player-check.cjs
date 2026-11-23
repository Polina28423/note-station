const assert = require('node:assert/strict');

module.exports = async (page, base) => {
  const embed = 'https://www.youtube-nocookie.com/embed/';
  const ids = ['j8f6FeWdTYA', 'bi6oa7bC48Y'];
  const requests = [];
  const route = async requestRoute => {
    const request = requestRoute.request();
    requests.push({ url: request.url(), referer: request.headers().referer });
    await requestRoute.fulfill({ contentType: 'text/html; charset=utf-8', body: '<button>Воспроизвести</button>' });
  };
  await page.route(`${embed}*`, route);
  try {
    await page.goto(base + '/');
    await page.locator('.account-open').first().click();
    await page.evaluate(([first, second]) => {
      const invoke = window.__TAURI__.core.invoke;
      const content = `<div>Описание</div><div><a href="https://www.youtube.com/watch?v=${first}"><iframe src="https://www.youtube.com/embed/${first}"></iframe></a></div><div><iframe src="https://www.youtube.com/embed/${second}"></iframe></div><iframe src="https://example.org/embed/${second}"></iframe>`;
      window.videoWrites = [];
      window.__TAURI__.core.invoke = async (command, args) => {
        const note = { object_id: args?.id, ver: 'v1', title: 'Видео', content, encrypted: false };
        if (command === 'get_note') return note;
        if (command === 'save_note') {
          window.videoWrites.push(args.content);
          return { note: { ...note, ver: 'v2', content: args.content } };
        }
        return invoke(command, args);
      };
    }, ids);
    await page.locator('#notes .note-row').first().click();
    const players = page.locator('#note-content .note-video iframe');
    await players.first().waitFor();
    assert.deepEqual(await players.evaluateAll(frames => frames.map(frame => frame.src)), ids.map(id => embed + id));
    assert.equal(await page.locator('#note-content iframe').count(), 2);
    assert.equal(await page.locator('#note-content .note-video > a').count(), 2);
    assert.equal(await players.first().getAttribute('sandbox'), 'allow-scripts allow-same-origin');
    const controls = page.frameLocator('#note-content .note-video iframe').first().getByRole('button', { name: 'Воспроизвести' });
    await controls.click();
    assert.equal(await page.locator('#note-editor').isVisible(), false);
    assert.ok(requests.some(request => request.url === embed + ids[0] && request.referer === base + '/'));
    assert.deepEqual(await page.evaluate(() => window.cspViolations), []);

    await page.getByText('Описание', { exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.note-video iframe').hasAttribute('src'));
    await page.waitForFunction(() => !document.getElementById('paste-plain').disabled);
    await page.locator('#cancel-edit').click();
    await page.locator('#reader-document').waitFor();
    await controls.waitFor();
    console.log('PASS YouTube player blocks, reader controls, fallback links, CSP, referrer and playback cleanup');

    for (const mode of ['blocks', 'classic']) {
      await page.locator('#profile-menu summary').click();
      await page.locator('#profile-settings').click();
      await page.locator('#editor-mode').selectOption(mode);
      await page.locator('#apply-settings').click();
      await page.locator('#note-content').getByText('Описание', { exact: true }).click();
      await page.waitForFunction(() => !document.getElementById('paste-plain').disabled);
      const root = mode === 'blocks' ? page.locator('#block-content') : page.frameLocator('#edit-content_ifr');
      const videos = root.locator('.video-edit-block');
      assert.equal(await videos.count(), 2);
      const video = videos.first();
      await video.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
      await video.frameLocator('iframe').getByRole('button', { name: 'Воспроизвести' }).waitFor();
      await video.getByRole('button', { name: 'Ссылка', exact: true }).click();
      assert.equal(await video.locator('iframe').count(), 0);
      assert.equal(await page.locator('#save-note').isDisabled(), true);
      await video.getByRole('button', { name: 'Изменить ссылку', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Изменить ссылку' });
      const input = dialog.getByRole('textbox', { name: 'Адрес ролика YouTube' });
      await input.fill('https://example.org/');
      await input.press('Enter');
      await dialog.getByText('Укажите ссылку на ролик YouTube.').waitFor();
      const newId = mode === 'blocks' ? 'abcdefghijk' : 'ABCDEFGHIJK';
      await input.fill(`https://youtu.be/${newId}`);
      await input.press('Enter');
      await video.getByRole('link', { name: `https://www.youtube.com/watch?v=${newId}` }).waitFor();
      await page.locator('#editor-undo').click();
      const oldId = mode === 'blocks' ? ids[0] : 'abcdefghijk';
      await video.getByRole('link', { name: `https://www.youtube.com/watch?v=${oldId}` }).waitFor();
      await page.locator('#editor-redo').click();
      await video.getByRole('link', { name: `https://www.youtube.com/watch?v=${newId}` }).waitFor();
      await page.locator('#save-note').click();
      await page.locator('#note-editor').waitFor({ state: 'hidden' });
      const saved = await page.evaluate(() => window.videoWrites.at(-1));
      assert.ok(saved.includes(`/embed/${newId}`) && saved.includes(`/embed/${ids[1]}`));
      assert.ok(saved.includes('Описание') && saved.includes('https://example.org/embed/'));
      assert.ok(!saved.includes('video-edit-block') && !saved.includes('data-note-protected'));
      assert.ok((await players.first().getAttribute('src')).endsWith(newId));
      console.log(`PASS YouTube editor ${mode}: view toggle, URL editing and validation, undo/redo and save`);
    }
  } finally {
    await page.unroute(`${embed}*`, route);
  }
};
