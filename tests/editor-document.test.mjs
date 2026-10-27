import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EditorDocument, cleanInline, renderBlock } from '../ui/editor-document.js';
import { normalizeColor, safeStyles, safeInlineStyles, normalizeFontFamily, normalizeFontSize } from '../ui/editor-styles.js';
const load = html => { const doc=new EditorDocument(html);doc.bindBaseline(doc.blocks);return doc; };
const clone = value => structuredClone(value);

test('copied browser defaults in inline ADB text remain editable without changing commands or entities',()=>{
  const html=readFileSync(new URL('./fixtures/legacy-adb-note.html',import.meta.url),'utf8'),doc=load(html);
  assert.equal(doc.fragments.size,0);assert.equal(doc.blocks.length,4);assert.equal(doc.serialize(doc.blocks),html);
  const blocks=clone(doc.blocks),line=blocks.at(-1);assert.equal(line.type,'paragraph');
  assert.ok(line.data.text.includes('font-family:Verdana,Arial,Helvetica,sans-serif'));assert.ok(line.data.text.includes('font-size:12pt'));
  line.data.text=line.data.text.replace('целочисленная переменная','целочисленное значение');
  const output=doc.serialize(blocks);assert.ok(output.includes('--ei &lt;имя переменой&gt; &lt;значение&gt; -  целочисленное значение'));
  assert.ok(output.includes('broadcast&nbsp; -n "org.example.app/org.example.Receiver" --es name "John" --ei age 30'));
  assert.ok(!output.includes('display:'));assert.ok(!output.includes('orphans:'));assert.equal(load(output).fragments.size,0);
});

test('inline browser-default allowances do not admit layout changes or active CSS',()=>{
  assert.deepEqual(safeInlineStyles('display: inline !important; float: none; text-align:start;white-space:normal;color:#222222',true),{color:'#222222'});
  for(const style of ['display:none','float:left','white-space:pre','position:absolute','display:inline!important;background-image:url(https://example.org)','font-weight:bold!important'])assert.throws(()=>safeInlineStyles(style,true));
  for(const style of ['display:none','float:left','white-space:pre','position:absolute'])assert.equal(load(`<div><span style="${style}">Keep</span></div>`).blocks[0].type,'preserved');
});

test('clipboard metadata and legacy font-size classes preserve editable nested text',()=>{
  const html=readFileSync(new URL('./fixtures/legacy-clipboard-note.html',import.meta.url),'utf8'),doc=load(html);
  assert.equal(doc.fragments.size,0);assert.equal(doc.blocks.length,11);assert.equal(doc.serialize(doc.blocks),html);
  const blocks=clone(doc.blocks);blocks[0].data.text=blocks[0].data.text.replace('Сервис один','Первый сервис');
  const changed=doc.serialize(blocks);assert.ok(changed.includes('<span class="syno-fontsize-x-small"><b id="ext-gen607">Первый сервис</b></span>'));
  assert.ok(changed.includes('font-size:12pt'));assert.ok(!changed.includes('data-pm-slice'));assert.ok(!changed.includes('data-en-clipboard'));
  assert.deepEqual(changed.match(/href="[^"]+"/g),html.match(/href="[^"]+"/g));assert.equal(load(changed).fragments.size,0);
  assert.equal(load('<div data-pm-slice="0 0 []" data-en-clipboard="true">Text</div>').blocks[0].type,'paragraph');
});

test('clipboard allowances reject unrelated classes, malformed metadata and events',()=>{
  for(const markup of ['<span class="custom">Text</span>','<span class="syno-fontsize-x-small custom">Text</span>','<span class="syno-fontsize-unknown">Text</span>','<div data-pm-slice="bad">Text</div>','<div data-en-clipboard="bad">Text</div>','<div data-pm-slice="0 0 []" onclick="bad()">Text</div>'])assert.equal(load(markup).blocks[0].type,'preserved');
  assert.equal(cleanInline('<span class="custom" onclick="bad()">Text</span>'),'Text');
  assert.equal(cleanInline('<span class="syno-fontsize-x-small">Text</span>'),'<span class="syno-fontsize-x-small">Text</span>');
  const html='<div><a href="https://example.org/empty"></a></div><div><br></div><div>&nbsp;</div>';
  const doc=load(html);assert.equal(doc.blocks.length,2);assert.equal(doc.serialize(doc.blocks),html);
});

test('legacy generated inline IDs are editable and retained without adding invisible div blocks',()=>{
  const html=readFileSync(new URL('./fixtures/legacy-generated-note.html',import.meta.url),'utf8');
  const doc=load(html);assert.equal(doc.fragments.size,0);assert.equal(doc.blocks.length,9);assert.equal(doc.serialize(doc.blocks),html);
  const blocks=clone(doc.blocks),label=blocks.find(block=>block.data.text.includes('ext-gen514'));
  label.data.text=label.data.text.replace('Протокол взаимодействия','Обновлённый протокол взаимодействия');
  const output=doc.serialize(blocks);assert.ok(output.includes('<b id="ext-gen514">Обновлённый протокол взаимодействия'));assert.equal((output.match(/href=/g)||[]).length,5);assert.equal((output.match(/<div><b><\/b><\/div>/g)||[]).length,6);
  assert.equal(load(output).fragments.size,0);
});

test('only generated legacy IDs are accepted and visible blank lines remain editable',()=>{
  for(const id of ['save-note','ext-gen','ext-genbad','ext-gen514-extra'])assert.equal(load(`<div><b id="${id}">Label</b></div>`).blocks[0].type,'preserved');
  assert.equal(cleanInline('<b id="save-note">Label</b>'),'<b>Label</b>');
  const html='<div></div><div><b></b></div><div><br></div><div>&nbsp;</div><div><code></code></div><div><b>Text</b></div>';
  const doc=load(html);assert.equal(doc.blocks.length,4);assert.equal(doc.serialize(doc.blocks),html);
  assert.equal(load('<div></div><div><b></b></div>').blocks.length,0);
  const deep='<div>'+'<b>'.repeat(100)+'</b>'.repeat(100)+'</div>';
  const guarded=load(deep);assert.equal(guarded.blocks[0].type,'preserved');assert.equal(guarded.serialize(guarded.blocks),deep);
});

test('nested headings and styled bold labels import as editable text without protected cards',()=>{
  for(const label of ['<h3>Протокол взаимодействия:</h3>','<strong style="font-weight:700;font-size:12pt">Протокол взаимодействия:</strong>','<span style="font-weight:bold;font-style:italic;text-decoration:underline">Протокол взаимодействия:</span>']){
    const html=`<div>${label}</div><div><a href="https://example.org/protocol">Документ</a></div>`;
    const doc=load(html);assert.equal(doc.fragments.size,0);assert.equal(doc.serialize(doc.blocks),html);
    const blocks=clone(doc.blocks);blocks[0].data.text=blocks[0].data.text.replace('Протокол','Обновлённый протокол');
    const output=doc.serialize(blocks);assert.ok(output.includes('Обновлённый протокол'));assert.ok(output.endsWith('<div><a href="https://example.org/protocol">Документ</a></div>'));assert.equal(load(output).fragments.size,0);
    if(label.startsWith('<h3>'))assert.match(output,/<div><h3>Обновлённый протокол взаимодействия:<\/h3><\/div>/);
    else assert.match(output,/font-weight:(?:700|bold)/);
  }
});

test('presentation styles use finite values and reject resource loading and injected CSS',()=>{
  assert.deepEqual(safeStyles('font-weight:700;font-style:italic;text-decoration:underline line-through',true),{'font-weight':'700','font-style':'italic','text-decoration':'underline line-through'});
  for(const style of ['font-weight:url(https://example.org)','font-style:expression(bad())','text-decoration:underline url(x)','text-decoration:none underline','font-weight:bold!important','text-decoration:underline underline'])assert.throws(()=>safeStyles(style,true));
  const html=cleanInline('<div><h3 onclick="bad()" style="font-weight:bold">Safe</h3><script>bad()</script></div>');assert.equal(html,'<div><h3 style="font-weight:bold">Safe</h3></div>');
});

test('nested text containers retain line structure and links as editable content',()=>{
  const html='<div>Описание элементов<div><a href="https://composeunstyled.com">https://composeunstyled.com</a></div></div><div>Примеры</div><div><a href="https://github.com/android/compose-samples">Примеры Compose</a><div><a href="https://www.sinasamaki.com/pager-animations/">Анимации</a></div><div>Очень интересный сайт<div><a href="https://kotlinandroid.org/kotlin-android/">Kotlin Android</a></div></div></div>';
  const doc=load(html);assert.equal(doc.fragments.size,0);assert.equal(doc.blocks.length,3);assert.ok(doc.blocks.every(block=>block.type==='paragraph'));
  assert.equal(doc.serialize(doc.blocks),html);
  const blocks=clone(doc.blocks);blocks[2].data.text=blocks[2].data.text.replace('Очень интересный сайт','Полезный сайт');
  const changed=doc.serialize(blocks);assert.ok(changed.startsWith(html.slice(0,html.indexOf('<div><a href="https://github'))));assert.ok(changed.includes('<div>Полезный сайт<div><a href="https://kotlinandroid.org/kotlin-android/">Kotlin Android</a></div></div>'));
  assert.equal((changed.match(/href=/g)||[]).length,4);assert.ok(!changed.includes('<p><div>'));assert.equal(load(changed).fragments.size,0);
});

test('nested text container styling and explicit empty lines survive an edit',()=>{
  const html='<div><div style="text-align:right;color:red">Line</div><div><br></div><div><div>Last</div></div></div>';
  const doc=load(html);assert.equal(doc.fragments.size,0);assert.equal(doc.serialize(doc.blocks),html);
  const blocks=clone(doc.blocks);blocks[0].data.text=blocks[0].data.text.replace('Last','Edited');
  assert.match(doc.serialize(blocks),/<div style="text-align:right;color:#ff0000">Line<\/div><div><br><\/div><div><div>Edited<\/div><\/div>/);
  for(const source of ['<div><div class="custom">Text</div></div>','<div><div onclick="bad()">Text</div></div>','<div><div><iframe src="x"></iframe></div></div>'])assert.equal(load(source).blocks[0].type,'preserved');
});

test('standalone links and adjacent inline text are editable without splitting their flow',()=>{
  const html='<div><a href="https://example.org/one">First</a></div><div>Second</div><a href="https://example.org/three">Third</a>';
  const doc=load(html);assert.deepEqual(doc.blocks.map(block=>block.type),['paragraph','paragraph','paragraph']);
  assert.equal(doc.serialize(doc.blocks),html);
  const blocks=clone(doc.blocks);blocks[2].data.text+='<br>More text';
  assert.equal(doc.serialize(blocks),'<div><a href="https://example.org/one">First</a></div><div>Second</div><div><a href="https://example.org/three">Third</a><br>More text</div>');
  const flow=load('Before <a href="https://example.org">Link</a><br><b>After</b>');
  assert.equal(flow.blocks.length,1);assert.equal(flow.blocks[0].type,'paragraph');
  assert.match(flow.blocks[0].data.text,/Before <a.*Link<\/a><br><b>After<\/b>/);
  assert.equal(load('<span style="color:red">Styled</span>').blocks[0].type,'paragraph');
  const styled=load('<p><a href="https://example.org" style="color:red;font-size:14pt">Styled link</a></p>');
  assert.equal(styled.blocks[0].type,'paragraph');
  assert.match(styled.blocks[0].data.text,/<a.*<span style="color:#ff0000;font-size:14pt">Styled link<\/span><\/a>/);
});
test('standalone unsafe links, special attributes and inline attachments stay protected',()=>{
  for(const html of ['<a href="javascript:alert(1)">Link</a>','<a href="https://example.org" onclick="bad()">Link</a>','<a href="https://example.org"><img src="attachment.png"></a>']){
    const doc=load(html);assert.equal(doc.blocks[0].type,'preserved');assert.equal(doc.serialize(doc.blocks),html);
  }
});

test('editing a div line retains div layout instead of adding paragraph margins',()=>{
  const doc=load('<div>Before</div><div><br></div><div>Next</div>');
  const blocks=clone(doc.blocks);blocks[0].data.text='After';
  assert.equal(doc.serialize(blocks),'<div>After</div><div><br></div><div>Next</div>');
});

test('unchanged HTML, whitespace and comments are retained byte-for-byte',()=>{
  const html='<!-- metadata -->\r\n<P>Text &amp; <b>bold</b></P>\n<p></p>\r\n';
  const doc=load(html);assert.equal(doc.serialize(doc.blocks),html);
});
test('editing one block retains unrelated raw markup and complex attachments exactly',()=>{
  const raw='<div data-source="synology"><img file_id="legacy" src="relative.png"><embed src="x.pdf"></div>';
  const html='<p>Before</p>\n'+raw+'\n<p style="color: red">Styled</p>';
  const doc=load(html),blocks=clone(doc.blocks);blocks[0].data.text='Changed <b>text</b>';
  assert.equal(doc.serialize(blocks),'<p>Changed <b>text</b></p>\n'+raw+'\n<p style="color: red">Styled</p>');
});
test('merged cells, attributes and mixed nested list types remain protected',()=>{
  for(const html of ['<table><tr><td colspan="2">x</td></tr></table>','<p class="synology">x</p>','<ul><li>A<ol><li>B</li></ol></li></ul>']) {
    const doc=load(html);assert.equal(doc.blocks[0].type,'preserved');assert.equal(doc.serialize(doc.blocks),html);
  }
});
test('plain nested lists and ordered counters are imported',()=>{
  const doc=load('<ol start="3" type="A"><li>One<ol><li>Nested</li></ol></li><li>Two</li></ol>');
  assert.equal(doc.blocks[0].type,'list');assert.equal(doc.blocks[0].data.meta.start,3);assert.equal(doc.blocks[0].data.meta.counterType,'upper-alpha');
  assert.equal(doc.blocks[0].data.items[0].items[0].content,'Nested');
});
test('plain tables preserve headings and can be exported after edits',()=>{
  const doc=load('<table><tr><th>Name</th><th>Count</th></tr><tr><td>A</td><td>1</td></tr></table>');
  assert.equal(doc.blocks[0].type,'table');assert.equal(doc.blocks[0].data.withHeadings,true);
  const blocks=clone(doc.blocks);blocks[0].data.content[1][1]='2';
  assert.match(doc.serialize(blocks),/<th>Name<\/th>/);assert.match(doc.serialize(blocks),/<td>2<\/td>/);
});
test('checklist checked states survive export and reimport',()=>{
  const html=renderBlock({type:'list',data:{style:'checklist',meta:{},items:[{content:'Done',meta:{checked:true},items:[]},{content:'Later',meta:{checked:false},items:[]}]}});
  const doc=load(html);assert.equal(doc.blocks[0].type,'list');assert.equal(doc.blocks[0].data.style,'checklist');
  assert.deepEqual(doc.blocks[0].data.items.map(i=>i.meta.checked),[true,false]);
});
test('protected fragments require explicit deletion consent',()=>{
  const doc=load('<p>Hello</p><img src="relative.png" file_id="a">'),blocks=[doc.blocks[0]];
  assert.throws(()=>doc.serialize(blocks),/Подтвердите/);
  assert.equal(doc.serialize(blocks,doc.missingProtected(blocks)),'<p>Hello</p>');
});
test('forged and duplicated fragment references block saving',()=>{
  const doc=load('<img src="relative.png">');
  assert.throws(()=>doc.serialize([...doc.blocks,{...doc.blocks[0],id:'copy'}]),/продублирован/);
  assert.throws(()=>doc.serialize([{id:'unknown',type:'preserved',data:{key:'forged'}}]),/Повреждён/);
});
test('unknown tools, duplicate IDs and invalid data cannot silently disappear',()=>{
  const doc=load('<p>x</p>');
  assert.throws(()=>doc.serialize([{id:'new',type:'unregistered',data:{}}]),/Неизвестный/);
  assert.throws(()=>doc.serialize([doc.blocks[0],doc.blocks[0]]),/структура/);
  assert.throws(()=>renderBlock({type:'table',data:{content:[['one'],['two','three']]}}),/таблица/);
});
test('initial editor normalization must not omit imported blocks',()=>{
  const doc=new EditorDocument('<p>one</p><p>two</p>');
  assert.throws(()=>doc.bindBaseline([doc.blocks[0]]),/пропустил/);
});
test('new inline HTML removes scripts, event handlers and unsafe URLs',()=>{
  const clean=cleanInline('<b onclick="bad()">OK</b><script>bad()</script><a href="javascript:bad()">No</a><img src="https://bad.invalid">');
  assert.equal(clean,'<b>OK</b>No');
  assert.equal(cleanInline('<a href="https://example.org" title="A">Link</a>'),'<a href="https://example.org" title="A">Link</a>');
});
test('special inline attributes remain protected on import',()=>{
  const doc=load('<p><a href="javascript:bad()">A</a></p><p><span style="font-family:UnknownCustomFont;color:red">B</span></p>');
  assert.deepEqual(doc.blocks.map(b=>b.type),['preserved','preserved']);
});
test('code contents are escaped when edited',()=>{
  const doc=load('<pre><code>&lt;script&gt;x&lt;/script&gt;</code></pre>'),blocks=clone(doc.blocks);
  assert.equal(blocks[0].type,'code');blocks[0].data.code='<img src=x>';
  assert.equal(doc.serialize(blocks),'<pre><code>&lt;img src=x&gt;</code></pre>');
});
test('reordering supported blocks keeps their original spelling',()=>{
  const doc=load('<P>one</P><h2>two</h2>');assert.equal(doc.serialize([...doc.blocks].reverse()),'<h2>two</h2><P>one</P>');
});
test('parser repairs and incomplete elements preserve the whole original',()=>{
  const html='<p>x</p><img src="unfinished';const doc=load(html);
  assert.equal(doc.blocks[0].type,'preserved');assert.equal(doc.serialize(doc.blocks),html);
});
test('empty documents can accept new paragraphs without a source dependency',()=>{
  const doc=load(' \n');assert.equal(doc.serialize(doc.blocks),' \n');
  assert.equal(doc.serialize([{id:'new',type:'paragraph',data:{text:'New'}}]),'<p>New</p> \n');
});
test('new quotes with captions and alignment can be reopened as editable quotes',()=>{
  const data={text:'Quote',caption:'Author',alignment:'center'};
  const doc=load(renderBlock({type:'quote',data}));
  assert.equal(doc.blocks[0].type,'quote');assert.deepEqual(doc.blocks[0].data,data);
});
test('large notes are preserved as one protected fragment instead of flooding the editor',()=>{
  const html='<p>'+ 'x'.repeat(1024*1024)+'</p>',doc=load(html);
  assert.equal(doc.blocks.length,1);assert.equal(doc.blocks[0].type,'preserved');assert.equal(doc.serialize(doc.blocks),html);
});
test('underline and strike markup are editable and survive HTML round-trip',()=>{
  const doc=load('<p><u>Underlined</u> <strike>Removed</strike></p>');
  assert.equal(doc.blocks[0].type,'paragraph');
  const blocks=clone(doc.blocks);blocks[0].data.text+='<i> italic</i>';
  const html=doc.serialize(blocks);assert.match(html,/<u>Underlined<\/u>/);assert.match(html,/<strike>Removed<\/strike>/);
  assert.equal(load(html).blocks[0].type,'paragraph');
});

test('validated colors reject CSS functions, malformed channels and resource URLs',()=>{
  assert.equal(normalizeColor('#abc'),'#aabbcc');assert.equal(normalizeColor('rgb(18, 52, 86)'),'#123456');
  assert.equal(normalizeColor('rgba(0,0,0,0)'),'rgba(0,0,0,0)');
  for(const value of ['url(https://bad.invalid)','var(--color)','rgb(300,0,0)','rgba(1,2,3,2)','red;position:fixed'])assert.equal(normalizeColor(value),'');
  assert.deepEqual(safeStyles('color:red;background-image:url(https://bad.invalid);text-align:right'),{color:'#ff0000','text-align':'right'});
  assert.throws(()=>safeStyles('position:fixed',true));
});
test('all alignments survive edited block export and reimport',()=>{
  for(const type of ['paragraph','header','quote','list','table'])for(const alignment of ['left','center','right','justify']){
    const data={paragraph:{text:'Text'},header:{text:'Title',level:2},quote:{text:'Quote',caption:'Author',alignment:'left'},list:{style:'unordered',meta:{},items:[{content:'Item',meta:{},items:[]}]},table:{content:[['Cell']],withHeadings:false}}[type];
    const html=renderBlock({type,data,tunes:{alignment:{alignment}}}),doc=load(html);
    assert.equal(doc.blocks[0].type,type);assert.equal(doc.blocks[0].tunes?.alignment.alignment || 'left',alignment);
  }
});
test('text and background colors remain editable and survive changed HTML',()=>{
  const doc=load('<p style="color:red;text-align:right"><span style="background-color:#fff2a8">Color</span></p>');
  assert.equal(doc.blocks[0].type,'paragraph');assert.equal(doc.blocks[0].tunes.alignment.alignment,'right');
  const blocks=clone(doc.blocks);blocks[0].data.text+=' more';
  const html=doc.serialize(blocks);assert.match(html,/color:#ff0000/);assert.match(html,/background-color:#fff2a8/);assert.match(html,/text-align:right/);
  assert.equal(load(html).blocks[0].type,'paragraph');
  const clean=cleanInline('<span style="color:#123456;background-color:yellow;background-image:url(https://bad.invalid);position:fixed">Safe</span>');
  assert.equal(clean,'<span style="color:#123456;background-color:#ffff00">Safe</span>');
});

test('font styles reject CSS injection and preserve safe family and point sizes',()=>{
  assert.equal(normalizeFontFamily('"Times New Roman", serif'),'Times New Roman,serif');
  assert.equal(normalizeFontSize('32px'),'24pt');
  for(const value of ['url(https://bad.invalid)','Arial;position:fixed','UnknownFont','Arial" onmouseover="bad'])assert.equal(normalizeFontFamily(value),'');
  for(const value of ['0pt','999px','calc(12pt)','12em','url(x)','14'])assert.equal(normalizeFontSize(value),'');
  assert.equal(cleanInline('<span style="font-family:Georgia;font-size:24pt">Text</span>'),'<span style="font-family:Georgia;font-size:24pt">Text</span>');
  for(const type of ['paragraph','header','quote','list','table']){
    const html='<span style="font-family:Georgia;font-size:24pt">Text</span>';
    const data={paragraph:{text:html},header:{text:html,level:2},quote:{text:html,caption:'',alignment:'left'},list:{style:'unordered',meta:{},items:[{content:html,meta:{},items:[]}]},table:{content:[[html]],withHeadings:false}}[type];
    assert.match(renderBlock({type,data}),/font-family:Georgia;font-size:24pt/);
  }
});
