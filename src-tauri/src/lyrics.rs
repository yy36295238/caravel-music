use crate::database::Library;
use lofty::{config::ParseOptions, file::TaggedFileExt, prelude::ItemKey, probe::Probe};
use serde::Serialize;
use std::{fs, io::Read};

/// 只返回当前歌曲的歌词，避免把整库歌词加载进前端索引。
#[derive(Serialize)]
pub struct Lyrics {
    pub text: String,
    pub source: &'static str,
}
/// 限制外部歌词体积，避免异常文本耗尽内存或阻塞页面。
const MAX_LYRICS_BYTES: u64 = 1024 * 1024;

/// 优先同目录同名 LRC，其次 ID3 USLT 文本；所有读取先复用媒体目录授权校验。
pub fn load(library: &Library, id: &str) -> Result<Lyrics, String> {
    let path = library.media_path(id)?;
    let parent = path.parent().ok_or("歌曲目录不可用")?;
    let mut sidecar = path.with_extension("lrc");
    if !sidecar.exists() {
        // Windows 常见大写 .LRC；只匹配当前歌曲文件名，不搜索其他目录。
        for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
            let candidate = entry.map_err(|e| e.to_string())?.path();
            if candidate.file_stem() == path.file_stem()
                && candidate
                    .extension()
                    .is_some_and(|s| s.eq_ignore_ascii_case("lrc"))
            {
                sidecar = candidate;
                break;
            }
        }
    }
    if sidecar.exists() {
        let real = sidecar.canonicalize().map_err(|e| e.to_string())?;
        if real.parent() != Some(parent) {
            return Err("歌词文件指向音乐目录之外，无法读取".into());
        }
        if !fs::metadata(&real).map_err(|e| e.to_string())?.is_file() {
            return Err("歌词路径不是普通文件".into());
        }
        let file = fs::File::open(real).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(MAX_LYRICS_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_LYRICS_BYTES {
            return Err("歌词文件超过 1 MiB".into());
        }
        let text = decode(&bytes)?;
        if !text.trim().is_empty() {
            log::info!("读取歌词 track={id} source=lrc");
            return Ok(Lyrics {
                text,
                source: "同名 LRC",
            });
        }
    }
    let file = Probe::open(&path)
        .and_then(|p| {
            p.options(
                ParseOptions::new()
                    .read_cover_art(false)
                    .read_properties(false),
            )
            .read()
        })
        .map_err(|e| format!("内嵌歌词读取失败：{e}"))?;
    for tag in file.tags() {
        if let Some(text) = tag
            .get_string(ItemKey::UnsyncLyrics)
            .or_else(|| tag.get_string(ItemKey::Lyrics))
        {
            if text.len() as u64 > MAX_LYRICS_BYTES {
                return Err("内嵌歌词超过 1 MiB".into());
            }
            if !text.trim().is_empty() {
                log::info!("读取歌词 track={id} source=id3");
                return Ok(Lyrics {
                    text: text.to_string(),
                    source: "MP3 内嵌歌词",
                });
            }
        }
    }
    Ok(Lyrics {
        text: String::new(),
        source: "",
    })
}

/// 兼容常见中文 LRC：优先 UTF BOM / UTF-8，无 BOM 的旧编码再按 GBK 解码。
fn decode(bytes: &[u8]) -> Result<String, String> {
    let (encoding, skip) = encoding_rs::Encoding::for_bom(bytes).unwrap_or((encoding_rs::UTF_8, 0));
    let (text, errors) = encoding.decode_without_bom_handling(&bytes[skip..]);
    if !errors {
        return Ok(text.into_owned());
    }
    if skip == 0 {
        let (text, errors) = encoding_rs::GBK.decode_without_bom_handling(bytes);
        if !errors {
            return Ok(text.into_owned());
        }
    }
    Err("无法识别歌词编码，请将 LRC 保存为 UTF-8".into())
}
