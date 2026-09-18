/* 原型共用业务规则；不上传音频，只持久化分类和文件标识。 */
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const duration = seconds => `${Math.floor((Number(seconds) || 0) / 60)}:${String(Math.floor((Number(seconds) || 0) % 60)).padStart(2, '0')}`;
  // 同一文件再次选择时复用分类；静态原型无法取得绝对路径。
  const fileId = file => `local:${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`;
  const matching = (tracks, filter) => tracks.filter(track =>
    (!filter.favorite || track.favorite) && (!filter.group || track.groups.includes(filter.group)) &&
    filter.tags.every(tag => track.tags.includes(tag)) &&
    `${track.title} ${track.artist} ${track.filename || ''}`.toLocaleLowerCase().includes(filter.query.toLocaleLowerCase().trim()));
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
  if (typeof module !== 'undefined') module.exports = { esc, duration, fileId, matching, shuffled, resolveSkin };
  if (typeof document === 'undefined') return;

  const icons = {
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
  const storageKey = 'liusheng-static-v1';
  // 示例曲目复用三段原创合成试听，所有音频均随原型离线提供。
  const titles = ['午后片刻', '橘色日落', '晚风来信', '雨后漫步', '山海之间', '慢一点', '窗边的光', '月亮不打烊', '漫长的夏天', '凌晨两点'];
  const seed = titles.map((title, i) => ({
    id: `demo-${i}`, title, artist: ['留声 · 键盘习作', '留声 · 弦音习作', '留声 · 氛围习作'][i % 3],
    album: ['日常片刻', '落日收集', '夜晚留白'][i % 3], filename: '', seconds: 18, art: i % 8,
    favorite: [0, 2, 4, 7].includes(i), groups: i % 2 ? ['晚间放松'] : ['通勤路上'],
    tags: i % 3 === 0 ? ['纯音乐', '放松'] : i % 3 === 1 ? ['轻快'] : ['纯音乐', '夜晚'],
    source: `assets/demo-${i % 3 + 1}.wav`, demo: true
  }));
  let store = { tracks: seed, groups: ['通勤路上', '晚间放松', '专注时刻'], tags: ['纯音乐', '放松', '轻快', '夜晚'], volume: 0.55, mode: 'order', current: 'demo-0', queue: [], position: 0 };
  let storageIssue = false;
  // 不信任本地缓存的形状，异常缓存不应导致播放器白屏。
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && Array.isArray(saved.tracks) && Array.isArray(saved.groups) && Array.isArray(saved.tags)) {
      const valid = saved.tracks.every(t => t && typeof t.id === 'string' && typeof t.title === 'string' && typeof t.artist === 'string' && Array.isArray(t.groups) && Array.isArray(t.tags));
      if (!valid) throw new Error('曲库缓存格式错误');
      store = { ...store, ...saved, groups: saved.groups.filter(n => typeof n === 'string'), tags: saved.tags.filter(n => typeof n === 'string') };
      store.tracks = saved.tracks.map(t => ({ ...t, source: seed.find(d => d.id === t.id)?.source || '', demo: seed.some(d => d.id === t.id), art: Number(t.art) % 8 || 0 }));
    }
  } catch (error) { console.warn('读取原型曲库失败：', error.message); storageIssue = true; }
  store.skin = resolveSkin(store.skin, document.body.dataset.theme).id;
  store.volume = Number.isFinite(store.volume) ? Math.max(0, Math.min(1, store.volume)) : 0.55;
  if (!['order', 'single', 'shuffle'].includes(store.mode)) store.mode = 'order';
  const filter = { favorite: false, group: '', tags: [], query: '' };
  const selected = new Set();
  const files = new Map();
  const audio = new Audio();
  audio.preload = 'metadata';
  audio.volume = store.volume;
  let currentId = store.tracks.some(t => t.id === store.current) ? store.current : store.tracks[0]?.id;
  let queue = Array.isArray(store.queue) ? store.queue.filter(id => store.tracks.some(t => t.id === id)) : [];
  let page = 1, toastTimer, searchTimer, playToken = 0, mediaId = '', mediaUrl = '', savedAt = 0;
  let restorePosition = Math.max(0, Number(store.position) || 0);
  let manageKind = 'groups';
  const pageSize = 50;
  const current = () => store.tracks.find(t => t.id === currentId);
  const playable = track => track && (track.demo || files.has(track.id));
  const favoriteButton = (track, extra = '') => `<button class="icon-btn favorite ${track?.favorite ? 'is-loved' : ''}" data-action="favorite" data-id="${esc(track?.id)}" aria-pressed="${!!track?.favorite}" aria-label="${track?.favorite ? '取消收藏' : '收藏'}${extra}" title="${track?.favorite ? '取消收藏' : '收藏'}">${icon('heart')}</button>`;

  // 只保存文件标识与用户操作，不将 Blob URL 或音频写入浏览器缓存。
  function persist() {
    try {
      const tracks = store.tracks.map(({ source, ...track }) => track);
      localStorage.setItem(storageKey, JSON.stringify({ ...store, tracks, current: currentId, queue, position: audio.ended ? 0 : mediaId === currentId ? audio.currentTime : restorePosition }));
      return true;
    } catch (error) {
      console.error('保存原型分类失败：', error.message);
      toast('浏览器未能保存数据，请检查存储权限；当前操作仅在本次打开有效');
      return false;
    }
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
        <a class="brand" href="index.html"><span class="brand-mark">${icon('music')}</span><span><strong>留声</strong><small>LOCAL MUSIC</small></span></a>
        <p class="nav-caption">我的音乐</p>
        <button class="nav-item" data-action="view" data-view="all">${icon('library')}<span>本地音乐</span><span class="count" id="all-count"></span></button>
        <button class="nav-item" data-action="view" data-view="favorite">${icon('heart')}<span>我喜欢的</span><span class="count" id="favorite-count"></span></button>
        <button class="nav-item" data-action="import">${icon('folder')}<span>导入音乐</span></button>
        <div class="side-heading"><span>我的分组</span><button class="icon-btn" data-action="manage" data-kind="groups" aria-label="管理分组">${icon('plus')}</button></div>
        <nav id="group-list" aria-label="分组"></nav>
        <div class="side-heading"><span>音乐标签</span><button class="icon-btn" data-action="manage" data-kind="tags" aria-label="管理标签">${icon('plus')}</button></div>
        <button class="nav-item" data-action="manage" data-kind="tags">${icon('tag')}<span>管理我的标签</span></button>
        <div class="sidebar-bottom"><div class="local-status">音乐与偏好，只留在本地</div><button class="skin-entry" data-action="skins">更换皮肤 · <span class="current-skin"></span> ${icon('arrow')}</button></div>
      </aside>
      <main class="workspace">
        <header class="topbar"><div class="breadcrumb">音乐库 ${icon('arrow')} <b>本地音乐</b></div>
          <label class="search">${icon('search')}<input id="search" type="search" placeholder="搜索歌曲、歌手、文件名" aria-label="搜索歌曲、歌手、文件名"><kbd>⌘ K</kbd></label>
        </header>
        <div class="content"><section class="library" aria-label="音乐库">
          <div class="hero"><div class="hero-copy"><div class="eyebrow">YOUR MUSIC, YOUR MOMENTS</div><h1>${esc(resolveSkin(store.skin).heading)}</h1><p>不必联网，随时回到喜欢的旋律。</p><div class="hero-foot">${icon('disc')}<span>自己的音乐，自己的节奏</span></div></div><div class="hero-art" aria-hidden="true"><div class="vinyl"></div><span class="vinyl-label">The little things.</span></div></div>
          <nav class="mobile-nav" aria-label="移动版音乐筛选" hidden><button class="chip active" data-action="view" data-view="all">全部音乐</button><button class="chip" data-action="view" data-view="favorite">我喜欢的</button><select id="mobile-group" aria-label="筛选分组"></select><button class="chip" data-action="skins">更换皮肤</button></nav>
          <div class="library-head"><div><h2 id="view-title">本地音乐</h2><p id="library-count"></p></div><div class="actions"><button class="btn primary" data-action="play-all">${icon('play')}播放全部</button><button class="btn" data-action="import">${icon('plus')}导入音乐</button></div></div>
          <div class="filters" id="filters"></div>
          <div class="batch" id="batch" hidden><span id="selected-count"></span><div><button class="text-btn" data-action="assign-selected">设置分组 / 标签</button><button class="text-btn" data-action="clear-selected">取消选择</button></div></div>
          <div class="table-wrap"><table aria-label="歌曲列表"><thead><tr><th><input id="select-all" type="checkbox" aria-label="选择本页全部歌曲"></th><th>歌曲</th><th class="artist-col">歌手</th><th class="album-col">专辑</th><th class="tag-col">标签</th><th>时长</th><th><span class="sr-only">收藏</span></th><th><span class="sr-only">更多操作</span></th></tr></thead><tbody id="tracks"></tbody></table></div>
          <div id="empty" class="empty" hidden>${icon('search')}没有找到歌曲<br><button class="text-btn" data-action="clear-filters">清空筛选</button></div><div id="pagination" class="pagination" hidden></div><div class="table-end" id="table-end"></div>
        </section>
        <aside class="right-panel" aria-label="当前歌曲详情"><div class="right-title">正在播放<span></span></div><div class="now-art"><small>LIUSHENG ORIGINAL DEMO</small><b>日常<br>片刻。</b></div><div id="now-info"></div><div class="detail-section"><div class="detail-heading">歌曲标签<button class="icon-btn" data-action="assign-current" aria-label="编辑当前歌曲标签">${icon('edit')}</button></div><div id="now-tags" class="detail-tags"></div></div><div class="detail-section"><div class="detail-heading">所属分组</div><div id="now-groups" class="detail-tags"></div></div><p class="note" id="now-note"></p></aside>
        </div>
      </main>
    </div>
    <footer class="player" aria-label="音乐播放器"><div class="player-track" id="player-track"></div><div class="player-center"><div class="transport"><button class="icon-btn" data-action="previous" aria-label="上一首">${icon('prev')}</button><button class="play-button" id="play-toggle" data-action="toggle-play" aria-label="播放">${icon('play')}</button><button class="icon-btn" data-action="next" aria-label="下一首">${icon('next')}</button></div><div class="progress"><span id="elapsed">0:00</span><input id="seek" type="range" aria-label="播放进度" min="0" max="18" step="0.1" value="0"><span id="total">0:18</span></div></div><div class="player-tools"><button class="mode-button" data-action="mode" id="mode" aria-label="切换播放模式"></button><button class="icon-btn volume-control" data-action="mute" id="mute" aria-label="静音">${icon('volume')}</button><input class="volume-control" id="volume" type="range" aria-label="音量" min="0" max="1" step="0.01" value="${store.volume}"><span class="divider"></span><button class="icon-btn" data-action="queue" aria-label="播放队列">${icon('queue')}</button></div></footer>
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
    $('.current-skin').textContent = skin.name;
    $('link[rel="icon"]').href = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="${skin.accent}"/><text x="7" y="25" font-size="25" fill="white">♪</text></svg>`);
    if (save) {
      console.info('已切换皮肤', { skin: skin.id });
      if (persist()) toast(`已切换为${skin.name}，下次打开继续使用`);
    }
  }
  function showSkins() {
    openModal('选择皮肤', `<div class="skin-options">${skins.map(skin => `<button class="skin-option" data-action="choose-skin" data-skin="${esc(skin.id)}" aria-pressed="${store.skin === skin.id}"><span class="skin-swatch" style="background:${skin.background};color:${skin.accent}" aria-hidden="true">${icon('music')}</span><span class="skin-copy"><strong>${esc(skin.name)}</strong><small>${esc(skin.description)}</small></span>${store.skin === skin.id ? icon('check') : ''}</button>`).join('')}</div>`, '选一个喜欢的样子，音乐照常播放。');
  }
  function filtered() { return matching(store.tracks, filter); }
  function render() {
    const rows = filtered();
    page = Math.max(1, Math.min(page, Math.ceil(rows.length / pageSize) || 1));
    $('#all-count').textContent = store.tracks.length;
    $('#favorite-count').textContent = store.tracks.filter(t => t.favorite).length;
    document.querySelectorAll('[data-action="view"]').forEach(button => {
      const active = button.dataset.view === 'favorite' ? filter.favorite : !filter.favorite && !filter.group;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('#group-list').innerHTML = store.groups.map((name, i) => `<button class="nav-item ${filter.group === name ? 'active' : ''}" data-action="group" data-name="${esc(name)}" aria-pressed="${filter.group === name}"><i class="group-dot tone-${i % 3}"></i><span>${esc(name)}</span><span class="count">${store.tracks.filter(t => t.groups.includes(name)).length}</span></button>`).join('');
    $('#mobile-group').innerHTML = '<option value="">全部分组</option>' + store.groups.map(name => `<option ${filter.group === name ? 'selected' : ''}>${esc(name)}</option>`).join('');
    $('#view-title').textContent = [filter.favorite ? '我喜欢的' : '', filter.group].filter(Boolean).join(' · ') || '本地音乐';
    const localCount = store.tracks.filter(t => !t.demo).length;
    $('#library-count').textContent = `${rows.length} 首歌曲 · ${localCount ? `已导入 ${localCount} 首本地音乐` : '示例曲库，导入 MP3 开始你的收藏'}`;
    $('#filters').innerHTML = `<span>标签</span><button class="chip ${filter.tags.length ? '' : 'active'}" data-action="all-tags">全部</button>${store.tags.map(tag => `<button class="chip ${filter.tags.includes(tag) ? 'active' : ''}" data-action="tag" data-name="${esc(tag)}" aria-pressed="${filter.tags.includes(tag)}">${esc(tag)}</button>`).join('')}<button class="text-btn" data-action="manage">管理分组与标签</button>`;
    const visible = rows.slice((page - 1) * pageSize, page * pageSize);
    $('#tracks').innerHTML = visible.map(t => `<tr class="${t.id === currentId ? 'current' : ''}" data-track="${esc(t.id)}"><td><input type="checkbox" data-select="${esc(t.id)}" ${selected.has(t.id) ? 'checked' : ''} aria-label="选择 ${esc(t.title)}"></td><td><div class="song-cell"><span class="cover art-${t.art}"><button class="row-play" data-action="play" data-id="${esc(t.id)}" aria-label="播放 ${esc(t.title)}">${icon(t.id === currentId && !audio.paused ? 'pause' : 'play')}</button></span><button class="song-name" data-action="play" data-id="${esc(t.id)}" aria-label="点播 ${esc(t.title)}"><span class="song-title">${esc(t.title)}</span><span class="song-meta">${t.demo ? '示例试听' : playable(t) ? '本地 MP3' : '需要重新选择文件'}</span></button></div></td><td class="cell-muted artist-col">${esc(t.artist)}</td><td class="cell-muted album-col">${esc(t.album || '本地音乐')}</td><td class="tag-col">${t.tags.slice(0, 2).map(tag => `<span class="row-tag">${esc(tag)}</span>`).join('') || '<span class="row-tag">—</span>'}</td><td class="cell-muted">${t.seconds ? duration(t.seconds) : '--:--'}</td><td>${favoriteButton(t, ` ${t.title}`)}</td><td><button class="icon-btn" data-action="assign" data-id="${esc(t.id)}" aria-label="编辑 ${esc(t.title)} 的分组和标签">${icon('dots')}</button></td></tr>`).join('');
    $('#empty').hidden = rows.length > 0;
    $('#table-end').textContent = rows.length ? `— ${rows.length <= pageSize ? '已展示全部' : '共'} ${rows.length} 首歌曲 —` : '';
    $('#select-all').checked = visible.length > 0 && visible.every(t => selected.has(t.id));
    $('#select-all').indeterminate = visible.some(t => selected.has(t.id)) && !$('#select-all').checked;
    $('#batch').hidden = !selected.size;
    $('#selected-count').textContent = `已选择 ${selected.size} 首`;
    $('#pagination').hidden = rows.length <= pageSize;
    $('#pagination').innerHTML = `<button class="icon-btn" data-action="page-prev" aria-label="上一页" ${page === 1 ? 'disabled' : ''}>‹</button>${page} / ${Math.ceil(rows.length / pageSize)}<button class="icon-btn" data-action="page-next" aria-label="下一页" ${page * pageSize >= rows.length ? 'disabled' : ''}>›</button>`;
    renderPlayer();
  }
  function renderPlayer() {
    const track = current();
    if (!track) return;
    $('#player-track').innerHTML = `<span class="cover art-${track.art}">${icon('music')}</span><div class="track-label"><strong>${esc(track.title)}</strong><small>${esc(track.artist)}</small></div>${favoriteButton(track, '当前歌曲')}`;
    $('#now-info').innerHTML = `<div class="now-info"><div><h3>${esc(track.title)}</h3><p>${esc(track.artist)}</p></div>${favoriteButton(track, '详情歌曲')}</div>`;
    $('#now-tags').innerHTML = track.tags.map(tag => `<span>${esc(tag)}</span>`).join('') || '<span>暂无标签</span>';
    $('#now-groups').innerHTML = track.groups.map(group => `<span>${esc(group)}</span>`).join('') || '<span>尚未分组</span>';
    $('#now-note').textContent = track.demo ? '当前为内置合成试听。导入你自己的 MP3，收藏属于你的声音。' : '音频仅在本地播放。重新打开页面后，需再次选择文件，收藏与分类会保留。';
    const rowButton = [...document.querySelectorAll('.row-play')].find(button => button.dataset.id === track.id);
    if (rowButton) {
      rowButton.innerHTML = icon(audio.paused ? 'play' : 'pause');
      rowButton.setAttribute('aria-label', `${audio.paused ? '播放' : '暂停'} ${track.title}`);
    }
    $('#play-toggle').innerHTML = icon(audio.paused ? 'play' : 'pause');
    $('#play-toggle').setAttribute('aria-label', audio.paused ? '播放' : '暂停');
    const labels = { order: '顺序播放', single: '单曲循环', shuffle: '随机播放' };
    $('#mode').innerHTML = `${icon(store.mode === 'shuffle' ? 'shuffle' : 'repeat')}<span>${labels[store.mode]}</span>`;
    $('#mode').setAttribute('aria-label', `${labels[store.mode]}，点击切换`);
    const total = mediaId === track.id && Number.isFinite(audio.duration) ? audio.duration : track.seconds || 0;
    $('#total').textContent = duration(total);
    $('#seek').max = total || 1;
    if (mediaId !== track.id) { $('#elapsed').textContent = duration(restorePosition); $('#seek').value = restorePosition; }
    $('#seek').disabled = mediaId !== track.id || !Number.isFinite(audio.duration);
  }
  function openModal(title, content, description = '') {
    const modal = $('#modal');
    modal.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-btn" data-action="close" aria-label="关闭弹窗">${icon('close')}</button></div>${description ? `<p class="dialog-desc">${esc(description)}</p>` : ''}${content}`;
    if (!modal.open) modal.showModal();
  }
  function showImport() {
    openModal('把音乐带进来', `<div class="import-options"><button class="btn primary" data-action="choose-files">${icon('music')}选择 MP3 文件</button><button class="btn" data-action="choose-folder">${icon('folder')}选择音乐文件夹</button></div><p class="note">支持多选。文件不会上传或修改。再次打开网页需重新选择文件；相同文件的收藏、分组和标签会保留。</p>`, '从你的电脑中选择喜欢的音乐。');
  }
  // 以 ID 建立队列，搜索或分类变化不会重新排列已经开始的播放。
  function startQueue(id) {
    const rows = filtered();
    queue = rows.map(t => t.id);
    if (!queue.includes(id)) queue.push(id);
    if (store.mode === 'shuffle') queue = [id, ...shuffled(queue.filter(key => key !== id))];
    playTrack(id);
  }
  async function playTrack(id, automatic = false) {
    const track = store.tracks.find(t => t.id === id);
    if (!playable(track)) {
      if (!automatic) toast('请重新选择这首 MP3，收藏和分类仍然保留');
      return false;
    }
    const token = ++playToken;
    if (mediaId !== id) {
      audio.pause();
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
      mediaUrl = track.demo ? '' : URL.createObjectURL(files.get(id));
      audio.src = track.demo ? track.source : mediaUrl;
      mediaId = id;
      if (id !== currentId) restorePosition = 0;
    }
    currentId = id;
    render();
    try {
      await audio.play();
      if (token === playToken) { renderPlayer(); persist(); }
      return true;
    } catch (error) {
      if (token !== playToken) return false;
      console.warn('音频播放失败：', error.name);
      if (!automatic) toast('无法播放此文件，请检查 MP3 是否损坏或重新选择文件');
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
    if (!audio.paused) { playToken++; audio.pause(); persist(); return; }
    if (!queue.length) queue = filtered().map(t => t.id);
    playTrack(currentId || queue[0]);
  }
  function showManage(kind = manageKind) {
    manageKind = kind === 'tags' ? 'tags' : 'groups';
    const label = manageKind === 'groups' ? '分组' : '标签';
    openModal('整理我的音乐', `<div class="dialog-tabs"><button class="${manageKind === 'groups' ? 'active' : ''}" data-action="manage" data-kind="groups">我的分组</button><button class="${manageKind === 'tags' ? 'active' : ''}" data-action="manage" data-kind="tags">我的标签</button></div><div class="dialog-list">${store[manageKind].map(name => `<div class="dialog-row"><span>${esc(name)}</span><button class="icon-btn" data-action="rename" data-name="${esc(name)}" aria-label="重命名 ${esc(name)}">${icon('edit')}</button><button class="icon-btn" data-action="delete-category" data-name="${esc(name)}" aria-label="删除 ${esc(name)}">${icon('trash')}</button></div>`).join('') || '<p class="note">还没有分类，创建一个吧。</p>'}</div><form id="category-form" class="inline-form"><input class="dialog-input" name="name" placeholder="新的${label}名称" aria-label="新的${label}名称" required maxlength="30"><button class="btn primary" type="submit">创建${label}</button></form>`, '给喜欢的声音，找到它的位置。');
  }
  function saveCategory(form) {
    const name = form.elements.name.value.trim();
    const old = form.dataset.old;
    if (!name) { toast('名称不能为空'); return; }
    if (store[manageKind].some(n => n.toLocaleLowerCase() === name.toLocaleLowerCase() && n !== old)) { toast('这个名称已经存在'); return; }
    if (old) {
      store[manageKind] = store[manageKind].map(n => n === old ? name : n);
      store.tracks.forEach(t => { t[manageKind] = t[manageKind].map(n => n === old ? name : n); });
      if (manageKind === 'groups' && filter.group === old) filter.group = name;
      if (manageKind === 'tags') filter.tags = filter.tags.map(n => n === old ? name : n);
    } else store[manageKind].push(name);
    const saved = persist();
    render(); showManage();
    if (saved) toast(old ? '名称已更新' : '已创建');
  }
  function showAssign(ids) {
    const tracks = store.tracks.filter(t => ids.includes(t.id));
    if (!tracks.length) { toast('请先选择歌曲'); return; }
    const batch = tracks.length > 1;
    openModal(batch ? `整理 ${tracks.length} 首歌曲` : tracks[0].title, `<form id="assign-form" data-ids="${esc(JSON.stringify(ids))}">${batch ? '<label class="check-label">操作<select class="dialog-input" name="operation"><option value="add">添加所选分类</option><option value="remove">移除所选分类</option></select></label>' : ''}${['groups', 'tags'].map(kind => `<fieldset class="assign-section"><legend>${kind === 'groups' ? '分组 · 可多选' : '标签 · 可多选'}</legend>${store[kind].map(name => `<label class="check-label"><input type="checkbox" name="${kind}" value="${esc(name)}" ${!batch && tracks[0][kind].includes(name) ? 'checked' : ''}>${esc(name)}</label>`).join('') || '<span class="note">还没有分类，请先到“管理分组与标签”中创建。</span>'}</fieldset>`).join('')}<div class="dialog-footer"><button class="btn" type="button" data-action="close">取消</button><button class="btn primary" type="submit">保存</button></div></form>`, batch ? '只修改所选分类，保留其他分组和标签。' : '取消勾选即可移除，音频文件不会被修改。');
  }
  function saveAssign(form) {
    const ids = JSON.parse(form.dataset.ids);
    const data = new FormData(form);
    store.tracks.filter(t => ids.includes(t.id)).forEach(track => {
      for (const kind of ['groups', 'tags']) {
        const values = data.getAll(kind).filter(value => store[kind].includes(value));
        if (ids.length === 1) track[kind] = values;
        else if (data.get('operation') === 'remove') track[kind] = track[kind].filter(value => !values.includes(value));
        else track[kind] = [...new Set([...track[kind], ...values])];
      }
    });
    const saved = persist();
    $('#modal').close(); render();
    if (saved) toast('分组和标签已保存');
  }
  function showQueue() {
    const ids = queue.length ? queue : filtered().map(t => t.id);
    openModal('播放队列', `<div class="dialog-list">${ids.map(id => store.tracks.find(t => t.id === id)).filter(Boolean).map(t => `<div class="dialog-row"><button class="icon-btn" data-action="queue-play" data-id="${esc(t.id)}" aria-label="从队列播放 ${esc(t.title)}">${icon(t.id === currentId && !audio.paused ? 'pause' : 'play')}</button><span>${esc(t.title)}</span><small class="cell-muted">${t.id === currentId ? '当前歌曲' : duration(t.seconds)}</small></div>`).join('') || '<p class="note">队列为空，请先选择歌曲。</p>'}</div>`, `${ids.length} 首 · 搜索和分类筛选不会改变已建立的队列`);
  }
  // 文件选择来自用户操作，只读取必要的文件信息，播放时才创建 Blob URL。
  function importFiles(list) {
    const candidates = [...list].filter(file => /\.mp3$/i.test(file.name));
    if (!candidates.length) { toast('没有找到 MP3 文件，请重新选择'); return; }
    let added = 0;
    const known = new Set(store.tracks.map(track => track.id));
    for (const file of candidates) {
      const id = fileId(file);
      files.set(id, file);
      if (known.has(id)) continue;
      known.add(id);
      const base = file.name.replace(/\.mp3$/i, '');
      const parts = base.split(' - ');
      store.tracks.push({ id, title: parts.length > 1 ? parts.slice(1).join(' - ') : base, artist: parts.length > 1 ? parts[0] : '未知歌手', filename: file.name, album: '本地音乐', seconds: 0, art: (store.tracks.length + added) % 8, favorite: false, groups: [], tags: [], demo: false, source: '' });
      added++;
    }
    filter.favorite = false; filter.group = ''; filter.tags = []; filter.query = '';
    $('#search').value = ''; page = Math.ceil(store.tracks.length / pageSize);
    const saved = persist();
    $('#modal').close(); render();
    console.info('本地导入完成', { selected: candidates.length, added });
    if (saved) toast(added ? `已导入 ${added} 首歌曲，可点击歌曲名播放` : `已重新连接 ${candidates.length} 首歌曲，分类保持不变`);
  }
  function handleAction(button) {
    const { action, id, name, view, kind } = button.dataset;
    if (action === 'skins') { showSkins(); return; }
    if (action === 'choose-skin') { applySkin(button.dataset.skin, true); $('#modal').close(); return; }
    if (action === 'close') { $('#modal').close(); return; }
    if (action === 'import') { showImport(); return; }
    if (action === 'choose-files' || action === 'choose-folder') { $(action === 'choose-files' ? '#file-input' : '#folder-input').click(); return; }
    if (action === 'toggle-play') { togglePlay(); return; }
    if (action === 'play') { if (currentId === id && mediaId === id) togglePlay(); else startQueue(id); return; }
    if (action === 'play-all') {
      const first = filtered().find(playable);
      if (!first) { toast('没有可播放的歌曲，请先导入 MP3'); return; }
      startQueue(first.id); return;
    }
    if (action === 'previous' || action === 'next') { restorePosition = 0; step(action === 'next' ? 1 : -1); return; }
    if (action === 'queue') { showQueue(); return; }
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
      store[manageKind] = store[manageKind].filter(n => n !== name);
      store.tracks.forEach(t => { t[manageKind] = t[manageKind].filter(n => n !== name); });
      if (manageKind === 'groups' && filter.group === name) filter.group = '';
      if (manageKind === 'tags') filter.tags = filter.tags.filter(n => n !== name);
      persist(); render(); showManage(); return;
    }
    if (action === 'favorite') { const track = store.tracks.find(t => t.id === id); if (track) { track.favorite = !track.favorite; persist(); } }
    if (action === 'view') { filter.favorite = view === 'favorite'; if (view === 'all') filter.group = ''; page = 1; }
    if (action === 'group') { filter.group = filter.group === name ? '' : name; page = 1; }
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
      persist();
    }
    if (action === 'mute') {
      audio.muted = !audio.muted;
      $('#mute').innerHTML = icon(audio.muted ? 'muted' : 'volume');
      $('#mute').setAttribute('aria-label', audio.muted ? '取消静音' : '静音');
    }
    render();
  }
  function bindEvents() {
    document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) handleAction(button); });
    document.addEventListener('submit', event => {
      event.preventDefault();
      if (event.target.id === 'category-form') saveCategory(event.target);
      if (event.target.id === 'assign-form') saveAssign(event.target);
    });
    $('#search').addEventListener('input', event => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { filter.query = event.target.value; page = 1; render(); }, 160);
    });
    $('#mobile-group').addEventListener('change', event => { filter.group = event.target.value; page = 1; render(); });
    $('#tracks').addEventListener('change', event => {
      const id = event.target.dataset.select;
      if (id) { if (event.target.checked) selected.add(id); else selected.delete(id); render(); }
    });
    $('#select-all').addEventListener('change', event => {
      filtered().slice((page - 1) * pageSize, page * pageSize).forEach(t => event.target.checked ? selected.add(t.id) : selected.delete(t.id));
      render();
    });
    for (const input of ['#file-input', '#folder-input']) $(input).addEventListener('change', event => { importFiles(event.target.files); event.target.value = ''; });
    $('#volume').addEventListener('input', event => { store.volume = Number(event.target.value); audio.volume = store.volume; persist(); });
    $('#seek').addEventListener('input', event => { if (Number.isFinite(audio.duration)) { audio.currentTime = Math.min(Number(event.target.value), audio.duration); restorePosition = 0; persist(); } });
    audio.addEventListener('loadedmetadata', () => {
      if (current()) current().seconds = audio.duration;
      if (restorePosition && Number.isFinite(audio.duration)) audio.currentTime = Math.min(restorePosition, Math.max(0, audio.duration - 0.1));
      restorePosition = 0; render();
    });
    audio.addEventListener('timeupdate', () => {
      $('#elapsed').textContent = duration(audio.currentTime);
      $('#seek').value = audio.currentTime;
      if (Date.now() - savedAt > 5000) { persist(); savedAt = Date.now(); }
    });
    audio.addEventListener('play', renderPlayer);
    audio.addEventListener('pause', renderPlayer);
    audio.addEventListener('ended', () => {
      restorePosition = 0;
      if (store.mode === 'single') { audio.currentTime = 0; playTrack(currentId, true); } else step(1, true);
    });
    audio.addEventListener('error', () => { console.warn('媒体读取失败', { code: audio.error?.code }); renderPlayer(); });
    document.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search').focus(); return; }
      if (event.code === 'Space' && !event.target.closest('input, textarea, select, button, a, [contenteditable], dialog')) { event.preventDefault(); togglePlay(); }
    });
    window.addEventListener('pagehide', () => { persist(); if (mediaUrl) URL.revokeObjectURL(mediaUrl); });
  }
  mount(); applySkin(store.skin); bindEvents(); render();
  if (storageIssue) toast('无法读取已保存的曲库，当前显示示例数据');
})();
