import { safeNoteFragment } from './content.js';
import { linkStrings as strings } from './strings.js';
import { youtubeEmbedHtml, youtubeVideoId, youtubeWatchUrl } from './youtube.js';

function editVideoUrl(id, trigger, onChange) {
  const doc = document;
  const dialog = doc.createElement('dialog');
  dialog.className = 'app-dialog video-link-dialog';
  dialog.setAttribute('aria-labelledby', 'video-link-title');
  const form = doc.createElement('form');
  form.noValidate = true;
  const title = doc.createElement('h2');
  title.id = 'video-link-title';
  title.textContent = strings.youtubeEdit;
  const body = doc.createElement('div');
  body.className = 'dialog-body';
  const label = doc.createElement('label');
  label.htmlFor = 'video-link-url';
  label.textContent = strings.youtubeUrl;
  const url = doc.createElement('input');
  url.id = label.htmlFor;
  url.type = 'url';
  url.maxLength = 8192;
  url.value = youtubeWatchUrl(id);
  const status = doc.createElement('p');
  status.setAttribute('role', 'status');
  body.append(label, url, status);
  const actions = doc.createElement('div');
  actions.className = 'dialog-actions';
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.textContent = strings.youtubeCancel;
  cancel.addEventListener('click', () => dialog.close());
  const apply = doc.createElement('button');
  apply.type = 'submit';
  apply.textContent = strings.youtubeApply;
  actions.append(cancel, apply);
  form.append(title, body, actions);
  dialog.append(form);
  doc.body.append(dialog);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (trigger.isConnected) trigger.focus();
  }, { once: true });
  dialog.addEventListener('cancel', event => { if (apply.disabled) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (apply.disabled) return;
    const value = url.value.trim();
    const nextId = youtubeVideoId(value, false) || youtubeVideoId(value, true);
    if (!nextId) {
      status.textContent = strings.youtubeInvalid;
      url.focus();
      return;
    }
    apply.disabled = cancel.disabled = true;
    try {
      if (nextId === id || await onChange(nextId)) dialog.close();
      else status.textContent = strings.youtubeChangeFailed;
    } catch {
      status.textContent = strings.youtubeChangeFailed;
    } finally { apply.disabled = cancel.disabled = false; }
  });
  dialog.showModal();
  url.focus();
  url.select();
}

export function makeVideoEditor(doc, id, { showPreview = false, onPreview, onChange }) {
  const block = doc.createElement('span');
  block.className = 'video-edit-block';
  const toolbar = doc.createElement('span');
  toolbar.className = 'video-edit-toolbar';
  const button = (label, action) => {
    const control = doc.createElement('button');
    control.type = 'button';
    control.textContent = label;
    control.addEventListener('click', action);
    return control;
  };
  const preview = doc.createElement('span');
  preview.className = 'video-edit-preview';
  const editButton = button(strings.youtubeEdit, () => editVideoUrl(id, editButton, async nextId => {
    if (!await onChange(nextId)) return false;
    id = nextId;
    renderPreview();
    return true;
  }));
  editButton.setAttribute('aria-haspopup', 'dialog');
  function renderPreview() {
    preview.replaceChildren(safeNoteFragment(youtubeEmbedHtml(id), undefined, { playYouTube: showPreview }));
    previewButton.setAttribute('aria-pressed', String(showPreview));
    linkButton.setAttribute('aria-pressed', String(!showPreview));
  }
  function changePreview(shown) {
    if (showPreview === shown) return;
    showPreview = shown;
    onPreview(shown);
    renderPreview();
  }
  const linkButton = button(strings.youtubeLink, () => changePreview(false));
  const previewButton = button(strings.youtubePreview, () => changePreview(true));
  const label = doc.createElement('strong');
  label.textContent = 'YouTube';
  toolbar.append(label, linkButton, previewButton, editButton);
  block.append(toolbar, preview);
  renderPreview();
  return block;
}
