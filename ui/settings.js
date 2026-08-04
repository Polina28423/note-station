import { settingsStrings as strings } from './strings.js';

export function bindSettingsTabs({ invoke }) {
  const $ = id => document.getElementById(id);
  const dialog = $('app-settings');
  const tabs = [$('settings-editor-tab'), $('settings-sessions-tab')];
  const panels = [$('settings-editor-panel'), $('settings-sessions-panel')];
  let request = 0;
  async function loadSessions() {
    const token = ++request;
    $('settings-sessions-list').replaceChildren();
    $('settings-sessions-status').textContent = strings.loading;
    $('settings-sessions-refresh').disabled = true;
    panels[1].setAttribute('aria-busy', 'true');
    try {
      const accounts = await invoke('list_accounts');
      if (token !== request || !dialog.open) return;
      for (const account of accounts) {
        const card = document.createElement('div'); card.className = 'settings-session-card';
        const name = document.createElement('strong'); name.textContent = account.account;
        const server = document.createElement('span'); server.textContent = account.server;
        const mode = document.createElement('small');
        mode.textContent = account.mode === 'strict' ? strings.strict : account.mode === 'plain_http' ? strings.http : strings.unverified;
        card.append(name, server, mode); $('settings-sessions-list').append(card);
      }
      $('settings-sessions-status').textContent = accounts.length ? strings.loaded(accounts.length) : strings.empty;
    } catch {
      if (token === request && dialog.open) $('settings-sessions-status').textContent = strings.failed;
    } finally {
      if (token === request) { $('settings-sessions-refresh').disabled = false; panels[1].setAttribute('aria-busy', 'false'); }
    }
  }
  function select(index, focus = false) {
    tabs.forEach((tab, at) => {
      tab.setAttribute('aria-selected', String(at === index)); tab.tabIndex = at === index ? 0 : -1;
      panels[at].hidden = at !== index;
    });
    if (focus) tabs[index].focus();
    if (index === 1) loadSessions();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', event => {
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
      if (target !== null) { event.preventDefault(); select(target, true); }
    });
  });
  $('settings-sessions-refresh').addEventListener('click', loadSessions);
  dialog.addEventListener('close', () => { request++; });
  return { reset() {
    request++; select(0);
    $('settings-sessions-list').replaceChildren(); $('settings-sessions-status').textContent = '';
    $('settings-sessions-refresh').disabled = false; panels[1].setAttribute('aria-busy', 'false');
  } };
}
