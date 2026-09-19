<div align="center">
  <img src="site/assets/logo.svg" width="72" alt="留声">
  <h1>留声 Liusheng · 本地音乐播放器</h1>
  <p><strong>把喜欢，留在耳边。</strong></p>
  <p>适用于 macOS / Windows 的轻量本地 MP3 音乐播放器，支持文件夹曲库、本地歌词、收藏与标签。</p>
  <p><a href="https://caravel-music.pages.dev">官网</a> · <a href="https://github.com/yy36295238/caravel-music/releases/download/v0.1.0/liusheng_0.1.0_macos_universal.dmg">下载 macOS 通用版</a> · <a href="docs/guide.md">使用与开发指南</a> · <a href="https://github.com/yy36295238/caravel-music/issues">反馈问题</a></p>
</div>

**简体中文** · [English](README.en.md)

**留声（Liusheng / Caravel Music）** 是面向本地音乐收藏的桌面播放器：把已有的 MP3 文件夹变成可搜索的曲库，按文件夹、专辑、歌手浏览，用同步歌词和播放队列专心听歌。适合希望离线播放、保留原文件目录结构、不需要账号或在线推荐的用户。

A lightweight local MP3 music player for macOS and Windows, built with Tauri and Rust. Browse your music library by folder, album or artist, read local LRC lyrics, and keep favorites and tags on your own computer. A universal macOS DMG is available; Windows currently requires a source build.

[下载与安装](#下载) · [功能一览](#功能一览) · [快速上手](#开始听歌) · [常见问题](#常见问题) · [开发](#开发)

![留声深色红皮肤](site/assets/player-dark.webp)

## 听歌需要的，刚刚好

- **你自己的曲库**：导入 MP3 文件夹，包含子目录；按来源名称、歌手或专辑查找歌曲。
- **留下喜欢的**：收藏、标签与批量整理，搜索和分页适合日常本地曲库。
- **歌词就在右边**：本地 LRC / 内嵌歌词，跟随高亮、点击定位、单曲时间校准，也可随时收起。
- **顺手控制播放**：播放队列、顺序 / 随机 / 单曲循环；macOS 菜单栏播放器支持暂停、切歌。
- **两种颜色，同样好用**：深色红与清新绿，共用曲库、播放和歌词功能，换肤不中断播放。
- **只留在本地**：无需账号，不复制、不移动、不改写原始 MP3；收藏与播放偏好保存在本机。

<details>
  <summary>看看清新绿皮肤</summary>

![留声清新绿皮肤](site/assets/player-light.webp)

</details>

## 功能一览

| 功能 | 当前支持 |
| --- | --- |
| 本地音乐库 | 导入 MP3 文件夹，递归扫描子目录；刷新更新元数据并清理缺失歌曲索引 |
| 文件夹筛选 | 用导入目录的末级名称选择来源，展示其下歌曲，不改动文件目录结构 |
| 歌曲搜索 | 搜索歌曲、歌手、专辑、文件名及来源文件夹名称，可叠加收藏和标签筛选 |
| 专辑 / 歌手 | 根据本地元数据自动整理，同名专辑按歌手区分 |
| 喜欢 / 收藏 | 一键爱心收藏，「我喜欢的」集中浏览 |
| 标签管理 | 创建、重命名、删除标签；单曲或批量整理 |
| 歌词 | 同名 LRC、MP3 内嵌歌词；同步高亮、点击跳转、按歌曲保存时间偏移 |
| 播放队列 | 顺序、随机、单曲循环，当前歌曲显示播放状态律动 |
| macOS 菜单栏 | 悬浮播放面板、暂停 / 上一首 / 下一首、播放模式切换 |
| 两套皮肤 | 深色红 / 清新绿，播放中切换，偏好自动保存 |
| 本地数据 | SQLite 保存曲库索引、收藏、标签、音量和播放进度 |

当前专注 MP3，不提供流媒体、在线歌词搜索、音效均衡器或音频转码。其他格式没有列为已支持功能。

## 下载

| 平台 | 要求 | 获取方式 |
| --- | --- | --- |
| macOS 通用版 | macOS 12+，Apple Silicon / Intel | [下载 DMG · v0.1.0 · 7.4 MB](https://github.com/yy36295238/caravel-music/releases/download/v0.1.0/liusheng_0.1.0_macos_universal.dmg) |
| Windows x64 | Windows 10 / 11、WebView2 | [源码构建指南](docs/guide.md#本地开发和打包)，暂未提供官网安装包 |

macOS：打开 DMG，将「留声」拖入 Applications。当前包为本地签名，尚未经过 Apple 公证；若系统拦截，请确认下载来源后按系统「隐私与安全性」提示处理。

## 开始听歌

1. 添加音乐文件夹，自动收录其中的 MP3。
2. 点歌曲播放；用文件夹按钮、歌手、专辑或搜索定位音乐。
3. 在「设置」中切换皮肤和管理标签；同名 LRC 放在 MP3 旁边即可读取。

留声不提供在线音乐或歌词搜索。移除来源不删除音频文件；刷新会清理缺失歌曲的索引，离线目录或失败扫描会保留记录。

## 常见问题

### 留声是离线音乐播放器吗？

是。播放器的曲库、搜索、收藏、标签和本地歌词无需联网，也无需账号。官网与安装包下载需要网络；Windows 首次缺少 WebView2 时需要安装运行时。

### Mac Intel 和 M 系列能用同一个安装包吗？

可以。macOS 通用 DMG 包含 `x86_64` 和 `arm64` 两种架构，支持 Intel Mac 与 Apple Silicon，最低 macOS 12。安装说明见[下载](#下载)。

### Windows 安装包在哪里？

当前 Release 仅提供 macOS 通用 DMG。Windows 10 / 11 x64 可从源码构建 NSIS 安装包，详见[构建指南](docs/guide.md#本地开发和打包)。

### 怎么显示 LRC 歌词？

把 `歌名.mp3` 和 `歌名.lrc` 放在同一个目录；没有外部 LRC 时读取 MP3 内嵌歌词。支持 UTF-8、UTF-16、常见 GBK 编码。歌词不同步时，在歌词「…」中提前或延后，每次 0.2 秒，设置只影响当前歌曲。

### 导入和移除文件夹会修改我的音乐吗？

不会复制、移动或改写 MP3。移除来源保留原文件；刷新确认文件不存在后删除对应索引及关联，目录离线、扫描取消或读取失败时保留记录。

### 为什么歌名或歌手和文件名不一样？

优先使用完整的音频标签。缺少歌名时支持 `001.歌名 - 歌手.mp3` 等文件名兜底；调整文件或更新解析规则后，点击「音乐文件夹 → 刷新曲库」重新读取元数据。

### 有 Linux、手机端或在线同步吗？

目前项目面向 macOS 和 Windows 桌面，不提供 Linux / Android / iOS 安装包或云端同步服务。

## 开发

Tauri 2 + 原生 JavaScript / CSS + Rust + SQLite，不捆绑 Chromium。

需要 Node.js 22+、Rust stable，以及对应平台构建工具：macOS 使用 Xcode Command Line Tools，Windows 使用 Visual Studio C++ Build Tools、Windows SDK 和 WebView2。

```sh
git clone https://github.com/yy36295238/caravel-music.git
cd caravel-music
./run.sh                      # 开发模式
./run.sh build universal dmg  # macOS 通用 DMG
./run.sh clean                # 清理构建缓存，保留 artifacts 中的 DMG
```

完整环境要求、打包、数据目录和自查方式见 [使用与开发指南](docs/guide.md)。

## 官网

官网源码位于 [`site/`](site/)，纯 HTML / CSS / JavaScript，无额外运行时依赖，使用 Cloudflare Pages 托管。

[部署说明与页面参考](docs/website.md) · [产品设计方案](本地音乐播放器设计方案.md)

## 反馈与参与

在 [GitHub Issues](https://github.com/yy36295238/caravel-music/issues) 描述问题时，请提供系统版本、芯片架构、应用版本、复现步骤和截图。无需上传私人曲库或完整数据库；歌词或文件名解析问题可提供去除隐私后的最小样例。

欢迎提交具体的问题与改进建议。下载更新请查看 [GitHub Releases](https://github.com/yy36295238/caravel-music/releases)，发布内容以实际提供的安装包为准。
