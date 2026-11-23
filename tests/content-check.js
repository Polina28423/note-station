import { safeNoteFragment, htmlToText } from '/content.js';
import { bindExternalLinks } from '/links.js';
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
 const linked=safeNoteFragment('<a href="https://example.org/path" target="_self" onclick="bad()">Сайт</a><a href="file:///C:/x">Файл</a><a href="javascript:bad()">Код</a>');
 check(linked.querySelectorAll('a').length===1&&linked.querySelector('a').getAttribute('href')==='https://example.org/path'&&!linked.querySelector('a').hasAttribute('onclick'),'reader preserves only validated website links');
 const videos = String.raw`<div><a href="https://www.youtube.com/watch?v=j8f6FeWdTYA&amp;t=30"><iframe src="https\://www\.youtube.com/embed/j8f6FeWdTYA"></iframe></a></div>
 <div><iframe src="https\://www\.youtube.com/embed/bi6oa7bC48Y" anchorhref="https://untrusted.invalid/">&nbsp;</iframe></div>`;
 fixture.replaceChildren(safeNoteFragment(videos));
 const videoLinks = [...fixture.querySelectorAll('a')];
 const watch = 'https://www.youtube.com/watch?v=';
 check(videoLinks.length === 2 && videoLinks[0].href === watch+'j8f6FeWdTYA&t=30' && videoLinks[1].href === watch+'bi6oa7bC48Y' && videoLinks.every(link=>link.textContent===link.href) && !fixture.querySelector('iframe,a a'),'wrapped and standalone YouTube embeds show one visible watch link each');
 let opened;
 const unbind = bindExternalLinks(fixture,url=>{opened=url;});
 videoLinks[1].click();unbind();
 check(opened===videoLinks[1].href && htmlToText(videos).includes(videoLinks[1].href),'YouTube URLs can be opened through the reader link handler and copied as text');
 const otherFrames = safeNoteFragment('<iframe src="https://youtube.com.untrusted.invalid/embed/j8f6FeWdTYA"></iframe><iframe src="https://www.youtube.com/embed/invalid" anchorhref="https://www.youtube.com/watch?v=j8f6FeWdTYA"></iframe>');
 check(!otherFrames.querySelector('iframe,a'),'invalid and unrelated embeds stay out of the reader');
 document.getElementById('results').textContent = checks.join('\n');
} catch(error) { document.getElementById('results').textContent = checks.join('\n') + '\nFAIL ' + error.message; }
