import { linkStrings as strings } from './strings.js';

export function normalizeWebUrl(value, allowBare = false) {
  if (typeof value !== 'string') return '';
  value = value.trim();
  if (!value || value.length > 8192 || /[\s\u0000-\u001f\u007f]/u.test(value)) return '';
  if (allowBare && !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('/')) value = 'https://' + value;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function bindExternalLinks(root, open, status = () => {}) {
  let opening = false;
  const follow = async link => {
    const url = normalizeWebUrl(link.getAttribute('href'));
    if (!url) { status(strings.invalid, true); return; }
    if (opening) return;
    opening = true;
    try { await open(url); }
    catch { status(strings.openFailed, true); }
    finally { opening = false; }
  };
  const click = event => {
    const link = event.target.closest?.('a[href]');
    if (!link || !root.contains(link)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.type === 'auxclick' && event.button !== 1) return;
    if (event.shiftKey || (event.detail !== 0 && root.ownerDocument.getSelection()?.toString())) return;
    follow(link);
  };
  const keydown = event => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    const selection = root.ownerDocument.getSelection();
    const node = selection?.anchorNode;
    const link = (node?.nodeType === 1 ? node : node?.parentElement)?.closest('a[href]');
    if (!link || !root.contains(link)) return;
    event.preventDefault(); event.stopImmediatePropagation(); follow(link);
  };
  root.addEventListener('click', click, true);
  root.addEventListener('auxclick', click, true);
  root.addEventListener('keydown', keydown, true);
  return () => {
    root.removeEventListener('click', click, true);
    root.removeEventListener('auxclick', click, true);
    root.removeEventListener('keydown', keydown, true);
  };
}

export function updateLink(range, href, text, existing) {
  const url = normalizeWebUrl(href);
  if (!url || !text.trim()) return false;
  const doc = range.startContainer.ownerDocument;
  let link = existing;
  if (link) {
    link.setAttribute('href', url);
    if (text !== link.textContent) link.textContent = text;
  } else {
    link = doc.createElement('a'); link.setAttribute('href', url);
    if (!range.collapsed && range.toString() === text) {
      const fragment = range.extractContents();
      for (const nested of fragment.querySelectorAll('a')) nested.replaceWith(...nested.childNodes);
      link.append(fragment);
    } else { range.deleteContents(); link.textContent = text; }
    range.insertNode(link);
  }
  range.selectNodeContents(link);
  const selection = doc.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  return true;
}
