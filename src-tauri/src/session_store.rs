use crate::synology::ConnectionMode;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};
use zeroize::{Zeroize, Zeroizing};

const MAGIC: &[u8] = b"NOTE-STATION-SESSION-1\0";
const LIMIT: usize = 256 * 1024;

// Never derive Debug: the record contains a bearer credential.
#[derive(Clone, Serialize, Deserialize)]
pub struct SavedSession {
    pub version: u8,
    pub server: String,
    pub account: String,
    pub sid: String,
    pub mode: ConnectionMode,
    pub certificate_pem: Option<String>,
}
impl Drop for SavedSession {
    fn drop(&mut self) {
        self.sid.zeroize();
    }
}

pub struct SessionStore {
    path: PathBuf,
}
impl SessionStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    fn pending(&self) -> PathBuf {
        self.path.with_extension("pending")
    }
    pub fn exists(&self) -> bool {
        self.path.exists()
    }

    pub fn save(&self, record: &SavedSession) -> Result<(), String> {
        let mut records = self.load_all()?;
        records.retain(|r| r.server != record.server || r.account != record.account);
        records.push(record.clone());
        self.write_records(&records)
    }

    pub fn remove(&self, server: &str, account: &str) -> Result<(), String> {
        let mut records = self.load_all()?;
        records.retain(|r| r.server != server || r.account != account);
        if records.is_empty() {
            self.clear()
        } else {
            self.write_records(&records)
        }
    }

    fn write_records(&self, records: &[SavedSession]) -> Result<(), String> {
        let plaintext = Zeroizing::new(
            serde_json::to_vec(records)
                .map_err(|_| "Не удалось подготовить сессию.".to_string())?,
        );
        if plaintext.len() > LIMIT {
            return Err("Слишком большой размер сохранённой сессии.".into());
        }
        let encrypted = protect(&plaintext)?;
        fs::create_dir_all(self.path.parent().ok_or("Нет каталога сессии.")?)
            .map_err(|_| "Не удалось создать каталог сессии.".to_string())?;
        let result = (|| {
            let mut file = fs::File::create(self.pending())?;
            file.write_all(MAGIC)?;
            file.write_all(&encrypted)?;
            file.sync_all()?;
            fs::rename(self.pending(), &self.path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(self.pending());
            return Err("Не удалось сохранить зашифрованную сессию.".into());
        }
        Ok(())
    }

    pub fn load(&self) -> Result<Option<SavedSession>, String> {
        Ok(self.load_all()?.pop())
    }

    pub fn load_all(&self) -> Result<Vec<SavedSession>, String> {
        let file = match fs::File::open(&self.path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => return Err("Не удалось прочитать сохранённую сессию.".into()),
        };
        let mut bytes = Vec::new();
        file.take((LIMIT + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "Не удалось прочитать сохранённую сессию.".to_string())?;
        if bytes.len() > LIMIT || !bytes.starts_with(MAGIC) {
            return Err("Сохранённая сессия повреждена. Удалите её и войдите заново.".into());
        }
        let plaintext = Zeroizing::new(unprotect(&bytes[MAGIC.len()..])?);
        // Accept the original single-account format without rewriting it on read.
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Records {
            Many(Vec<SavedSession>),
            Legacy(SavedSession),
        }
        let records = match serde_json::from_slice::<Records>(&plaintext)
            .map_err(|_| "Некорректная сохранённая сессия.".to_string())?
        {
            Records::Many(records) => records,
            Records::Legacy(record) => vec![record],
        };
        if records
            .iter()
            .any(|r| r.version != 1 || r.sid.is_empty() || r.sid.len() > 8192)
        {
            return Err("Неподдерживаемая сохранённая сессия.".into());
        }
        Ok(records)
    }

    pub fn clear(&self) -> Result<(), String> {
        for path in [self.path.clone(), self.pending()] {
            match fs::remove_file(path) {
                Ok(()) => (),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => {
                    return Err("Не удалось удалить сохранённую сессию. Повторите выход.".into())
                }
            }
        }
        Ok(())
    }
}

#[cfg(windows)]
fn dpapi(input: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    if input.len() > LIMIT {
        return Err("Некорректный размер сессии.".into());
    }
    let data = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    // DPAPI uses the current Windows user (not LOCAL_MACHINE). Buffers remain
    // alive across the FFI call; Windows-owned output is wiped and freed once.
    let success = unsafe {
        if encrypt {
            CryptProtectData(
                &data,
                null(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &data,
                null_mut(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if success == 0 {
        return Err("Windows не смог защитить или восстановить сессию. Войдите заново или удалите сохранённую сессию.".into());
    }
    if output.pbData.is_null() {
        return Err("Windows вернул пустую сессию.".into());
    }
    let result = unsafe {
        let buffer = std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize);
        let copy = buffer.to_vec();
        buffer.zeroize();
        LocalFree(output.pbData.cast());
        copy
    };
    Ok(result)
}

#[cfg(windows)]
fn protect(input: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(input, true)
}
#[cfg(windows)]
fn unprotect(input: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(input, false)
}
#[cfg(not(windows))]
fn protect(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("Сохранение сессии пока поддерживается только в Windows.".into())
}
#[cfg(not(windows))]
fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("Сессия Windows недоступна на этой системе.".into())
}

pub fn expired_session(error: &str) -> bool {
    [106, 107, 119]
        .iter()
        .any(|code| error.ends_with(&format!("Код API: {code}.")))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    fn record(sid: &str) -> SavedSession {
        SavedSession {
            version: 1,
            server: "https://nas.example:5001".into(),
            account: "test-user".into(),
            sid: sid.into(),
            mode: ConnectionMode::Strict,
            certificate_pem: None,
        }
    }
    fn store() -> SessionStore {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        SessionStore::new(
            std::env::temp_dir()
                .join(format!("note-station-test-{}-{unique}", std::process::id()))
                .join("session.bin"),
        )
    }
    #[test]
    fn protected_record_survives_restart_and_can_be_replaced_and_deleted() {
        let store = store();
        assert!(store.load().unwrap().is_none());
        store.save(&record("SYNTHETIC-TEST-TOKEN-ONE")).unwrap();
        let bytes = fs::read(&store.path).unwrap();
        assert!(!bytes
            .windows(24)
            .any(|part| part == b"SYNTHETIC-TEST-TOKEN-ONE"));
        assert!(!String::from_utf8_lossy(&bytes).contains("test-user"));
        let reopened = SessionStore::new(store.path.clone());
        assert_eq!(
            reopened.load().unwrap().unwrap().sid,
            "SYNTHETIC-TEST-TOKEN-ONE"
        );
        reopened.save(&record("SYNTHETIC-TEST-TOKEN-TWO")).unwrap();
        assert_eq!(
            store.load().unwrap().unwrap().sid,
            "SYNTHETIC-TEST-TOKEN-TWO"
        );
        reopened.clear().unwrap();
        assert!(store.load().unwrap().is_none());
        store.clear().unwrap();
        fs::remove_dir(store.path.parent().unwrap()).unwrap();
    }
    #[test]
    fn accounts_are_independent_and_legacy_sessions_migrate() {
        let store = store();
        let first = record("first-token");
        // Write the original encrypted single-session format.
        fs::create_dir_all(store.path.parent().unwrap()).unwrap();
        let mut bytes = MAGIC.to_vec();
        bytes.extend(protect(&serde_json::to_vec(&first).unwrap()).unwrap());
        fs::write(&store.path, bytes).unwrap();
        assert_eq!(store.load_all().unwrap().len(), 1);
        let mut second = record("second-token");
        second.account = "second-user".into();
        store.save(&second).unwrap();
        let reopened = SessionStore::new(store.path.clone());
        assert_eq!(reopened.load_all().unwrap().len(), 2);
        second.sid = "renewed-token".into();
        reopened.save(&second).unwrap();
        let all = store.load_all().unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].sid, "first-token");
        assert_eq!(all[1].sid, "renewed-token");
        store.remove(&first.server, &first.account).unwrap();
        assert_eq!(store.load().unwrap().unwrap().account, "second-user");
        store.remove(&second.server, &second.account).unwrap();
        assert!(!store.exists());
        fs::remove_dir(store.path.parent().unwrap()).unwrap();
    }

    #[test]
    fn corrupt_or_truncated_session_is_rejected_without_exposing_contents() {
        let store = store();
        store.save(&record("synthetic-sensitive-token")).unwrap();
        let mut bytes = fs::read(&store.path).unwrap();
        bytes.truncate(MAGIC.len() + 10);
        fs::write(&store.path, bytes).unwrap();
        let error = store.load().err().unwrap();
        assert!(!error.contains("synthetic-sensitive-token"));
        store.clear().unwrap();
        fs::remove_dir(store.path.parent().unwrap()).unwrap();
    }
    #[test]
    fn network_and_access_errors_do_not_expire_a_saved_session() {
        assert!(expired_session("Ошибка. Код API: 106."));
        assert!(expired_session("Ошибка. Код API: 119."));
        assert!(!expired_session("Ошибка. Код API: 105."));
        assert!(!expired_session("NAS не ответил вовремя."));
    }
}
