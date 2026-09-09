#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod external_links;
mod session_store;
mod spelling;
mod synology;

use serde::Serialize;
use session_store::{expired_session, SavedSession, SessionStore};
use std::sync::atomic::{AtomicBool, Ordering};
use synology::{ConnectionMode, NasClient, Note, NoteSummary, NoteVersion, Notebook, SavedNote};
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;

#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || external_links::open_web_url(&url))
        .await
        .map_err(|_| "Не удалось открыть системный браузер.".to_string())?
}

#[tauri::command]
fn spelling_licenses() -> &'static str {
    spelling::LICENSES
}

#[derive(Default)]
struct SpellingState(std::sync::Arc<std::sync::Mutex<Option<spelling::SpellChecker>>>);

#[tauri::command]
async fn check_spelling(
    state: State<'_, SpellingState>,
    segments: Vec<spelling::TextSegment>,
    language: spelling::Language,
) -> Result<spelling::CheckResult, String> {
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = shared
            .lock()
            .map_err(|_| "Проверка орфографии недоступна.".to_string())?;
        if guard.is_none() {
            *guard = Some(spelling::SpellChecker::new()?);
        }
        guard
            .as_ref()
            .ok_or("Словари орфографии недоступны.")?
            .check(&segments, language)
    })
    .await
    .map_err(|_| "Не удалось завершить проверку орфографии.".to_string())?
}

#[tauri::command]
async fn spelling_suggestions(
    state: State<'_, SpellingState>,
    word: String,
    languages: Vec<spelling::Language>,
) -> Result<Vec<String>, String> {
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = shared
            .lock()
            .map_err(|_| "Проверка орфографии недоступна.".to_string())?;
        if guard.is_none() {
            *guard = Some(spelling::SpellChecker::new()?);
        }
        guard
            .as_ref()
            .ok_or("Словари орфографии недоступны.")?
            .suggestions(&word, &languages)
    })
    .await
    .map_err(|_| "Не удалось получить варианты исправления.".to_string())?
}

#[derive(Clone, Serialize)]
struct ConnectionInfo {
    server: String,
    account: String,
    mode: ConnectionMode,
    remembered: bool,
}
struct ActiveSession {
    client: NasClient,
    connection: ConnectionInfo,
    certificate_pem: Option<String>,
}
#[derive(Default)]
struct AppState(Mutex<Option<ActiveSession>>, AtomicBool, AtomicBool);
#[derive(Serialize)]
struct Connected {
    notebooks: Vec<Notebook>,
    connection: ConnectionInfo,
    notice: Option<String>,
}
#[derive(Serialize)]
struct LogoutResult {
    server_revoked: bool,
    notice: Option<String>,
}

fn store(app: &tauri::AppHandle) -> Result<SessionStore, String> {
    Ok(SessionStore::new(
        app.path()
            .app_local_data_dir()
            .map_err(|_| "Не найден каталог данных приложения.".to_string())?
            .join("session.bin"),
    ))
}

#[tauri::command]
async fn login(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    server: String,
    account: String,
    password: String,
    otp: String,
    trusted_certificate_pem: Option<String>,
    connection_mode: Option<ConnectionMode>,
    remember_session: Option<bool>,
) -> Result<Connected, String> {
    let mut guard = state.0.lock().await;
    if guard.is_some() {
        return Err("Сначала выйдите из текущей сессии.".into());
    }
    let mode = connection_mode.unwrap_or_default();
    let mut client = NasClient::connect(&server, trusted_certificate_pem.as_deref(), mode).await?;
    client.login(&account, password, &otp).await?;
    let notebooks = match client.notebooks().await {
        Ok(notebooks) => notebooks,
        Err(error) => {
            let _ = client.logout().await;
            return Err(error);
        }
    };
    let mut connection = ConnectionInfo {
        server: server.trim().into(),
        account,
        mode,
        remembered: false,
    };
    let remember = remember_session.unwrap_or(true);
    let saved = if remember {
        let record = SavedSession {
            version: 1,
            server: connection.server.clone(),
            account: connection.account.clone(),
            sid: client.session_id()?.to_string(),
            mode,
            certificate_pem: trusted_certificate_pem.clone(),
        };
        store(&app).and_then(|store| store.save(&record))
    } else {
        store(&app).and_then(|store| store.remove(&connection.server, &connection.account))
    };
    // A previous identity must never be silently restored if saving the new one fails.
    let notice = match saved {
        Ok(()) => {
            connection.remembered = remember;
            None
        }
        Err(error) => {
            if let Err(clear_error) =
                store(&app).and_then(|store| store.remove(&connection.server, &connection.account))
            {
                let _ = client.logout().await;
                return Err(format!("{error} {clear_error}"));
            }
            Some(format!("Вы вошли, но сессия не сохранена: {error}"))
        }
    };
    *guard = Some(ActiveSession {
        client,
        connection: connection.clone(),
        certificate_pem: trusted_certificate_pem,
    });
    Ok(Connected {
        notebooks,
        connection,
        notice,
    })
}

#[tauri::command]
async fn restore_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    server: Option<String>,
    account: Option<String>,
) -> Result<Option<Connected>, String> {
    let mut guard = state.0.lock().await;
    if let Some(active) = guard.as_ref() {
        return Ok(Some(Connected {
            notebooks: active.client.notebooks().await?,
            connection: active.connection.clone(),
            notice: None,
        }));
    }
    let store = store(&app)?;
    let record = match (server, account) {
        (Some(server), Some(account)) => store
            .load_all()?
            .into_iter()
            .find(|r| r.server == server && r.account == account),
        _ => store.load()?,
    };
    let Some(record) = record else {
        return Ok(None);
    };
    // No password login: reuse the protected SID, then let the NAS validate it.
    let mut client = NasClient::connect(
        &record.server,
        record.certificate_pem.as_deref(),
        record.mode,
    )
    .await?;
    client.resume_session(record.sid.clone())?;
    let notebooks = match client.notebooks().await {
        Ok(notebooks) => notebooks,
        Err(error) => {
            if expired_session(&error) {
                store.remove(&record.server, &record.account)?;
                return Err("Срок сессии истёк. Войдите снова.".into());
            }
            return Err(error); // Network/permission failures keep the protected record for retry.
        }
    };
    let connection = ConnectionInfo {
        server: record.server.clone(),
        account: record.account.clone(),
        mode: record.mode,
        remembered: true,
    };
    *guard = Some(ActiveSession {
        client,
        connection: connection.clone(),
        certificate_pem: record.certificate_pem.clone(),
    });
    Ok(Some(Connected {
        notebooks,
        connection,
        notice: None,
    }))
}

#[tauri::command]
async fn set_session_persistence(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    remember: bool,
) -> Result<ConnectionInfo, String> {
    let mut guard = state.0.lock().await;
    let active = guard.as_mut().ok_or("Сначала войдите в NAS.")?;
    let store = store(&app)?;
    if remember {
        store.save(&SavedSession {
            version: 1,
            server: active.connection.server.clone(),
            account: active.connection.account.clone(),
            sid: active.client.session_id()?.into(),
            mode: active.connection.mode,
            certificate_pem: active.certificate_pem.clone(),
        })?;
    } else {
        store.remove(&active.connection.server, &active.connection.account)?;
    }
    active.connection.remembered = remember;
    Ok(active.connection.clone())
}

#[tauri::command]
fn has_saved_session(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(store(&app)?.exists())
}

// Only public connection metadata crosses into the webview; SIDs stay in Rust.
#[tauri::command]
fn list_accounts(app: tauri::AppHandle) -> Result<Vec<ConnectionInfo>, String> {
    Ok(store(&app)?
        .load_all()?
        .iter()
        .map(|r| ConnectionInfo {
            server: r.server.clone(),
            account: r.account.clone(),
            mode: r.mode,
            remembered: true,
        })
        .collect())
}

#[tauri::command]
async fn switch_account(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.0.lock().await;
    if let Some(active) = guard.take() {
        if !active.connection.remembered {
            let _ = active.client.logout().await;
        }
    }
    Ok(())
}

#[tauri::command]
async fn forget_account(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    server: String,
    account: String,
) -> Result<(), String> {
    let guard = state.0.lock().await;
    if guard
        .as_ref()
        .is_some_and(|a| a.connection.server == server && a.connection.account == account)
    {
        return Err("Сначала переключитесь с этого аккаунта.".into());
    }
    store(&app)?.remove(&server, &account)
}

#[tauri::command]
async fn list_todos(state: State<'_, AppState>) -> Result<Vec<synology::Todo>, String> {
    let guard = state.0.lock().await;
    guard.as_ref().ok_or("Войдите в NAS.")?.client.todos().await
}
#[tauri::command]
async fn create_todo(
    state: State<'_, AppState>,
    title: String,
    due_date: Option<i64>,
    note_id: Option<String>,
) -> Result<synology::TodoCreated, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .create_todo(&title, due_date, note_id.as_deref())
        .await
}
#[tauri::command]
async fn set_todo_done(
    state: State<'_, AppState>,
    id: String,
    done: bool,
    expected_done: bool,
) -> Result<synology::TodoUpdate, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .set_todo_done(&id, done, expected_done)
        .await
}
#[tauri::command]
async fn list_tags(state: State<'_, AppState>) -> Result<Vec<synology::Tag>, String> {
    let guard = state.0.lock().await;
    guard.as_ref().ok_or("Войдите в NAS.")?.client.tags().await
}
#[tauri::command]
async fn list_tag_notes(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<NoteSummary>, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .notes_for_tag(&id)
        .await
}
#[tauri::command]
async fn list_shared_notebooks(state: State<'_, AppState>) -> Result<Vec<Notebook>, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .shared_notebooks()
        .await
}
#[tauri::command]
async fn list_shared_notes(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<NoteSummary>, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .shared_notes(&id)
        .await
}
#[tauri::command]
async fn list_recycled_notes(state: State<'_, AppState>) -> Result<Vec<NoteSummary>, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .recycled_notes()
        .await
}
#[tauri::command]
async fn get_section_note(
    state: State<'_, AppState>,
    id: String,
    context: synology::AccessContext,
) -> Result<Note, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .section_note(&id, context)
        .await
}
#[tauri::command]
async fn restore_recycled_note(
    state: State<'_, AppState>,
    id: String,
    context: synology::AccessContext,
) -> Result<synology::SectionMutation, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .restore_recycled_note(&id, context)
        .await
}

#[tauri::command]
async fn list_notebooks(state: State<'_, AppState>) -> Result<Vec<Notebook>, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .notebooks()
        .await
}
#[tauri::command]
async fn list_notes(state: State<'_, AppState>) -> Result<Vec<NoteSummary>, String> {
    let guard = state.0.lock().await;
    guard.as_ref().ok_or("Войдите в NAS.")?.client.notes().await
}
#[tauri::command]
async fn get_note(state: State<'_, AppState>, id: String) -> Result<Note, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .note(&id)
        .await
}
#[tauri::command]
async fn list_note_versions(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<NoteVersion>, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .note_versions(&id)
        .await
}

#[tauri::command]
async fn get_note_version(
    state: State<'_, AppState>,
    id: String,
    version: serde_json::Value,
) -> Result<Note, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .note_version(&id, version)
        .await
}

#[tauri::command]
async fn restore_note_version(
    state: State<'_, AppState>,
    id: String,
    version: serde_json::Value,
    expected_version: serde_json::Value,
) -> Result<SavedNote, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .restore_note_version(&id, version, expected_version)
        .await
}

#[tauri::command]
async fn save_note(
    state: State<'_, AppState>,
    id: String,
    expected_version: serde_json::Value,
    title: String,
    content: String,
    brief: String,
) -> Result<SavedNote, String> {
    let guard = state.0.lock().await;
    guard
        .as_ref()
        .ok_or("Войдите в NAS.")?
        .client
        .save_note(&id, expected_version, title, content, brief)
        .await
}

#[tauri::command]
async fn logout(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<LogoutResult, String> {
    let mut guard = state.0.lock().await;
    let store = store(&app)?;
    let had_saved = store.exists();
    // If deletion fails, retain the active session so the UI can offer retry.
    // Once deletion succeeds, network failures cannot resurrect the local token.
    if let Some(active) = guard.as_ref() {
        store.remove(&active.connection.server, &active.connection.account)?;
    }
    if let Some(active) = guard.take() {
        return match active.client.logout().await {
            Ok(()) => Ok(LogoutResult { server_revoked: true, notice: None }),
            Err(_) => Ok(LogoutResult { server_revoked: false, notice: Some("Сессия удалена с компьютера. NAS не подтвердил выход; серверная сессия может оставаться действующей до тайм-аута.".into()) }),
        };
    }
    Ok(LogoutResult {
        server_revoked: false,
        notice: if had_saved {
            Some("Сохранённая сессия удалена с компьютера. Серверная сессия завершится по тайм-ауту NAS.".into())
        } else {
            None
        },
    })
}

#[tauri::command]
fn register_close_guard(state: State<'_, AppState>) {
    state.1.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn close_window(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.2.store(true, Ordering::SeqCst);
    let result = app
        .get_webview_window("main")
        .ok_or("Окно не найдено.")?
        .close()
        .map_err(|_| "Не удалось закрыть окно.".to_string());
    if result.is_err() {
        state.2.store(false, Ordering::SeqCst);
    }
    result
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .manage(SpellingState::default())
        .setup(|app| {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or("Не найдена конфигурация главного окна.")?;
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(external_links::app_navigation)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if state.1.load(Ordering::SeqCst) && !state.2.load(Ordering::SeqCst) {
                    let _ = window.emit("request-close", ());
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_external_url,
            spelling_licenses,
            check_spelling,
            spelling_suggestions,
            login,
            list_accounts,
            switch_account,
            forget_account,
            restore_session,
            set_session_persistence,
            has_saved_session,
            list_todos,
            create_todo,
            set_todo_done,
            list_tags,
            list_tag_notes,
            list_shared_notebooks,
            list_shared_notes,
            list_recycled_notes,
            get_section_note,
            restore_recycled_note,
            list_notebooks,
            list_notes,
            get_note,
            save_note,
            list_note_versions,
            get_note_version,
            restore_note_version,
            register_close_guard,
            close_window,
            logout
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Note Station Rust");
}
