import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './styles.css';
import { matching, collections, albumKey, albumName, artistName } from './library.js';
import { parseLyrics, activeLyricIndex, lyricScrollTop } from './lyrics.js';
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
// 只缓存索引元数据，音频始终由原生层按需读取。
const store = { tracks: [], directories: [], groups: [], tags: [], skin: 'dark', volume: 0.55, mode: 'order' };
const filter = { favorite: false, group: '', tags: [], query: '', artist: '', album: '' };
// 概览与歌曲明细共用列表区域，播放器和已建立的队列独立于导航。
let browseKind = '', collectionTitle = '';
const selected = new Set();
const audio = new Audio();
audio.preload = 'metadata';
audio.volume = store.volume;
let currentId = null;
let queue = [];
let page = 1, toastTimer, searchTimer, playToken = 0, mediaId = '', savedAt = 0;
let restorePosition = 0;
let manageKind = 'groups';
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
function persist() {
  if (!initialized) return Promise.resolve();
  const queueKey = JSON.stringify(queue);
  const settings = { skin: store.skin, volume: store.volume, mode: store.mode, current: currentId,
    position: audio.ended ? 0 : mediaId === currentId ? audio.currentTime : restorePosition };
  if (queueKey !== savedQueue) settings.queue = [...queue];
  const task = saveChain.then(() => invoke('save_settings', { settings })).then(() => { savedQueue = queueKey; });
  saveChain = task.catch(error => reportError('保存播放设置', error));
  return task;
}
function reportError(context, error) {
  console.error(context, error);
  toast(`${context}失败：${String(error)}`);
}
// 后台索引刷新只替换曲库，不能覆盖正在播放时修改的音量、进度和皮肤。
async function reloadLibrary() {
  const data = await invoke('load_library');
  Object.assign(store, { tracks: data.tracks, directories: data.directories, groups: data.groups, tags: data.tags });
  render();
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
      <div class="side-heading"><span>我的分组</span><button class="icon-btn" data-action="manage" data-kind="groups" aria-label="管理分组">${icon('plus')}</button></div>
      <nav id="group-list" aria-label="分组"></nav>
      <div class="sidebar-bottom"><div class="local-status">音乐与偏好，只留在本地</div><button class="settings-entry" data-action="settings">${icon('settings')}<span>设置</span>${icon('arrow')}</button></div>
    </aside>
    <main class="workspace">
      <header class="topbar"><div class="breadcrumb">音乐库 ${icon('arrow')} <b>本地音乐</b></div>
        <label class="search">${icon('search')}<input id="search" type="search" placeholder="搜索歌曲、歌手、专辑、文件名" aria-label="搜索歌曲、歌手、专辑、文件名"><kbd>⌘ K</kbd></label>
      </header>
      <div class="content"><section class="library" aria-label="音乐库">
        <div class="hero"><div class="hero-copy"><div class="eyebrow">YOUR MUSIC, YOUR MOMENTS</div><h1>${esc(resolveSkin(store.skin).heading)}</h1><p>不必联网，随时回到喜欢的旋律。</p><div class="hero-foot">${icon('disc')}<span>自己的音乐，自己的节奏</span></div></div><div class="hero-art" aria-hidden="true"><div class="vinyl"></div><span class="vinyl-label">The little things.</span></div></div>
        <nav class="mobile-nav" aria-label="移动版音乐筛选" hidden><button class="chip active" data-action="view" data-view="all">全部音乐</button><button class="chip" data-action="view" data-view="favorite">我喜欢的</button><button class="chip" data-action="browse" data-kind="albums">专辑</button><button class="chip" data-action="browse" data-kind="artists">歌手</button><select id="mobile-group" aria-label="筛选分组"></select><button class="chip" data-action="settings">设置</button></nav>
        <div id="collection-path" class="collection-path" hidden></div><div class="library-head"><div><h2 id="view-title">本地音乐</h2><p id="library-count"></p></div><div class="actions"><button class="btn primary" data-action="play-all">${icon('play')}播放全部</button><button class="btn" data-action="import">${icon('plus')}导入音乐</button></div></div>
        <div id="scan-status" class="scan-status" role="status" hidden></div><div class="filters" id="filters"></div>
        <div class="batch" id="batch" hidden><span id="selected-count"></span><div><button class="text-btn" data-action="assign-selected">设置分组 / 标签</button><button class="text-btn" data-action="clear-selected">取消选择</button></div></div>
        <div id="collections" class="collection-list" hidden></div><div class="table-wrap"><table aria-label="歌曲列表"><thead><tr><th><input id="select-all" type="checkbox" aria-label="选择本页全部歌曲"></th><th>歌曲</th><th class="artist-col">歌手</th><th class="album-col">专辑</th><th class="tag-col">标签</th><th>时长</th><th><span class="sr-only">收藏</span></th><th><span class="sr-only">更多操作</span></th></tr></thead><tbody id="tracks"></tbody></table></div>
        <div id="empty" class="empty" hidden>${icon('search')}没有找到歌曲<br><button class="text-btn" data-action="clear-filters">清空筛选</button></div><div id="pagination" class="pagination" hidden></div><div class="table-end" id="table-end"></div>
      </section>
      <aside class="right-panel" aria-label="当前歌曲详情"><div class="right-title">正在播放<span></span></div><div id="now-info"></div><div id="inline-lyrics-slot"><section id="inline-lyrics" class="inline-lyrics" aria-label="当前歌曲歌词"><div class="detail-heading"><span>歌词</span><button class="text-btn" data-action="follow-lyrics" data-target="inline-lyrics-body" aria-pressed="true">跟随播放</button><button class="text-btn" data-action="close-lyrics" aria-label="关闭歌词">关闭</button></div><div class="lyrics-actions"><span id="lyrics-source"></span><button class="text-btn" data-action="reload-lyrics">重新读取</button></div><div id="inline-lyrics-body" class="lyrics-body" data-lyric-view tabindex="0" aria-label="主界面歌词"></div></section></div><div class="detail-section"><div class="detail-heading">歌曲标签<button class="icon-btn" data-action="assign-current" aria-label="编辑当前歌曲标签">${icon('edit')}</button></div><div id="now-tags" class="detail-tags"></div></div><div class="detail-section"><div class="detail-heading">所属分组</div><div id="now-groups" class="detail-tags"></div></div><p class="note" id="now-note"></p></aside>
      </div>
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
function showSettings() {
  openModal('设置', `<h3 class="settings-heading">外观</h3><p class="settings-description">选择喜欢的皮肤，切换即保存。</p><div class="skin-options">${skins.map(skin => `<button class="skin-option" data-action="choose-skin" data-skin="${esc(skin.id)}" aria-pressed="${store.skin === skin.id}"><span class="skin-swatch" style="background:${skin.background};color:${skin.accent}" aria-hidden="true">${icon('music')}</span><span class="skin-copy"><strong>${esc(skin.name)}</strong><small>${esc(skin.description)}</small></span>${store.skin === skin.id ? icon('check') : ''}</button>`).join('')}</div><h3 class="settings-heading">音乐整理</h3><button class="settings-row" data-action="manage" data-kind="tags">${icon('tag')}<span><strong>标签管理</strong><small>创建、重命名或删除标签</small></span><em>${store.tags.length} 个</em>${icon('arrow')}</button>`, '把留声调成你喜欢的样子。');
}
// ponytail: 不到一万首只扫描内存元数据；规模明显增长时再下推 SQL 查询。
function filtered() { return matching(store.tracks, filter); }
function render() {
  const rows = filtered();
  const entries = browseKind ? collections(store.tracks, browseKind, filter.query) : [];
  const count = browseKind ? entries.length : rows.length;
  page = Math.max(1, Math.min(page, Math.ceil(count / pageSize) || 1));
  $('#all-count').textContent = store.tracks.length;
  $('#favorite-count').textContent = store.tracks.filter(t => t.favorite).length;
  $('#album-count').textContent = collections(store.tracks, 'albums').length;
  $('#artist-count').textContent = collections(store.tracks, 'artists').length;
  document.querySelectorAll('[data-action="browse"]').forEach(button => {
    const active = button.dataset.kind === (browseKind || (filter.album ? 'albums' : filter.artist ? 'artists' : ''));
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-action="view"]').forEach(button => {
    const active = !browseKind && !filter.album && !filter.artist && (button.dataset.view === 'favorite' ? filter.favorite : !filter.favorite && !filter.group);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#group-list').innerHTML = store.groups.map((name, i) => `<button class="nav-item ${filter.group === name ? 'active' : ''}" data-action="group" data-name="${esc(name)}" aria-pressed="${filter.group === name}"><i class="group-dot tone-${i % 3}"></i><span>${esc(name)}</span><span class="count">${store.tracks.filter(t => t.groups.includes(name)).length}</span></button>`).join('');
  $('#mobile-group').innerHTML = '<option value="">全部分组</option>' + store.groups.map(name => `<option ${filter.group === name ? 'selected' : ''}>${esc(name)}</option>`).join('');
  const detailKind = filter.album ? 'albums' : filter.artist ? 'artists' : '';
  const heading = browseKind === 'albums' ? '专辑' : browseKind === 'artists' ? '歌手' : collectionTitle || [filter.favorite ? '我喜欢的' : '', filter.group].filter(Boolean).join(' · ') || '本地音乐';
  $('#view-title').textContent = heading;
  $('.breadcrumb b').textContent = heading;
  $('#search').placeholder = browseKind === 'albums' ? '搜索专辑名称、歌手' : browseKind === 'artists' ? '搜索歌手' : '搜索歌曲、歌手、专辑、文件名';
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
  $('#filters').innerHTML = `<span>标签</span><button class="chip ${filter.tags.length ? '' : 'active'}" data-action="all-tags">全部</button>${store.tags.map(tag => `<button class="chip ${filter.tags.includes(tag) ? 'active' : ''}" data-action="tag" data-name="${esc(tag)}" aria-pressed="${filter.tags.includes(tag)}">${esc(tag)}</button>`).join('')}<button class="text-btn" data-action="settings">标签设置</button>`;
  const visible = browseKind ? [] : rows.slice((page - 1) * pageSize, page * pageSize);
  $('#tracks').innerHTML = visible.map(t => `<tr class="${t.id === currentId ? 'current' : ''}" data-track="${esc(t.id)}"><td><input type="checkbox" data-select="${esc(t.id)}" ${selected.has(t.id) ? 'checked' : ''} aria-label="选择 ${esc(t.title)}"></td><td><div class="song-cell"><span class="cover art-${t.art}"><button class="row-play" data-action="play" data-id="${esc(t.id)}" aria-label="播放 ${esc(t.title)}">${icon(t.id === currentId && !audio.paused ? 'pause' : 'play')}</button></span><button class="song-name" data-action="play" data-id="${esc(t.id)}" aria-label="点播 ${esc(t.title)}"><span class="song-title">${esc(t.title)}</span><span class="song-meta">${playable(t) ? (t.metadataError ? '标签读取异常' : '本地 MP3') : '文件缺失或目录离线'}</span></button></div></td><td class="cell-muted artist-col"><button class="metadata-link" data-action="collection" data-kind="artists" data-key="${esc(artistName(t))}" data-name="${esc(artistName(t))}">${esc(artistName(t))}</button></td><td class="cell-muted album-col"><button class="metadata-link" data-action="collection" data-kind="albums" data-key="${esc(albumKey(t))}" data-name="${esc(albumName(t))}">${esc(albumName(t))}</button></td><td class="tag-col">${t.tags.slice(0, 2).map(tag => `<span class="row-tag">${esc(tag)}</span>`).join('') || '<span class="row-tag">—</span>'}</td><td class="cell-muted">${t.seconds ? duration(t.seconds) : '--:--'}</td><td>${favoriteButton(t, ` ${t.title}`)}</td><td><button class="icon-btn" data-action="assign" data-id="${esc(t.id)}" aria-label="编辑 ${esc(t.title)} 的分组和标签">${icon('dots')}</button></td></tr>`).join('');
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
    $('#now-tags').textContent = '暂无标签'; $('#now-groups').textContent = '尚未分组';
    $('#seek').disabled = true; $('#total').textContent = '0:00'; $('#elapsed').textContent = '0:00';
    $('#play-toggle').innerHTML = icon('play');
    return;
  }
  $('#player-track').innerHTML = `<span class="cover art-${track.art}">${icon('music')}</span><div class="track-label"><strong>${esc(track.title)}</strong><small>${esc(track.artist)}</small></div>${favoriteButton(track, '当前歌曲')}`;
  $('#now-info').innerHTML = `<div class="now-info"><div><h3>${esc(track.title)}</h3><p>${esc(track.artist)}</p></div>${favoriteButton(track, '详情歌曲')}</div>`;
  $('#now-tags').innerHTML = track.tags.map(tag => `<span>${esc(tag)}</span>`).join('') || '<span>暂无标签</span>';
  $('#now-groups').innerHTML = track.groups.map(group => `<span>${esc(group)}</span>`).join('') || '<span>尚未分组</span>';
  $('#now-note').textContent = '音频只在本地读取，喜欢、分组和标签自动保存。';
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
}
// 歌词仅缓存当前歌曲，请求序号防止快速切歌时旧响应覆盖新歌曲。
let lyricTrack, lyricRequest = 0, lyricLines = [], lyricActive = -1;
const lyricsWideLayout = matchMedia('(min-width: 1201px)');
lyricsWideLayout.addEventListener('change', placeInlineLyrics);
async function loadLyrics() {
  const track = current(), request = ++lyricRequest;
  lyricTrack = track?.id || null; lyricLines = []; lyricActive = -1;
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
    $('#lyrics-source').textContent = result.source ? `${artistName(track)} · ${result.source}` : artistName(track);
    const html = lyricLines.length ? lyricLines.map((line, index) => `<button class="lyric-line" data-action="lyric-seek" data-index="${index}" aria-label="跳转至 ${duration(line.time)}，${esc(line.text)}">${esc(line.text)}</button>`).join('') : `<p class="plain-lyrics">${esc(parsed.text || '暂无本地歌词\n可在 MP3 同目录放置同名 .lrc 文件，或使用内嵌歌词，然后点击“重新读取”。')}</p>`;
    document.querySelectorAll('[data-lyric-view]').forEach(view => { view.innerHTML = html; });
    syncLyrics(true);
  } catch (error) {
    if (request !== lyricRequest) return;
    console.warn('读取歌词失败', { id: track.id, reason: String(error) });
    document.querySelectorAll('[data-lyric-view]').forEach(view => { view.textContent = `歌词读取失败：${String(error)}`; });
  }
}
// 只在当前句变化时滚动；重新显示歌词与跳转则立即定位。
function syncLyrics(immediate = false) {
  if (!lyricLines.length) return;
  const index = activeLyricIndex(lyricLines, mediaId === currentId ? audio.currentTime : restorePosition);
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
  document.querySelector(`[data-action="follow-lyrics"][data-target="${view.id}"]`).setAttribute('aria-pressed', String(follow));
}
// 深色宽窗口放在右侧；浅色与窄窗口移到曲库上方，移动同一节点保留显隐状态。
function placeInlineLyrics() {
  const section = $('#inline-lyrics');
  if (!section) return;
  if (lyricsWideLayout.matches && store.skin !== 'light') $('#inline-lyrics-slot').append(section);
  else $('.library').insertBefore(section, $('#collection-path'));
  requestAnimationFrame(() => syncLyrics(true));
}

// 只切换主界面的歌词区域，切歌和换肤不会重新打开已关闭的歌词。
function setLyricsVisible(visible) {
  $('#inline-lyrics').hidden = !visible;
  $('.lyrics-toggle').setAttribute('aria-expanded', String(visible));
  $('.lyrics-toggle').setAttribute('aria-label', visible ? '关闭歌词' : '显示歌词');
  if (visible) syncLyrics(true);
  else $('.lyrics-toggle').focus();
}
/** 切换浏览范围时清理不相干的分类条件，已经播放的队列保持不变。 */
function resetCollection() {
  browseKind = ''; collectionTitle = '';
  Object.assign(filter, { favorite: false, group: '', tags: [], artist: '', album: '' });
  page = 1;
}
function openModal(title, content, description = '') {
  const modal = $('#modal');
  modal.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-btn" data-action="close" aria-label="关闭弹窗">${icon('close')}</button></div>${description ? `<p class="dialog-desc">${esc(description)}</p>` : ''}${content}`;
  if (!modal.open) modal.showModal();
}
let scanning = false, lastReload = 0, scanProgress = null;
function showImport() {
  const labels = { ready: '已连接', scanning: '扫描中', offline: '离线 / 无权限', error: '部分读取失败', cancelled: '已取消' };
  openModal('音乐文件夹', `<div class="import-options"><button class="btn primary" data-action="choose-folder" ${scanning ? 'disabled' : ''}>${icon('plus')}添加文件夹</button><button class="btn" data-action="refresh" ${scanning || !store.directories.length ? 'disabled' : ''}>刷新曲库</button></div><div class="dialog-list">${store.directories.map(d => `<div class="directory-row"><div><strong>${esc(d.path)}</strong><small>${labels[d.status] || '待刷新'} · ${d.count} 首</small></div><button class="text-btn" data-action="remove-directory" data-id="${esc(d.id)}" ${scanning ? 'disabled' : ''}>移除</button></div>`).join('') || '<p class="note">添加一个音乐文件夹，自动扫描其中的 MP3 和子目录。</p>'}</div><p class="note">只读取原文件。移除来源后保留收藏和分类，再次添加同一路径即可恢复。新增或移动文件后请刷新曲库。</p>${scanProgress?.errors.length ? `<details><summary>最近扫描的 ${scanProgress.failed} 项异常</summary><ul>${scanProgress.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></details>` : ''}`);
}
function renderScan() {
  const status = $('#scan-status');
  status.hidden = !scanning;
  status.innerHTML = `正在扫描 · ${scanProgress?.processed || 0} 首 · ${scanProgress?.failed || 0} 项异常 <button class="text-btn" data-action="cancel-scan">取消扫描</button>`;
}
async function runScan(command) {
  scanning = true; scanProgress = null; $('#modal').close(); renderScan();
  try {
    const result = await invoke(command);
    if (result) {
      scanProgress = result;
      toast(`${result.cancelled ? '扫描已取消' : '扫描完成'}：${result.processed} 首，${result.failed} 项异常`);
    }
  } finally { scanning = false; renderScan(); await reloadLibrary(); }
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
function showManage(kind = manageKind) {
  manageKind = kind === 'tags' ? 'tags' : 'groups';
  const label = manageKind === 'groups' ? '分组' : '标签';
  openModal(manageKind === 'tags' ? '设置 · 标签管理' : '整理我的音乐', `<button class="text-btn settings-back" data-action="settings">‹ 返回设置</button><div class="dialog-tabs"><button class="${manageKind === 'groups' ? 'active' : ''}" data-action="manage" data-kind="groups">我的分组</button><button class="${manageKind === 'tags' ? 'active' : ''}" data-action="manage" data-kind="tags">我的标签</button></div><div class="dialog-list">${store[manageKind].map(name => `<div class="dialog-row"><span>${esc(name)}</span><button class="icon-btn" data-action="rename" data-name="${esc(name)}" aria-label="重命名 ${esc(name)}">${icon('edit')}</button><button class="icon-btn" data-action="delete-category" data-name="${esc(name)}" aria-label="删除 ${esc(name)}">${icon('trash')}</button></div>`).join('') || '<p class="note">还没有分类，创建一个吧。</p>'}</div><form id="category-form" class="inline-form"><input class="dialog-input" name="name" placeholder="新的${label}名称" aria-label="新的${label}名称" required maxlength="30"><button class="btn primary" type="submit">创建${label}</button></form>`, '给喜欢的声音，找到它的位置。');
}
async function saveCategory(form) {
  const name = form.elements.name.value.trim();
  const old = form.dataset.old;
  await invoke('edit_category', { kind: manageKind, operation: old ? 'rename' : 'create', name: old || name, next: old ? name : null });
  if (old) {
    if (manageKind === 'groups' && filter.group === old) filter.group = name;
    if (manageKind === 'tags') filter.tags = filter.tags.map(n => n === old ? name : n);
  }
  await reloadLibrary(); showManage(); toast(old ? '名称已更新' : '已创建');
}
function showAssign(ids) {
  const tracks = store.tracks.filter(t => ids.includes(t.id));
  if (!tracks.length) { toast('请先选择歌曲'); return; }
  const batch = tracks.length > 1;
  openModal(batch ? `整理 ${tracks.length} 首歌曲` : tracks[0].title, `<form id="assign-form" data-ids="${esc(JSON.stringify(ids))}">${batch ? '<label class="check-label">操作<select class="dialog-input" name="operation"><option value="add">添加所选分类</option><option value="remove">移除所选分类</option></select></label>' : ''}${['groups', 'tags'].map(kind => `<fieldset class="assign-section"><legend>${kind === 'groups' ? '分组 · 可多选' : '标签 · 可多选'}</legend>${store[kind].map(name => `<label class="check-label"><input type="checkbox" name="${kind}" value="${esc(name)}" ${!batch && tracks[0][kind].includes(name) ? 'checked' : ''}>${esc(name)}</label>`).join('') || '<span class="note">还没有分类，可在侧栏创建分组，或到“设置”中创建标签。</span>'}</fieldset>`).join('')}<div class="dialog-footer"><button class="btn" type="button" data-action="close">取消</button><button class="btn primary" type="submit">保存</button></div></form>`, batch ? '只修改所选分类，保留其他分组和标签。' : '取消勾选即可移除，音频文件不会被修改。');
}
async function saveAssign(form) {
  const ids = JSON.parse(form.dataset.ids);
  const data = new FormData(form);
  await invoke('assign_categories', { assignment: { ids, groups: data.getAll('groups'), tags: data.getAll('tags'), operation: ids.length === 1 ? 'replace' : data.get('operation') } });
  await reloadLibrary(); $('#modal').close(); toast('分组和标签已保存');
}
let queuePage = 1;
function showQueue() {
  const ids = queue.length ? queue : filtered().map(t => t.id);
  openModal('播放队列', `<div class="dialog-list">${ids.slice((queuePage - 1) * pageSize, queuePage * pageSize).map(id => store.tracks.find(t => t.id === id)).filter(Boolean).map(t => `<div class="dialog-row"><button class="icon-btn" data-action="queue-play" data-id="${esc(t.id)}" aria-label="从队列播放 ${esc(t.title)}">${icon(t.id === currentId && !audio.paused ? 'pause' : 'play')}</button><span>${esc(t.title)}</span><small class="cell-muted">${t.id === currentId ? '当前歌曲' : duration(t.seconds)}</small></div>`).join('') || '<p class="note">队列为空，请先选择歌曲。</p>'}</div><div class="dialog-footer"><button class="btn" data-action="queue-prev" ${queuePage === 1 ? 'disabled' : ''}>上一页</button><span>${queuePage} / ${Math.max(1, Math.ceil(ids.length / pageSize))}</span><button class="btn" data-action="queue-next" ${queuePage * pageSize >= ids.length ? 'disabled' : ''}>下一页</button></div>`, `${ids.length} 首 · 搜索和分类筛选不会改变已建立的队列`);
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
    setLyricsVisible($('#inline-lyrics').hidden); return;
  }
  if (action === 'close-lyrics') { setLyricsVisible(false); return; }
  if (action === 'reload-lyrics') { await loadLyrics(); return; }
  if (action === 'follow-lyrics') {
    const view = document.getElementById(button.dataset.target);
    setLyricsFollow(view, view.dataset.follow === 'false'); syncLyrics(true); return;
  }
  if (action === 'lyric-seek') {
    const line = lyricLines[Number(button.dataset.index)];
    if (!line || !current()) return;
    if (mediaId !== currentId) { restorePosition = line.time; await playTrack(currentId); }
    else if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(line.time, audio.duration);
    syncLyrics(true); await persist(); return;
  }
  if (action === 'settings') { showSettings(); return; }
  if (action === 'choose-skin') { applySkin(button.dataset.skin, true); showSettings(); return; }
  if (action === 'close') { $('#modal').close(); return; }
  if (action === 'import') { showImport(); return; }
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
  if (action === 'queue-play') { if (!queue.length) queue = filtered().map(t => t.id); playTrack(id); $('#modal').close(); return; }
  if (action === 'manage') { showManage(kind); return; }
  if (action === 'assign' || action === 'assign-current' || action === 'assign-selected') { showAssign(action === 'assign-selected' ? [...selected] : [id || currentId]); return; }
  if (action === 'rename') {
    openModal('重命名', `<form id="category-form" data-old="${esc(name)}"><input class="dialog-input" name="name" value="${esc(name)}" maxlength="30" aria-label="分类名称" required><div class="dialog-footer"><button type="submit" class="btn primary">保存名称</button></div></form>`); return;
  }
  if (action === 'delete-category') {
    openModal('删除分类', `<p class="dialog-desc">删除“${esc(name)}”？歌曲、文件和收藏都会保留。</p><div class="dialog-footer"><button class="btn" data-action="manage">取消</button><button class="btn primary" data-action="confirm-delete" data-name="${esc(name)}">确认删除</button></div>`); return;
  }
  if (action === 'confirm-delete') {
    await invoke('edit_category', { kind: manageKind, operation: 'delete', name, next: null });
    if (manageKind === 'groups' && filter.group === name) filter.group = '';
    if (manageKind === 'tags') filter.tags = filter.tags.filter(n => n !== name);
    await reloadLibrary(); showManage(); return;
  }
  if (action === 'favorite') { const track = store.tracks.find(t => t.id === id); if (track) { const value = !track.favorite; await invoke('set_favorite', { id, value }); track.favorite = value; } }
  if (action === 'view') { resetCollection(); filter.favorite = view === 'favorite'; }
  if (action === 'group') { browseKind = ''; collectionTitle = ''; filter.artist = ''; filter.album = ''; filter.group = filter.group === name ? '' : name; page = 1; }
  if (action === 'tag') { filter.tags = filter.tags.includes(name) ? filter.tags.filter(t => t !== name) : [...filter.tags, name]; page = 1; }
  if (action === 'all-tags') { filter.tags = []; page = 1; }
  if (action === 'clear-filters') { Object.assign(filter, { favorite: false, group: '', tags: [], query: '' }); $('#search').value = ''; page = 1; }
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
  document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) handleAction(button).catch(error => reportError('操作', error)); });
  document.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.id === 'category-form') saveCategory(event.target).catch(error => reportError('保存分类', error));
    if (event.target.id === 'assign-form') saveAssign(event.target).catch(error => reportError('整理歌曲', error));
  });
  $('#search').addEventListener('input', event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { filter.query = event.target.value; page = 1; render(); }, 160);
  });
  $('#mobile-group').addEventListener('change', event => { browseKind = ''; collectionTitle = ''; filter.artist = ''; filter.album = ''; filter.group = event.target.value; page = 1; render(); });
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
  audio.addEventListener('play', renderPlayer);
  audio.addEventListener('pause', renderPlayer);
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
    if (event.key === 'Escape' && !$('#modal').open && !$('#inline-lyrics').hidden) { setLyricsVisible(false); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search').focus(); return; }
    if (event.code === 'Space' && !event.target.closest('input, textarea, select, button, a, [contenteditable], dialog')) { event.preventDefault(); togglePlay(); }
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
  syncMenuPlayer();
  await listen('save-playback', () => { void persist().catch(() => {}); });
  await listen('before-quit', async () => {
    audio.pause();
    try { await persist(); } finally { await invoke('quit_app'); }
  });
}
initialize().catch(error => reportError('启动音乐库', error));
