use crate::database::Library;
use lofty::{
    config::ParseOptions,
    file::{AudioFile, TaggedFileExt},
    picture::PictureType,
    prelude::ItemKey,
    probe::Probe,
};
use tauri::http::{Request, Response};

/// 详情仅在用户打开时读取，不把长备注、版权等文本放入整库索引。
pub fn load(library: &Library, id: &str) -> Result<Vec<(&'static str, String)>, String> {
    let path = library.media_path(id)?;
    let size = path.metadata().map_err(|e| e.to_string())?.len();
    let file = Probe::open(&path)
        .and_then(|p| p.options(ParseOptions::new().read_cover_art(false)).read())
        .map_err(|e| format!("歌曲信息读取失败：{e}"))?;
    let mut fields = Vec::new();
    // 优先主标签，缺失字段再查其他标签，兼容同时带 ID3v1 / ID3v2 的文件。
    let tags: Vec<_> = file
        .primary_tag()
        .into_iter()
        .chain(file.tags().iter())
        .collect();
    for (label, key) in [
        ("歌名", ItemKey::TrackTitle),
        ("歌手", ItemKey::TrackArtist),
        ("专辑", ItemKey::AlbumTitle),
        ("专辑歌手", ItemKey::AlbumArtist),
        ("发行日期", ItemKey::ReleaseDate),
        ("录制日期", ItemKey::RecordingDate),
        ("年份", ItemKey::Year),
        ("流派", ItemKey::Genre),
        ("曲目编号", ItemKey::TrackNumber),
        ("总曲目数", ItemKey::TrackTotal),
        ("碟片编号", ItemKey::DiscNumber),
        ("总碟片数", ItemKey::DiscTotal),
        ("作曲", ItemKey::Composer),
        ("作词", ItemKey::Lyricist),
        ("制作人", ItemKey::Producer),
        ("出版方", ItemKey::Publisher),
        ("版权", ItemKey::CopyrightMessage),
        ("语言", ItemKey::Language),
        ("BPM", ItemKey::IntegerBpm),
        ("ISRC", ItemKey::Isrc),
        ("编码软件", ItemKey::EncoderSoftware),
        ("备注", ItemKey::Comment),
    ] {
        if let Some(value) = tags.iter().find_map(|tag| {
            let values: Vec<_> = tag
                .get_strings(key.clone())
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .collect();
            (!values.is_empty()).then(|| values.join(" / "))
        }) {
            // 部分下载器把整段歌词写进作词/备注；限制详情体积，不影响独立歌词读取。
            let text = if value.chars().count() > 2048 {
                format!("{}…", value.chars().take(2048).collect::<String>())
            } else {
                value
            };
            fields.push((label, text));
        }
    }
    let properties = file.properties();
    fields.push(("格式", "MP3".into()));
    let seconds = properties.duration().as_secs();
    fields.push(("时长", format!("{}:{:02}", seconds / 60, seconds % 60)));
    if let Some(value) = properties.audio_bitrate() {
        fields.push(("码率", format!("{value} kbps")));
    }
    if let Some(value) = properties.sample_rate() {
        fields.push(("采样率", format!("{value} Hz")));
    }
    if let Some(value) = properties.channels() {
        fields.push((
            "声道",
            match value {
                1 => "单声道".into(),
                2 => "立体声".into(),
                _ => format!("{value} 声道"),
            },
        ));
    }
    fields.push(("文件大小", format!("{:.2} MiB", size as f64 / 1_048_576.0)));
    log::info!("读取歌曲信息 track={id} fields={}", fields.len());
    Ok(fields)
}

/// 图片通过媒体协议单独传输；上限避免异常封面占满 WebView 内存。
const MAX_COVER_BYTES: usize = 16 * 1024 * 1024;

/// 优先专辑正面，其次可显示的内嵌图片；不访问标签中的外部图片链接。
pub fn cover(library: &Library, id: &str, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let result = (|| {
        if !["GET", "HEAD"].contains(&request.method().as_str()) {
            return Err((405, "不支持的封面请求".to_string()));
        }
        let path = library.media_path(id).map_err(|e| (403, e))?;
        let file = Probe::open(path)
            .and_then(|p| p.options(ParseOptions::new().read_properties(false)).read())
            .map_err(|e| (422, e.to_string()))?;
        let picture = file
            .tags()
            .iter()
            .flat_map(|tag| tag.pictures())
            .filter(|pic| {
                !pic.data().is_empty()
                    && pic.data().len() <= MAX_COVER_BYTES
                    && pic.mime_type().is_some_and(|mime| {
                        matches!(
                            mime.as_str(),
                            "image/jpeg" | "image/png" | "image/gif" | "image/bmp" | "image/tiff"
                        )
                    })
            })
            .min_by_key(|pic| {
                if pic.pic_type() == PictureType::CoverFront {
                    0
                } else {
                    1
                }
            });
        let Some(picture) = picture else {
            return Ok(Response::builder().status(204).body(Vec::new()).unwrap());
        };
        Ok(Response::builder()
            .header("Content-Type", picture.mime_type().unwrap().as_str())
            .header("Content-Length", picture.data().len())
            .header("X-Content-Type-Options", "nosniff")
            .body(if request.method() == "HEAD" {
                Vec::new()
            } else {
                picture.data().to_vec()
            })
            .unwrap())
    })();
    let mut response = result.unwrap_or_else(|(status, reason)| {
        log::warn!("封面读取失败 track={id} status={status} reason={reason}");
        Response::builder().status(status).body(Vec::new()).unwrap()
    });
    response
        .headers_mut()
        .insert("Access-Control-Allow-Origin", "*".parse().unwrap());
    // 页面刷新曲库时更换 URL 版本，同一版本复用浏览器缓存以免重复解析 MP3。
    let cache = if response.status().is_success() {
        "private, max-age=3600"
    } else {
        "no-store"
    };
    response
        .headers_mut()
        .insert("Cache-Control", cache.parse().unwrap());
    response
}
