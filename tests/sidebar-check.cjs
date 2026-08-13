const assert = require('node:assert/strict');

module.exports = async (page, base) => {
  await page.goto(base + '/');
  await page.locator('.account-open').first().click();
  await page.locator('#workspace').waitFor({state:'visible'});
  for (const width of [1440, 900]) {
    await page.setViewportSize({width,height:600});
    const profile = page.locator('#profile-menu summary');
    await profile.click();
    await page.locator('#profile-settings').waitFor({state:'visible'});
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
