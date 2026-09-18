use crate::database::Library;
use std::io::{Read, Seek, SeekFrom};
use tauri::http::{Request, Response};

/// WebView 的字节范围请求每次最多读取 1 MiB，拖动进度不加载整首音频。
const RANGE_CHUNK: u64 = 1024 * 1024;

/// 只处理单段范围；非法、越界和多段请求返回 416。
pub fn byte_range(value: &str, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    let (start, end) = value.strip_prefix("bytes=")?.split_once('-')?;
    let (start, end) = if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        if suffix == 0 {
            return None;
        }
        (length.saturating_sub(suffix), length - 1)
    } else {
        (
            start.parse::<u64>().ok()?,
            if end.is_empty() {
                length - 1
            } else {
                end.parse::<u64>().ok()?.min(length - 1)
            },
        )
    };
    if start >= length || end < start {
        None
    } else {
        Some((start, end.min(start.saturating_add(RANGE_CHUNK - 1))))
    }
}
/// 协议路径只接受歌曲 ID；真实路径与目录授权始终在 Rust 端重新确认。
pub fn respond(library: &Library, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let id = request.uri().path().trim_start_matches('/');
    let result = (|| {
        if !["GET", "HEAD"].contains(&request.method().as_str()) {
            return Err((405, "不支持的媒体请求".to_string()));
        }
        let path = library.media_path(id).map_err(|e| (403, e))?;
        let mut file = std::fs::File::open(path).map_err(|e| (404, e.to_string()))?;
        let length = file.metadata().map_err(|e| (500, e.to_string()))?.len();
        let mut builder = Response::builder()
            .header("Content-Type", "audio/mpeg")
            .header("Accept-Ranges", "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "no-store");
        if request.method() == "HEAD" {
            return Ok(builder
                .header("Content-Length", length)
                .body(vec![])
                .unwrap());
        }
        if let Some(range) = request.headers().get("range") {
            let parsed = range.to_str().ok().and_then(|s| byte_range(s, length));
            let Some((start, end)) = parsed else {
                return Ok(builder
                    .status(416)
                    .header("Content-Range", format!("bytes */{length}"))
                    .body(vec![])
                    .unwrap());
            };
            let count = end - start + 1;
            file.seek(SeekFrom::Start(start))
                .map_err(|e| (500, e.to_string()))?;
            let mut bytes = Vec::with_capacity(count as usize);
            file.take(count)
                .read_to_end(&mut bytes)
                .map_err(|e| (500, e.to_string()))?;
            builder = builder
                .status(206)
                .header("Content-Range", format!("bytes {start}-{end}/{length}"));
            Ok(builder
                .header("Content-Length", bytes.len())
                .body(bytes)
                .unwrap())
        } else {
            // ponytail: 非 Range 客户端回退整文件响应；未来若支持超大音频，换为原生流式解码。
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|e| (500, e.to_string()))?;
            Ok(builder
                .header("Content-Length", bytes.len())
                .body(bytes)
                .unwrap())
        }
    })();
    result.unwrap_or_else(|(code, reason)| {
        log::warn!("媒体读取失败 track={id} status={code} reason={reason}");
        Response::builder()
            .status(code)
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .unwrap()
    })
}
