use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

const PIXEL: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

fn fixture<F, T, Fut>(responses: Vec<Vec<u8>>, operation: F) -> (T, Vec<Vec<u8>>)
where
    F: FnOnce(NasClient) -> Fut,
    Fut: std::future::Future<Output = T>,
{
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let worker = thread::spawn(move || {
        let mut requests = Vec::new();
        for response in responses {
            let deadline = std::time::Instant::now() + Duration::from_secs(6);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            std::time::Instant::now() < deadline,
                            "Missing media request"
                        );
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("{error}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 8192];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                assert!(count > 0);
                request.extend_from_slice(&buffer[..count]);
                if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    let length = String::from_utf8_lossy(&request[..end])
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                response.len()
            )
            .unwrap();
            stream.write_all(&response).unwrap();
            requests.push(request);
        }
        requests
    });
    let client = NasClient {
        http: http_builder_for_mode(None, ConnectionMode::PlainHttp)
            .unwrap()
            .no_proxy()
            .build()
            .unwrap(),
        base: Url::parse(&format!("http://{address}/")).unwrap(),
        sid: Some("media-fixture-session".into()),
        apis: HashMap::from([(
            "SYNO.NoteStation.Note".into(),
            ApiInfo {
                path: "entry.cgi".into(),
                min_version: 1,
                max_version: 3,
            },
        )]),
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let result = runtime.block_on(operation(client));
    (result, worker.join().unwrap())
}
fn response(data: Value) -> Vec<u8> {
    serde_json::to_vec(&json!({"success":true,"data":data})).unwrap()
}
fn upload() -> ImageUpload {
    ImageUpload {
        reference: "ns-image-one".into(),
        name: "фото.png".into(),
        data: PIXEL.into(),
    }
}
fn fields(request: &[u8]) -> HashMap<String, Value> {
    let start = request.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
    url::form_urlencoded::parse(&request[start..])
        .map(|(key, value)| (key.into_owned(), serde_json::from_str(&value).unwrap()))
        .collect()
}

#[test]
fn downloads_only_the_configured_api_with_exact_version_and_access() {
    let (result, requests) = fixture(vec![STANDARD.decode(PIXEL).unwrap()], |client| async move {
        client
            .note_image(
                "note-one",
                "file-one",
                json!("old-version"),
                AccessContext {
                    perm_from: Some(json!("owner")),
                    smart_id: Some("shared-one".into()),
                },
            )
            .await
    });
    assert!(result
        .unwrap()
        .data_url
        .starts_with("data:image/png;base64,"));
    let request = &requests[0];
    assert!(request.starts_with(b"POST /webapi/entry.cgi HTTP/1.1"));
    let values = fields(request);
    assert_eq!(values["method"], "download");
    assert_eq!(values["file_id"], "file-one");
    assert_eq!(values["ver"], "old-version");
    assert_eq!(values["perm_from"], "owner");
    assert_eq!(values["smart_id"], "shared-one");
}

#[test]
fn rejects_non_image_responses_without_echoing_credentials() {
    let (result, _) = fixture(
        vec![b"<html>media-fixture-session</html>".to_vec()],
        |client| async move {
            client
                .note_image("note", "file", json!(1), AccessContext::default())
                .await
        },
    );
    let error = result.err().unwrap();
    assert!(!error.contains("media-fixture"));
    assert!(!error.contains("html"));
}

#[test]
fn upload_uses_one_conflict_checked_multipart_write_and_rereads_identifiers() {
    let content = "<p>Before<img ref=\"ns-image-one\">After</p>";
    let (result, requests) = fixture(
        vec![
            response(json!({"title":"Note","content":"old","ver":"v1"})),
            response(json!({"data":[{"ver":"v2"}]})),
            response(
                json!({"title":"Note","content":content,"ver":"v2","attachment":{"file-new":{"ref":"ns-image-one","secret":"not exposed"}}}),
            ),
        ],
        |client| async move {
            client
                .save_note_with_images(
                    "note",
                    json!("v1"),
                    "Note".into(),
                    content.into(),
                    "Before After".into(),
                    vec![upload()],
                )
                .await
        },
    );
    let saved = result.unwrap();
    assert_eq!(saved.note.images[0].file_id, "file-new");
    assert_eq!(saved.note.images[0].reference, "ns-image-one");
    assert_eq!(saved.note.ver, Some(json!("v2")));
    let request = &requests[1];
    let header_end = request.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    let header = String::from_utf8_lossy(&request[..header_end]);
    assert!(header.starts_with("POST /webapi/entry.cgi?"));
    let target = header.lines().next().unwrap().split(' ').nth(1).unwrap();
    let url = Url::parse(&format!("http://fixture{target}")).unwrap();
    let routing: HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(routing["method"], "\"set\"");
    assert_eq!(routing["_sid"], "\"media-fixture-session\"");
    assert!(header.contains("multipart/form-data; boundary=note-station-"));
    let body = String::from_utf8_lossy(&request[header_end + 4..]);
    assert!(body.contains("name=\"check_conflict\"\r\n\r\ntrue"));
    assert!(body.contains("name=\"ver\"\r\n\r\n\"v1\""));
    assert!(body.contains("\"action\":\"create\""));
    assert!(body.contains("\"ref\":\"ns-image-one\""));
    assert!(body.contains("\"name\":\"image0\""));
    assert!(body.contains("name=\"image0\"; filename=\"фото.png\""));
    assert!(!body.contains("delete"));
    assert!(!body.contains("media-fixture-session"));
    assert!(request.windows(8).any(|w| w == b"\x89PNG\r\n\x1a\n"));
}

#[test]
fn version_conflict_prevents_any_upload() {
    let (result, requests) = fixture(
        vec![response(json!({"title":"Note","content":"new","ver":"v2"}))],
        |client| async move {
            client
                .save_note_with_images(
                    "note",
                    json!("v1"),
                    "Note".into(),
                    "<img ref=\"ns-image-one\">".into(),
                    "".into(),
                    vec![upload()],
                )
                .await
        },
    );
    assert!(result.is_err());
    assert_eq!(requests.len(), 1);
    assert_eq!(fields(&requests[0])["method"], "get");
}

#[test]
fn invalid_image_and_unreferenced_upload_do_not_reach_the_network() {
    let (result, requests) = fixture(vec![], |client| async move {
        client
            .save_note_with_images(
                "note",
                json!("v1"),
                "Note".into(),
                "<p>No image</p>".into(),
                "".into(),
                vec![upload()],
            )
            .await
    });
    assert!(result.is_err());
    assert!(requests.is_empty());
}
