use crate::media::{image_data, ImageData, ImageUpload, MAX_IMAGE, MAX_UPLOAD};
use reqwest::{redirect::Policy, Certificate, Client, ClientBuilder};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, time::Duration};
use url::Url;

#[cfg(test)]
#[path = "media_tests.rs"]
mod media_tests;

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
    #[serde(default)]
    pub shared: Value,
    #[serde(default)]
    pub individual_shared: Value,
    #[serde(default)]
    pub category: String,
    #[serde(flatten)]
    pub access: AccessContext,
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
    #[serde(default)]
    pub tag: Value,
    #[serde(default)]
    pub recycle: Value,
    #[serde(flatten)]
    pub access: AccessContext,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct AccessContext {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perm_from: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smart_id: Option<String>,
}
impl AccessContext {
    fn params(&self) -> Result<Vec<(String, Value)>, String> {
        let mut params = Vec::new();
        if let Some(value) = &self.perm_from {
            validate_version(value)?;
            params.push(("perm_from".into(), value.clone()));
        }
        if let Some(id) = &self.smart_id {
            validate_object_id(id)?;
            params.push(("smart_id".into(), json!(id)));
        }
        Ok(params)
    }
}

#[derive(Serialize, Deserialize)]
pub struct Todo {
    pub object_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, deserialize_with = "deserialize_flag")]
    pub done: bool,
    #[serde(default)]
    pub note_id: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub due_date: Option<Value>,
    #[serde(default)]
    pub items: Vec<Todo>,
}
#[derive(Serialize, Deserialize)]
pub struct Tag {
    #[serde(alias = "object_id", alias = "id")]
    pub tag_id: String,
    #[serde(default)]
    pub title: String,
}
#[derive(Serialize)]
pub struct SectionMutation {
    pub notice: Option<String>,
}
#[derive(Serialize)]
pub struct TodoUpdate {
    pub done: bool,
    pub notice: Option<String>,
}
#[derive(Serialize)]
pub struct TodoCreated {
    pub object_id: Option<String>,
}
fn todo_create_params(
    title: &str,
    due_date: Option<i64>,
    note_id: Option<&str>,
) -> Result<Vec<(String, Value)>, String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 250 || title.chars().any(char::is_control) {
        return Err("Введите название задачи от 1 до 250 символов без управляющих знаков.".into());
    }
    let mut params = vec![("title".into(), json!(title))];
    if let Some(date) = due_date {
        if !(0..=253402300799).contains(&date) {
            return Err("Некорректный срок задачи.".into());
        }
        params.push(("due_date".into(), json!(date)));
    }
    if let Some(id) = note_id {
        validate_object_id(id)?;
        params.push(("note_id".into(), json!(id)));
    }
    Ok(params)
}
fn flag(value: &Value) -> bool {
    value == &json!(true) || value == &json!(1)
}
fn deserialize_flag<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::Bool(value) => Ok(value),
        Value::Number(ref n) if n.as_u64() == Some(0) || n.as_u64() == Some(1) => Ok(flag(&value)),
        Value::Null => Ok(false),
        _ => Err(serde::de::Error::custom("Invalid boolean flag")),
    }
}
fn validate_object_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 1024 {
        Err("Некорректный идентификатор объекта.".into())
    } else {
        Ok(())
    }
}
fn shared_notebook(notebook: &Notebook) -> bool {
    flag(&notebook.shared)
        || flag(&notebook.individual_shared)
        || notebook.access.perm_from.is_some()
        || matches!(notebook.category.as_str(), "shared" | "joined")
}
fn tag_matches(value: &Value, id: &str) -> bool {
    match value {
        Value::String(value) => value == id,
        Value::Array(values) => values.iter().any(|value| tag_matches(value, id)),
        Value::Object(values) => ["tag_id", "object_id", "id"]
            .iter()
            .any(|key| values.get(*key).and_then(Value::as_str) == Some(id)),
        _ => false,
    }
}

#[derive(Serialize)]
pub struct Note {
    pub object_id: String,
    pub ver: Option<Value>,
    pub title: String,
    pub content: String,
    pub encrypted: bool,
    pub tags: Option<Vec<String>>,
    pub images: Vec<ImageReference>,
    pub access: AccessContext,
}
#[derive(Serialize)]
pub struct ImageReference {
    pub file_id: String,
    pub reference: String,
}
fn image_references(data: &Value) -> Vec<ImageReference> {
    data.get("attachment")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|items| items.iter())
        .filter_map(|(id, file)| {
            let reference = file.get("ref")?.as_str()?;
            if id.len() > 1024 || reference.len() > 1024 {
                return None;
            }
            Some(ImageReference {
                file_id: id.clone(),
                reference: reference.into(),
            })
        })
        .collect()
}
#[derive(Serialize)]
pub struct NoteTagState {
    pub ver: Value,
    pub tags: Vec<String>,
    pub catalog: Vec<Tag>,
}
fn validate_tags(tags: &[String]) -> Result<(), String> {
    let unique: std::collections::HashSet<_> = tags.iter().collect();
    if tags.len() > 256
        || unique.len() != tags.len()
        || tags.iter().map(String::len).sum::<usize>() > 32768
        || tags.iter().any(|name| {
            name.trim().is_empty()
                || name.chars().count() > 1024
                || name.chars().any(char::is_control)
        })
    {
        return Err("Некорректный список тегов: проверьте названия и повторы.".into());
    }
    Ok(())
}
fn tag_dictionary(value: &Value) -> Result<Vec<Value>, String> {
    let map = value
        .as_object()
        .ok_or("Неизвестный формат каталога тегов.")?;
    if map.len() > 10000 {
        return Err("Слишком большой каталог тегов.".into());
    }
    map.iter()
        .map(|(id, value)| {
            if value.get("title").and_then(Value::as_str).is_none() {
                return Err("Неизвестный формат каталога тегов.".into());
            }
            let mut row = value.clone();
            row["tag_id"] = json!(id);
            Ok(row)
        })
        .collect()
}

#[derive(Serialize, Deserialize)]
pub struct NoteVersion {
    #[serde(alias = "version")]
    pub ver: Value,
    #[serde(default)]
    pub mtime: Option<Value>,
}

fn validate_version(version: &Value) -> Result<(), String> {
    if version.as_u64().is_some()
        || version
            .as_str()
            .is_some_and(|v| !v.is_empty() && v.len() <= 1024)
    {
        Ok(())
    } else {
        Err("Некорректная версия заметки.".into())
    }
}

fn parse_note_versions(data: Value) -> Result<Vec<NoteVersion>, String> {
    let rows = data
        .get("versions")
        .and_then(Value::as_array)
        .ok_or("Неизвестный формат истории версий NAS.")?;
    if rows.len() > 1000
        || data
            .get("total")
            .and_then(Value::as_u64)
            .is_some_and(|total| total > rows.len() as u64)
    {
        return Err("История превышает доступный лимит 1000 версий или получена не полностью. Откройте историю в официальном клиенте.".into());
    }
    let versions: Vec<NoteVersion> = serde_json::from_value(json!(rows))
        .map_err(|_| "Неизвестный формат версии заметки.".to_string())?;
    for version in &versions {
        validate_version(&version.ver)?;
    }
    Ok(versions)
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
                        "SYNO.API.Auth,SYNO.NoteStation.Notebook,SYNO.NoteStation.Note,SYNO.NoteStation.Note.Version,SYNO.NoteStation.Tag,SYNO.NoteStation.Todo".into(),
                    ),
                ],
            )
            .await?;
        client.apis = serde_json::from_value(data)
            .map_err(|_| "Неизвестный формат каталога API NAS.".to_string())?;
        Ok(client)
    }

    async fn post(&self, path: &str, fields: Vec<(String, String)>) -> Result<Value, String> {
        self.post_with_data(path, fields, false).await
    }
    async fn post_with_data(
        &self,
        path: &str,
        fields: Vec<(String, String)>,
        optional_data: bool,
    ) -> Result<Value, String> {
        let response = self.http.post(endpoint(&self.base, path)?)
            .form(&fields).send().await.map_err(|e| {
                // Never expose reqwest error URLs, request bodies or server diagnostics.
                if e.is_timeout() { "NAS не ответил вовремя." }
                else if e.is_connect() && self.base.scheme() == "http" { "Не удалось подключиться к NAS по HTTP. Проверьте адрес, порт и сеть." }
                else if e.is_connect() { "Не удалось подключиться к NAS. Проверьте сеть и сертификат. Для самоподписанного выберите публичный PEM-файл; адрес NAS должен совпадать с именем в сертификате, срок действия не должен истечь." }
                else { "Ошибка запроса к NAS." }.to_string()
            })?;
        Self::read_json(response, optional_data).await
    }

    async fn read_json(
        mut response: reqwest::Response,
        optional_data: bool,
    ) -> Result<Value, String> {
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
        let value: Value = serde_json::from_slice(&body)
            .map_err(|_| "NAS вернул некорректный JSON.".to_string())?;
        if optional_data
            && value.get("success").and_then(Value::as_bool) == Some(true)
            && value.get("data").is_none()
        {
            return Ok(json!({}));
        }
        decode_response(value)
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
        self.call_version_inner(api, version, method, params, false)
            .await
    }
    async fn call_version_inner(
        &self,
        api: &str,
        version: u32,
        method: &str,
        params: Vec<(String, Value)>,
        optional_data: bool,
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
        self.post_with_data(&info.path, encode_entry(fields), optional_data)
            .await
    }

    async fn list(&self, api: &str, key: &str) -> Result<Vec<Value>, String> {
        self.list_options(api, 2, key, vec![]).await
    }
    async fn list_options(
        &self,
        api: &str,
        version: u32,
        key: &str,
        params: Vec<(String, Value)>,
    ) -> Result<Vec<Value>, String> {
        let mut rows = Vec::new();
        for _ in 0..50 {
            let mut fields = params.clone();
            fields.extend([
                ("offset".into(), json!(rows.len())),
                ("limit".into(), json!(200)),
            ]);
            let data = self.call_version(api, version, "list", fields).await?;
            if key == "tags" && data.get(key).is_none() && data.get("total").is_none() {
                return tag_dictionary(&data);
            }
            let page = match data.get(key).or_else(|| {
                if key == "items" {
                    data.get("todos")
                } else {
                    None
                }
            }) {
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
        let rows = self
            .list_options(
                "SYNO.NoteStation.Note",
                3,
                "notes",
                vec![("filter".into(), json!({"recycle":false}))],
            )
            .await?;
        let notes: Vec<NoteSummary> = serde_json::from_value(json!(rows))
            .map_err(|_| "Неизвестный формат заметок.".to_string())?;
        Ok(notes
            .into_iter()
            .filter(|note| !flag(&note.recycle))
            .collect())
    }

    pub async fn todos(&self) -> Result<Vec<Todo>, String> {
        let rows = self
            .list_options(
                "SYNO.NoteStation.Todo",
                2,
                "items",
                vec![("field".into(), json!({"items":true}))],
            )
            .await?;
        serde_json::from_value(json!(rows)).map_err(|_| "Неизвестный формат задач NAS.".into())
    }
    pub async fn create_todo(
        &self,
        title: &str,
        due_date: Option<i64>,
        note_id: Option<&str>,
    ) -> Result<TodoCreated, String> {
        let params = todo_create_params(title, due_date, note_id)?;
        let data = self
            .call_version_inner("SYNO.NoteStation.Todo", 2, "create", params, true)
            .await?;
        let object_id = data
            .get("object_id")
            .and_then(Value::as_str)
            .filter(|id| validate_object_id(id).is_ok())
            .map(str::to_owned);
        Ok(TodoCreated { object_id })
    }
    pub async fn set_todo_done(
        &self,
        id: &str,
        done: bool,
        expected_done: bool,
    ) -> Result<TodoUpdate, String> {
        validate_object_id(id)?;
        let current = self
            .call(
                "SYNO.NoteStation.Todo",
                "get",
                vec![("object_id".into(), json!(id))],
            )
            .await?;
        if !current
            .get("done")
            .is_some_and(|value| value.is_boolean() || matches!(value.as_u64(), Some(0 | 1)))
        {
            return Err("NAS не вернул состояние задачи. Обновите список.".into());
        }
        let current: Todo = serde_json::from_value(current)
            .map_err(|_| "Неизвестный формат задачи NAS.".to_string())?;
        if current.object_id != id {
            return Err("NAS вернул другую задачу. Обновите список.".into());
        }
        if current.done != expected_done {
            return Err("Состояние задачи уже изменилось на NAS. Обновите список.".into());
        }
        if current.done == done {
            return Ok(TodoUpdate { done, notice: None });
        }
        self.call_version_inner(
            "SYNO.NoteStation.Todo",
            2,
            "set",
            vec![
                ("object_id".into(), json!(id)),
                ("done".into(), json!(done)),
            ],
            true,
        )
        .await?;
        Ok(TodoUpdate { done, notice: None })
    }
    pub async fn tags(&self) -> Result<Vec<Tag>, String> {
        let rows = self
            .list_options("SYNO.NoteStation.Tag", 1, "tags", vec![])
            .await?;
        serde_json::from_value(json!(rows)).map_err(|_| "Неизвестный формат тегов NAS.".into())
    }
    pub async fn note_tags(&self, id: &str) -> Result<NoteTagState, String> {
        let note = self.note(id).await?;
        if note.encrypted {
            return Err("Теги зашифрованной заметки пока нельзя изменять.".into());
        }
        let tags = note
            .tags
            .ok_or("NAS не вернул список тегов заметки. Изменение запрещено.")?;
        validate_tags(&tags)?;
        Ok(NoteTagState {
            ver: note.ver.ok_or("NAS не вернул версию заметки.")?,
            tags,
            catalog: self.tags().await?,
        })
    }
    pub async fn set_note_tags(
        &self,
        id: &str,
        expected_version: Value,
        expected_tags: Vec<String>,
        tags: Vec<String>,
    ) -> Result<SavedNote, String> {
        validate_object_id(id)?;
        validate_tags(&tags)?;
        validate_tags(&expected_tags)?;
        if expected_version.is_null() {
            return Err("Нет версии заметки. Откройте её заново.".into());
        }
        self.api("SYNO.NoteStation.Note", 3)?;
        let mut current = self.note(id).await?;
        if current.encrypted {
            return Err("Теги зашифрованной заметки пока нельзя изменять.".into());
        }
        let previous = current
            .tags
            .as_ref()
            .ok_or("NAS не вернул список тегов заметки. Изменение запрещено.")?;
        let mut sorted_previous = previous.clone();
        sorted_previous.sort();
        let mut sorted_expected = expected_tags;
        sorted_expected.sort();
        if current.ver.as_ref() != Some(&expected_version) || sorted_previous != sorted_expected {
            return Err(
                "Заметка или её теги изменились на NAS. Обновите данные окна перед применением."
                    .into(),
            );
        }
        let mut sorted_tags = tags.clone();
        sorted_tags.sort();
        if sorted_tags == sorted_previous {
            return Ok(SavedNote {
                note: current,
                notice: None,
            });
        }
        self.call_version_inner(
            "SYNO.NoteStation.Note",
            3,
            "set",
            vec![
                ("object_id".into(), json!(id)),
                ("ver".into(), expected_version),
                ("check_conflict".into(), json!(true)),
                ("tag".into(), json!(tags)),
            ],
            true,
        )
        .await?;
        match self.note(id).await {
            Ok(note) => Ok(SavedNote { note, notice: None }),
            Err(_) => {
                current.ver = None;
                current.tags = None;
                Ok(SavedNote {note:current,notice:Some("NAS подтвердил изменение тегов, но повторное чтение не удалось. Откройте заметку заново перед редактированием.".into())})
            }
        }
    }
    async fn section_notes(
        &self,
        recycle: bool,
        extra: Vec<(String, Value)>,
    ) -> Result<Vec<NoteSummary>, String> {
        let rows = self
            .list_options(
                "SYNO.NoteStation.Note",
                3,
                "notes",
                extra
                    .into_iter()
                    .chain([
                        ("filter".into(), json!({"recycle":recycle})),
                        ("field".into(), json!({"tag":true})),
                    ])
                    .collect(),
            )
            .await?;
        let notes: Vec<NoteSummary> = serde_json::from_value(json!(rows))
            .map_err(|_| "Неизвестный формат заметок NAS.".to_string())?;
        Ok(notes
            .into_iter()
            .filter(|note| note.recycle.is_null() || flag(&note.recycle) == recycle)
            .collect())
    }
    pub async fn recycled_notes(&self) -> Result<Vec<NoteSummary>, String> {
        self.section_notes(true, vec![]).await
    }
    pub async fn notes_for_tag(&self, id: &str) -> Result<Vec<NoteSummary>, String> {
        validate_object_id(id)?;
        let notes = self.section_notes(false, vec![]).await?;
        if !notes.is_empty() && notes.iter().all(|note| note.tag.is_null()) {
            return Err(
                "NAS не вернул сведения о тегах заметок. Фильтрация недоступна для этого ответа."
                    .into(),
            );
        }
        let title = if !notes.is_empty() && !notes.iter().any(|note| tag_matches(&note.tag, id)) {
            self.tags()
                .await?
                .into_iter()
                .find(|tag| tag.tag_id == id)
                .map(|tag| tag.title)
        } else {
            None
        };
        Ok(notes
            .into_iter()
            .filter(|note| {
                tag_matches(&note.tag, id)
                    || title
                        .as_ref()
                        .is_some_and(|name| tag_matches(&note.tag, name))
            })
            .collect())
    }
    pub async fn shared_notebooks(&self) -> Result<Vec<Notebook>, String> {
        Ok(self
            .notebooks()
            .await?
            .into_iter()
            .filter(shared_notebook)
            .collect())
    }
    pub async fn shared_notes(&self, id: &str) -> Result<Vec<NoteSummary>, String> {
        validate_object_id(id)?;
        let notebook = self
            .shared_notebooks()
            .await?
            .into_iter()
            .find(|book| book.object_id == id)
            .ok_or("Общий блокнот недоступен. Обновите список.")?;
        let mut context = notebook.access;
        if context.perm_from.is_none() {
            context.perm_from = Some(json!(id));
        }
        let mut fields = context.params()?;
        fields.push(("filter".into(), json!({"parent_id":id,"recycle":false})));
        let rows = self
            .list_options("SYNO.NoteStation.Note", 3, "notes", fields)
            .await?;
        let mut notes: Vec<NoteSummary> = serde_json::from_value(json!(rows))
            .map_err(|_| "Неизвестный формат общих заметок.".to_string())?;
        notes.retain(|note| note.parent_id == id && !flag(&note.recycle));
        for note in &mut notes {
            if note.access.perm_from.is_none() {
                note.access = context.clone();
            }
        }
        Ok(notes)
    }
    pub async fn section_note(&self, id: &str, context: AccessContext) -> Result<Note, String> {
        self.read_note_context(id, None, context).await
    }
    pub async fn restore_recycled_note(
        &self,
        id: &str,
        context: AccessContext,
    ) -> Result<SectionMutation, String> {
        validate_object_id(id)?;
        let mut fields = context.params()?;
        fields.push(("object_id".into(), json!(id)));
        self.call_version_inner("SYNO.NoteStation.Note", 3, "restore", fields, true)
            .await?;
        Ok(SectionMutation { notice: None })
    }

    pub async fn note_versions(&self, id: &str) -> Result<Vec<NoteVersion>, String> {
        if id.is_empty() || id.len() > 1024 {
            return Err("Некорректный ID заметки.".into());
        }
        let data = self
            .call(
                "SYNO.NoteStation.Note.Version",
                "list",
                vec![
                    ("object_id".into(), json!(id)),
                    ("limit".into(), json!(1000)),
                ],
            )
            .await?;
        parse_note_versions(data)
    }

    pub async fn note_version(&self, id: &str, version: Value) -> Result<Note, String> {
        validate_version(&version)?;
        let note = self.read_note(id, Some(version.clone())).await?;
        if note.ver.as_ref() != Some(&version) {
            return Err("NAS вернул другую версию заметки. Восстановление отменено.".into());
        }
        if note.encrypted {
            return Err("Просмотр зашифрованных версий пока не поддерживается.".into());
        }
        Ok(note)
    }

    pub async fn restore_note_version(
        &self,
        id: &str,
        version: Value,
        expected_version: Value,
    ) -> Result<SavedNote, String> {
        let historical = self.note_version(id, version).await?;
        // Create a new revision through the conflict-checked write path. Never delete history.
        self.save_note(
            id,
            expected_version,
            historical.title,
            historical.content,
            String::new(),
        )
        .await
    }

    pub async fn note(&self, id: &str) -> Result<Note, String> {
        self.read_note(id, None).await
    }

    async fn read_note(&self, id: &str, version: Option<Value>) -> Result<Note, String> {
        self.read_note_context(id, version, AccessContext::default())
            .await
    }
    async fn read_note_context(
        &self,
        id: &str,
        version: Option<Value>,
        context: AccessContext,
    ) -> Result<Note, String> {
        if id.is_empty() || id.len() > 1024 {
            return Err("Некорректный ID заметки.".into());
        }
        let mut params = context.params()?;
        params.push(("object_id".into(), json!(id)));
        if let Some(version) = version {
            params.push(("ver".into(), version));
        }
        let data = self.call("SYNO.NoteStation.Note", "get", params).await?;
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
            images: if encrypted {
                vec![]
            } else {
                image_references(&data)
            },
            access: context,
            tags: data
                .get("tag")
                .and_then(|value| serde_json::from_value::<Vec<String>>(value.clone()).ok()),
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
        self.save_note_with_images(id, expected_version, title, content, brief, vec![])
            .await
    }

    pub async fn save_note_with_images(
        &self,
        id: &str,
        expected_version: Value,
        title: String,
        content: String,
        brief: String,
        images: Vec<ImageUpload>,
    ) -> Result<SavedNote, String> {
        if images.len() > 20 {
            return Err("Можно добавить не более 20 изображений за одно сохранение.".into());
        }
        let mut uploads = Vec::new();
        let mut total = 0;
        let mut references = std::collections::HashSet::new();
        for image in images {
            let (bytes, mime) = image.decode()?;
            total += bytes.len();
            if total > MAX_UPLOAD
                || !references.insert(image.reference.clone())
                || !content.contains(&format!("ref=\"{}\"", image.reference))
            {
                return Err(
                    "Превышен общий размер 20 МБ или повреждены ссылки изображений.".into(),
                );
            }
            uploads.push((image, bytes, mime));
        }
        validate_note_update(id, &expected_version, &title, &content, &brief)?;
        self.api("SYNO.NoteStation.Note", 3)?;
        let current = self.note(id).await?;
        if current.encrypted {
            return Err("Редактирование зашифрованных заметок пока не поддерживается.".into());
        }
        if current.ver.as_ref() != Some(&expected_version) {
            return Err("Заметка изменена на NAS с момента открытия. Скопируйте свой текст, отмените редактирование и откройте свежую версию.".into());
        }
        let fields = vec![
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
        ];
        let result = if uploads.is_empty() {
            self.call_version("SYNO.NoteStation.Note", 3, "set", fields)
                .await?
        } else {
            self.upload_note(fields, uploads).await?
        };
        // A successful write must not be reported as a failed write if the
        // follow-up read is unavailable: that could encourage duplicate retries.
        match self.note(id).await {
            Ok(note) => {
                let newer = result.pointer("/data/0/ver").is_some_and(|version| note.ver.as_ref() != Some(version));
                Ok(SavedNote { note, notice: newer.then(|| "После сохранения появилась другая версия заметки. Показана актуальная версия с NAS.".into()) })
            },
            Err(_) => Ok(SavedNote { note: Note { object_id:id.into(), title, content, encrypted:false,
                ver: result.pointer("/data/0/ver").cloned(), tags:None, images:vec![], access:AccessContext::default() }, notice: Some("NAS подтвердил сохранение, но повторное чтение не удалось. Обновите библиотеку перед дальнейшим редактированием.".into()) }),
        }
    }

    async fn upload_note(
        &self,
        mut fields: Vec<(String, Value)>,
        uploads: Vec<(ImageUpload, Vec<u8>, &'static str)>,
    ) -> Result<Value, String> {
        let info = self.api("SYNO.NoteStation.Note", 3)?;
        let boundary = format!(
            "note-station-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "Ошибка системного времени.")?
                .as_nanos()
        );
        if uploads.iter().any(|(_, bytes, _)| {
            bytes
                .windows(boundary.len())
                .any(|w| w == boundary.as_bytes())
        }) {
            return Err("Не удалось подготовить изображения. Повторите сохранение.".into());
        }
        let mut body = Vec::new();
        let mut attachments = Vec::new();
        for (index, (image, bytes, mime)) in uploads.into_iter().enumerate() {
            let name = format!("image{index}");
            // Keep Unicode filenames, but never allow them to alter multipart headers.
            let filename: String = image
                .name
                .chars()
                .map(|c| {
                    if matches!(c, '"' | '\\' | '/') {
                        '_'
                    } else {
                        c
                    }
                })
                .collect();
            body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n").as_bytes());
            body.extend_from_slice(&bytes);
            body.extend_from_slice(b"\r\n");
            attachments.push(json!({"action":"create","format":"raw","name":name,"ref":image.reference,"rotate":true}));
        }
        fields.push(("attachment".into(), json!(attachments)));
        let routing = encode_entry(vec![
            ("api".into(), json!("SYNO.NoteStation.Note")),
            ("version".into(), json!(3)),
            ("method".into(), json!("set")),
            ("_sid".into(), json!(self.session_id()?)),
        ]);
        for (name, value) in fields {
            body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
        }
        body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
        let response = self.http.post(endpoint(&self.base,&info.path)?).query(&routing).header(reqwest::header::CONTENT_TYPE,format!("multipart/form-data; boundary={boundary}")).body(body).send().await.map_err(|_| "Не удалось подтвердить загрузку изображений. Не повторяйте сохранение автоматически; проверьте заметку на NAS.")?;
        Self::read_json(response, false).await
    }

    pub async fn note_image(
        &self,
        id: &str,
        file_id: &str,
        version: Value,
        context: AccessContext,
    ) -> Result<ImageData, String> {
        if id.is_empty()
            || id.len() > 1024
            || file_id.is_empty()
            || file_id.len() > 1024
            || file_id.chars().any(char::is_control)
        {
            return Err("Некорректный идентификатор изображения.".into());
        }
        validate_note_update(id, &version, "image", "", "")?;
        let info = self.api("SYNO.NoteStation.Note", 3)?;
        let mut params = context.params()?;
        params.extend(vec![
            ("api".into(), json!("SYNO.NoteStation.Note")),
            ("version".into(), json!(3)),
            ("method".into(), json!("download")),
            ("object_id".into(), json!(id)),
            ("file_id".into(), json!(file_id)),
            ("ver".into(), version),
            ("format".into(), json!("raw")),
            ("_sid".into(), json!(self.session_id()?)),
        ]);
        let fields = encode_entry(params);
        let mut response = self
            .http
            .post(endpoint(&self.base, &info.path)?)
            .form(&fields)
            .send()
            .await
            .map_err(|_| "Не удалось загрузить изображение с NAS.")?;
        if !response.status().is_success() {
            return Err("NAS не предоставил изображение.".into());
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_IMAGE as u64)
        {
            return Err("Изображение превышает 10 МБ.".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Не удалось прочитать изображение.")?
        {
            if bytes.len() + chunk.len() > MAX_IMAGE {
                return Err("Изображение превышает 10 МБ.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        image_data(&bytes)
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

    fn section_case<F, Fut>(steps: Vec<(Value, Value)>, operation: F) -> Result<Value, String>
    where
        F: FnOnce(NasClient) -> Fut,
        Fut: std::future::Future<Output = Result<Value, String>>,
    {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            thread,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let worker = thread::spawn(move || {
            for (expected, response) in steps {
                let deadline = std::time::Instant::now() + Duration::from_secs(5);
                let mut tcp = loop {
                    match listener.accept() {
                        Ok((tcp, _)) => break tcp,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(
                                std::time::Instant::now() < deadline,
                                "Missing section request"
                            );
                            thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("{error}"),
                    }
                };
                tcp.set_nonblocking(false).unwrap();
                tcp.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut bytes = Vec::new();
                let (start, length) = loop {
                    let mut buffer = [0; 8192];
                    let n = tcp.read(&mut buffer).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buffer[..n]);
                    if let Some(end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
                        let header = String::from_utf8_lossy(&bytes[..end]);
                        let length = header
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|value| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap();
                        break (end + 4, length);
                    }
                };
                while bytes.len() < start + length {
                    let mut buffer = [0; 8192];
                    let n = tcp.read(&mut buffer).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buffer[..n]);
                }
                let fields: HashMap<String, Value> =
                    url::form_urlencoded::parse(&bytes[start..start + length])
                        .map(|(key, value)| {
                            (key.into_owned(), serde_json::from_str(&value).unwrap())
                        })
                        .collect();
                assert_eq!(fields["_sid"], "section-fixture-token");
                for (key, value) in expected.as_object().unwrap() {
                    assert_eq!(fields.get(key), Some(value), "Field {key}");
                }
                if fields["method"] == "set" || fields["method"] == "restore" {
                    assert_eq!(fields.len(), expected.as_object().unwrap().len() + 1);
                }
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
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
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
            sid: Some("section-fixture-token".into()),
            apis: [
                ("SYNO.NoteStation.Note", 3),
                ("SYNO.NoteStation.Notebook", 2),
                ("SYNO.NoteStation.Tag", 1),
                ("SYNO.NoteStation.Todo", 2),
            ]
            .into_iter()
            .map(|(name, max_version)| {
                (
                    name.into(),
                    ApiInfo {
                        path: "entry.cgi".into(),
                        min_version: 1,
                        max_version,
                    },
                )
            })
            .collect(),
        };
        let result = runtime.block_on(operation(client));
        worker.join().unwrap();
        result
    }
    #[test]
    fn tag_filter_resolves_catalog_ids_to_note_tag_names() {
        let result=section_case(vec![
            (json!({"api":"SYNO.NoteStation.Note","method":"list"}),json!({"success":true,"data":{"notes":[{"object_id":"note-a","tag":["Работа"]}],"total":1}})),
            (json!({"api":"SYNO.NoteStation.Tag","method":"list"}),json!({"success":true,"data":{"tag-work":{"title":"Работа"}}}))
        ],|client|async move{Ok(json!(client.notes_for_tag("tag-work").await?))}).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 1);
    }
    #[test]
    fn note_tags_loads_catalog_dictionary_and_saves_only_metadata() {
        let original = "<div><img src='attachment.png'></div><p>Keep this content</p>";
        let result=section_case(vec![
            (json!({"method":"get","object_id":"note-a"}),json!({"success":true,"data":{"ver":"v1","content":original,"tag":["Работа"]}})),
            (json!({"api":"SYNO.NoteStation.Tag","method":"list"}),json!({"success":true,"data":{"tag-work":{"title":"Работа"}}})),
            (json!({"method":"get","object_id":"note-a"}),json!({"success":true,"data":{"ver":"v1","content":original,"tag":["Работа"]}})),
            (json!({"api":"SYNO.NoteStation.Note","version":3,"method":"set","object_id":"note-a","ver":"v1","check_conflict":true,"tag":["Новый"]}),json!({"success":true})),
            (json!({"method":"get","object_id":"note-a"}),json!({"success":true,"data":{"ver":"v2","title":"Fresh title","content":original,"tag":["Новый"]}}))
        ],|client|async move {
            let state=client.note_tags("note-a").await?;assert_eq!(state.catalog[0].tag_id,"tag-work");
            let saved=client.set_note_tags("note-a",state.ver,state.tags,vec!["Новый".into()]).await?;
            Ok(json!(saved.note))
        }).unwrap();
        assert_eq!(result["content"], original);
        assert_eq!(result["tags"], json!(["Новый"]));
        assert_eq!(result["ver"], "v2");
    }
    #[test]
    fn note_tag_conflicts_and_missing_metadata_never_write() {
        for data in [
            json!({"ver":"v2","content":"text","tag":["old"]}),
            json!({"ver":"v1","content":"text","tag":["other"]}),
            json!({"ver":"v1","content":"text"}),
        ] {
            let result = section_case(
                vec![(json!({"method":"get"}), json!({"success":true,"data":data}))],
                |client| async move {
                    client
                        .set_note_tags(
                            "note-a",
                            json!("v1"),
                            vec!["old".into()],
                            vec!["new".into()],
                        )
                        .await?;
                    Ok(json!(true))
                },
            );
            assert!(result.is_err());
        }
    }
    #[test]
    fn successful_tag_write_with_failed_read_disables_stale_note_editing() {
        let result = section_case(
            vec![
                (
                    json!({"method":"get"}),
                    json!({"success":true,"data":{"ver":"v1","content":"keep","tag":["old"]}}),
                ),
                (
                    json!({"api":"SYNO.NoteStation.Note","version":3,"method":"set","object_id":"note-a","ver":"v1","check_conflict":true,"tag":[]}),
                    json!({"success":true}),
                ),
                (
                    json!({"method":"get"}),
                    json!({"success":false,"error":{"code":105}}),
                ),
            ],
            |client| async move {
                let saved = client
                    .set_note_tags("note-a", json!("v1"), vec!["old".into()], vec![])
                    .await?;
                assert!(saved.notice.is_some());
                assert!(saved.note.ver.is_none());
                assert!(saved.note.tags.is_none());
                Ok(json!(saved.note.content))
            },
        );
        assert!(result.is_ok());
    }
    #[test]
    fn tag_validation_rejects_duplicates_and_invalid_names() {
        assert!(validate_tags(&["x".into(), "x".into()]).is_err());
        assert!(validate_tags(&[" ".into()]).is_err());
        assert!(validate_tags(&["bad\nname".into()]).is_err());
        assert!(validate_tags(&vec!["x".into(); 257]).is_err());
        assert!(validate_tags(&[]).is_ok());
        assert!(tag_dictionary(&json!({"unexpected":"text"})).is_err());
    }
    #[test]
    fn todo_creation_sends_only_selected_fields_and_accepts_empty_success() {
        let result = section_case(vec![
            (json!({"api":"SYNO.NoteStation.Todo","version":2,"method":"create","title":"Новая задача","due_date":1795211999_i64,"note_id":"note-a"}), json!({"success":true,"data":{"object_id":"created-task"}})),
            (json!({"method":"create","title":"Без срока"}), json!({"success":true}))
        ], |client| async move {
            let created = client.create_todo("  Новая задача  ", Some(1795211999), Some("note-a")).await?;
            assert_eq!(created.object_id.as_deref(), Some("created-task"));
            assert!(client.create_todo("Без срока", None, None).await?.object_id.is_none());
            Ok(json!(true))
        }).unwrap();
        assert_eq!(result, json!(true));
    }
    #[test]
    fn todo_creation_rejects_invalid_input_before_sending() {
        for title in ["", "   ", "line\nbreak", "bad\0value"] {
            assert!(todo_create_params(title, None, None).is_err());
        }
        assert!(todo_create_params(&"я".repeat(251), None, None).is_err());
        assert!(todo_create_params("Valid", Some(-1), None).is_err());
        assert!(todo_create_params("Valid", Some(253402300800), None).is_err());
        assert!(todo_create_params("Valid", None, Some("")).is_err());
        assert_eq!(
            todo_create_params("  Task  ", None, None).unwrap(),
            vec![("title".into(), json!("Task"))]
        );
    }
    #[test]
    fn todo_list_and_completion_use_minimal_mutation_and_accept_empty_success() {
        let result=section_case(vec![
            (json!({"api":"SYNO.NoteStation.Todo","version":2,"method":"list","offset":0,"limit":200,"field":{"items":true}}),json!({"success":true,"data":{"items":[{"object_id":"todo-a","title":"Task","done":0,"items":[{"object_id":"child","done":true}]}],"total":1}})),
            (json!({"api":"SYNO.NoteStation.Todo","version":2,"method":"get","object_id":"todo-a"}),json!({"success":true,"data":{"object_id":"todo-a","done":false}})),
            (json!({"api":"SYNO.NoteStation.Todo","version":2,"method":"set","object_id":"todo-a","done":true}),json!({"success":true}))
        ],|client|async move{let rows=client.todos().await?;assert_eq!(rows[0].items.len(),1);let result=client.set_todo_done(&rows[0].object_id,true,rows[0].done).await?;Ok(json!({"done":result.done}))}).unwrap();
        assert_eq!(result, json!({"done":true}));
    }
    #[test]
    fn changed_todo_is_not_overwritten() {
        let result = section_case(
            vec![(
                json!({"method":"get","object_id":"todo-a"}),
                json!({"success":true,"data":{"object_id":"todo-a","done":true}}),
            )],
            |client| async move {
                client.set_todo_done("todo-a", true, false).await?;
                Ok(Value::Null)
            },
        );
        assert!(result.unwrap_err().contains("уже изменилось"));
    }
    #[test]
    fn missing_or_null_todo_state_cannot_trigger_a_write() {
        for state in [
            json!({"object_id":"todo-a"}),
            json!({"object_id":"todo-a","done":null}),
        ] {
            let result = section_case(
                vec![(
                    json!({"method":"get"}),
                    json!({"success":true,"data":state}),
                )],
                |client| async move {
                    client.set_todo_done("todo-a", true, false).await?;
                    Ok(Value::Null)
                },
            );
            assert!(result.unwrap_err().contains("не вернул состояние"));
        }
    }
    #[test]
    fn trash_listing_and_restore_preserve_access_without_deleting_or_rewriting_content() {
        let result=section_case(vec![
            (json!({"api":"SYNO.NoteStation.Note","version":3,"method":"list","filter":{"recycle":true}}),json!({"success":true,"data":{"notes":[{"object_id":"deleted","recycle":true,"perm_from":"shared-book"},{"object_id":"active","recycle":false}],"total":2}})),
            (json!({"api":"SYNO.NoteStation.Note","version":3,"method":"restore","object_id":"deleted","perm_from":"shared-book"}),json!({"success":true}))
        ],|client|async move{let notes=client.recycled_notes().await?;assert_eq!(notes.len(),1);client.restore_recycled_note(&notes[0].object_id,notes[0].access.clone()).await?;Ok(json!(notes[0].object_id))}).unwrap();
        assert_eq!(result, json!("deleted"));
    }
    #[test]
    fn tag_filter_handles_string_and_object_tags_and_excludes_trash() {
        let result=section_case(vec![
            (json!({"api":"SYNO.NoteStation.Tag","version":1,"method":"list"}),json!({"success":true,"data":{"tags":[{"tag_id":"tag-a","title":"Work"}],"total":1}})),
            (json!({"api":"SYNO.NoteStation.Note","version":3,"method":"list","filter":{"recycle":false},"field":{"tag":true}}),json!({"success":true,"data":{"notes":[{"object_id":"a","tag":["tag-a"]},{"object_id":"b","tag":[{"tag_id":"tag-a"}]},{"object_id":"c","tag":["tag-other"]},{"object_id":"d","tag":["tag-a"],"recycle":true}],"total":4}}))
        ],|client|async move{let tags=client.tags().await?;Ok(json!(client.notes_for_tag(&tags[0].tag_id).await?))}).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 2);
    }
    #[test]
    fn shared_notes_carry_permission_context_through_preview() {
        let result=section_case(vec![
            (json!({"api":"SYNO.NoteStation.Notebook","version":2,"method":"list"}),json!({"success":true,"data":{"notebooks":[{"object_id":"shared-book","shared":1},{"object_id":"private-book"}],"total":2}})),
            (json!({"api":"SYNO.NoteStation.Note","version":3,"method":"list","filter":{"parent_id":"shared-book","recycle":false},"perm_from":"shared-book"}),json!({"success":true,"data":{"notes":[{"object_id":"shared-note","parent_id":"shared-book"}],"total":1}})),
            (json!({"api":"SYNO.NoteStation.Note","version":2,"method":"get","object_id":"shared-note","perm_from":"shared-book"}),json!({"success":true,"data":{"title":"Shared","content":"<p>Shared text</p>","ver":1}}))
        ],|client|async move{let notes=client.shared_notes("shared-book").await?;let note=client.section_note(&notes[0].object_id,notes[0].access.clone()).await?;Ok(json!(note.title))}).unwrap();
        assert_eq!(result, json!("Shared"));
    }
    #[test]
    fn section_lists_keep_api_versions_and_offsets_across_pages() {
        let first: Vec<Value> = (0..200)
            .map(|index| json!({"tag_id":format!("tag-{index}"),"title":"Tag"}))
            .collect();
        let result=section_case(vec![
            (json!({"api":"SYNO.NoteStation.Tag","version":1,"method":"list","offset":0,"limit":200}),json!({"success":true,"data":{"tags":first,"total":201}})),
            (json!({"api":"SYNO.NoteStation.Tag","version":1,"method":"list","offset":200,"limit":200}),json!({"success":true,"data":{"tags":[{"tag_id":"last","title":"Last"}],"total":201}}))
        ],|client|async move{let tags=client.tags().await?;Ok(json!(tags.len()))}).unwrap();
        assert_eq!(result, json!(201));
    }
    #[test]
    fn normal_library_excludes_recycled_notes_even_if_server_returns_them() {
        let result=section_case(vec![(json!({"api":"SYNO.NoteStation.Note","version":3,"method":"list","filter":{"recycle":false}}),json!({"success":true,"data":{"notes":[{"object_id":"active"},{"object_id":"deleted","recycle":true}],"total":2}}))],|client|async move{Ok(json!(client.notes().await?))}).unwrap();
        assert_eq!(result.as_array().unwrap().len(), 1);
        assert_eq!(result[0]["object_id"], json!("active"));
    }
    #[test]
    fn metadata_and_access_validation_do_not_guess_empty_tags_or_accept_invalid_flags() {
        assert!(serde_json::from_value::<Todo>(json!({"object_id":"t","done":2})).is_err());
        assert!(AccessContext {
            perm_from: Some(json!({"url":"https://evil"})),
            smart_id: None
        }
        .params()
        .is_err());
        assert!(!tag_matches(&json!(["other"]), "tag-a"));
        let result = section_case(
            vec![(
                json!({"method":"list"}),
                json!({"success":true,"data":{"notes":[{"object_id":"a"}],"total":1}}),
            )],
            |client| async move { Ok(json!(client.notes_for_tag("tag-a").await?)) },
        );
        assert!(result.unwrap_err().contains("не вернул сведения о тегах"));
    }

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
        historical: bool,
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
            let count = if conflict { 1 } else { 3 } + 2 * usize::from(historical);
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
                if historical && index == 0 {
                    assert_eq!(fields["api"], "SYNO.NoteStation.Note.Version");
                    assert_eq!(fields["method"], "list");
                    assert_eq!(fields["version"], 2);
                    assert_eq!(fields["object_id"], "note-a");
                    let body = json!({"success":true,"data":{"total":1,"versions":[{
                        "id":"history-row-id", "author":"fixture-author", "version":"v0",
                        "mtime":1700000000, "commit_msg":{"device":"desktop","listable":true},
                        "last_version":false
                    }]}})
                    .to_string();
                    write!(
                        tcp,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .unwrap();
                    continue;
                }
                if historical && index == 1 {
                    assert_eq!(fields["api"], "SYNO.NoteStation.Note");
                    assert_eq!(fields["method"], "get");
                    assert_eq!(fields["ver"], "v0");
                    let body = json!({"success":true,"data":{"ver":"v0","title":"Новый заголовок","content":"<p>Старая версия</p><img data-file-id=\"existing\">"}}).to_string();
                    write!(
                        tcp,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .unwrap();
                    continue;
                }
                let index = index - 2 * usize::from(historical);
                let data = if index == 1 {
                    assert_eq!(fields["method"], "set");
                    assert_eq!(fields["version"], 3);
                    assert_eq!(fields["ver"], "v1");
                    if historical {
                        assert!(fields["content"]
                            .as_str()
                            .unwrap()
                            .contains("Старая версия"));
                    }
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
        run_save_or_restore_case(conflict, failed_readback, false)
    }
    fn run_save_or_restore_case(
        conflict: bool,
        failed_readback: bool,
        historical: bool,
    ) -> Result<SavedNote, String> {
        let (server, worker) = save_fixture(conflict, failed_readback, historical);
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
                apis: HashMap::from([
                    (
                        "SYNO.NoteStation.Note".into(),
                        ApiInfo {
                            path: "entry.cgi".into(),
                            min_version: 1,
                            max_version: 3,
                        },
                    ),
                    (
                        "SYNO.NoteStation.Note.Version".into(),
                        ApiInfo {
                            path: "entry.cgi".into(),
                            min_version: 1,
                            max_version: 2,
                        },
                    ),
                ]),
                sid: Some("synthetic-save-token".into()),
            };
            if historical {
                let versions = client.note_versions("note-a").await?;
                assert_eq!(versions.len(), 1);
                assert_eq!(versions[0].ver, json!("v0"));
                return client
                    .restore_note_version("note-a", versions[0].ver.clone(), json!("v1"))
                    .await;
            }
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
    fn restores_historical_content_as_new_conflict_checked_revision() {
        let result = run_save_or_restore_case(false, false, true).unwrap();
        assert_eq!(result.note.ver, Some(json!("v2")));
    }
    #[test]
    fn restore_rejects_concurrent_change_without_writing() {
        assert!(run_save_or_restore_case(true, false, true)
            .err()
            .unwrap()
            .contains("изменена на NAS"));
    }
    #[test]
    fn history_normalizes_documented_version_field_without_using_row_id() {
        let versions = parse_note_versions(json!({"total":2,"versions":[
            {"id":"row-a","author":"fixture","version":17,"mtime":1700000000,"commit_msg":{"device":"desktop"},"last_version":false},
            {"id":"row-b","version":"18","mtime":null,"last_version":true}
        ]})).unwrap();
        assert_eq!(versions[0].ver, json!(17));
        assert_eq!(versions[1].ver, json!("18"));
        assert_eq!(versions[0].mtime, Some(json!(1700000000)));
        assert_eq!(
            serde_json::to_value(&versions[0]).unwrap(),
            json!({"ver":17,"mtime":1700000000})
        );
        for row in [
            json!({"id":"row-only"}),
            json!({"version":null}),
            json!({"version":{}}),
            json!({"version":""}),
            json!({"version":true}),
            json!({"ver":17,"version":18}),
        ] {
            assert!(parse_note_versions(json!({"versions":[row]})).is_err());
        }
    }
    #[test]
    fn history_rejects_malformed_or_incomplete_lists() {
        assert!(parse_note_versions(json!({"versions":[{"ver":"v1"}],"total":2})).is_err());
        assert!(parse_note_versions(json!({"versions":[{"ver":null}]})).is_err());
        assert!(parse_note_versions(json!({"versions":[{"ver":{}}]})).is_err());
        assert!(parse_note_versions(json!({"versions":[]}))
            .unwrap()
            .is_empty());
        assert_eq!(
            parse_note_versions(json!({"versions":[{"ver":1},{"ver":"v2"}]}))
                .unwrap()
                .len(),
            2
        );
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
