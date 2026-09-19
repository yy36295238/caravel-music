# 留声官网

官网使用独立的 `site/` 静态目录，不与桌面应用的 Vite 入口混用。GitHub 仓库首页由根目录 `README.md` 展示，完整使用说明保留在 `docs/guide.md`。

## 参考调研

2026-09-19 实际查阅：

| 产品 | 参考地址 | 采用的组织方式 |
| --- | --- | --- |
| fooyin | https://www.fooyin.org/ 和 https://github.com/fooyin/fooyin | 简明定位、产品截图、下载与文档入口分开；开发说明不占据产品首页 |
| Strawberry | https://www.strawberrymusicplayer.org/ | 真实界面、平台下载要求、安装说明清晰可查 |
| Harmonoid | https://github.com/harmonoid/harmonoid | README 优先展示产品和深浅界面，链接官网、下载及使用资料 |

页面独立设计，不复制对方的代码、品牌或截图。使用用户提供的留声深色红、清新绿真实界面，转为 WebP。官网以冷灰白背景、珊瑚红强调色和双皮肤截图切换为核心；不添加虚构用户数、性能测试、推荐语或 Windows 下载。

## 本地预览

```sh
python3 -m http.server 4321 --bind 127.0.0.1 --directory site
```

访问 http://127.0.0.1:4321 。官网不需要 `npm install` 或桌面 Rust 构建。运行 `node scripts/check-site.mjs` 检查静态资源、锚点和皮肤切换。

## Cloudflare Pages

项目名 `caravel-music`，默认域名 https://caravel-music.pages.dev 。

```sh
npx wrangler@4 pages deploy site --project-name caravel-music --branch main
```

首次创建项目：`npx wrangler@4 pages project create caravel-music --production-branch main`。配置位于根目录 `wrangler.toml`。仅上传静态站点，不上传本地音乐、数据库、密钥或开发日志。自定义域名可在该 Pages 项目的 Custom domains 中绑定。

本项目采用直接上传部署；向 GitHub 推送不会自动更新 Cloudflare。若改为 Git 集成，新建 Pages 项目时连接本仓库，构建命令留空、输出目录填写 `site`。

## 发布与维护

- macOS 按钮指向 GitHub Release `v0.1.0` 的 `liusheng_0.1.0_macos_universal.dmg`，不把安装包提交进源码仓库。
- 发布新版时，先上传对应 release 资产，再更新官网、README 的版本、体积和链接。
- Windows 尚无官网安装包，按钮只指向真实构建说明。
- 如更换官网域名，同步更新 README、Open Graph 图片绝对地址及本说明。
- 截图切换为展示效果，不模拟播放器，也不读取访客文件。网站不使用统计脚本、Cookie 或外部字体。

## 搜索发现

- GitHub About 使用中英文产品描述与准确的平台状态，Topics 标明 music-player、local-music-player、mp3-player、lyrics、tauri 等实际属性。
- 中文和英文 README 介绍用途、功能、安装要求、限制及开发方式，不使用虚构下载量或用户评价。
- 官网提供明确的页面标题、描述、canonical、Open Graph / Twitter 分享信息与 SoftwareApplication 结构化数据。
- `robots.txt` 允许抓取并声明 `sitemap.xml`，站点地图仅包含正式官网首页。
- 修改 JSON-LD 后，需要同步更新 `_headers` 的 CSP SHA-256，`node scripts/check-site.mjs` 会检查一致性。

这些配置有助于搜索系统理解项目，但不保证收录时效、排名或展示形式。GitHub 和外部搜索引擎各自维护索引。可用 `caravel-music in:name` 或 `user:yy36295238 topic:music-player` 在 GitHub 查找；外部可尝试「留声 Liusheng 本地音乐播放器」。

如需主动请求 Google / Bing 收录，需由站点所有者在 Search Console / Bing Webmaster Tools 验证网站后提交 `https://caravel-music.pages.dev/sitemap.xml`；本次没有代为完成站长平台认证或声称已被外部搜索引擎收录。
