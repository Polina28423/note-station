import { normalizeWebUrl } from './links.js';
import { parseFragment } from './vendor/editorjs/html-parser.js';

const watchHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const embedHosts = new Set([...watchHosts, 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const videoId = /^[A-Za-z0-9_-]{11}$/;
export const youtubeWatchUrl = id => `https://www.youtube.com/watch?v=${id}`;

export function youtubeVideoId(value, isEmbed) {
  const href = normalizeWebUrl(value?.replace(/\\([:.])/g, '$1'));
  if (!href) return '';
  const url = new URL(href);
  if (url.port) return '';
  let id;
  if (isEmbed && embedHosts.has(url.hostname)) {
    id = url.pathname.match(/^\/embed\/([\w-]{11})\/?$/)?.[1];
  } else if (!isEmbed && watchHosts.has(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/shorts\/([\w-]{11})\/?$/)?.[1];
  } else if (!isEmbed && url.hostname === 'youtu.be') {
    id = url.pathname.match(/^\/([\w-]{11})\/?$/)?.[1];
  }
  return videoId.test(id || '') ? id : '';
}

export function standaloneYouTubeId(html) {
  if (html.length > 100000 || !/<iframe\b/i.test(html)) return '';
  let node = parseFragment(html);
  for (let depth = 0; depth < 8; depth++) {
    const children = node.childNodes.filter(child => child.nodeName !== '#comment' &&
      (child.nodeName !== '#text' || child.value.trim()));
    if (children.length !== 1) return '';
    [node] = children;
    if (node.tagName === 'iframe') return youtubeVideoId(node.attrs.find(attr => attr.name === 'src')?.value, true);
    if (!['a','div','p','span'].includes(node.tagName)) return '';
  }
  return '';
}

export function youtubeEmbedHtml(id) {
  if (!videoId.test(id || '')) throw Error('Некорректный идентификатор YouTube.');
  return `<iframe src="https://www.youtube.com/embed/${id}" anchorhref="${youtubeWatchUrl(id)}" youtube="true" width="480" height="270" allowfullscreen></iframe>`;
}
