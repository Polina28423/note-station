const assert = require('node:assert/strict');

module.exports = async (page, base) => {
  await page.goto(base + '/');
  await page.locator('.account-open').first().click();
  await page.locator('#workspace').waitFor({state:'visible'});
  assert.equal(await page.locator('#show-notebooks').count(),0);
  await page.locator('#notebooks .notebook-row').first().waitFor();
  await page.locator('#toggle-notebooks').click();
  assert.equal(await page.locator('#notebooks').isVisible(),false);
  await page.locator('#toggle-notebooks').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#notebooks').isVisible(),true);
  assert.equal(await page.locator('header #open-settings').isVisible(), false);
  assert.equal(await page.locator('header #connection').isVisible(), false);
  assert.equal(await page.locator('header #session-state').count(), 0);
  for (const width of [1440, 900]) {
    await page.setViewportSize({width,height:600});
    const profile = page.locator('#profile-menu summary');
    await profile.click();
    await page.locator('#profile-settings').waitFor({state:'visible'});
    assert.equal(await page.locator('#session-state, #profile-connection').count(), 0);
    assert.equal(await page.locator('.profile-actions button svg').count(), 3);
    const bounds = await profile.boundingBox();
    assert(bounds.y + bounds.height <= 600, 'Profile must remain visible below the scrolling tree');
    const actions = await page.locator('.profile-actions').boundingBox();
    assert(actions.y >= 0 && actions.y + actions.height <= bounds.y + 1, 'Profile actions open above the footer');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#profile-menu').getAttribute('open'), null);
  }
  await page.locator('#profile-menu summary').click();
  await page.locator('#profile-settings').click();
  await page.locator('#app-settings').waitFor({state:'visible'});
  await page.keyboard.press('Escape');
  await page.locator('#profile-menu summary').click();
  await page.locator('#switch-account').click();
  await page.locator('#welcome-panel').waitFor({state:'visible'});
  console.log('PASS sidebar profile stays visible, menu opens upward, Escape, settings and account switching');
};
