import { safeNoteFragment } from './content.js';
import { historyStrings as strings } from './strings.js';

export function bindNoteHistory({ invoke, getNote, canOpen, leave, setBusy, onRestored }) {
  const $ = id => document.getElementById(id);
  const dialog = $('history-dialog');
  let note = null, selected = null, request = 0, writing = false;
  function message(text) { $('history-status').textContent = text; }
  function clearPreview() {
    selected = null;
    $('history-restore').disabled = true;
    $('history-note-title').textContent = '';
    $('history-preview').replaceChildren();
  }
  function close() {
    if (writing) return;
    request++;
    clearPreview();
    $('history-list').replaceChildren();
    note = null;
    dialog.close();
  }
  $('history-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  $('note-history').addEventListener('click', async () => {
    if (!canOpen() || !await leave() || !getNote()) return;
    note = { ...getNote() };
    const token = ++request;
    clearPreview();
    $('history-list').replaceChildren();
    message(strings.loading);
    dialog.showModal();
    try {
      const versions = await invoke('list_note_versions', { id: note.object_id });
      if (token !== request) return;
      message(versions.length ? strings.choose : strings.empty);
      for (const version of versions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${strings.version} ${version.ver}`;
        const timestamp = Number(version.mtime);
        if (Number.isFinite(timestamp) && timestamp > 0) {
          const date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
          if (!Number.isNaN(date.getTime())) button.textContent += ` · ${date.toLocaleString('ru-RU')}`;
        }
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', async () => {
          if (writing) return;
          const previewToken = ++request;
          clearPreview();
          for (const sibling of $('history-list').children) sibling.setAttribute('aria-pressed', String(sibling === button));
          message(strings.previewLoading);
          try {
            const preview = await invoke('get_note_version', { id: note.object_id, version: version.ver });
            if (previewToken !== request) return;
            $('history-note-title').textContent = preview.title;
            $('history-preview').replaceChildren(safeNoteFragment(preview.content));
            selected = version.ver;
            $('history-restore').disabled = note.ver == null;
            message(strings.ready);
          } catch (error) { if (previewToken === request) message(String(error)); }
        });
        $('history-list').append(button);
      }
    } catch (error) { if (token === request) message(String(error)); }
  });
  $('history-restore').addEventListener('click', async () => {
    if (writing || selected == null || !note || note.ver == null) return;
    writing = true;
    setBusy(true);
    $('history-restore').disabled = true;
    $('history-close').disabled = true;
    message(strings.saving);
    try {
      const result = await invoke('restore_note_version', { id: note.object_id, version: selected, expectedVersion: note.ver });
      onRestored(result);
      writing = false;
      close();
    } catch (error) {
      // A failed or ambiguous write requires a fresh history session before retrying.
      clearPreview();
      for (const button of $('history-list').children) button.disabled = true;
      message(String(error));
    } finally {
      writing = false;
      $('history-close').disabled = false;
      setBusy(false);
    }
  });
}
