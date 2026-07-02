// Authentication has an explicit checking state. The credential form is never
// an intermediate view while a saved (or already active) session is restored.
export async function restoreAtStartup({ invoke, checking, connected, login, unavailable }) {
  checking();
  try {
    const result = await invoke('restore_session');
    if (result) {
      // A UI/load failure after successful authentication is not a reason to
      // ask for credentials again, including for a memory-only active session.
      try { await connected(result); }
      catch (error) { unavailable(String(error)); }
    }
    else login();
  } catch (error) {
    let saved;
    try { saved = await invoke('has_saved_session'); }
    catch { unavailable(String(error)); return; }
    if (saved) unavailable(String(error));
    else login(String(error));
  }
}
