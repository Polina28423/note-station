use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

pub const MAX_IMAGE: usize = 10 * 1024 * 1024;
pub const MAX_UPLOAD: usize = 20 * 1024 * 1024;

#[derive(Deserialize)]
pub struct ImageUpload {
    pub reference: String,
    pub name: String,
    pub data: String,
}

#[derive(Serialize)]
pub struct ImageData {
    pub data_url: String,
}

pub fn image_type(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE {
        return Err("Изображение должно занимать не более 10 МБ.".into());
    }
    let dimensions = if bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        && bytes.len() >= 33
        && &bytes[12..16] == b"IHDR"
    {
        Some((
            "image/png",
            u32::from_be_bytes(bytes[16..20].try_into().map_err(|_| "Некорректный PNG.")?),
            u32::from_be_bytes(bytes[20..24].try_into().map_err(|_| "Некорректный PNG.")?),
        ))
    } else if (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) && bytes.len() >= 13 {
        Some((
            "image/gif",
            u16::from_le_bytes([bytes[6], bytes[7]]) as u32,
            u16::from_le_bytes([bytes[8], bytes[9]]) as u32,
        ))
    } else if bytes.starts_with(b"\xff\xd8") {
        let mut cursor = 2;
        let mut found = None;
        while cursor + 4 <= bytes.len() {
            if bytes[cursor] != 0xff {
                break;
            }
            cursor += 1;
            while cursor < bytes.len() && bytes[cursor] == 0xff {
                cursor += 1;
            }
            if cursor + 3 > bytes.len() {
                break;
            }
            let marker = bytes[cursor];
            cursor += 1;
            if marker == 0xda || marker == 0xd9 {
                break;
            }
            let length = u16::from_be_bytes([bytes[cursor], bytes[cursor + 1]]) as usize;
            if length < 2 || cursor + length > bytes.len() {
                break;
            }
            if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf)
                && length >= 8
            {
                found = Some((
                    "image/jpeg",
                    u16::from_be_bytes([bytes[cursor + 5], bytes[cursor + 6]]) as u32,
                    u16::from_be_bytes([bytes[cursor + 3], bytes[cursor + 4]]) as u32,
                ));
                break;
            }
            cursor += length;
        }
        found
    } else if bytes.len() >= 30 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        let le24 = |offset: usize| {
            u32::from_le_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], 0])
        };
        match &bytes[12..16] {
            b"VP8X" => Some(("image/webp", le24(24) + 1, le24(27) + 1)),
            b"VP8 " if &bytes[23..26] == b"\x9d\x01\x2a" => Some((
                "image/webp",
                (u16::from_le_bytes([bytes[26], bytes[27]]) & 0x3fff) as u32,
                (u16::from_le_bytes([bytes[28], bytes[29]]) & 0x3fff) as u32,
            )),
            b"VP8L" if bytes[20] == 0x2f => Some((
                "image/webp",
                1 + (bytes[21] as u32 | ((bytes[22] as u32 & 0x3f) << 8)),
                1 + ((bytes[22] as u32 >> 6)
                    | ((bytes[23] as u32) << 2)
                    | ((bytes[24] as u32 & 0xf) << 10)),
            )),
            _ => None,
        }
    } else {
        None
    };
    let (mime, width, height) =
        dimensions.ok_or("Выберите корректное изображение PNG, JPEG, GIF или WebP.")?;
    if width == 0
        || height == 0
        || width > 16384
        || height > 16384
        || u64::from(width) * u64::from(height) > 40_000_000
    {
        return Err("Размеры изображения превышают 16 384 пикселя или 40 мегапикселей.".into());
    }
    Ok(mime)
}

impl ImageUpload {
    pub fn decode(&self) -> Result<(Vec<u8>, &'static str), String> {
        if !self.reference.starts_with("ns-image-")
            || self.reference.len() > 80
            || !self
                .reference
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            || self.name.is_empty()
            || self.name.len() > 255
            || self.name.chars().any(char::is_control)
        {
            return Err("Некорректное имя или ссылка изображения.".into());
        }
        if self.data.len() > (MAX_IMAGE + 2) / 3 * 4 {
            return Err("Изображение превышает 10 МБ.".into());
        }
        let bytes = STANDARD
            .decode(&self.data)
            .map_err(|_| "Некорректные данные изображения.")?;
        let mime = image_type(&bytes)?;
        Ok((bytes, mime))
    }
}

pub fn image_data(bytes: &[u8]) -> Result<ImageData, String> {
    let mime = image_type(bytes)?;
    Ok(ImageData {
        data_url: format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_html_svg_truncation_and_large_dimensions() {
        for bytes in [b"<svg></svg>".as_slice(), b"<html>secret</html>", b"GIF89a"] {
            assert!(image_type(bytes).is_err());
        }
        let mut png = vec![0; 33];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[12..16].copy_from_slice(b"IHDR");
        png[16..20].copy_from_slice(&100_000u32.to_be_bytes());
        png[20..24].copy_from_slice(&1u32.to_be_bytes());
        assert!(image_type(&png).is_err());
    }
    #[test]
    fn recognizes_pixels_and_validates_uploads() {
        let png=STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=").unwrap();
        assert_eq!(image_type(&png).unwrap(), "image/png");
        assert!(image_data(&png)
            .unwrap()
            .data_url
            .starts_with("data:image/png;base64,"));
        let upload = ImageUpload {
            reference: "ns-image-test".into(),
            name: "пример.png".into(),
            data: STANDARD.encode(png),
        };
        assert!(upload.decode().is_ok());
        assert!(ImageUpload {
            reference: "../secret".into(),
            ..upload
        }
        .decode()
        .is_err());
    }
}
