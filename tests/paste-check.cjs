const assert = require('node:assert/strict');
module.exports = async (page, base) => {
  for (const mode of ['blocks','classic']) {
    await page.goto(base + '/');
    await page.locator('.account-open').first().click();
    await page.locator('#notes .note-row').first().click();
    await page.locator('#note-content p').first().waitFor();
    await page.locator('#profile-menu summary').click();
    await page.locator('#profile-settings').click();
    await page.locator('#editor-mode').selectOption(mode);
    await page.locator('#apply-settings').click();
    await page.locator('#note-content p').first().click();
    await page.waitForFunction(()=>!document.getElementById('paste-plain').disabled);
    const paste = () => page.evaluate(mode => {
      const root = mode==='blocks' ? document.querySelector('#block-content .ce-paragraph') : window.tinymce.get('edit-content').getBody().querySelector('p');
      if(mode==='classic')window.tinymce.get('edit-content').focus();else root.focus();
      const doc=root.ownerDocument, range=doc.createRange();range.selectNodeContents(root);
      const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);
      const data=new DataTransfer();data.setData('text/plain','Plain <text>\nSecond line');data.setData('text/html','<p><b style="color:red">Formatted source</b></p>');
      const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});
      root.dispatchEvent(event);
      return {prevented:event.defaultPrevented,html:root.innerHTML,text:root.textContent};
    },mode);
    await page.locator('#paste-plain').click();
    assert.equal(await page.locator('#paste-plain').getAttribute('aria-pressed'),'true');
    const result=await paste();assert.equal(result.prevented,true);
    assert.ok(result.text.includes('Plain <text>'));
    assert.ok(!result.html.includes('Formatted source')&&!result.html.includes('color:red'));
    assert.ok(result.html.includes('<br')||result.html.includes('\n'));
    const bodyText=()=>page.evaluate(mode=>mode==='blocks'?document.getElementById('block-content').textContent:window.tinymce.get('edit-content').getBody().textContent,mode);
    await page.waitForTimeout(450);
    await page.locator('#editor-undo').click();
    assert.ok(!(await bodyText()).includes('Plain <text>'));
    await page.locator('#editor-redo').click();
    assert.ok((await bodyText()).includes('Plain <text>'));
    await page.locator('#paste-plain').click();
    assert.equal(await page.locator('#paste-plain').getAttribute('aria-pressed'),'false');
    await paste();
    await page.waitForFunction(mode=>{
      const root=mode==='blocks'?document.getElementById('block-content'):window.tinymce.get('edit-content').getBody();
      return [...root.querySelectorAll('b,strong')].some(el=>el.textContent.includes('Formatted source'));
    },mode);
    console.log(`PASS ${mode}: plain text paste, escaped text, toggle, undo/redo and formatted paste`);
  }
};
