'use strict';
const { chromium }=require('playwright');
const { spawn }=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const root=path.resolve(__dirname,'../..');
async function main(){
  const server=spawn('python',['tests/serve-preview.py','--port','0'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let browser;
  try {
    const port=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Preview server did not start')),10000);
      server.stdout.on('data',chunk=>{const m=String(chunk).match(/PREVIEW_PORT=(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});
      server.on('error',reject);server.on('exit',code=>{if(code)reject(Error('Preview server exited: '+code));});
    });
    const executable=[process.env.EDITOR_TEST_BROWSER,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>p&&fs.existsSync(p));
    browser=await chromium.launch({headless:true,executablePath:executable,args:['--disable-background-networking']});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addInitScript(()=>{window.cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.cspViolations.push(e.violatedDirective));});
    await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/block-editor-check.html`);
    await page.waitForFunction(()=>window.testResult!==undefined,{},{timeout:60000});
    const result=await page.evaluate(()=>window.testResult);
    const csp=await page.evaluate(()=>window.cspViolations);
    console.log(JSON.stringify({...result,pageErrors:errors,cspViolations:csp},null,2));
    if(!result.ok||errors.length||csp.length)process.exitCode=1;
    // The existing classic-media regression page uses the same CSP and local assets.
    await page.goto(`http://127.0.0.1:${port}/editor-check.html`);
    await page.waitForFunction(()=>document.getElementById('results').textContent.split('PASS ').length>=9||document.getElementById('results').textContent.includes('FAIL'),{},{timeout:30000});
    const classic=await page.locator('#results').textContent();console.log(classic);
    if(classic.includes('FAIL'))process.exitCode=1;
    await page.goto(`http://127.0.0.1:${port}/content-check.html`);
    await page.waitForFunction(()=>document.getElementById('results').textContent.split('PASS ').length>=6||document.getElementById('results').textContent.includes('FAIL'));
    const content=await page.locator('#results').textContent();console.log(content);
    if(content.includes('FAIL'))process.exitCode=1;
    const appChecks=await require(path.join(root,'tests/app-editor-settings-check.cjs'))(page,`http://127.0.0.1:${port}`);
    console.log(`Application settings and auto-edit: ${appChecks.length} checks passed.`);
    await require(path.join(root,'tests/history-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/spelling-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/typography-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/links-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/settings-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/collections-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/sidebar-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/paste-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/editor-layout-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/enter-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/task-create-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/note-tags-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/inline-flow-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/images-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/note-html-check.cjs'))(page,`http://127.0.0.1:${port}`);
    await require(path.join(root,'tests/heading-import-check.cjs'))(page,`http://127.0.0.1:${port}`);
    if(errors.length){console.error(errors);process.exitCode=1;}
  } finally {await browser?.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
