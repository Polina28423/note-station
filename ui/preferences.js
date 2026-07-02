const KEY = 'note-station.connection.v1';

function fields(value) {
  if (!value || typeof value.server !== 'string' || typeof value.account !== 'string'
      || value.server.length > 2048 || value.account.length > 256) return null;
  try {
    const url = new URL(value.server);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname
        || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return { server: value.server, account: value.account };
  } catch { return null; }
}

export function loadConnection(storage) {
  try { return fields(JSON.parse(storage.getItem(KEY))); }
  catch { return null; }
}

export function saveConnection(storage, value) {
  const safe = fields(value);
  if (!safe) return false;
  try { storage.setItem(KEY, JSON.stringify(safe)); return true; }
  catch { return false; }
}
