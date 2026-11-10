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
      window.__TAURI__.core.invoke = async (command, args) => command === 'get_note'
        ? { object_id: args.id, ver: 'v1', title: 'Видео', content, encrypted: false }
        : invoke(command, args);
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
  } finally {
    await page.unroute(`${embed}*`, route);
  }
};
