use serde::{Deserialize, Serialize};

/// 仅向界面返回索引信息；音频通过歌曲 ID 单独读取。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub directory_id: String,
    pub filename: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub seconds: f64,
    pub art: u8,
    pub available: bool,
    pub favorite: bool,
    pub metadata_error: String,
    pub groups: Vec<String>,
    pub tags: Vec<String>,
}

/// 移除目录只停用来源，保留收藏及分类关联。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Directory {
    pub id: String,
    pub path: String,
    pub status: String,
    pub count: usize,
}

#[derive(Serialize)]
pub struct LibraryData {
    pub tracks: Vec<Track>,
    pub directories: Vec<Directory>,
    pub groups: Vec<String>,
    pub tags: Vec<String>,
    pub settings: serde_json::Value,
}

/// 队列仅在变化时传入，避免进度保存反复写入上万条 ID。
#[derive(Deserialize)]
pub struct PlaybackSettings {
    pub skin: String,
    pub volume: f64,
    pub mode: String,
    pub current: Option<String>,
    pub position: f64,
    pub queue: Option<Vec<String>>,
}

/// 批量操作区分替换、添加、移除，不能覆盖未选择的其他分类。
#[derive(Deserialize)]
pub struct Assignment {
    pub ids: Vec<String>,
    pub groups: Vec<String>,
    pub tags: Vec<String>,
    pub operation: String,
}

/// 扫描进度不包含本地完整路径；失败详情仅向当前窗口展示。
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub processed: usize,
    pub failed: usize,
    pub finished: bool,
    pub cancelled: bool,
    pub errors: Vec<String>,
}

/// 单个文件的增量索引候选；未变化时 metadata 为空，仅更新可用状态。
pub struct IndexedFile {
    pub path: String,
    pub filename: String,
    pub size: i64,
    pub modified: String,
    pub metadata: Option<Metadata>,
}

pub struct Metadata {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub seconds: f64,
    pub error: String,
}
