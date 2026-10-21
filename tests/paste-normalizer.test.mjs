import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizePastedHtml } from '../ui/paste-normalizer.js';
import { EditorDocument } from '../ui/editor-document.js';

test('website HTML becomes editable markup without site CSS or metadata',()=>{
  const source=readFileSync(new URL('./fixtures/paste-website.html',import.meta.url),'utf8'),result=normalizePastedHtml(source);
  assert.ok(result.includes('Заголовок статьи'));assert.equal((result.match(/href=/g)||[]).length,2);assert.equal((result.match(/<h1/g)||[]).length,2);
  for(const token of ['class=','id=','lang=','transition','quotes:','margin:','line-height:','Fira Sans','-webkit-'])assert.ok(!result.includes(token),token);
  assert.ok(result.includes('font-size:18pt'));assert.ok(result.includes('font-weight:500'));assert.ok(result.includes('font-family:sans-serif'));assert.ok(result.includes('text-align:left'));
  const document=new EditorDocument(result);assert.equal(document.fragments.size,0);assert.deepEqual(document.blocks.map(block=>block.type),['paragraph','paragraph','header','header']);
  assert.equal(normalizePastedHtml(result),result);
});
test('normalization preserves formatting, relative sizes, fallbacks and safe links',()=>{
  const result=normalizePastedHtml('<p data-pm-slice="0 0 []"><span style="font-size:2rem"><u><b id="ext-gen607" style="font-weight:700">Title</b></u><span style="font-size:50%;font-family:Unknown,Arial,serif">Small</span></span><a href="https://example.org/?a=1&amp;b=2" title="Link">Link</a><br>Next</p>');
  assert.ok(result.includes('font-size:24pt'));assert.ok(result.includes('font-size:12pt;font-family:Arial,serif'));assert.ok(result.includes('<u><b style="font-weight:700">Title</b></u>'));assert.ok(result.includes('href="https://example.org/?a=1&amp;b=2"'));assert.ok(result.includes('<br>Next'));assert.ok(!result.includes('ext-gen'));
  assert.equal(new EditorDocument(result).fragments.size,0);
});
test('scripts, active elements, unsafe URLs and CSS resource loads are removed',()=>{
  const result=normalizePastedHtml('<div onclick="bad()"><b class="site" style="background-image:url(https://bad.invalid);color:red">Safe</b><script>bad()</script><iframe src="https://bad.invalid"></iframe><svg onload="bad()"><text>Hidden</text></svg><a href="javascript:bad()">Text</a><img src="javascript:bad()" onerror="bad()"></div>');
  for(const token of ['onclick','class=','<script','iframe','<svg','javascript:','onerror','url(','Hidden'])assert.ok(!result.includes(token),token);
  assert.ok(result.includes('<b style="color:#ff0000">Safe</b>'));assert.ok(result.includes('Text'));
});
test('lists, tables, code, images and explicit blank lines survive normalization',()=>{
  const result=normalizePastedHtml('<ol start="3" type="A"><li><b>Item</b></li></ol><table class="site"><tr><td>A</td><td>B</td></tr></table><pre><code>  a\n b &lt; c</code></pre><div><br></div><p></p><img file_id="original-file" ref="reference" src="relative.png" alt="Image" width="40">');
  assert.ok(result.includes('<ol start="3" type="A">'));assert.ok(result.includes('<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>'));assert.ok(result.includes('  a\n b &lt; c'));assert.ok(result.includes('<div><br></div><p><br></p>'));assert.ok(result.includes('file_id="original-file"'));assert.ok(result.includes('ref="reference"'));
  assert.ok(normalizePastedHtml('<table><tr><td colspan="2">Merged</td></tr></table>').includes('colspan="2"'));
});
test('copied paragraphs inside lists, table cells and quotes remain editable',()=>{
  const html=normalizePastedHtml('<ul><li><p>One</p><p><b>Two</b></p></li></ul><table><tr><td><div><p>Cell</p><p>Next</p></div></td></tr></table><blockquote><p>Quote</p><p>Next</p></blockquote>');
  assert.ok(html.includes('<li>One<br><b>Two</b></li>'));assert.ok(html.includes('<td>Cell<br>Next</td>'));assert.ok(html.includes('<blockquote>Quote<br>Next</blockquote>'));assert.equal(new EditorDocument(html).fragments.size,0);
});
test('malformed HTML is repaired, empty artifacts are removed and excessive input is rejected',()=>{
  assert.equal(normalizePastedHtml('<div><b></b></div><a href="https://example.org"></a>'),'');
  assert.equal(normalizePastedHtml('<p><b>Text'),'<p><b>Text</b></p>');
  assert.throws(()=>normalizePastedHtml('x'.repeat(2*1024*1024+1)),/2 МБ/);
  assert.throws(()=>normalizePastedHtml('<div>'.repeat(90)+'Text'+'</div>'.repeat(90)),/сложный/);
});
