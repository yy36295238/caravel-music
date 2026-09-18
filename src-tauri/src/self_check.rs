use crate::{database::Library, lyrics, media, models::*, scanner};
use std::{fs, path::PathBuf};

/// 无需测试框架的端到端自查：临时曲库、持久化、范围读取及撤销目录授权。
pub fn run() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    crate::tray::self_check();
    let root = std::env::temp_dir().join(format!("liusheng-check-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("音乐/子目录")).map_err(|e| e.to_string())?;
    let result = check(&root);
    let _ = fs::remove_dir_all(&root);
    result
}
fn check(root: &std::path::Path) -> Result<(), String> {
    let music = root.join("音乐");
    let path = music.join("子目录/测试歌手 - 测试歌曲.MP3");
    // 损坏的音频仍应被收录，标签失败不得终止扫描。
    fs::write(&path, vec![1u8; 2048]).map_err(|e| e.to_string())?;
    let library = Library::open(&root.join("data/library.sqlite"))?;
    let id = library.add_directory(&music)?;
    assert!(library.add_directory(&music.join("子目录")).is_err());
    scanner::scan(&library, None, |_| {})?;
    let data = library.load()?;
    assert_eq!(data.tracks.len(), 1);
    let track = &data.tracks[0];
    assert_eq!(track.title, "测试歌曲");
    assert!(!track.metadata_error.is_empty());
    let lrc = path.with_extension("LRC");
    fs::write(&lrc, "[00:01.20]中文歌词").map_err(|e| e.to_string())?;
    assert_eq!(
        lyrics::load(&library, &track.id)?.text,
        "[00:01.20]中文歌词"
    );
    let (gbk, _, _) = encoding_rs::GBK.encode("[00:02]旧编码歌词");
    fs::write(&lrc, &gbk).map_err(|e| e.to_string())?;
    assert!(lyrics::load(&library, &track.id)?
        .text
        .contains("旧编码歌词"));
    let utf16: Vec<u8> = [0xff, 0xfe]
        .into_iter()
        .chain("带标记歌词".encode_utf16().flat_map(u16::to_le_bytes))
        .collect();
    fs::write(&lrc, utf16).map_err(|e| e.to_string())?;
    assert_eq!(lyrics::load(&library, &track.id)?.text, "带标记歌词");
    fs::write(&lrc, vec![b'a'; 1024 * 1024 + 1]).map_err(|e| e.to_string())?;
    assert!(lyrics::load(&library, &track.id).is_err());
    fs::remove_file(&lrc).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        let outside = root.join("outside.lrc");
        fs::write(&outside, "不可越界读取").map_err(|e| e.to_string())?;
        std::os::unix::fs::symlink(&outside, &lrc).map_err(|e| e.to_string())?;
        assert!(lyrics::load(&library, &track.id).is_err());
        fs::remove_file(&lrc).map_err(|e| e.to_string())?;
    }
    assert!(lyrics::load(&library, "../../outside.lrc").is_err());
    println!("PASS: 同名 LRC、UTF-8 / UTF-16 / GBK、歌词体积限制及目录边界");
    library.favorite(&track.id, true)?;
    library.category("groups", "create", "通勤", None)?;
    library.category("tags", "create", "安静", None)?;
    assert!(library.category("tags", "create", "安静", None).is_err());
    library.assign(Assignment {
        ids: vec![track.id.clone()],
        groups: vec!["通勤".into()],
        tags: vec!["安静".into()],
        operation: "add".into(),
    })?;
    library.category("groups", "rename", "通勤", Some("夜行"))?;
    let req = tauri::http::Request::builder()
        .uri(format!("music://localhost/{}", track.id))
        .header("Range", "bytes=100-199")
        .body(vec![])
        .unwrap();
    let response = media::respond(&library, req);
    assert_eq!(response.status(), 206);
    assert_eq!(response.body().len(), 100);
    assert_eq!(media::byte_range("bytes=-50", 100), Some((50, 99)));
    assert_eq!(media::byte_range("bytes=100-", 100), None);
    assert_eq!(media::byte_range("bytes=0-1,4-5", 100), None);
    assert!(library.media_path("../../etc/passwd").is_err());
    library.finish_scan(&id, "incomplete", "error", false)?;
    assert!(library.load()?.tracks[0].available);
    library.remove_directory(&id)?;
    assert!(library.media_path(&track.id).is_err());
    assert!(lyrics::load(&library, &track.id).is_err());
    assert!(path.exists());
    let restored = library.add_directory(&music)?;
    assert_eq!(restored, id);
    scanner::scan(&library, None, |_| {})?;
    let restored = library.load()?;
    assert_eq!(restored.tracks[0].id, track.id);
    assert!(restored.tracks[0].favorite);
    assert_eq!(restored.tracks[0].groups, vec!["夜行"]);
    library.save_settings(PlaybackSettings {
        skin: "light".into(),
        volume: 0.6,
        mode: "order".into(),
        current: Some(track.id.clone()),
        position: 1.2,
        queue: Some(vec![track.id.clone()]),
    })?;
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    scanner::scan(&library, None, |_| {})?;
    assert!(!library.load()?.tracks[0].available);
    library.category("tags", "delete", "安静", None)?;
    drop(library);
    let reopened = Library::open(&root.join("data/library.sqlite"))?.load()?;
    assert!(reopened.tracks[0].favorite);
    assert_eq!(reopened.settings["skin"], "light");
    assert!(reopened.tracks[0].tags.is_empty());
    println!("PASS: 目录扫描、损坏标签降级、重复目录、收藏/分类持久化、目录撤销/恢复、缺失标记、字节范围和路径边界");
    // 有外部提供的真实 MP3 样本时，额外校验时长与元数据解析。
    if let Some(sample) = std::env::var_os("LIUSHENG_CHECK_MP3") {
        let sample = PathBuf::from(sample);
        let library = Library::open(&root.join("real.sqlite"))?;
        let dest = root.join("真实样本");
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        fs::copy(sample, dest.join("中文 空格.mp3")).map_err(|e| e.to_string())?;
        library.add_directory(&dest)?;
        scanner::scan(&library, None, |_| {})?;
        let data = library.load()?;
        assert!(data.tracks[0].seconds > 0.0);
        assert!(data.tracks[0].metadata_error.is_empty());
        assert!(lyrics::load(&library, &data.tracks[0].id)?.text.is_empty());
        // 只向自查的临时副本写入 ID3，绝不修改传入的样本文件。
        use lofty::{
            config::WriteOptions,
            prelude::{ItemKey, TagExt},
            tag::{Tag, TagType},
        };
        let mut tag = Tag::new(TagType::Id3v2);
        tag.insert_text(ItemKey::UnsyncLyrics, "内嵌歌词正文".into());
        tag.save_to_path(dest.join("中文 空格.mp3"), WriteOptions::default())
            .map_err(|e| e.to_string())?;
        assert_eq!(
            lyrics::load(&library, &data.tracks[0].id)?.text,
            "内嵌歌词正文"
        );
        fs::write(dest.join("中文 空格.lrc"), "[00:00]优先外部歌词").map_err(|e| e.to_string())?;
        assert!(lyrics::load(&library, &data.tracks[0].id)?
            .text
            .contains("优先外部歌词"));
        println!("PASS: 真实 MP3 时长、内嵌歌词、缺失歌词与 LRC 优先级");
    }
    Ok(())
}
