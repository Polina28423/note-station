import { safeNoteFragment, htmlToText } from '/content.js';
const fixture = document.getElementById('fixture');
const checks = [];
function check(value, name) { if (!value) throw Error(name); checks.push('PASS ' + name); }
try {
 fixture.replaceChildren(safeNoteFragment('<h2 onclick="alert(1)" style="color:red">Заголовок</h2><p>Текст <b>жирный</b></p><table><tr><td colspan="99">Ячейка</td></tr></table><script>window.compromised=true</script><img src="https://untrusted.invalid/pixel" onerror="alert(1)"><iframe src="https://untrusted.invalid"></iframe><a href="javascript:alert(1)">Ссылка</a><svg onload="alert(1)"><text>SVG</text></svg><custom-element>Текст</custom-element>'));
 check(fixture.querySelectorAll('script,img,iframe,svg,custom-element,a').length === 0,'active elements and external resources removed');
 check([...fixture.querySelectorAll('*')].every(n => [...n.attributes].every(a=>a.name==='style')),'only validated presentation attributes are retained');
 check(getComputedStyle(fixture.querySelector('h2')).color==='rgb(255, 0, 0)','safe text colors are visible in the reader');
 check(fixture.querySelector('h2')?.textContent === 'Заголовок' && fixture.querySelector('b')?.textContent === 'жирный' && !!fixture.querySelector('table td'),'headings, emphasis and tables preserved');
 check(fixture.textContent.includes('Ссылка') && !fixture.textContent.includes('compromised'),'safe link text retained, script text discarded');
 check(htmlToText('<p>Один</p><p>Два<br>Три</p>') === 'Один\nДва\nТри','copy text preserves line breaks');
 const styled=safeNoteFragment('<p style="text-align:right;background-image:url(https://untrusted.invalid);color:#123456">Color</p><span style="background-color:#fff2a8;position:fixed">Highlight</span>');
 check(styled.querySelector('p').style.textAlign==='right'&&!styled.querySelector('p').style.backgroundImage&&!styled.querySelector('span').style.position&&!!styled.querySelector('span').style.backgroundColor,'reader keeps alignment and background color while dropping resource-loading CSS');
 document.getElementById('results').textContent = checks.join('\n');
} catch(error) { document.getElementById('results').textContent = checks.join('\n') + '\nFAIL ' + error.message; }
