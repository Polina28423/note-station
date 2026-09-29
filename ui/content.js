import { imagePreview, imageResources } from './images.js';
import { linkStrings } from './strings.js';
import { normalizeWebUrl } from './links.js';
import { normalizeColor, safeStyles } from './editor-styles.js';
// Only explicitly validated presentation values are copied; server handlers/resources are not.
const ALLOWED = new Set(['P','DIV','BR','H1','H2','H3','H4','H5','H6','STRONG','B','EM','I','U','S','STRIKE','DEL','UL','OL','LI','BLOCKQUOTE','PRE','CODE','HR','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','SUP','SUB','SPAN','MARK','FONT']);
const DROP = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','TEMPLATE','SVG','MATH','NOSCRIPT']);
export function safeNoteFragment(html, images) {
  const resources=images&&imageResources(images.note,images.load);
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = document.createDocumentFragment();
  let remaining = 50000;
  function copy(source, target, depth = 0) {
    for (const node of source.childNodes) {
      if (--remaining < 0 || depth > 80) return;
      if (node.nodeType === Node.TEXT_NODE) { target.append(document.createTextNode(node.textContent)); continue; }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = node.tagName.toUpperCase();
      if (tag === 'INPUT' && node.getAttribute('type') === 'checkbox') { target.append(document.createTextNode(node.hasAttribute('checked') ? '☑ ' : '☐ ')); continue; }
      if (DROP.has(tag)) continue;
      if (tag === 'IMG') {
        if(resources){target.append(imagePreview(node.outerHTML,resources.note,resources.load));continue;}
        if (node.getAttribute('alt')) target.append(document.createTextNode(`[${node.getAttribute('alt')}]`));
        continue;
      }
      if (tag === 'A') {
        const href = normalizeWebUrl(node.getAttribute('href'));
        if (href) {
          const link = document.createElement('a'); link.href = href; link.rel = 'noopener noreferrer'; link.title = linkStrings.openHint;
          for(const [key,value] of Object.entries(safeStyles(node.getAttribute('style'))))link.style.setProperty(key,value);
          copy(node, link, depth + 1); target.append(link);
        } else { copy(node, target, depth + 1); }
        continue;
      }
      if (ALLOWED.has(tag)) {
        const element = document.createElement(tag==='FONT'?'span':tag.toLowerCase());
        const styles=safeStyles(node.getAttribute('style'));
        if(tag==='FONT'){const color=normalizeColor(node.getAttribute('color'));if(color)styles.color=color;}
        for(const [key,value] of Object.entries(styles))element.style.setProperty(key,value);
        copy(node, element, depth + 1); target.append(element);
      } else { copy(node, target, depth + 1); }
    }
  }
  copy(template.content, fragment);
  return fragment;
}
export function htmlToText(html) {
  const fragment = safeNoteFragment(html);
  fragment.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
  fragment.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,blockquote').forEach(n => n.append('\n'));
  return (fragment.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}
