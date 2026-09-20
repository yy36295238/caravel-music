import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './styles.css';
import { initUpdater, renderUpdater, checkForUpdates, installUpdate } from './updater.js';
import { matching, collections, albumKey, albumName, artistName, musicFolders } from './library.js';
import { parseLyrics, activeLyricIndex, lyricScrollTop, lyricSeekTime } from './lyrics.js';
import { playbackSnapshot } from './menu-state.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const duration = seconds => `${Math.floor((Number(seconds) || 0) / 60)}:${String(Math.floor((Number(seconds) || 0) % 60)).padStart(2, '0')}`;
const shuffled = items => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
// 内置皮肤注册表：只描述外观，新增皮肤无需复制音乐业务逻辑。
const skins = [
  { id: 'dark', name: '深色红', scheme: 'dark', accent: '#f25b68', background: '#19191e', heading: '把喜欢，留在耳边。', description: '深色侧栏 · 红色强调 · 歌曲详情' },
  { id: 'light', name: '清新绿', scheme: 'light', accent: '#13865e', background: '#f6f8f7', heading: '好音乐，就在身边。', description: '浅色布局 · 绿色强调 · 宽松列表' }
];
// 旧版没有保存皮肤，或已保存皮肤被移除时，回退到入口默认皮肤。
const resolveSkin = (id, fallback = 'dark') => skins.find(skin => skin.id === id) || skins.find(skin => skin.id === fallback) || skins[0];
const icons = {
  settings: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  music: '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
  library: '<rect x="3" y="4" width="5" height="16" rx="1"/><path d="M12 4v16M16 5l4 14M3 9h5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  play: '<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M5 5v14m14-14-11 7 11 7Z"/>',
  next: '<path d="M19 5v14M5 5l11 7-11 7Z"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 4-6 5H2v6h3l6 5Zm5 5 5 6m0-6-5 6"/>',
  queue: '<path d="M3 5h18M3 11h18M3 17h10m4-2 5 3-5 3Z"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>',
  shuffle: '<path d="M3 5h3c5 0 7 14 12 14h3m-4-4 4 4-4 3M3 19h3c2 0 3-2 4-4m4-6c1-2 2-4 4-4h3m-4-3 4 3-4 4"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1"/>',
  dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6ZM13 6l5 5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M5 12a7 7 0 0 1 7-7m0 14a7 7 0 0 0 7-7"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.music}</svg>`;
const $ = selector => document.querySelector(selector);
// 同一标记用于曲库、底部播放器和队列，律动只表示播放状态。
const playbackIndicator = id => `<span class="playing-indicator" data-playing-track="${esc(id)}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
// 只缓存索引元数据，音频始终由原生层按需读取。
const store = { tracks: [], directories: [], tags: [], skin: 'dark', volume: 0.55, mode: 'order', lyricOffsets: {} };
const filter = { favorite: false, tags: [], query: '', artist: '', album: '', directoryId: '' };
// 文件夹选项仅在索引更新时汇总，播放状态更新不重复遍历目录。
let folderEntries = [];
// 概览与歌曲明细共用列表区域，播放器和已建立的队列独立于导航。
let browseKind = '', collectionTitle = '';
// 设置与曲库切换视图，保留曲库筛选和唯一音频实例。
let settingsOpen = false;
// 返回设置时保留上次查看的分类，标签管理弹窗关闭后不会跳回外观。
let settingsTab = 'settings-appearance';
const selected = new Set();
const audio = new Audio();
audio.preload = 'metadata';
audio.volume = store.volume;
let currentId = null;
let queue = [];
let page = 1, toastTimer, searchTimer, playToken = 0, mediaId = '', savedAt = 0;
let restorePosition = 0;
const pageSize = 100;
const current = () => store.tracks.find(t => t.id === currentId);
const playable = track => track?.available;
const favoriteButton = (track, extra = '') => `<button class="icon-btn favorite ${track?.favorite ? 'is-loved' : ''}" data-action="favorite" data-id="${esc(track?.id)}" aria-pressed="${!!track?.favorite}" aria-label="${track?.favorite ? '取消收藏' : '收藏'}${extra}" title="${track?.favorite ? '取消收藏' : '收藏'}">${icon('heart')}</button>`;

// 菜单栏复用主窗口的唯一音频实例；低频快照不含文件路径和整个曲库。
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let menuSnapshotKey = '';
function syncMenuPlayer() {
  if (!initialized || !navigator.platform.startsWith('Mac')) return;
  const snapshot = playbackSnapshot(store, queue.length ? queue : filtered().map(t => t.id), currentId, !audio.paused && !audio.ended && !audio.error, reducedMotion.matches);
  const key = JSON.stringify(snapshot);
  if (key === menuSnapshotKey) return;
  menuSnapshotKey = key;
  invoke('update_menu_player', { snapshot }).catch(error => {
    menuSnapshotKey = ''; console.warn('菜单栏状态同步失败', error);
  });
}
reducedMotion.addEventListener('change', syncMenuPlayer);

// 串行保存防止较早的进度覆盖新设置；队列不变时不重写长列表。
let saveChain = Promise.resolve(), savedQueue = '', initialized = false;
// 校准操作显式携带完整快照，连续调整再复位时也必须排队写入空映射。
function persist(saveLyricOffsets = false) {
  if (!initialized) return Promise.resolve();
  const queueKey = JSON.stringify(queue);
  const settings = { skin: store.skin, volume: store.volume, mode: store.mode, current: currentId,
    position: audio.ended ? 0 : mediaId === currentId ? audio.currentTime : restorePosition };
  if (queueKey !== savedQueue) settings.queue = [...queue];
  if (saveLyricOffsets) settings.lyricOffsets = { ...store.lyricOffsets };
  const task = saveChain.then(() => invoke('save_settings', { settings })).then(() => { savedQueue = queueKey; });
  saveChain = task.catch(error => reportError('保存播放设置', error));
  return task;
}
function reportError(context, error) {
  console.error(context, error);
  const message = `${context}失败：${String(error)}`;
  toast(message);
  // 文件夹弹窗处于顶层时，错误也要在弹窗内可见。
  const folderStatus = $('#folder-scan-status');
  if (folderStatus) folderStatus.textContent = message;
}
// 后台索引刷新只替换曲库，不能覆盖正在播放时修改的音量、进度和皮肤。
async function reloadLibrary() {
  const data = await invoke('load_library');
  Object.assign(store, { tracks: data.tracks, directories: data.directories, tags: data.tags });
  folderEntries = musicFolders(store.tracks, store.directories);
  if (filter.directoryId && !folderEntries.some(item => item.directoryId === filter.directoryId)) {
    filter.directoryId = '';
  }
  // 刷新删除记录后同步清理内存引用，避免队列或定时保存重新带回失效歌曲。
  const ids = new Set(store.tracks.map(track => track.id));
  const oldQueueLength = queue.length;
  queue = queue.filter(id => ids.has(id));
  for (const id of selected) if (!ids.has(id)) selected.delete(id);
  let offsetsRemoved = false;
  for (const id of Object.keys(store.lyricOffsets)) {
    if (!ids.has(id)) { delete store.lyricOffsets[id]; offsetsRemoved = true; }
  }
  const currentRemoved = currentId && !ids.has(currentId);
  if (currentRemoved) {
    playToken++; currentId = null; mediaId = ''; restorePosition = 0;
    audio.pause(); audio.removeAttribute('src'); audio.load();
  }
  render();
  if (oldQueueLength !== queue.length && $('#modal').open && $('#modal').dataset.view === 'queue') showQueue();
  if (initialized && (currentRemoved || offsetsRemoved || oldQueueLength !== queue.length)) await persist(offsetsRemoved);
  return data.settings;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
function mount() {
  $('#app').innerHTML = `<div class="layout">
    <aside class="sidebar" aria-label="音乐导航">
      <div class="brand"><span class="brand-mark">${icon('music')}</span><span><strong>留声</strong><small>LOCAL MUSIC</small></span></div>
      <p class="nav-caption">我的音乐</p>
      <button class="nav-item" data-action="view" data-view="all">${icon('library')}<span>本地音乐</span><span class="count" id="all-count"></span></button>
      <button class="nav-item" data-action="view" data-view="favorite">${icon('heart')}<span>我喜欢的</span><span class="count" id="favorite-count"></span></button>
      <button class="nav-item" data-action="browse" data-kind="albums">${icon('disc')}<span>专辑</span><span class="count" id="album-count"></span></button>
      <button class="nav-item" data-action="browse" data-kind="artists">${icon('music')}<span>歌手</span><span class="count" id="artist-count"></span></button>
      <button class="nav-item" data-action="import">${icon('folder')}<span>音乐文件夹</span></button>
      <div class="sidebar-bottom"><div class="local-status">音乐与偏好，只留在本地</div><button class="settings-entry" data-action="settings">${icon('settings')}<span>设置</span>${icon('arrow')}</button></div>
    </aside>
    <main class="workspace">
      <header class="topbar"><div class="breadcrumb">音乐库 ${icon('arrow')} <b>本地音乐</b></div>
        <label class="search">${icon('search')}<input id="search" type="search" placeholder="搜索歌曲、歌手、专辑、文件夹" aria-label="搜索歌曲、歌手、专辑、文件夹"><kbd>⌘ K</kbd></label>
      </header>
      <nav class="mobile-nav" aria-label="移动版音乐筛选" hidden><button class="chip active" data-action="view" data-view="all">全部音乐</button><button class="chip" data-action="view" data-view="favorite">我喜欢的</button><button class="chip" data-action="browse" data-kind="albums">专辑</button><button class="chip" data-action="browse" data-kind="artists">歌手</button><button class="chip" data-action="settings">设置</button></nav>
      <div class="content"><section class="library" aria-label="音乐库">
        <div class="hero"><div class="hero-copy"><div class="eyebrow">YOUR MUSIC, YOUR MOMENTS</div><h1>${esc(resolveSkin(store.skin).heading)}</h1><p>不必联网，随时回到喜欢的旋律。</p><div class="hero-foot">${icon('disc')}<span>自己的音乐，自己的节奏</span></div></div><div class="hero-art" aria-hidden="true"><div class="vinyl"></div><span class="vinyl-label">The little things.</span></div></div>
        <div id="collection-path" class="collection-path" hidden></div><div class="library-head"><div><h2 id="view-title" tabindex="-1">本地音乐</h2><p id="library-count"></p></div><div class="actions"><button class="btn primary" data-action="play-all">${icon('play')}播放全部</button><button class="btn" data-action="import">${icon('plus')}导入音乐</button></div></div>
        <div id="scan-status" class="scan-status" role="status" hidden></div><div class="folder-filters" id="folder-filters" role="group" aria-label="按音乐文件夹筛选"></div><div class="filters" id="filters"></div>
        <div class="batch" id="batch" hidden><span id="selected-count"></span><div><button class="text-btn" data-action="assign-selected">设置标签</button><button class="text-btn" data-action="clear-selected">取消选择</button></div></div>
        <div id="collections" class="collection-list" hidden></div><div class="table-wrap"><table aria-label="歌曲列表"><thead><tr><th><input id="select-all" type="checkbox" aria-label="选择本页全部歌曲"></th><th>歌曲</th><th class="artist-col">歌手</th><th class="album-col">专辑</th><th class="tag-col">标签</th><th>时长</th><th><span class="sr-only">收藏</span></th><th><span class="sr-only">更多操作</span></th></tr></thead><tbody id="tracks"></tbody></table></div>
        <div id="empty" class="empty" hidden>${icon('search')}没有找到歌曲<br><button class="text-btn" data-action="clear-filters">清空筛选</button></div><div id="pagination" class="pagination" hidden></div><div class="table-end" id="table-end"></div>
      </section>
      <aside class="right-panel" aria-label="当前歌曲歌词"><div class="right-title">正在播放<span></span></div><div id="now-info"></div><div id="inline-lyrics-slot"><section id="inline-lyrics" class="inline-lyrics" aria-label="当前歌曲歌词"><div class="detail-heading"><span>歌词</span><button class="text-btn" data-action="follow-lyrics" data-target="inline-lyrics-body" aria-pressed="true" hidden>跟随播放</button><details class="lyrics-options"><summary class="icon-btn" aria-label="歌词更多" title="歌词更多">${icon('dots')}</summary><div class="lyrics-options-panel"><div class="lyrics-actions"><span id="lyrics-source"></span><button class="text-btn" data-action="reload-lyrics">重新读取</button></div><div id="lyrics-timing" class="lyrics-timing" hidden aria-label="当前歌曲歌词校准"><button class="text-btn" data-action="lyric-offset" data-delta="0.2" title="歌词比人声慢时使用">提前 0.2s</button><button class="text-btn" id="lyrics-offset" data-action="lyric-offset" data-delta="reset" title="点击恢复原始时间"></button><button class="text-btn" data-action="lyric-offset" data-delta="-0.2" title="歌词比人声快时使用">延后 0.2s</button></div></div></details><button class="icon-btn" data-action="close-lyrics" aria-label="关闭歌词" title="关闭歌词">${icon('close')}</button></div><div id="inline-lyrics-body" class="lyrics-body" data-lyric-view tabindex="0" aria-label="主界面歌词"></div></section></div></aside>
      </div>
      <section id="settings-page" class="settings-page" aria-labelledby="settings-title" hidden></section>
    </main>
  </div>
  <footer class="player" aria-label="音乐播放器"><div class="player-track" id="player-track"></div><div class="player-center"><div class="transport"><button class="icon-btn" data-action="previous" aria-label="上一首">${icon('prev')}</button><button class="play-button" id="play-toggle" data-action="toggle-play" aria-label="播放">${icon('play')}</button><button class="icon-btn" data-action="next" aria-label="下一首">${icon('next')}</button></div><div class="progress"><span id="elapsed">0:00</span><input id="seek" type="range" aria-label="播放进度" min="0" max="1" step="0.1" value="0"><span id="total">0:00</span></div></div><div class="player-tools"><button class="mode-button" data-action="mode" id="mode" aria-label="切换播放模式"></button><button class="icon-btn volume-control" data-action="mute" id="mute" aria-label="静音">${icon('volume')}</button><input class="volume-control" id="volume" type="range" aria-label="音量" min="0" max="1" step="0.01" value="${store.volume}"><span class="divider"></span><button class="lyrics-toggle" data-action="lyrics" aria-label="关闭歌词" aria-expanded="true" aria-controls="inline-lyrics">词</button><button class="icon-btn" data-action="queue" aria-label="播放队列">${icon('queue')}</button></div></footer>
  <dialog id="modal" aria-labelledby="dialog-title"></dialog><div id="toast" class="toast" role="status" hidden></div>
  <input id="file-input" type="file" accept=".mp3,audio/mpeg" multiple hidden><input id="folder-input" type="file" accept=".mp3,audio/mpeg" webkitdirectory multiple hidden>`;
}
// 换肤只更新外观属性，不重新挂载页面或音频，保留文件授权、队列和筛选。
function applySkin(id, save = false) {
  const skin = resolveSkin(id);
  store.skin = skin.id;
  document.body.dataset.theme = skin.id;
  document.documentElement.style.colorScheme = skin.scheme;
  $('meta[name="color-scheme"]').content = skin.scheme;
  document.title = `留声 · 本地音乐 — ${skin.name}`;
  $('.hero h1').textContent = skin.heading;
  syncMenuPlayer();
  placeInlineLyrics();
  $('link[rel="icon"]').href = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="${skin.accent}"/><text x="7" y="25" font-size="25" fill="white">♪</text></svg>`);
  if (save) {
    console.info('已切换皮肤', { skin: skin.id });
    persist().then(() => toast(`已切换为${skin.name}，下次打开继续使用`)).catch(() => {});
  }
}
// 设置使用主内容区；返回时不重建曲库或中断播放。
function showSettings(panelId = settingsTab) {
  settingsTab = panelId;
  $('#modal').close();
  settingsOpen = true;
  $('#settings-page').innerHTML = `<div class="settings-page-head"><div><h1 id="settings-title" tabindex="-1">设置</h1><p class="settings-description">把留声调成你喜欢的样子。</p></div><button class="btn" data-action="back-library">返回音乐库</button></div>
    <div class="settings-tabs" role="tablist" aria-label="设置分类">${[['settings-appearance', '外观'], ['settings-organize', '音乐整理'], ['software-update', '软件更新']].map(([id, label]) => `<button id="tab-${id}" role="tab" data-action="settings-tab" data-panel="${id}" aria-controls="${id}" aria-selected="false" tabindex="-1">${label}</button>`).join('')}</div>
    <section id="settings-appearance" class="settings-section" role="tabpanel" aria-labelledby="tab-settings-appearance" tabindex="0" hidden><h2 id="appearance-title" class="settings-heading">外观</h2><p class="settings-description">选择喜欢的皮肤，切换即保存。</p><div class="skin-options">${skins.map(skin => `<button class="skin-option" data-action="choose-skin" data-skin="${esc(skin.id)}" aria-pressed="${store.skin === skin.id}"><span class="skin-swatch" style="background:${skin.background};color:${skin.accent}" aria-hidden="true">${icon('music')}</span><span class="skin-copy"><strong>${esc(skin.name)}</strong><small>${esc(skin.description)}</small></span>${icon('check')}</button>`).join('')}</div></section>
    <section id="settings-organize" class="settings-section" role="tabpanel" aria-labelledby="tab-settings-organize" tabindex="0" hidden><h2 id="organize-title" class="settings-heading">音乐整理</h2><p class="settings-description">用标签整理音乐，按自己的习惯查找歌曲。</p><button class="settings-row" data-action="manage" data-kind="tags">${icon('tag')}<span><strong>标签管理</strong><small>创建、重命名或删除标签</small></span><em id="settings-tag-count">${store.tags.length} 个</em>${icon('arrow')}</button></section>
    <section id="software-update" class="settings-section" role="tabpanel" aria-labelledby="tab-software-update" tabindex="0" hidden><h2 id="update-title" class="settings-heading">软件更新</h2><p class="settings-description" data-update-version></p><p class="settings-description">启动时自动检查；点击安装后将保存播放进度并重启。</p><p class="update-message" role="status" data-update-message></p><progress class="update-progress" max="100" aria-label="更新下载进度" hidden></progress><pre class="update-notes" data-update-notes hidden></pre><div class="actions"><button class="btn" data-action="check-update">检查更新</button><button class="btn primary" data-action="install-update" hidden>下载并安装更新</button></div></section>`;
  selectSettingsTab(settingsTab);
  renderUpdater();
  render();
  $('.workspace').scrollTop = 0;
  $('#settings-title').focus({ preventScroll: true });
}
// 切换只改变显隐，更新下载状态和当前控件节点保持不变。
function selectSettingsTab(panelId) {
  settingsTab = panelId;
  document.querySelectorAll('[data-action="settings-tab"]').forEach(tab => {
    const active = tab.dataset.panel === panelId;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.dataset.panel).hidden = !active;
  });
}
// ponytail: 不到一万首只扫描内存元数据；规模明显增长时再下推 SQL 查询。
function filtered() { return matching(store.tracks, filter, store.directories); }
function render() {
  $('.content').hidden = settingsOpen;
  $('#settings-page').hidden = !settingsOpen;
  $('.search').hidden = settingsOpen;
  document.querySelectorAll('[data-action="settings"]').forEach(button => {
    button.classList.toggle('active', settingsOpen);
    button.setAttribute('aria-pressed', String(settingsOpen));
  });
  if ($('#settings-tag-count')) $('#settings-tag-count').textContent = `${store.tags.length} 个`;
  const rows = filtered();
  const entries = browseKind ? collections(store.tracks, browseKind, filter.query) : [];
  const count = browseKind ? entries.length : rows.length;
  page = Math.max(1, Math.min(page, Math.ceil(count / pageSize) || 1));
  $('#all-count').textContent = store.tracks.length;
  $('#favorite-count').textContent = store.tracks.filter(t => t.favorite).length;
  $('#album-count').textContent = collections(store.tracks, 'albums').length;
  $('#artist-count').textContent = collections(store.tracks, 'artists').length;
  document.querySelectorAll('[data-action="browse"]').forEach(button => {
    const active = !settingsOpen && button.dataset.kind === (browseKind || (filter.album ? 'albums' : filter.artist ? 'artists' : ''));
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-action="view"]').forEach(button => {
    const active = !settingsOpen && !browseKind && !filter.album && !filter.artist && (button.dataset.view === 'favorite' ? filter.favorite : !filter.favorite);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const detailKind = filter.album ? 'albums' : filter.artist ? 'artists' : '';
  const heading = browseKind === 'albums' ? '专辑' : browseKind === 'artists' ? '歌手' : collectionTitle || (filter.favorite ? '我喜欢的' : '本地音乐');
  $('#view-title').textContent = heading;
  $('.breadcrumb b').textContent = settingsOpen ? '设置' : heading;
  $('#search').placeholder = browseKind === 'albums' ? '搜索专辑名称、歌手' : browseKind === 'artists' ? '搜索歌手' : '搜索歌曲、歌手、专辑、文件夹';
  $('#search').setAttribute('aria-label', $('#search').placeholder);
  $('#collection-path').hidden = !detailKind;
  $('#collection-path').innerHTML = detailKind ? `<button class="text-btn" data-action="browse" data-kind="${detailKind}">返回${detailKind === 'albums' ? '专辑' : '歌手'}</button><span> / ${esc(collectionTitle)}</span>` : '';
  $('.hero').hidden = !!browseKind || !!detailKind;
  $('.table-wrap').hidden = !!browseKind;
  $('#collections').hidden = !browseKind;
  $('#filters').hidden = !!browseKind;
  $('[data-action="play-all"]').hidden = !!browseKind;
  $('#collections').innerHTML = entries.slice((page - 1) * pageSize, page * pageSize).map(item => `<button class="collection-card" data-action="collection" data-kind="${browseKind}" data-key="${esc(item.key)}" data-name="${esc(item.title)}"><span class="collection-art art-${item.art} ${browseKind === 'artists' ? 'artist-art' : ''}" aria-hidden="true">${browseKind === 'artists' ? esc(item.title.slice(0, 1)) : icon('disc')}</span><span class="collection-copy"><strong>${esc(item.title)}</strong><small>${browseKind === 'albums' ? esc(item.artist) : `${item.albums.size} 张专辑`}</small><small>${item.count} 首歌曲</small></span>${icon('arrow')}</button>`).join('');
  const localCount = store.tracks.filter(playable).length;
  $('#library-count').textContent = `${rows.length} 首歌曲 · ${localCount ? `已导入 ${localCount} 首本地音乐` : '选择音乐文件夹开始收藏'}`;
  if (browseKind) $('#library-count').textContent = `${entries.length} ${browseKind === 'albums' ? '张专辑' : '位歌手'} · 根据本地歌曲信息整理`;
  $('#folder-filters').hidden = !!browseKind || !folderEntries.length;
  $('#folder-filters').innerHTML = `<span class="folder-filter-label">${icon('folder')}文件夹</span><button class="folder-chip ${filter.directoryId ? '' : 'active'}" data-action="folder" data-id="" aria-pressed="${!filter.directoryId}">全部</button>${folderEntries.map(item => `<button class="folder-chip ${item.directoryId === filter.directoryId ? 'active' : ''}" data-action="folder" data-id="${esc(item.directoryId)}" aria-pressed="${item.directoryId === filter.directoryId}" title="${esc(item.path)}"><span>${esc(item.name)}</span><small>${item.count}</small></button>`).join('')}`;
  $('#filters').innerHTML = `<span>标签</span><button class="chip ${filter.tags.length ? '' : 'active'}" data-action="all-tags">全部</button>${store.tags.map(tag => `<button class="chip ${filter.tags.includes(tag) ? 'active' : ''}" data-action="tag" data-name="${esc(tag)}" aria-pressed="${filter.tags.includes(tag)}">${esc(tag)}</button>`).join('')}<button class="text-btn" data-action="settings" data-panel="settings-organize">标签设置</button>`;
  const visible = browseKind ? [] : rows.slice((page - 1) * pageSize, page * pageSize);
  $('#tracks').innerHTML = visible.map(t => `<tr class="${t.id === currentId ? 'current' : ''}" data-track="${esc(t.id)}"><td><input type="checkbox" data-select="${esc(t.id)}" ${selected.has(t.id) ? 'checked' : ''} aria-label="选择 ${esc(t.title)}"></td><td><div class="song-cell"><span class="cover art-${t.art}"><button class="row-play" data-action="play" data-id="${esc(t.id)}" aria-label="播放 ${esc(t.title)}">${icon(t.id === currentId && !audio.paused ? 'pause' : 'play')}</button>${playbackIndicator(t.id)}</span><button class="song-name" data-action="play" data-id="${esc(t.id)}" aria-label="点播 ${esc(t.title)}"><span class="song-title">${esc(t.title)}</span><span class="song-meta">${playable(t) ? (t.metadataError ? '标签读取异常' : '本地 MP3') : '文件缺失或目录离线'}</span></button></div></td><td class="cell-muted artist-col"><button class="metadata-link" data-action="collection" data-kind="artists" data-key="${esc(artistName(t))}" data-name="${esc(artistName(t))}">${esc(artistName(t))}</button></td><td class="cell-muted album-col"><button class="metadata-link" data-action="collection" data-kind="albums" data-key="${esc(albumKey(t))}" data-name="${esc(albumName(t))}">${esc(albumName(t))}</button></td><td class="tag-col">${t.tags.slice(0, 2).map(tag => `<span class="row-tag">${esc(tag)}</span>`).join('') || '<span class="row-tag">—</span>'}</td><td class="cell-muted">${t.seconds ? duration(t.seconds) : '--:--'}</td><td>${favoriteButton(t, ` ${t.title}`)}</td><td><button class="icon-btn" data-action="track-more" data-id="${esc(t.id)}" aria-label="${esc(t.title)} 更多" title="更多">${icon('dots')}</button></td></tr>`).join('');
  $('#empty').hidden = count > 0;
  $('#empty').innerHTML = `${icon('search')}没有找到${browseKind === 'albums' ? '专辑' : browseKind === 'artists' ? '歌手' : '歌曲'}<br><button class="text-btn" data-action="clear-filters">清空筛选</button>`;
  $('#table-end').hidden = !!browseKind;
  $('#table-end').textContent = rows.length ? `— ${rows.length <= pageSize ? '已展示全部' : '共'} ${rows.length} 首歌曲 —` : '';
  $('#select-all').checked = visible.length > 0 && visible.every(t => selected.has(t.id));
  $('#select-all').indeterminate = visible.some(t => selected.has(t.id)) && !$('#select-all').checked;
  $('#batch').hidden = !!browseKind || !selected.size;
  $('#selected-count').textContent = `已选择 ${selected.size} 首`;
  $('#pagination').hidden = count <= pageSize;
  $('#pagination').innerHTML = `<button class="icon-btn" data-action="page-prev" aria-label="上一页" ${page === 1 ? 'disabled' : ''}>‹</button>${page} / ${Math.ceil(count / pageSize)}<button class="icon-btn" data-action="page-next" aria-label="下一页" ${page * pageSize >= count ? 'disabled' : ''}>›</button>`;
  renderPlayer();
}
function renderPlayer() {
  syncMenuPlayer();
  const labels = { order: '顺序播放', single: '单曲循环', shuffle: '随机播放' };
  $('#mode').innerHTML = `${icon(store.mode === 'shuffle' ? 'shuffle' : 'repeat')}<span>${labels[store.mode]}</span>`;
  $('#mode').setAttribute('aria-label', `${labels[store.mode]}，点击切换`);
  const track = current();
  if (lyricTrack !== (track?.id || null)) void loadLyrics();
  if (!track) {
    $('#player-track').innerHTML = '<div class="track-label"><strong>还没有正在播放的音乐</strong><small>选择歌曲，开始聆听</small></div>';
    $('#now-info').textContent = '从本地音乐开始';
    $('#seek').disabled = true; $('#total').textContent = '0:00'; $('#elapsed').textContent = '0:00';
    $('#play-toggle').innerHTML = icon('play');
    renderPlaybackIndicators(); return;
  }
  $('#player-track').innerHTML = `<span class="cover art-${track.art}">${playbackIndicator(track.id)}</span><div class="track-label"><strong>${esc(track.title)}</strong><small>${esc(track.artist)}</small></div>${favoriteButton(track, '当前歌曲')}<button class="icon-btn" data-action="track-more" data-id="${esc(track.id)}" aria-label="当前歌曲更多" title="更多">${icon('dots')}</button>`;
  $('#now-info').innerHTML = `<div class="now-info"><div><h3>${esc(track.title)}</h3><p>${esc(track.artist)}</p></div>${favoriteButton(track, '详情歌曲')}</div>`;
  const rowButton = [...document.querySelectorAll('.row-play')].find(button => button.dataset.id === track.id);
  if (rowButton) {
    rowButton.innerHTML = icon(audio.paused ? 'play' : 'pause');
    rowButton.setAttribute('aria-label', `${audio.paused ? '播放' : '暂停'} ${track.title}`);
  }
  $('#play-toggle').innerHTML = icon(audio.paused ? 'play' : 'pause');
  $('#play-toggle').setAttribute('aria-label', audio.paused ? '播放' : '暂停');
  const total = mediaId === track.id && Number.isFinite(audio.duration) ? audio.duration : track.seconds || 0;
  $('#total').textContent = duration(total);
  $('#seek').max = total || 1;
  if (mediaId !== track.id) { $('#elapsed').textContent = duration(restorePosition); $('#seek').value = restorePosition; }
  $('#seek').disabled = mediaId !== track.id || !Number.isFinite(audio.duration);
  renderPlaybackIndicators();
}
// 只更新标记与按钮状态，队列打开期间切歌或暂停不重建弹窗、不打断焦点。
function renderPlaybackIndicators() {
  const activeId = current()?.id;
  const playing = mediaId === activeId && !audio.paused && !audio.ended && !audio.error;
  document.querySelectorAll('[data-playing-track]').forEach(marker => {
    const active = marker.dataset.playingTrack === activeId;
    marker.classList.toggle('is-current', active);
    marker.classList.toggle('is-playing', active && playing);
  });
  document.querySelectorAll('[data-queue-track]').forEach(row => {
    const active = row.dataset.queueTrack === activeId;
    row.classList.toggle('is-current', active);
    const button = row.querySelector('[data-action="queue-play"]');
    button.setAttribute('aria-label', `${active && playing ? '暂停' : '播放'} ${row.querySelector('.queue-title').textContent}`);
    row.querySelector('.queue-transport').innerHTML = icon(active && playing ? 'pause' : 'play');
    row.querySelector('.queue-state').textContent = active ? (playing ? '正在播放' : audio.ended ? '播放结束' : '已暂停') : row.dataset.duration;
  });
}
// 歌词仅缓存当前歌曲，请求序号防止快速切歌时旧响应覆盖新歌曲。
let lyricTrack, lyricRequest = 0, lyricLines = [], lyricActive = -1;
// 只在播放且歌词可见时逐帧取音频真实进度，暂停或隐藏后不空转。
let lyricFrame = 0;
const lyricOffset = () => store.lyricOffsets[currentId] || 0;
function updateLyricsClock() {
  cancelAnimationFrame(lyricFrame);
  lyricFrame = 0;
  syncLyrics();
  if (!audio.paused && !audio.ended && !audio.error && !document.hidden && !$('#inline-lyrics').hidden && lyricLines.length) {
    lyricFrame = requestAnimationFrame(updateLyricsClock);
  }
}
function renderLyricOffset() {
  const offset = lyricOffset();
  $('#lyrics-timing').hidden = !lyricLines.length;
  $('#lyrics-offset').textContent = offset ? `${offset > 0 ? '提前' : '延后'} ${Math.abs(offset).toFixed(1)}s` : '原始时间';
  $('#lyrics-offset').setAttribute('aria-label', '歌词时间偏移，点击复位');
}
const lyricsWideLayout = matchMedia('(min-width: 1201px)');
lyricsWideLayout.addEventListener('change', placeInlineLyrics);
async function loadLyrics() {
  const track = current(), request = ++lyricRequest;
  lyricTrack = track?.id || null; lyricLines = []; lyricActive = -1;
  $('.lyrics-options').open = false;
  renderLyricOffset();
  $('#lyrics-source').textContent = track ? `${artistName(track)} · ${albumName(track)}` : '';
  for (const view of document.querySelectorAll('[data-lyric-view]')) {
    setLyricsFollow(view, true);
    view.textContent = track ? '正在读取歌词…' : '播放一首歌曲，查看歌词。';
    view.scrollTo({ top: 0, behavior: 'auto' });
  }
  if (!track) return;
  try {
    const result = await invoke('load_lyrics', { id: track.id });
    if (request !== lyricRequest) return;
    const parsed = parseLyrics(result.text);
    lyricLines = parsed.lines;
    renderLyricOffset();
    $('#lyrics-source').textContent = result.source ? `${artistName(track)} · ${result.source}` : artistName(track);
    const html = lyricLines.length ? lyricLines.map((line, index) => `<button class="lyric-line" data-action="lyric-seek" data-index="${index}" aria-label="跳转至这句歌词：${esc(line.text)}">${esc(line.text)}</button>`).join('') : `<p class="plain-lyrics">${esc(parsed.text || '暂无本地歌词\n可在 MP3 同目录放置同名 .lrc 文件，或使用内嵌歌词，然后在歌词“更多”中点击“重新读取”。')}</p>`;
    document.querySelectorAll('[data-lyric-view]').forEach(view => { view.innerHTML = html; });
    syncLyrics(true); updateLyricsClock();
  } catch (error) {
    if (request !== lyricRequest) return;
    console.warn('读取歌词失败', { id: track.id, reason: String(error) });
    document.querySelectorAll('[data-lyric-view]').forEach(view => { view.textContent = `歌词读取失败：${String(error)}`; });
  }
}
// 只在当前句变化时滚动；重新显示歌词与跳转则立即定位。
function syncLyrics(immediate = false) {
  if (!lyricLines.length) return;
  const index = activeLyricIndex(lyricLines, mediaId === currentId ? audio.currentTime : restorePosition, lyricOffset());
  if (lyricActive === index && !immediate) return;
  lyricActive = index;
  for (const view of document.querySelectorAll('[data-lyric-view]')) {
    view.querySelector('.active')?.classList.remove('active');
    view.querySelector('[aria-current]')?.removeAttribute('aria-current');
    const line = view.children[index];
    if (!line) continue;
    line.classList.add('active'); line.setAttribute('aria-current', 'true');
    if (view.dataset.follow !== 'false' && view.clientHeight) {
      view.scrollTo({ top: lyricScrollTop(line.offsetTop, line.offsetHeight, view.clientHeight, view.scrollHeight),
        behavior: immediate || reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }
}
// 手动浏览暂停歌词跟随，不影响音频播放。
function setLyricsFollow(view, follow) {
  view.dataset.follow = String(follow);
  const button = document.querySelector(`[data-action="follow-lyrics"][data-target="${view.id}"]`);
  button.setAttribute('aria-pressed', String(follow));
  // 正常播放不重复展示状态文字，手动浏览后才提供恢复跟随入口。
  button.hidden = follow;
}
// 歌词位置只由窗口宽度决定，两款皮肤共用同一节点并保留显隐状态。
function placeInlineLyrics() {
  const section = $('#inline-lyrics');
  if (!section) return;
  if (lyricsWideLayout.matches) $('#inline-lyrics-slot').append(section);
  else $('.library').insertBefore(section, $('#collection-path'));
  requestAnimationFrame(() => syncLyrics(true));
}

// 关闭歌词时同时释放右栏空间；切歌与换肤保留显隐状态。
function setLyricsVisible(visible) {
  $('#inline-lyrics').hidden = !visible;
  $('.content').classList.toggle('lyrics-hidden', !visible);
  if (!visible) $('.lyrics-options').open = false;
  $('.lyrics-toggle').setAttribute('aria-expanded', String(visible));
  $('.lyrics-toggle').setAttribute('aria-label', visible ? '关闭歌词' : '显示歌词');
  if (visible) syncLyrics(true);
  else $('.lyrics-toggle').focus();
  updateLyricsClock();
}
/** 切换浏览范围时清理不相干的分类条件，已经播放的队列保持不变。 */
function resetCollection() {
  settingsOpen = false;
  browseKind = ''; collectionTitle = '';
  Object.assign(filter, { favorite: false, tags: [], artist: '', album: '', directoryId: '' });
  page = 1;
}
// 统一将初始焦点放在标题，避免关闭按钮自动高亮；Tab 仍可进入弹窗操作。
function openModal(title, content, description = '') {
  const modal = $('#modal');
  modal.dataset.view = '';
  modal.innerHTML = `<div class="dialog-head"><h2 id="dialog-title" tabindex="-1" autofocus>${esc(title)}</h2><button class="icon-btn" data-action="close" aria-label="关闭弹窗">${icon('close')}</button></div>${description ? `<p class="dialog-desc">${esc(description)}</p>` : ''}${content}`;
  if (!modal.open) modal.showModal();
  $('#dialog-title').focus({ preventScroll: true });
}
let scanning = false, lastReload = 0, scanProgress = null;
// 文件夹名称作为主信息；完整路径保留在次级文字和悬浮提示中。
function showImport() {
  const labels = { ready: '已连接', scanning: '扫描中', offline: '无法访问', error: '部分读取失败', cancelled: '已取消' };
  const total = store.directories.reduce((count, directory) => count + directory.count, 0);
  const folders = store.directories.map(directory => {
    const name = directory.path.split(/[\\/]/).filter(Boolean).at(-1) || directory.path;
    return `<div class="directory-card"><span class="directory-icon" aria-hidden="true">${icon('folder')}</span><div class="directory-copy"><strong title="${esc(name)}">${esc(name)}</strong><span class="directory-path" title="${esc(directory.path)}">${esc(directory.path)}</span><div class="directory-meta"><span class="directory-status" data-status="${esc(directory.status)}">${labels[directory.status] || '待刷新'}</span><span>${directory.count} 首歌曲</span></div></div><div class="directory-actions"><button class="btn" data-action="open-directory" data-id="${esc(directory.id)}" aria-label="打开文件夹 ${esc(name)}">打开</button><button class="icon-btn" data-action="remove-directory" data-id="${esc(directory.id)}" aria-label="移除来源 ${esc(name)}" title="移除来源" ${scanning ? 'disabled' : ''}>${icon('trash')}</button></div></div>`;
  }).join('');
  openModal('音乐文件夹', `<div class="folder-toolbar"><span>${store.directories.length} 个文件夹 · ${total} 首歌曲</span><div><button class="btn" data-action="refresh" ${scanning || !store.directories.length ? 'disabled' : ''}>${icon('repeat')}刷新曲库</button><button class="btn primary" data-action="choose-folder" ${scanning ? 'disabled' : ''}>${icon('plus')}添加文件夹</button></div></div><div class="directory-list">${folders || `<div class="folder-empty">${icon('folder')}<strong>添加你的音乐文件夹</strong><span>自动收录文件夹及子目录中的 MP3</span></div>`}</div><div class="folder-footer"><span>刷新会清理缺失歌曲，不改动原文件。</span><span id="folder-scan-status" role="status"></span><button class="text-btn" data-action="cancel-scan" ${scanning ? '' : 'hidden'}>取消扫描</button></div>${scanProgress?.errors.length ? `<details><summary>查看 ${scanProgress.failed} 项扫描异常</summary><ul>${scanProgress.errors.map(error => `<li>${esc(error)}</li>`).join('')}</ul></details>` : ''}`);
  $('#modal').dataset.view = 'folders';
  renderScan();
}
function renderScan() {
  const status = $('#scan-status');
  status.hidden = !scanning;
  const folderStatus = $('#folder-scan-status');
  if (folderStatus) folderStatus.textContent = scanning ? `正在扫描 · ${scanProgress?.processed || 0} 首` : scanProgress ? `已扫描 ${scanProgress.processed} 首 · 已清理 ${scanProgress.removed || 0} 首` : '';
  status.innerHTML = `正在扫描 · ${scanProgress?.processed || 0} 首 · ${scanProgress?.failed || 0} 项异常 <button class="text-btn" data-action="cancel-scan">取消扫描</button>`;
}
async function runScan(command) {
  scanning = true; scanProgress = null; renderScan();
  if ($('#modal').open && $('#modal').dataset.view === 'folders') showImport();
  try {
    const result = await invoke(command);
    if (result) {
      scanProgress = result;
      toast(`${result.cancelled ? '扫描已取消' : '扫描完成'}：${result.processed} 首，清理 ${result.removed || 0} 首，${result.failed} 项异常`);
    }
  } finally {
    scanning = false; await reloadLibrary(); renderScan();
    if ($('#modal').open && $('#modal').dataset.view === 'folders') showImport();
  }
}
// 以 ID 建立队列，搜索或分类变化不会重新排列已经开始的播放。
function startQueue(id) {
  if (!playable(store.tracks.find(t => t.id === id))) { toast('文件不可用，请检查音乐目录连接并刷新曲库'); return; }
  const rows = filtered().filter(playable);
  queue = rows.map(t => t.id);
  if (!queue.includes(id)) queue.push(id);
  if (store.mode === 'shuffle') queue = [id, ...shuffled(queue.filter(key => key !== id))];
  playTrack(id);
}
async function playTrack(id, automatic = false) {
  const track = store.tracks.find(t => t.id === id);
  if (!playable(track)) {
    if (!automatic) toast('文件不可用，请检查音乐目录连接并刷新曲库');
    return false;
  }
  const token = ++playToken;
  if (mediaId !== id) {
    audio.pause();
    audio.src = convertFileSrc(id, 'music');
    mediaId = id;
    if (id !== currentId) restorePosition = 0;
  }
  currentId = id;
  render();
  try {
    await audio.play();
    if (token === playToken) { renderPlayer(); await persist(); }
    return true;
  } catch (error) {
    if (token !== playToken) return false;
    console.warn('音频播放失败：', error.name);
    if (!automatic) toast('无法播放此文件，请检查 MP3 或音乐目录后刷新曲库');
    renderPlayer();
    return false;
  }
}
async function step(direction, automatic = false) {
  if (!queue.length) queue = filtered().map(t => t.id);
  let index = queue.indexOf(currentId);
  // 自动连播最多遍历剩余队列一次，错误音频不能造成无限重试。
  for (let tried = 0; tried < queue.length; tried++) {
    index += direction;
    if (index < 0 || index >= queue.length) { if (!automatic) toast(direction > 0 ? '已到播放队列末尾' : '已经是第一首'); return; }
    const track = store.tracks.find(t => t.id === queue[index]);
    if (playable(track)) {
      const expectedToken = playToken + 1;
      const started = await playTrack(track.id, automatic);
      // 用户切歌或暂停后，旧的自动连播任务不能再覆盖新的操作。
      if (playToken !== expectedToken || started) return;
    }
    if (!automatic && playable(track)) return;
  }
}
function togglePlay() {
  if (!audio.paused) { playToken++; audio.pause(); void persist().catch(() => {}); return; }
  if (!queue.length) queue = filtered().map(t => t.id);
  const id = playable(current()) ? currentId : queue.find(key => playable(store.tracks.find(t => t.id === key)));
  if (!id) { toast('请先导入可播放的 MP3'); return; }
  playTrack(id);
}
function showManage() {
  openModal('设置 · 标签管理', `<button class="text-btn settings-back" data-action="settings">‹ 返回设置</button><div class="dialog-list">${store.tags.map(name => `<div class="dialog-row"><span>${esc(name)}</span><button class="icon-btn" data-action="rename" data-name="${esc(name)}" aria-label="重命名 ${esc(name)}">${icon('edit')}</button><button class="icon-btn" data-action="delete-category" data-name="${esc(name)}" aria-label="删除 ${esc(name)}">${icon('trash')}</button></div>`).join('') || '<p class="note">还没有标签，创建一个吧。</p>'}</div><form id="category-form" class="inline-form"><input class="dialog-input" name="name" placeholder="新的标签名称" aria-label="新的标签名称" required maxlength="30"><button class="btn primary" type="submit">创建标签</button></form>`);
}
async function saveCategory(form) {
  const name = form.elements.name.value.trim();
  const old = form.dataset.old;
  await invoke('edit_category', { kind: 'tags', operation: old ? 'rename' : 'create', name: old || name, next: old ? name : null });
  if (old) filter.tags = filter.tags.map(n => n === old ? name : n);
  await reloadLibrary(); showManage(); toast(old ? '名称已更新' : '已创建');
}
function showAssign(ids) {
  const tracks = store.tracks.filter(t => ids.includes(t.id));
  if (!tracks.length) { toast('请先选择歌曲'); return; }
  const batch = tracks.length > 1;
  openModal(batch ? `设置 ${tracks.length} 首歌曲的标签` : tracks[0].title, `<form id="assign-form" data-ids="${esc(JSON.stringify(ids))}">${batch ? '<label class="check-label">操作<select class="dialog-input" name="operation"><option value="add">添加所选标签</option><option value="remove">移除所选标签</option></select></label>' : ''}<fieldset class="assign-section"><legend>标签 · 可多选</legend>${store.tags.map(name => `<label class="check-label"><input type="checkbox" name="tags" value="${esc(name)}" ${!batch && tracks[0].tags.includes(name) ? 'checked' : ''}>${esc(name)}</label>`).join('') || '<span class="note">还没有标签，可到“设置”中创建。</span>'}</fieldset><div class="dialog-footer"><button class="btn" type="button" data-action="close">取消</button><button class="btn primary" type="submit">保存</button></div></form>`, batch ? '只修改所选标签，保留其他标签。' : '取消勾选即可移除，音频文件不会被修改。');
}
/** 列表与播放器共用单曲操作，删除必须另行确认具体文件。 */
function showTrackActions(id, confirmDelete = false) {
  const track = store.tracks.find(t => t.id === id);
  if (!track) { toast('歌曲已不在曲库中'); return; }
  const source = store.directories.find(dir => dir.id === track.directoryId)?.path || '';
  const content = confirmDelete
    ? `<p class="dialog-desc">将永久删除此 MP3 文件，同时移除曲库记录。此操作无法撤销。</p><div class="dialog-footer"><button class="btn" data-action="track-more" data-id="${esc(id)}">取消</button><button class="btn danger" data-action="confirm-delete-track" data-id="${esc(id)}" ${scanning ? 'disabled' : ''}>永久删除文件</button></div>`
    : `<div class="dialog-list"><button class="btn" data-action="assign" data-id="${esc(id)}">${icon('tag')}设置标签</button><button class="btn" data-action="dislike-track" data-id="${esc(id)}">不喜欢</button><button class="btn danger" data-action="delete-track" data-id="${esc(id)}" ${scanning ? 'disabled' : ''}>${icon('trash')}删除</button></div><p class="note">不喜欢：保留文件，以后不再出现在曲库和播放队列中。${scanning ? '扫描期间暂时无法删除文件。' : ''}</p>`;
  openModal(confirmDelete ? '确认删除歌曲' : track.title, `<p class="track-file">${esc(track.filename)}<br><span>${esc(source)}</span></p>${content}<p id="track-action-status" class="note" role="status"></p>`);
}
// 防止重复点击或重新打开弹窗时，对同一文件重复执行不可逆操作。
let trackActionPending = false;
/** 单曲移除后复用曲库重载，统一清理当前播放、队列、选择和歌词偏移。 */
async function removeTrackFromLibrary(id, deleteFile) {
  if (trackActionPending) return;
  trackActionPending = true;
  const status = $('#track-action-status');
  if (status) status.textContent = '正在处理…';
  try {
    if (currentId === id) {
      // Windows 上先释放正在播放的文件句柄；失败时保留歌曲与进度，允许重新播放。
      restorePosition = mediaId === id ? audio.currentTime : restorePosition;
      playToken++; audio.pause(); audio.removeAttribute('src'); audio.load(); mediaId = '';
    }
    await saveChain;
    await invoke(deleteFile ? 'delete_track' : 'dislike_track', { id });
    $('#modal').close();
    await reloadLibrary();
    toast(deleteFile ? '已删除 MP3 文件' : '已标记不喜欢，以后不再播放');
  } catch (error) {
    reportError(deleteFile ? '删除歌曲' : '标记不喜欢', error);
    if (status?.isConnected) status.textContent = String(error);
  } finally {
    trackActionPending = false;
  }
}
async function saveAssign(form) {
  const ids = JSON.parse(form.dataset.ids);
  const data = new FormData(form);
  await invoke('assign_categories', { assignment: { ids, tags: data.getAll('tags'), operation: ids.length === 1 ? 'replace' : data.get('operation') } });
  await reloadLibrary(); $('#modal').close(); toast('标签已保存');
}
let queuePage = 1;
function showQueue() {
  const ids = queue.length ? queue : filtered().map(t => t.id);
  queuePage = Math.max(1, Math.min(queuePage, Math.ceil(ids.length / pageSize) || 1));
  openModal('播放队列', `<div class="dialog-list">${ids.slice((queuePage - 1) * pageSize, queuePage * pageSize).map(id => store.tracks.find(t => t.id === id)).filter(Boolean).map(t => `<div class="dialog-row queue-row" data-queue-track="${esc(t.id)}" data-duration="${duration(t.seconds)}"><button class="icon-btn" data-action="queue-play" data-id="${esc(t.id)}" aria-label="播放 ${esc(t.title)}"><span class="queue-transport">${icon('play')}</span>${playbackIndicator(t.id)}</button><span class="queue-title">${esc(t.title)}</span><small class="cell-muted queue-state">${duration(t.seconds)}</small></div>`).join('') || '<p class="note">队列为空，请先选择歌曲。</p>'}</div><div class="dialog-footer"><button class="btn" data-action="queue-prev" ${queuePage === 1 ? 'disabled' : ''}>上一页</button><span>${queuePage} / ${Math.max(1, Math.ceil(ids.length / pageSize))}</span><button class="btn" data-action="queue-next" ${queuePage * pageSize >= ids.length ? 'disabled' : ''}>下一页</button></div>`, `${ids.length} 首 · 筛选不会改变已建立的队列`);
  $('#modal').dataset.view = 'queue';
  renderPlaybackIndicators();
}
async function handleAction(button) {
  const { action, id, name, view, kind } = button.dataset;
  if (action === 'browse') {
    resetCollection(); browseKind = kind; filter.query = ''; $('#search').value = ''; render(); return;
  }
  if (action === 'collection') {
    resetCollection(); filter.query = ''; $('#search').value = '';
    if (kind === 'artists') filter.artist = button.dataset.key; else filter.album = button.dataset.key;
    collectionTitle = name; render(); return;
  }
  if (action === 'lyrics') {
    const visible = settingsOpen || $('#inline-lyrics').hidden;
    settingsOpen = false; render(); setLyricsVisible(visible); return;
  }
  if (action === 'close-lyrics') { setLyricsVisible(false); return; }
  if (action === 'reload-lyrics') { await loadLyrics(); return; }
  if (action === 'follow-lyrics') {
    const view = document.getElementById(button.dataset.target);
    setLyricsFollow(view, view.dataset.follow === 'false'); syncLyrics(true); return;
  }
  if (action === 'lyric-offset') {
    if (!currentId || !lyricLines.length) return;
    // 以 0.2 秒为步长，限制在正负 30 秒；零值删除以免积累无效设置。
    const offset = button.dataset.delta === 'reset' ? 0 : Math.max(-30, Math.min(30, Math.round((lyricOffset() + Number(button.dataset.delta)) * 10) / 10));
    if (!Number.isFinite(offset)) return;
    if (offset) store.lyricOffsets[currentId] = offset;
    else delete store.lyricOffsets[currentId];
    renderLyricOffset(); syncLyrics(true); await persist(true); return;
  }
  if (action === 'lyric-seek') {
    const line = lyricLines[Number(button.dataset.index)];
    if (!line || !current()) return;
    const position = lyricSeekTime(line.time, lyricOffset());
    if (mediaId !== currentId) { restorePosition = position; await playTrack(currentId); }
    else if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(position, audio.duration);
    syncLyrics(true); await persist(); return;
  }
  if (action === 'settings-tab') { selectSettingsTab(button.dataset.panel); return; }
  if (action === 'check-update') { await checkForUpdates(); return; }
  if (action === 'install-update') { await installUpdate(); return; }
  if (action === 'settings') { showSettings(button.dataset.panel); return; }
  if (action === 'back-library') {
    settingsOpen = false; render(); $('#view-title').focus({ preventScroll: true }); return;
  }
  if (action === 'choose-skin') {
    applySkin(button.dataset.skin, true);
    // 只更新选中态，键盘焦点留在当前皮肤选项。
    document.querySelectorAll('[data-action="choose-skin"]').forEach(option => option.setAttribute('aria-pressed', String(option.dataset.skin === store.skin)));
    return;
  }
  if (action === 'close') { $('#modal').close(); return; }
  if (action === 'import') { showImport(); return; }
  if (action === 'open-directory') { await invoke('open_directory', { id }); return; }
  if (action === 'choose-folder' || action === 'refresh') { await runScan(action === 'refresh' ? 'refresh_library' : 'add_directory'); return; }
  if (action === 'cancel-scan') { await invoke('cancel_scan'); toast('将在当前文件处理完成后停止'); return; }
  if (action === 'remove-directory') {
    openModal('移除音乐来源', `<p class="dialog-desc">移除后这些歌曲将无法播放，原文件、收藏和分类保留。</p><div class="dialog-footer"><button class="btn" data-action="import">取消</button><button class="btn primary" data-action="confirm-remove-directory" data-id="${esc(id)}">确认移除</button></div>`); return;
  }
  if (action === 'confirm-remove-directory') {
    await invoke('remove_directory', { id });
    const removed = new Set(store.tracks.filter(t => t.directoryId === id).map(t => t.id));
    if (removed.has(currentId)) { playToken++; audio.pause(); audio.removeAttribute('src'); audio.load(); mediaId = ''; currentId = null; restorePosition = 0; }
    queue = queue.filter(key => !removed.has(key));
    await reloadLibrary(); await persist(); showImport(); return;
  }
  if (action === 'toggle-play') { togglePlay(); return; }
  if (action === 'play') { if (currentId === id && mediaId === id) togglePlay(); else startQueue(id); return; }
  if (action === 'play-all') {
    const first = filtered().find(playable);
    if (!first) { toast('没有可播放的歌曲，请先导入 MP3'); return; }
    startQueue(first.id); return;
  }
  if (action === 'previous' || action === 'next') { restorePosition = 0; step(action === 'next' ? 1 : -1); return; }
  if (action === 'queue') { queuePage = 1; showQueue(); return; }
  if (action === 'queue-prev' || action === 'queue-next') { queuePage += action === 'queue-next' ? 1 : -1; showQueue(); return; }
  if (action === 'queue-play') {
    if (!queue.length) queue = filtered().map(t => t.id);
    if (currentId === id && mediaId === id) togglePlay(); else await playTrack(id);
    return;
  }
  if (action === 'manage') { showManage(); return; }
  if (action === 'track-more' || action === 'delete-track') { showTrackActions(id, action === 'delete-track'); return; }
  if (action === 'dislike-track' || action === 'confirm-delete-track') { await removeTrackFromLibrary(id, action === 'confirm-delete-track'); return; }
  if (action === 'assign' || action === 'assign-selected') { showAssign(action === 'assign-selected' ? [...selected] : [id]); return; }
  if (action === 'rename') {
    openModal('重命名', `<form id="category-form" data-old="${esc(name)}"><input class="dialog-input" name="name" value="${esc(name)}" maxlength="30" aria-label="标签名称" required><div class="dialog-footer"><button type="submit" class="btn primary">保存名称</button></div></form>`); return;
  }
  if (action === 'delete-category') {
    openModal('删除标签', `<p class="dialog-desc">删除“${esc(name)}”？歌曲、文件和收藏都会保留。</p><div class="dialog-footer"><button class="btn" data-action="manage">取消</button><button class="btn primary" data-action="confirm-delete" data-name="${esc(name)}">确认删除</button></div>`); return;
  }
  if (action === 'confirm-delete') {
    await invoke('edit_category', { kind: 'tags', operation: 'delete', name, next: null });
    filter.tags = filter.tags.filter(n => n !== name);
    await reloadLibrary(); showManage(); return;
  }
  if (action === 'favorite') { const track = store.tracks.find(t => t.id === id); if (track) { const value = !track.favorite; await invoke('set_favorite', { id, value }); track.favorite = value; } }
  if (action === 'view') { resetCollection(); filter.favorite = view === 'favorite'; }
  if (action === 'folder') {
    // 重建按钮后只恢复原有键盘焦点，避免鼠标点击被程序聚焦误判为键盘操作。
    const restoreFocus = button.matches(':focus-visible');
    filter.directoryId = folderEntries.some(item => item.directoryId === id) ? id : '';
    // 切换来源时清空批量选择，防止误操作隐藏的歌曲；播放队列保持不变。
    selected.clear(); page = 1; render();
    if (restoreFocus) [...document.querySelectorAll('[data-action="folder"]')].find(item => item.dataset.id === filter.directoryId)?.focus({ preventScroll: true });
    return;
  }
  if (action === 'tag') { filter.tags = filter.tags.includes(name) ? filter.tags.filter(t => t !== name) : [...filter.tags, name]; page = 1; }
  if (action === 'all-tags') { filter.tags = []; page = 1; }
  if (action === 'clear-filters') { Object.assign(filter, { favorite: false, tags: [], query: '', directoryId: '' }); $('#search').value = ''; page = 1; }
  if (action === 'clear-selected') selected.clear();
  if (action === 'page-prev') page--;
  if (action === 'page-next') page++;
  if (action === 'mode') {
    store.mode = { order: 'single', single: 'shuffle', shuffle: 'order' }[store.mode];
    if (store.mode === 'shuffle') {
      const candidates = queue.length ? queue : filtered().map(t => t.id);
      queue = [currentId, ...shuffled(candidates.filter(key => key !== currentId))].filter(Boolean);
    }
    if (store.mode === 'order') {
      const members = new Set(queue);
      queue = store.tracks.filter(t => members.has(t.id)).map(t => t.id);
    }
    void persist().catch(() => {});
  }
  if (action === 'mute') {
    audio.muted = !audio.muted;
    $('#mute').innerHTML = icon(audio.muted ? 'muted' : 'volume');
    $('#mute').setAttribute('aria-label', audio.muted ? '取消静音' : '静音');
  }
  render();
}
function bindEvents() {
  document.addEventListener('click', event => {
    if (!event.target.closest('.lyrics-options')) $('.lyrics-options').open = false;
    const button = event.target.closest('[data-action]');
    if (button) handleAction(button).catch(error => reportError('操作', error));
  });
  document.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.id === 'category-form') saveCategory(event.target).catch(error => reportError('保存分类', error));
    if (event.target.id === 'assign-form') saveAssign(event.target).catch(error => reportError('整理歌曲', error));
  });
  $('#search').addEventListener('input', event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filter.query = event.target.value; page = 1; render(); }, 160);
  });
  $('#tracks').addEventListener('change', event => {
    const id = event.target.dataset.select;
    if (id) { if (event.target.checked) selected.add(id); else selected.delete(id); render(); }
  });
  $('#select-all').addEventListener('change', event => {
    filtered().slice((page - 1) * pageSize, page * pageSize).forEach(t => event.target.checked ? selected.add(t.id) : selected.delete(t.id));
    render();
  });
  $('#volume').addEventListener('input', event => { store.volume = Number(event.target.value); audio.volume = store.volume; void persist().catch(() => {}); });
  $('#seek').addEventListener('input', event => { if (Number.isFinite(audio.duration)) { audio.currentTime = Math.min(Number(event.target.value), audio.duration); restorePosition = 0; void persist().catch(() => {}); } });
  audio.addEventListener('loadedmetadata', () => {
    if (current() && Number.isFinite(audio.duration)) current().seconds = audio.duration;
    if (restorePosition && Number.isFinite(audio.duration)) audio.currentTime = Math.min(restorePosition, Math.max(0, audio.duration - 0.1));
    restorePosition = 0; render();
  });
  audio.addEventListener('timeupdate', () => {
    $('#elapsed').textContent = duration(audio.currentTime);
    $('#seek').value = audio.currentTime;
    syncLyrics();
    if (Date.now() - savedAt > 5000) { void persist().catch(() => {}); savedAt = Date.now(); }
  });
  for (const event of ['playing', 'pause', 'ended', 'emptied', 'error']) audio.addEventListener(event, updateLyricsClock);
  document.addEventListener('visibilitychange', updateLyricsClock);
  audio.addEventListener('play', renderPlayer);
  audio.addEventListener('pause', renderPlayer);
  audio.addEventListener('ended', renderPlayer);
  audio.addEventListener('ended', () => {
    restorePosition = 0;
    if (store.mode === 'single') { audio.currentTime = 0; playTrack(currentId, true); } else step(1, true);
  });
  audio.addEventListener('error', () => { console.warn('媒体读取失败', { code: audio.error?.code }); renderPlayer(); toast('音频读取失败，请检查文件或目录后刷新曲库'); });
  audio.addEventListener('seeking', () => syncLyrics(true));
  for (const view of document.querySelectorAll('[data-lyric-view]')) {
    view.addEventListener('wheel', () => setLyricsFollow(view, false), { passive: true });
    view.addEventListener('touchstart', () => setLyricsFollow(view, false), { passive: true });
    view.addEventListener('keydown', event => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) setLyricsFollow(view, false);
    });
  }
  document.addEventListener('keydown', event => {
    // 标准横向 Tab 键盘操作；焦点与选中面板一起移动。
    if (event.target.closest('.settings-tabs') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const tabs = [...document.querySelectorAll('[data-action="settings-tab"]')];
      const index = tabs.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectSettingsTab(tabs[next].dataset.panel); tabs[next].focus(); return;
    }
    if (event.key === 'Escape' && !$('#modal').open && $('.lyrics-options').open) {
      $('.lyrics-options').open = false; $('.lyrics-options summary').focus(); return;
    }
    if (event.key === 'Escape' && !settingsOpen && !$('#modal').open && !$('#inline-lyrics').hidden) { setLyricsVisible(false); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); settingsOpen = false; render(); $('#search').focus(); return; }
    if (event.code === 'Space' && !event.target.closest('input, textarea, select, button, a, summary, [contenteditable], dialog')) { event.preventDefault(); togglePlay(); }
  });
}

// 必须先挂载错误提示，再异步读取本地库；失败时不覆盖已有数据库设置。
async function initialize() {
  mount(); applySkin(store.skin); bindEvents(); render();
  const settings = await reloadLibrary();
  store.volume = Number.isFinite(settings.volume) ? Math.max(0, Math.min(1, settings.volume)) : 0.55;
  store.mode = ['order', 'single', 'shuffle'].includes(settings.mode) ? settings.mode : 'order';
  currentId = store.tracks.some(t => t.id === settings.current) ? settings.current : null;
  const ids = new Set(store.tracks.map(t => t.id));
  queue = (settings.queue || []).filter(id => ids.has(id));
  savedQueue = JSON.stringify(queue);
  store.lyricOffsets = settings.lyricOffsets || {};
  restorePosition = Math.max(0, Number(settings.position) || 0);
  audio.volume = store.volume; $('#volume').value = store.volume;
  applySkin(settings.skin); render(); initialized = true;
  await listen('scan-progress', async event => {
    scanProgress = event.payload; scanning = !scanProgress.finished; renderScan();
    if (Date.now() - lastReload > 1500 || scanProgress.finished) {
      lastReload = Date.now();
      try { await reloadLibrary(); } catch (error) { reportError('更新扫描结果', error); }
    }
  });
  await listen('menu-control', event => {
    if (['toggle-play', 'previous', 'next', 'mode'].includes(event.payload)) {
      handleAction({ dataset: { action: event.payload } }).catch(error => reportError('菜单栏播放控制', error));
    }
  });
  // 更新检查不阻塞播放器初始化；只有安装前才暂停并等待已有保存队列完成。
  void initUpdater(async () => { audio.pause(); await persist(); });
  syncMenuPlayer();
  await listen('save-playback', () => { void persist().catch(() => {}); });
  await listen('before-quit', async () => {
    audio.pause();
    try { await persist(); } finally { await invoke('quit_app'); }
  });
}
initialize().catch(error => reportError('启动音乐库', error));
