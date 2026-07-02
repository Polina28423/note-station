// Server attributes and active elements are never copied into the live document.
const ALLOWED = new Set(['P','DIV','BR','H1','H2','H3','H4','H5','H6','STRONG','B','EM','I','U','S','DEL','UL','OL','LI','BLOCKQUOTE','PRE','CODE','HR','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','SUP','SUB']);
const DROP = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','TEMPLATE','SVG','MATH','NOSCRIPT']);
export function safeNoteFragment(html) {
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
      if (DROP.has(tag)) continue;
      if (tag === 'IMG') {
        if (node.getAttribute('alt')) target.append(document.createTextNode(`[${node.getAttribute('alt')}]`));
        continue;
      }
      if (ALLOWED.has(tag)) {
        const element = document.createElement(tag.toLowerCase());
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
