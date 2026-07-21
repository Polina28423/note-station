import { spellingStrings as strings } from './strings.js';

export function bindSpelling({ editor, invoke }) {
  const $ = id => document.getElementById(id);
  const dialog = $('spelling-dialog');
  let request = 0, snapshot = null, issues = [], selected = null, applying = false;
  let scopeSelection = null;
  const ignored = new Set();
  const ignoredKey = issue => JSON.stringify([issue.word, issue.languages]);
  function message(value) { $('spelling-status').textContent = value; }
  function clearDetail() {
    selected = null;
    $('spelling-context').replaceChildren();
    $('spelling-detail').textContent = '';
    $('spelling-suggestions').replaceChildren();
    $('spelling-ignore').disabled = true;
  }
  function current() { return snapshot && editor.spellingCurrent(snapshot); }
  function render() {
    $('spelling-issues').replaceChildren();
    clearDetail();
    for (const issue of issues) {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = issue.word; button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => select(issue, button));
      $('spelling-issues').append(button);
    }
  }
  async function check() {
    const token = ++request;
    clearDetail(); $('spelling-issues').replaceChildren();
    message(strings.checking);
    try {
      snapshot = editor.spellingSnapshot();
      const scope = $('spelling-scope').value === 'selection' ? scopeSelection : null;
      let segments = snapshot.segments;
      if ($('spelling-scope').value === 'selection') {
        const segment = scope && segments.find(part => part.id === scope.segment);
        if (!segment || scope.start + scope.length > segment.text.length) throw Error(strings.noSelection);
        segments = [{ id: segment.id, text: segment.text.slice(scope.start, scope.start + scope.length) }];
      }
      const result = await invoke('check_spelling', { segments, language: $('spelling-language').value });
      if (token !== request || !dialog.open) return;
      if (!current()) { message(strings.stale); return; }
      if (scope) result.issues = result.issues.map(issue => ({ ...issue, start: issue.start + scope.start }));
      issues = result.issues.filter(issue => !ignored.has(ignoredKey(issue)));
      render();
      message(result.truncated ? strings.truncated : issues.length ? `${strings.found(issues.length)} ${strings.choose}` : strings.clean);
    } catch (error) { if (token === request && dialog.open) message(String(error)); }
  }
  async function select(issue, button) {
    if (applying) return;
    const token = ++request;
    clearDetail();
    if (!current()) { message(strings.stale); return; }
    selected = issue;
    for (const sibling of $('spelling-issues').children) sibling.setAttribute('aria-pressed', String(sibling === button));
    const segment = snapshot.segments.find(part => part.id === issue.segment);
    if (!segment || segment.text.slice(issue.start, issue.start + issue.length) !== issue.word) { message(strings.stale); return; }
    const mark = document.createElement('mark'); mark.textContent = issue.word;
    $('spelling-context').append(document.createTextNode(segment.text.slice(Math.max(0, issue.start - 55), issue.start)), mark, document.createTextNode(segment.text.slice(issue.start + issue.length, issue.start + issue.length + 55)));
    $('spelling-detail').textContent = (issue.mixed_alphabet ? strings.mixedAlphabet + ' ' : '') + issue.languages.map(language => strings.languages[language]).join(' / ');
    $('spelling-ignore').disabled = false;
    message(strings.suggestions);
    try {
      const suggestions = await invoke('spelling_suggestions', { word: issue.word, languages: issue.languages });
      if (token !== request || !dialog.open) return;
      if (!current()) { clearDetail(); message(strings.stale); return; }
      for (const value of suggestions) {
        const replace = document.createElement('button'); replace.type = 'button'; replace.textContent = value;
        replace.setAttribute('aria-label', strings.replace(value));
        replace.addEventListener('click', async () => {
          if (applying || !current()) { message(strings.stale); return; }
          applying = true;
          // Contenteditable must be outside the modal's inert subtree to accept insertText.
          dialog.close();
          let changed = false;
          try { changed = await editor.replaceSpelling(snapshot, issue, value); }
          catch (error) { message(String(error)); }
          finally {
            applying = false;
            if (editor.active) dialog.showModal();
          }
          if (!dialog.open) return;
          if (changed) {
            if ($('spelling-scope').value === 'selection' && scopeSelection) scopeSelection.length += value.length - issue.length;
            await check();
          }
          else { clearDetail(); message(strings.failed); }
        });
        $('spelling-suggestions').append(replace);
      }
      message(suggestions.length ? strings.choose : strings.noSuggestions);
    } catch (error) { if (token === request && dialog.open) message(String(error)); }
  }
  function close() {
    if (applying) return;
    request++; snapshot = null; issues = []; ignored.clear(); clearDetail(); $('spelling-issues').replaceChildren(); dialog.close();
  }
  $('check-spelling').addEventListener('pointerdown', event => event.preventDefault());
  $('check-spelling').addEventListener('click', () => {
    if (!editor.active || applying) return;
    ignored.clear();
    try { scopeSelection = editor.spellingSnapshot().selection; } catch (error) { message(String(error)); return; }
    $('spelling-scope').value = 'all';
    $('spelling-selection-option').disabled = !scopeSelection;
    dialog.showModal(); check();
  });
  $('spelling-recheck').addEventListener('click', () => { ignored.clear(); check(); });
  $('spelling-scope').addEventListener('change', () => { ignored.clear(); check(); });
  $('spelling-language').addEventListener('change', () => { ignored.clear(); check(); });
  $('spelling-ignore').addEventListener('click', () => {
    if (!selected) return;
    request++; ignored.add(ignoredKey(selected));
    issues = issues.filter(issue => !ignored.has(ignoredKey(issue)));
    render(); message(issues.length ? strings.found(issues.length) : strings.allSkipped);
  });
  $('spelling-licenses').addEventListener('toggle', async () => {
    if (!$('spelling-licenses').open || $('spelling-license-text').textContent) return;
    try { $('spelling-license-text').textContent = await invoke('spelling_licenses'); }
    catch (error) { message(String(error)); }
  });
  $('spelling-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!applying && !dialog.open) { request++; snapshot = null; } });
}
