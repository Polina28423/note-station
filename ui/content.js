import { imagePreview, imageResources } from './images.js';
import { linkStrings } from './strings.js';
import { normalizeWebUrl } from './links.js';
import { normalizeColor, safeStyles } from './editor-styles.js';
// Only explicitly validated presentation values are copied; server handlers/resources are not.
const ALLOWED = new Set(['P','DIV','BR','H1','H2','H3','H4','H5','H6','STRONG','B','EM','I','U','S','STRIKE','DEL','UL','OL','LI','BLOCKQUOTE','PRE','CODE','HR','TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','SUP','SUB','SPAN','MARK','FONT']);
const DROP = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','TEMPLATE','SVG','MATH','NOSCRIPT']);
const YOUTUBE_WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const YOUTUBE_EMBED_HOSTS = new Set([...YOUTUBE_WATCH_HOSTS, 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const PLAYER_ORIGIN = 'https://www.youtube-nocookie.com';

function youtubeVideoId(value, isEmbed) {
  const href = normalizeWebUrl(value?.replace(/\\([:.])/g, '$1'));
  if (!href) return '';
  const url = new URL(href);
  const hosts = isEmbed ? YOUTUBE_EMBED_HOSTS : YOUTUBE_WATCH_HOSTS;
  if (url.port || !hosts.has(url.hostname)) return '';
  const id = isEmbed ? url.pathname.match(/^\/embed\/([\w-]{11})\/?$/)?.[1]
    : url.pathname === '/watch' ? url.searchParams.get('v') : '';
  return /^[\w-]{11}$/.test(id || '') ? id : '';
}

function externalLink(href) {
  const link = document.createElement('a');
  link.href = href;
  link.rel = 'noopener noreferrer';
  link.title = linkStrings.openHint;
  return link;
}

function videoLink(id) {
  const href = `https://www.youtube.com/watch?v=${id}`;
  const link = externalLink(href);
  link.textContent = href;
  return link;
}

export function safeNoteFragment(html, images, { playYouTube = false } = {}) {
  const resources=images&&imageResources(images.note,images.load);
  const template = document.createElement('template');
  template.innerHTML = html;
  const fragment = document.createDocumentFragment();
  let remaining = 50000;
  function appendVideo(target, id, link = videoLink(id)) {
    if (!playYouTube) {
      target.append(link);
      return;
    }
    const block = document.createElement('span');
    block.className = 'note-video';
    const player = document.createElement('iframe');
    player.title = linkStrings.youtubePlayer;
    player.loading = 'lazy';
    player.referrerPolicy = 'strict-origin-when-cross-origin';
    player.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    player.allowFullscreen = true;
    player.dataset.videoSource = `${PLAYER_ORIGIN}/embed/${id}`;
    player.src = player.dataset.videoSource;
    block.append(player, link);
    target.append(block);
  }

  function copy(source, target, depth = 0, linkedVideos = null) {
    for (const node of source.childNodes) {
      if (--remaining < 0 || depth > 80) return;
      if (node.nodeType === Node.TEXT_NODE) { target.append(document.createTextNode(node.textContent)); continue; }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = node.tagName.toUpperCase();
      if (tag === 'INPUT' && node.getAttribute('type') === 'checkbox') { target.append(document.createTextNode(node.hasAttribute('checked') ? '☑ ' : '☐ ')); continue; }
      if (tag === 'IFRAME') {
        const id = youtubeVideoId(node.getAttribute('src'), true);
        if (id && linkedVideos) linkedVideos.add(id);
        else if (id) appendVideo(target, id);
        continue;
      }
      if (DROP.has(tag)) continue;
      if (tag === 'IMG') {
        if(resources){target.append(imagePreview(node.outerHTML,resources.note,resources.load));continue;}
        if (node.getAttribute('alt')) target.append(document.createTextNode(`[${node.getAttribute('alt')}]`));
        continue;
      }
      if (tag === 'A') {
        const href = normalizeWebUrl(node.getAttribute('href'));
        if (href) {
          const link = externalLink(href);
          for(const [key,value] of Object.entries(safeStyles(node.getAttribute('style'))))link.style.setProperty(key,value);
          const videos = new Set();
          copy(node, link, depth + 1, videos);
          const watchId = youtubeVideoId(href, false);
          const matching = watchId || youtubeVideoId(href, true);
          const hasMatchingVideo = videos.delete(matching);
          if (hasMatchingVideo && !link.textContent.trim() && !link.querySelector('img,.note-image')) {
            if (!watchId) link.href = videoLink(matching).href;
            link.textContent = link.href;
          }
          if (hasMatchingVideo) appendVideo(target, matching, link);
          else if (link.hasChildNodes()) target.append(link);
          for (const id of videos) appendVideo(target, id);
        } else { copy(node, target, depth + 1, linkedVideos); }
        continue;
      }
      if (ALLOWED.has(tag)) {
        const element = document.createElement(tag==='FONT'?'span':tag.toLowerCase());
        const styles=safeStyles(node.getAttribute('style'));
        if(tag==='FONT'){const color=normalizeColor(node.getAttribute('color'));if(color)styles.color=color;}
        for(const [key,value] of Object.entries(styles))element.style.setProperty(key,value);
        copy(node, element, depth + 1, linkedVideos); target.append(element);
      } else { copy(node, target, depth + 1, linkedVideos); }
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
