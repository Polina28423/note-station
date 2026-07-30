use url::Url;

fn web_url(value: &str) -> Result<Url, String> {
    let value = value.trim();
    if value.len() > 8192 || value.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("Укажите корректный адрес сайта с http:// или https://.".into());
    }
    let url = Url::parse(value)
        .map_err(|_| "Укажите полный адрес сайта с http:// или https://.".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(
            "Разрешены только ссылки на сайты http:// и https:// без имени пользователя и пароля."
                .into(),
        );
    }
    Ok(url)
}

pub fn app_navigation(url: &Url) -> bool {
    url.as_str() == "about:blank"
        || (url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                || (matches!(url.scheme(), "http" | "https")
                    && url.host_str() == Some("tauri.localhost"))))
}

pub fn open_web_url(value: &str) -> Result<(), String> {
    let url = web_url(value)?;
    open_in_browser(url.as_str())
}

#[cfg(windows)]
fn open_in_browser(url: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    let operation: Vec<u16> = "open\0".encode_utf16().collect();
    let address: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
    // Pass the validated URL as a document to Windows, never to a command shell.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            address.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    if result as isize <= 32 {
        return Err(
            "Не удалось открыть сайт. Проверьте, выбран ли браузер по умолчанию в Windows.".into(),
        );
    }
    Ok(())
}

#[cfg(not(windows))]
fn open_in_browser(_url: &str) -> Result<(), String> {
    Err("Открытие сайта в системном браузере поддерживается в Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn websites_cannot_replace_the_app_webview() {
        for address in [
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/",
            "tauri://localhost/",
            "about:blank",
        ] {
            assert!(app_navigation(&Url::parse(address).unwrap()));
        }
        for address in [
            "https://example.org",
            "http://tauri.localhost.evil/",
            "http://user@tauri.localhost/",
            "file:///C:/file.html",
            "javascript:alert(1)",
        ] {
            assert!(!app_navigation(&Url::parse(address).unwrap()));
        }
    }
    #[test]
    fn only_web_addresses_can_reach_the_browser() {
        for value in [
            "javascript:alert(1)",
            "file:///C:/Windows/notepad.exe",
            "shell:AppsFolder",
            "mailto:user@example.org",
            "data:text/html,x",
            "https://user:secret@example.org",
            "https://example.org\n/x",
            "https://example.org/a b",
            "//example.org",
            "example.org",
            "https://",
        ] {
            assert!(web_url(value).is_err(), "{value}");
        }
        assert_eq!(
            web_url(" https://example.org/path?q=1#part ")
                .unwrap()
                .as_str(),
            "https://example.org/path?q=1#part"
        );
        assert_eq!(
            web_url("http://example.org").unwrap().as_str(),
            "http://example.org/"
        );
        assert!(web_url(&format!("https://example.org/{}", "x".repeat(8192))).is_err());
    }
}
