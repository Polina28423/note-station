# Note Station Rust — First Prototype

> This repository's history was reconstructed during the GitHub import. Dates starting July 2, 2026, were assigned during the import. Each imported commit records its source hash and original author date.

An independent Windows desktop client for Synology Note Station, built with Rust and Tauri 2. Development takes place in this project. The original client in `original/` is a reference and its interface code is not copied.

## Features

- Sign in over HTTPS or explicitly selected HTTP using a password and an optional two-factor authentication code.
- Remember the last server and username on this computer. Saved sessions are protected by Windows DPAPI and kept separately for each account and NAS.
- Discover NAS APIs and load notebooks and notes with pagination.
- Browse a collapsible notebook tree, search note titles, sort results, and pin notebooks locally per account and server.
- Restore the last notebook and note on sign-in and find frequently opened notes in the sidebar.
- Read formatted notes with adjustable text size, a full-width reading mode, and resizable panels.
- View all notes in a shelf or select a notebook within it.
- Choose a saved account on the welcome screen, add an account, or switch accounts without signing out of a saved session.
- See a clear message when a note is encrypted.

The **Tasks**, **Shared Notebooks**, **Trash**, and **Tags** sections support browsing, creating tasks with a due date and optional note link, marking tasks complete, restoring notes from the trash, and filtering by tag.

The prototype can read and edit existing notes. Creating new notes, offline storage, decryption, QuickConnect ID, advanced Secure SignIn authorization, and background synchronization are not implemented. Editor.js is the default editor. TinyMCE is available in classic mode. Supported blocks include paragraphs, headings, nested lists, checklists, simple tables, quotes, code, and links. Unsupported fragments retain their original HTML, and the client provides a safe preview where possible.

## Running on Windows

### Developing in Visual Studio Code

Open `NoteStation.code-workspace` with **File → Open Workspace from File**, or run this command from the project root:

```powershell
code .\NoteStation.code-workspace
```

Settings are in `.vscode/` and also apply when opening the project folder directly. The Rust client is developed from this folder.

- `src-tauri/src/main.rs` contains the entry point and application commands.
- `src-tauri/src/synology.rs` implements NAS API access.
- `src-tauri/src/session_store.rs` handles saved sessions.
- `ui/` contains the HTML, CSS, and JavaScript interface.
- **Ctrl+Shift+B** builds a debug executable. **F5** builds and debugs Rust. **Ctrl+F5** runs without the debugger.
- Under **Terminal → Run Task**, choose `Rust: run`, `Rust: check`, `Rust: test`, `Rust: build release`, `Rust: format`, `UI: test`, or `UI: browser test`.
- **F12** goes to the definition. **Shift+Alt+F** formats a Rust file.

The recommended extensions are `rust-lang.rust-analyzer` for Rust language support and `ms-vscode.cpptools` for Windows debugging. The development setup includes `rust-src`. See the [official VS Code Rust guide](https://code.visualstudio.com/docs/languages/rust).

The workspace uses Rust from `.tools/cargo` and `.tools/rustup`. Its environment variables apply to the language server, workspace tasks, and new integrated terminals. The global `PATH` remains unchanged. On a different computer, prepare the Rust toolchain and install the C++ Build Tools, Windows SDK, and WebView2. VS Code hides `.tools/` and `target/` in the Explorer and excludes the original client and third-party JavaScript from general search.

Use F5 to debug Rust and the debug build's WebView developer tools to debug the interface. Rebuild and restart after changing files under `ui/`.

### Running from PowerShell

Install stable Rust with the MSVC toolchain, Visual Studio C++ Build Tools, the Windows SDK, and the WebView2 Runtime. The start script uses the local Rust installation in `.tools/` when available. Node.js and npm are optional for running the app and for ordinary Rust builds.

From the project root:

```powershell
.\start.ps1
```

- Rust tests run with `.\start.ps1 -Test`.
- With Node.js installed, run `node --test tests/preferences.test.mjs tests/library.test.mjs tests/startup.test.mjs tests/editor-document.test.mjs` to check preferences, library navigation, startup, and the editor adapter.
- A release build with `.\start.ps1 -Release` produces `target/release/note-station-rust.exe`.

Enter the full NAS address, such as `https://nas.example:5001`, without `/webman` or `/webapi`. Note Station must be installed on the NAS and the account must have access to it.

HTTPS with certificate verification is the default. For a self-signed certificate, expand **Self-signed certificate** and select the public NAS or CA certificate as PEM. The `.pem`, `.crt`, and `.cer` extensions are accepted if the file contains exactly one PEM certificate, no private key, and is at most 64 KB. DER and PFX support is pending. Export the public certificate through a trusted NAS administrative channel.

The certificate applies only to the client's connection. If you save the session, the PEM is stored in the encrypted record and reused when reconnecting. Otherwise, select it again after restarting. Choose **Remove certificate** before the next sign-in to return to normal trust settings. The NAS address must match a certificate Subject Alternative Name. An IP address requires an IP SAN. The certificate must be valid. Standard mode checks the server name, certificate validity period, and TLS signature.

### Connecting without a certificate file

- **HTTPS · Skip certificate verification** encrypts traffic without verifying the server's identity, certificate name, or validity period. A server impersonating the NAS could intercept the connection.
- **HTTP · Unencrypted** accepts an address such as `http://nas.example:5000`. The password, session ID, and notes are transmitted in clear text.

Both modes require explicit confirmation when signing in manually. A saved session reconnects in its configured mode. The app never falls back to HTTP or disables verification automatically after a connection error. Standard HTTPS is offered again after sign-out or when there is no saved session. Windows trust settings remain unchanged. The selected connection mode is displayed alongside the server address when applicable.

### Remembering the server and username

Signing in remembers the server and username locally even if the NAS is unavailable. These fields are restored on the next launch from the `local.notestation.rustclient` WebView profile. Passwords and one-time codes are excluded. The session ID, certificate, and connection mode can be saved separately in a protected session record. URLs with embedded credentials are not saved. Sign-in still works when local preference storage is unavailable.

## Architecture

To discover API names and versions for your own NAS without signing in, run `python tools/discover-api.py --server https://nas.example:5001`.

- `ui/` contains the interface and the bundled Editor.js, TinyMCE, and DOMPurify libraries in `ui/vendor/`.
- `src-tauri/src/main.rs` exposes session, reading, saving, and window-close commands.
- `src-tauri/src/synology.rs` handles HTTP(S), API discovery, request encoding, pagination, and errors.
- `src-tauri/src/session_store.rs` handles atomic saves, Windows DPAPI protection, loading, and deletion.
- `src-tauri/tauri.conf.json` configures the window and its Content Security Policy. The project uses no shell or filesystem plugins.

Passwords and session IDs are excluded from logs and browser storage. Secrets are present in memory during requests, so complete memory erasure is not guaranteed. The HTTP client rejects redirects, and API paths returned by the NAS cannot change the origin. Rust handles NAS access on behalf of the WebView. Note rendering strips scripts and unsafe attributes and validates allowed styles. Responses are capped at 16 MB and lists at 10,000 entries.

## API and compatibility testing

The following calls were identified from `original/package.nw/js/background.js`:

| API | Version and method | Encoding |
| --- | --- | --- |
| `SYNO.API.Info` | `1 / query` | Form data sent to `query.cgi` |
| `SYNO.API.Auth` | Up to `6 / login`, `1 / logout` | Form data sent to the discovered endpoint |
| `SYNO.NoteStation.Notebook` | `2 / list` | JSON field values in form data |
| `SYNO.NoteStation.Note` | `2 / list, get` | JSON field values in form data |

For a compatibility check on a particular NAS, sign in, load notebooks and the note list, read a note, and sign out. Automated tests cover validation, encoding, and HTTP/TLS exchanges with a loopback test server. They verify that untrusted self-signed certificates, expired certificates, and name mismatches are rejected, and that explicitly trusted certificates, intentionally disabled verification, and plain HTTP behave as configured. Test keys are generated in memory. Tests also check which fields are saved and how storage errors are handled.

The basic sign-in, notebook listing, note listing, and reading workflow was confirmed on a real NAS. The interface was also tested with demonstration data. For troubleshooting, share the error code and a sanitized response structure. Keep passwords, session IDs, and HAR files containing cookies private. See the [Tauri development guide](https://v2.tauri.app/develop/) and [Synology DSM Login Web API Guide](https://kb.synology.com/en-uk/DG/DSM_Login_Web_API_Guide/3).

## Using the library

The workspace has three panels for navigation, the note list, and the document. Select a notebook to filter the list. Use the star to pin the notebook on this computer. Drag the panel dividers to resize them, or focus a divider with Tab and use the Left or Right arrow. The note list shows a short description and modification date when supplied by the NAS.

Shelves come from the `stack` field returned by `SYNO.NoteStation.Notebook/list`. Notebooks without a shelf appear at the top level. Select a shelf to list notes from all its notebooks. The triangle collapses or expands its notebooks. Search temporarily expands matching shelves. Shelves with the same name are kept separate by owner. Pinned notebooks also remain in their shelves. Creating, renaming, or moving shelves and notebooks on the NAS is not implemented.

The sidebar search matches notebook and shelf names. The search box above the notes matches titles in the current selection. **All Notes** shows the whole library. **Frequently Opened Notes** ranks notes by opening count, then by the most recent opening. Refresh reloads both notebooks and notes. The last notebook and note are restored at sign-in when they are still available.

Use Up and Down to move through the note list. **Ctrl+K** focuses search in reading mode. **⛶** opens full-width reading and **Esc** returns to the normal layout. **A− / A+** adjust the text size, and **Copy** copies the note as plain text.

For a development preview, run `python tests/serve-preview.py` and open `http://127.0.0.1:8765/`. Use `http://127.0.0.1:8765/content-check.html` to check safe note rendering. The preview uses mock data, does not connect to the NAS, and is excluded from the executable.

## Saved sessions and sign-out

Sign in with **Save session** selected to add the account to the welcome screen. The next time you select that account, the client decrypts the session ID and checks it with the NAS. The NAS sets the expiration time. **Switch user** keeps a saved session available. For a temporary sign-in, switching ends that session. **Forget** deletes the selected local session record and the server session expires on its own. **Sign out** also requests revocation on the NAS.

The Windows session store uses `%LOCALAPPDATA%/local.notestation.rustclient/`. It protects the session ID, server, username, connection mode, and optional PEM with DPAPI scoped to the current Windows user. Passwords and one-time codes are excluded. No encryption key is stored next to the file. Processes running as the same Windows user can access DPAPI under that identity. Temporary session ID copies and decrypted JSON are cleared where possible. The legacy `session.bin` format is supported automatically. Other operating systems can sign in without saving a session.

If the NAS is unavailable, the record stays in place and you can choose **Retry connection** or **Forget session**. If the NAS reports an expired session ID with code `106`, `107`, or `119`, the record is removed and a new sign-in is required. **Forget session** can also remove a damaged or inaccessible record.

**Sign out** removes the local record, clears the active session, and then requests sign-out on the NAS. If the NAS cannot be reached, the app reports that server-side revocation was unconfirmed. A local deletion error leaves sign-out incomplete so it can be retried. Server and username preferences remain available. Sign-out leaves notes and notebooks on the NAS intact.

Windows tests cover encryption, reopening, overwriting and deleting a record, rejecting corrupted data, distinguishing network errors from session expiration, and recovering sessions after restarting the interface. Mock tests also cover temporary sessions and staying signed out after a restart.

## Note editors

Open a note and click its body to start editing. Save with **Save to NAS** or **Ctrl+S**. **Cancel** returns to reading. When navigating away, refreshing, signing out, or closing the window with changes present, the app offers to save, discard, or keep editing. Drafts live in memory during the editing session and cannot be recovered after a crash.

The client uses bundled Editor.js 2.31.7, DOMPurify 3.4.17, and parse5 8.1.1. Choose TinyMCE 8.10.2 under **Settings → Note editor** to switch to classic editing and access the HTML source. The choice persists across launches. Select text and press **Ctrl+B** or use the toolbar for bold. Both editors provide bold, italics, underline, strikethrough, links, and clear formatting, along with text color, highlighting, and alignment. The color palette includes 18 presets, a custom color, and reset. Color applies to selected text, while alignment applies to the current block. See [third-party notices](THIRD_PARTY_NOTICES.txt) for licenses, including TinyMCE's GPL mode.

Saves use `SYNO.NoteStation.Note` v3 with `method=set`, `object_id`, the original `ver`, `check_conflict=true`, `title`, `content`, `brief`, and a version message. The client reads the current revision before saving to prevent overwriting a newer version. The NAS enforces permissions. Encrypted notes and notes without a version remain read-only. After a confirmed save, a failed read-back produces a separate notice so the save is still reported accurately.

Protected fragments preserve their source markup and require confirmation for removal. Removing an attachment reference removes its markup from the note. Supported images can be inserted and uploaded when the note is saved. Title-only edits preserve the original body HTML. Editor.js regenerates only modified supported blocks, and TinyMCE is available for complex documents or tables with merged cells.

The CSP allows local scripts, the local editor frame, inline formatting styles, and the approved YouTube embed endpoint. Pasted HTML passes through DOMPurify, and exported blocks use validated markup and URLs. Image previews use validated raster data.

Tests cover version checks, stale saves, attachment preservation during ordinary text edits, and a successful save followed by a failed read-back. Browser tests exercise both editors, formatting, Ctrl+S, navigation with unsaved changes, canceling and retaining a draft on error. Use `tests/editor-document.test.mjs` for the HTML adapter and `tools/editor-build/browser-check.cjs` for the browser workflow. Compatibility of saves with a live NAS and the official client should be checked on a test note.

## Starting with an active session

While `restore_session` runs, the app shows a connection screen. It opens the library after a successful session restore and presents the sign-in form when no session is available or a new sign-in is required. When the NAS is unreachable, you can retry, sign in manually, or sign out. A network error leaves the saved session ID available for retry. To exercise startup logic without a browser, run `node --test tests/startup.test.mjs`.
