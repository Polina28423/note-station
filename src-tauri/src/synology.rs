use reqwest::{redirect::Policy, Certificate, Client, ClientBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, time::Duration};
use url::Url;

const SESSION: &str = "notestation";
const MAX_RESPONSE: usize = 16 * 1024 * 1024;
const MAX_CERTIFICATE: usize = 64 * 1024;

#[derive(Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionMode {
    #[default]
    Strict,
    UnverifiedTls,
    PlainHttp,
}

#[cfg(test)]
fn http_builder(trusted_certificate_pem: Option<&str>) -> Result<ClientBuilder, String> {
    http_builder_for_mode(trusted_certificate_pem, ConnectionMode::Strict)
}

fn http_builder_for_mode(
    trusted_certificate_pem: Option<&str>,
    mode: ConnectionMode,
) -> Result<ClientBuilder, String> {
    if mode != ConnectionMode::Strict && trusted_certificate_pem.is_some() {
        return Err("Доверенный сертификат применяется только в режиме HTTPS с проверкой.".into());
    }
    let mut builder = Client::builder()
        .https_only(mode != ConnectionMode::PlainHttp)
        .danger_accept_invalid_certs(mode == ConnectionMode::UnverifiedTls)
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(40));
    if let Some(pem) = trusted_certificate_pem {
        if pem.len() > MAX_CERTIFICATE {
            return Err("Файл сертификата превышает 64 КБ.".into());
        }
        if pem.contains("PRIVATE KEY") {
            return Err("Выберите только публичный сертификат PEM, без закрытого ключа.".into());
        }
        let certificates = Certificate::from_pem_bundle(pem.as_bytes())
            .map_err(|_| "Не удалось прочитать сертификат PEM.".to_string())?;
        if certificates.len() != 1 {
            return Err("Файл должен содержать ровно один публичный сертификат PEM.".into());
        }
        // Additional trust is limited to this client/session. Hostname, expiry and
        // TLS signatures are still checked; the Windows trust store is unchanged.
        for certificate in certificates {
            builder = builder.add_root_certificate(certificate);
        }
    }
    Ok(builder)
}

// No Debug implementation: this object holds a session credential.
pub struct NasClient {
    http: Client,
    base: Url,
    apis: HashMap<String, ApiInfo>,
    sid: Option<String>,
}

impl Drop for NasClient {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        if let Some(sid) = self.sid.as_mut() {
            sid.zeroize();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiInfo {
    path: String,
    min_version: u32,
    max_version: u32,
}

#[derive(Serialize, Deserialize)]
pub struct Notebook {
    pub object_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub stack: Option<String>,
    #[serde(default)]
    pub owner: Option<NotebookOwner>,
}

#[derive(Serialize, Deserialize)]
pub struct NotebookOwner {
    #[serde(default)]
    pub uid: Option<Value>,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Serialize, Deserialize)]
pub struct NoteSummary {
    pub object_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub parent_id: String,
    #[serde(default)]
    pub brief: Option<String>,
    #[serde(default)]
    pub mtime: Option<Value>,
}

#[derive(Serialize)]
pub struct Note {
    pub object_id: String,
    pub ver: Option<Value>,
    pub title: String,
    pub content: String,
    pub encrypted: bool,
}

#[derive(Serialize)]
pub struct SavedNote {
    pub note: Note,
    pub notice: Option<String>,
}

#[cfg(test)]
fn normalize_server(server: &str) -> Result<Url, String> {
    normalize_server_for_mode(server, ConnectionMode::Strict)
}

fn normalize_server_for_mode(server: &str, mode: ConnectionMode) -> Result<Url, String> {
    let mut url = Url::parse(server.trim())
        .map_err(|_| "Введите полный адрес NAS с http:// или https://.".to_string())?;
    let expected_scheme = if mode == ConnectionMode::PlainHttp {
        "http"
    } else {
        "https"
    };
    if url.scheme() != expected_scheme || url.host_str().is_none() {
        return Err(format!(
            "Для выбранного режима укажите адрес {expected_scheme}:// ."
        ));
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Адрес не должен содержать пароль, параметры или фрагмент.".into());
    }
    if url.path() != "/" && !url.path().is_empty() {
        return Err("Укажите корень NAS, например https://nas.example:5001 .".into());
    }
    url.set_path("/");
    Ok(url)
}

fn endpoint(base: &Url, path: &str) -> Result<Url, String> {
    // API discovery is server-controlled. Never allow it to redirect credentials elsewhere.
    if path.is_empty()
        || path
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
        || !path
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"/_-.".contains(&c))
    {
        return Err("NAS вернул недопустимый путь API.".into());
    }
    base.join(&format!("webapi/{path}"))
        .map_err(|_| "Некорректный путь API.".into())
}

fn decode_response(value: Value) -> Result<Value, String> {
    if value.get("success").and_then(Value::as_bool) != Some(true) {
        let code = value
            .pointer("/error/code")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let hint = match code {
            105 | 106 | 107 | 119 => {
                "Сессия недействительна или нет доступа. Выйдите и войдите снова."
            }
            400 => "Проверьте имя пользователя и пароль.",
            403 => "Требуется код двухфакторной аутентификации.",
            404 => "Неверный код двухфакторной аутентификации.",
            _ => "NAS отклонил запрос.",
        };
        return Err(format!("{hint} Код API: {code}."));
    }
    value
        .get("data")
        .cloned()
        .ok_or_else(|| "В ответе NAS отсутствует data.".into())
}

fn encode_entry(params: Vec<(String, Value)>) -> Vec<(String, String)> {
    // Legacy Note Station entry.cgi expects JSON-encoded field values, including strings.
    params
        .into_iter()
        .map(|(key, value)| (key, value.to_string()))
        .collect()
}

impl NasClient {
    pub fn session_id(&self) -> Result<&str, String> {
        self.sid.as_deref().ok_or_else(|| "Нет сессии NAS.".into())
    }

    pub fn resume_session(&mut self, sid: String) -> Result<(), String> {
        if sid.is_empty() || sid.len() > 8192 {
            return Err("Некорректная сохранённая сессия.".into());
        }
        self.sid = Some(sid);
        Ok(())
    }

    pub async fn connect(
        server: &str,
        trusted_certificate_pem: Option<&str>,
        mode: ConnectionMode,
    ) -> Result<Self, String> {
        let base = normalize_server_for_mode(server, mode)?;
        let mut client = Self {
            http: http_builder_for_mode(trusted_certificate_pem, mode)?
                .build()
                .map_err(|_| "Не удалось создать HTTPS-клиент.".to_string())?,
            base,
            apis: HashMap::new(),
            sid: None,
        };
        let data = client
            .post(
                "query.cgi",
                vec![
                    ("api".into(), "SYNO.API.Info".into()),
                    ("version".into(), "1".into()),
                    ("method".into(), "query".into()),
                    (
                        "query".into(),
                        "SYNO.API.Auth,SYNO.NoteStation.Notebook,SYNO.NoteStation.Note".into(),
                    ),
                ],
            )
            .await?;
        client.apis = serde_json::from_value(data)
            .map_err(|_| "Неизвестный формат каталога API NAS.".to_string())?;
        Ok(client)
    }

    async fn post(&self, path: &str, fields: Vec<(String, String)>) -> Result<Value, String> {
        let mut response = self.http.post(endpoint(&self.base, path)?)
            .form(&fields).send().await.map_err(|e| {
                // Never expose reqwest error URLs, request bodies or server diagnostics.
                if e.is_timeout() { "NAS не ответил вовремя." }
                else if e.is_connect() && self.base.scheme() == "http" { "Не удалось подключиться к NAS по HTTP. Проверьте адрес, порт и сеть." }
                else if e.is_connect() { "Не удалось подключиться к NAS. Проверьте сеть и сертификат. Для самоподписанного выберите публичный PEM-файл; адрес NAS должен совпадать с именем в сертификате, срок действия не должен истечь." }
                else { "Ошибка запроса к NAS." }.to_string()
            })?;
        if !response.status().is_success() {
            return Err(format!("NAS вернул HTTP {}.", response.status().as_u16()));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Не удалось прочитать ответ NAS.".to_string())?
        {
            if body.len() + chunk.len() > MAX_RESPONSE {
                return Err("Ответ NAS превышает 16 МБ.".into());
            }
            body.extend_from_slice(&chunk);
        }
        decode_response(
            serde_json::from_slice(&body)
                .map_err(|_| "NAS вернул некорректный JSON.".to_string())?,
        )
    }

    fn api(&self, name: &str, version: u32) -> Result<&ApiInfo, String> {
        let info = self
            .apis
            .get(name)
            .ok_or_else(|| format!("NAS не предоставляет {name}. Установлен ли Note Station?"))?;
        if version < info.min_version || version > info.max_version {
            return Err(format!("{name}: NAS не поддерживает версию {version}."));
        }
        Ok(info)
    }

    pub async fn login(
        &mut self,
        account: &str,
        password: String,
        otp: &str,
    ) -> Result<(), String> {
        if account.trim().is_empty() || password.is_empty() {
            return Err("Введите имя пользователя и пароль.".into());
        }
        let info = self
            .apis
            .get("SYNO.API.Auth")
            .ok_or("NAS не предоставляет API авторизации.")?;
        let version = info.max_version.min(6);
        if version < info.min_version {
            return Err("Неподдерживаемая версия API входа.".into());
        }
        let mut fields = vec![
            ("api".into(), "SYNO.API.Auth".into()),
            ("version".into(), version.to_string()),
            ("method".into(), "login".into()),
            ("format".into(), "sid".into()),
            ("session".into(), SESSION.into()),
            ("account".into(), account.into()),
            ("passwd".into(), password),
        ];
        if !otp.trim().is_empty() {
            fields.push(("otp_code".into(), otp.trim().into()));
        }
        let data = self.post(&info.path, fields).await?;
        self.sid = Some(
            data.get("sid")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .ok_or("NAS не вернул идентификатор сессии.")?
                .to_string(),
        );
        Ok(())
    }

    async fn call(
        &self,
        api: &str,
        method: &str,
        params: Vec<(String, Value)>,
    ) -> Result<Value, String> {
        self.call_version(api, 2, method, params).await
    }

    async fn call_version(
        &self,
        api: &str,
        version: u32,
        method: &str,
        params: Vec<(String, Value)>,
    ) -> Result<Value, String> {
        let info = self.api(api, version)?;
        let mut fields = params;
        fields.extend([
            ("api".into(), json!(api)),
            ("version".into(), json!(version)),
            ("method".into(), json!(method)),
            (
                "_sid".into(),
                json!(self.sid.as_ref().ok_or("Нет сессии NAS.")?),
            ),
        ]);
        self.post(&info.path, encode_entry(fields)).await
    }

    async fn list(&self, api: &str, key: &str) -> Result<Vec<Value>, String> {
        let mut rows = Vec::new();
        for _ in 0..50 {
            let data = self
                .call(
                    api,
                    "list",
                    vec![
                        ("offset".into(), json!(rows.len())),
                        ("limit".into(), json!(200)),
                    ],
                )
                .await?;
            let page = match data.get(key) {
                Some(Value::Array(page)) => page.clone(),
                None | Some(Value::Null)
                    if data.get("total").and_then(Value::as_u64) == Some(0) =>
                {
                    Vec::new()
                }
                _ => return Err(format!("Неизвестный формат списка {key}.")),
            };
            let count = page.len();
            if count == 0 {
                if data
                    .get("total")
                    .and_then(Value::as_u64)
                    .is_some_and(|n| n > rows.len() as u64)
                {
                    return Err("NAS вернул неполный список.".into());
                }
                return Ok(rows);
            }
            rows.extend(page);
            let total = data.get("total").and_then(Value::as_u64);
            if total.is_some_and(|n| rows.len() as u64 >= n) || (total.is_none() && count < 200) {
                return Ok(rows);
            }
        }
        Err("Слишком большой список или NAS не поддерживает пагинацию (лимит 10 000).".into())
    }

    pub async fn notebooks(&self) -> Result<Vec<Notebook>, String> {
        serde_json::from_value(json!(
            self.list("SYNO.NoteStation.Notebook", "notebooks").await?
        ))
        .map_err(|_| "Неизвестный формат блокнотов.".into())
    }

    pub async fn notes(&self) -> Result<Vec<NoteSummary>, String> {
        serde_json::from_value(json!(self.list("SYNO.NoteStation.Note", "notes").await?))
            .map_err(|_| "Неизвестный формат заметок.".into())
    }

    pub async fn note(&self, id: &str) -> Result<Note, String> {
        if id.is_empty() || id.len() > 1024 {
            return Err("Некорректный ID заметки.".into());
        }
        let data = self
            .call(
                "SYNO.NoteStation.Note",
                "get",
                vec![("object_id".into(), json!(id))],
            )
            .await?;
        let encrypted = data
            .get("encrypt")
            .is_some_and(|v| v == &json!(true) || v == &json!(1));
        Ok(Note {
            object_id: id.into(),
            ver: data.get("ver").filter(|v| !v.is_null()).cloned(),
            title: data
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Без названия")
                .into(),
            content: if encrypted {
                String::new()
            } else {
                data.get("content")
                    .and_then(Value::as_str)
                    .ok_or("NAS не вернул текст заметки.")?
                    .into()
            },
            encrypted,
        })
    }

    pub async fn save_note(
        &self,
        id: &str,
        expected_version: Value,
        title: String,
        content: String,
        brief: String,
    ) -> Result<SavedNote, String> {
        validate_note_update(id, &expected_version, &title, &content, &brief)?;
        self.api("SYNO.NoteStation.Note", 3)?;
        let current = self.note(id).await?;
        if current.encrypted {
            return Err("Редактирование зашифрованных заметок пока не поддерживается.".into());
        }
        if current.ver.as_ref() != Some(&expected_version) {
            return Err("Заметка изменена на NAS с момента открытия. Скопируйте свой текст, отмените редактирование и откройте свежую версию.".into());
        }
        let result = self
            .call_version(
                "SYNO.NoteStation.Note",
                3,
                "set",
                vec![
                    ("object_id".into(), json!(id)),
                    ("ver".into(), expected_version),
                    ("check_conflict".into(), json!(true)),
                    ("title".into(), json!(title)),
                    ("content".into(), json!(content)),
                    ("brief".into(), json!(brief)),
                    (
                        "commit_msg".into(),
                        json!({"device":"desktop","listable":true}),
                    ),
                ],
            )
            .await?;
        // A successful write must not be reported as a failed write if the
        // follow-up read is unavailable: that could encourage duplicate retries.
        match self.note(id).await {
            Ok(note) => {
                let newer = result.pointer("/data/0/ver").is_some_and(|version| note.ver.as_ref() != Some(version));
                Ok(SavedNote { note, notice: newer.then(|| "После сохранения появилась другая версия заметки. Показана актуальная версия с NAS.".into()) })
            },
            Err(_) => Ok(SavedNote { note: Note { object_id:id.into(), title, content, encrypted:false,
                ver: result.pointer("/data/0/ver").cloned() }, notice: Some("NAS подтвердил сохранение, но повторное чтение не удалось. Обновите библиотеку перед дальнейшим редактированием.".into()) }),
        }
    }

    pub async fn logout(&self) -> Result<(), String> {
        let Some(sid) = &self.sid else {
            return Ok(());
        };
        let info = self
            .apis
            .get("SYNO.API.Auth")
            .ok_or("Нет API авторизации.")?;
        // Logout may return success without data, unlike read calls.
        let result = self
            .post(
                &info.path,
                vec![
                    ("api".into(), "SYNO.API.Auth".into()),
                    ("version".into(), "1".into()),
                    ("method".into(), "logout".into()),
                    ("session".into(), SESSION.into()),
                    ("_sid".into(), sid.clone()),
                ],
            )
            .await;
        match result {
            Err(error) if error == "В ответе NAS отсутствует data." => Ok(()),
            other => other.map(|_| ()),
        }
    }
}

fn validate_note_update(
    id: &str,
    version: &Value,
    title: &str,
    content: &str,
    brief: &str,
) -> Result<(), String> {
    if id.is_empty() || id.len() > 1024 {
        return Err("Некорректный ID заметки.".into());
    }
    let valid_version = version
        .as_str()
        .is_some_and(|v| !v.is_empty() && v.len() <= 1024)
        || version.as_u64().is_some();
    if !valid_version {
        return Err("NAS не вернул версию заметки. Обновите заметку перед редактированием.".into());
    }
    if title.trim().is_empty() || title.chars().count() > 1024 {
        return Err("Введите заголовок длиной до 1024 символов.".into());
    }
    if content.len() > 8 * 1024 * 1024 || brief.len() > 4096 {
        return Err("Слишком большой размер заметки.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notebook_response_preserves_shelf_and_owner_without_requiring_them() {
        let notebook: Notebook = serde_json::from_value(json!({
            "object_id":"book-a", "title":"Проект", "stack":"Работа",
            "owner":{"uid":1001,"display_name":"Анна"}
        }))
        .unwrap();
        let output = serde_json::to_value(notebook).unwrap();
        assert_eq!(output["stack"], "Работа");
        assert_eq!(output["owner"]["uid"], 1001);
        for response in [
            json!({"object_id":"legacy"}),
            json!({"object_id":"plain","stack":null,"owner":null}),
        ] {
            let notebook: Notebook = serde_json::from_value(response).unwrap();
            assert!(notebook.stack.is_none());
        }
    }

    #[test]
    fn rejects_invalid_or_private_certificate_files() {
        assert!(http_builder(Some("")).is_err());
        assert!(http_builder(Some("not a certificate")).is_err());
        assert!(http_builder(Some("-----BEGIN PRIVATE KEY-----")).is_err());
        assert!(http_builder(Some(&"x".repeat(MAX_CERTIFICATE + 1))).is_err());
        let certificate = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let pem = certificate.cert.pem();
        assert!(http_builder(Some(&(pem.clone() + &pem))).is_err());
    }

    // Real loopback TLS: verifies the production trust builder against an
    // ephemeral self-signed server, without a NAS, credentials or system changes.
    fn tls_probe(trust_certificate: bool, matching_hostname: bool, expired: bool) -> (bool, bool) {
        tls_probe_with_mode(
            trust_certificate,
            matching_hostname,
            expired,
            ConnectionMode::Strict,
        )
    }

    fn tls_probe_with_mode(
        trust_certificate: bool,
        matching_hostname: bool,
        expired: bool,
        mode: ConnectionMode,
    ) -> (bool, bool) {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            sync::Arc,
            thread,
        };
        let key_pair = rcgen::KeyPair::generate().unwrap();
        let mut params = rcgen::CertificateParams::new(vec!["localhost".into()]).unwrap();
        if expired {
            params.not_before = rcgen::date_time_ymd(2020, 1, 1);
            params.not_after = rcgen::date_time_ymd(2021, 1, 1);
        }
        let certificate = params.self_signed(&key_pair).unwrap();
        let pem = certificate.pem();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![certificate.der().clone()],
            rustls::pki_types::PrivatePkcs8KeyDer::from(key_pair.serialize_der()).into(),
        )
        .unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let tcp = loop {
                match listener.accept() {
                    Ok((tcp, _)) => break tcp,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if std::time::Instant::now() >= deadline {
                            return false;
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("Local TLS test listener failed: {error}"),
                }
            };
            tcp.set_nonblocking(false).unwrap();
            tcp.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            tcp.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
            let connection = rustls::ServerConnection::new(Arc::new(config)).unwrap();
            let mut tls = rustls::StreamOwned::new(connection, tcp);
            let mut buffer = [0; 8192];
            let received_http = matches!(tls.read(&mut buffer), Ok(n) if n > 0);
            if received_http {
                let body = r#"{"success":true,"data":{"ok":true}}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = tls.write_all(response.as_bytes());
                let _ = tls.flush();
            }
            received_http
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let success = runtime.block_on(async {
            let hostname = if matching_hostname {
                "localhost"
            } else {
                "127.0.0.1"
            };
            let builder =
                http_builder_for_mode(if trust_certificate { Some(&pem) } else { None }, mode)
                    .unwrap();
            let client = NasClient {
                http: builder
                    .no_proxy()
                    .resolve("localhost", address)
                    .build()
                    .unwrap(),
                base: normalize_server(&format!("https://{hostname}:{}", address.port())).unwrap(),
                apis: HashMap::new(),
                sid: None,
            };
            client.post("query.cgi", vec![]).await.is_ok()
        });
        (success, server.join().unwrap())
    }

    #[test]
    fn explicitly_trusted_self_signed_certificate_connects() {
        assert_eq!(tls_probe(true, true, false), (true, true));
    }

    #[test]
    fn self_signed_certificate_is_rejected_by_default_before_http() {
        assert_eq!(tls_probe(false, true, false), (false, false));
    }

    #[test]
    fn importing_certificate_does_not_disable_hostname_check() {
        assert_eq!(tls_probe(true, false, false), (false, false));
    }

    #[test]
    fn importing_certificate_does_not_disable_expiry_check() {
        assert_eq!(tls_probe(true, true, true), (false, false));
    }

    #[test]
    fn explicitly_selected_unverified_tls_needs_no_certificate_file() {
        assert_eq!(
            tls_probe_with_mode(false, false, true, ConnectionMode::UnverifiedTls),
            (true, true)
        );
    }

    #[test]
    fn connection_modes_require_matching_scheme_and_explicit_http() {
        assert!(normalize_server_for_mode("http://nas:5000", ConnectionMode::Strict).is_err());
        assert!(
            normalize_server_for_mode("http://nas:5000", ConnectionMode::UnverifiedTls).is_err()
        );
        assert!(normalize_server_for_mode("https://nas:5001", ConnectionMode::PlainHttp).is_err());
        assert!(normalize_server_for_mode("http://nas:5000", ConnectionMode::PlainHttp).is_ok());
        assert!(
            normalize_server_for_mode("http://user:secret@nas", ConnectionMode::PlainHttp).is_err()
        );
        assert!(http_builder_for_mode(Some("ignored"), ConnectionMode::UnverifiedTls).is_err());
        assert!(http_builder_for_mode(Some("ignored"), ConnectionMode::PlainHttp).is_err());
    }

    #[test]
    fn explicitly_selected_http_connects_to_plain_server() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            thread,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let mut tcp = loop {
                match listener.accept() {
                    Ok((tcp, _)) => break tcp,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if std::time::Instant::now() >= deadline {
                            return false;
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("Local HTTP listener failed: {error}"),
                }
            };
            tcp.set_nonblocking(false).unwrap();
            tcp.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            tcp.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut buffer = [0; 8192];
            let count = tcp.read(&mut buffer).unwrap();
            let valid_request = buffer[..count].starts_with(b"POST /webapi/query.cgi HTTP/1.1");
            let body = r#"{"success":true,"data":{}}"#;
            write!(
                tcp,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            valid_request
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = runtime.block_on(async {
            let client = NasClient {
                http: http_builder_for_mode(None, ConnectionMode::PlainHttp)
                    .unwrap()
                    .no_proxy()
                    .build()
                    .unwrap(),
                base: normalize_server_for_mode(
                    &format!("http://{address}"),
                    ConnectionMode::PlainHttp,
                )
                .unwrap(),
                apis: HashMap::new(),
                sid: None,
            };
            client.post("query.cgi", vec![]).await
        });
        assert!(server.join().unwrap());
        assert_eq!(result.unwrap(), json!({}));
    }

    #[test]
    fn rejects_unsafe_server_urls() {
        for url in [
            "http://nas:5000",
            "https://user:secret@nas",
            "https://nas/?sid=x",
            "https://nas/#x",
            "https://nas/webapi",
            "file:///notes",
        ] {
            assert!(normalize_server(url).is_err(), "{url}");
        }
        assert_eq!(
            normalize_server(" https://nas:5001 ").unwrap().as_str(),
            "https://nas:5001/"
        );
    }

    #[test]
    fn discovery_cannot_send_credentials_to_another_origin() {
        let base = normalize_server("https://nas:5001").unwrap();
        for path in [
            "https://evil/",
            "//evil",
            "../entry.cgi",
            "%2e%2e/x",
            "x?host=evil",
            "x\\y",
        ] {
            assert!(endpoint(&base, path).is_err());
        }
        assert_eq!(
            endpoint(&base, "auth.cgi").unwrap().as_str(),
            "https://nas:5001/webapi/auth.cgi"
        );
    }

    #[test]
    fn entry_fields_match_legacy_json_encoding() {
        let fields = encode_entry(vec![
            ("object_id".into(), json!("a\"b")),
            ("version".into(), json!(2)),
        ]);
        assert_eq!(fields[0].1, "\"a\\\"b\"");
        assert_eq!(fields[1].1, "2");
    }

    #[test]
    fn api_errors_never_echo_server_secrets() {
        let error =
            decode_response(json!({"success":false,"error":{"code":403,"message":"secret-token"}}))
                .unwrap_err();
        assert!(error.contains("403"));
        assert!(!error.contains("secret-token"));
        assert!(decode_response(json!({"data":{}})).is_err());
        assert_eq!(
            decode_response(json!({"success":true,"data":{"notes":[]}})).unwrap(),
            json!({"notes":[]})
        );
    }
    fn save_fixture(
        conflict: bool,
        failed_readback: bool,
    ) -> (String, std::thread::JoinHandle<()>) {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            thread,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            let count = if conflict { 1 } else { 3 };
            for index in 0..count {
                let deadline = std::time::Instant::now() + Duration::from_secs(5);
                let mut tcp = loop {
                    match listener.accept() {
                        Ok((tcp, _)) => break tcp,
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(std::time::Instant::now() < deadline, "Missing request");
                            thread::sleep(Duration::from_millis(10));
                        }
                        Err(e) => panic!("{e}"),
                    }
                };
                tcp.set_nonblocking(false).unwrap();
                tcp.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                tcp.set_write_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut bytes = Vec::new();
                let (header_end, length) = loop {
                    let mut buffer = [0; 8192];
                    let n = tcp.read(&mut buffer).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buffer[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&bytes[..end]);
                        let size = header
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|v| v.trim().parse::<usize>().unwrap())
                            })
                            .unwrap();
                        break (end + 4, size);
                    }
                };
                while bytes.len() < header_end + length {
                    let mut buffer = [0; 8192];
                    let n = tcp.read(&mut buffer).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buffer[..n]);
                }
                assert!(
                    String::from_utf8_lossy(&bytes).starts_with("POST /webapi/entry.cgi HTTP/1.1")
                );
                let fields: HashMap<String, Value> =
                    url::form_urlencoded::parse(&bytes[header_end..header_end + length])
                        .map(|(k, v)| (k.into_owned(), serde_json::from_str(&v).unwrap()))
                        .collect();
                assert_eq!(fields["_sid"], "synthetic-save-token");
                let data = if index == 1 {
                    assert_eq!(fields["method"], "set");
                    assert_eq!(fields["version"], 3);
                    assert_eq!(fields["ver"], "v1");
                    assert_eq!(fields["check_conflict"], true);
                    assert_eq!(fields["title"], "Новый заголовок");
                    assert!(fields["content"].as_str().unwrap().contains("data-file-id"));
                    for forbidden in ["attachment", "parent_id", "recycle", "encrypt"] {
                        assert!(!fields.contains_key(forbidden));
                    }
                    json!({"data":[{"ver":"v2","object_id":"note-a"}]})
                } else {
                    assert_eq!(fields["method"], "get");
                    json!({"object_id":"note-a","title":if index==0 {"Старый"} else {"Новый заголовок"},"content":"<p>Текст</p>","ver":if conflict {"changed"} else if index==0 {"v1"} else {"v2"}})
                };
                let response = if index == 2 && failed_readback {
                    json!({"success":false,"error":{"code":119}})
                } else {
                    json!({"success":true,"data":data})
                };
                let body = response.to_string();
                write!(
                    tcp,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            }
        });
        (format!("http://{address}"), worker)
    }
    fn run_save_case(conflict: bool, failed_readback: bool) -> Result<SavedNote, String> {
        let (server, worker) = save_fixture(conflict, failed_readback);
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let result = rt.block_on(async {
            let client = NasClient {
                http: http_builder_for_mode(None, ConnectionMode::PlainHttp)
                    .unwrap()
                    .no_proxy()
                    .build()
                    .unwrap(),
                base: normalize_server_for_mode(&server, ConnectionMode::PlainHttp).unwrap(),
                apis: HashMap::from([(
                    "SYNO.NoteStation.Note".into(),
                    ApiInfo {
                        path: "entry.cgi".into(),
                        min_version: 1,
                        max_version: 3,
                    },
                )]),
                sid: Some("synthetic-save-token".into()),
            };
            client
                .save_note(
                    "note-a",
                    json!("v1"),
                    "Новый заголовок".into(),
                    "<p>Текст</p><img data-file-id=\"existing\" src=\"original.png\">".into(),
                    "Текст".into(),
                )
                .await
        });
        worker.join().unwrap();
        result
    }
    #[test]
    fn saves_note_with_server_conflict_check_and_no_attachment_mutations() {
        let result = run_save_case(false, false).unwrap();
        assert_eq!(result.note.ver, Some(json!("v2")));
        assert!(result.notice.is_none());
    }
    #[test]
    fn stale_note_is_not_written() {
        let error = run_save_case(true, false).err().unwrap();
        assert!(error.contains("изменена на NAS"));
    }
    #[test]
    fn successful_write_with_failed_readback_is_reported_as_saved() {
        let result = run_save_case(false, true).unwrap();
        assert!(result.notice.is_some());
        assert_eq!(result.note.ver, Some(json!("v2")));
    }
    #[test]
    fn rejects_unversioned_or_empty_title_updates() {
        assert!(validate_note_update("id", &Value::Null, "Title", "body", "").is_err());
        assert!(validate_note_update("id", &json!("v1"), "  ", "body", "").is_err());
        assert!(validate_note_update("id", &json!("v1"), "Title", "", "").is_ok());
    }
}
