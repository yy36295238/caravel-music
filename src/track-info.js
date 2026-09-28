import { invoke, convertFileSrc } from '@tauri-apps/api/core';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// 每次曲库刷新允许重新读取外部改过的封面；无图结果只在当前版本内记忆。
let coverVersion = Date.now();
const missingCovers = new Set();
export function refreshCovers() { coverVersion++; missingCovers.clear(); }

/** 封面随可见区域懒加载，缺失或离线歌曲保留原有占位图。 */
export function coverImage(track) {
  if (!track?.available || missingCovers.has(track.id)) return '';
  const url = `${convertFileSrc('cover', 'music')}/${encodeURIComponent(track.id)}?v=${coverVersion}`;
  return `<img class="embedded-cover" data-cover="${esc(track.id)}" data-cover-version="${coverVersion}" src="${esc(url)}" alt="" loading="lazy" decoding="async">`;
}
// 图片事件不冒泡，捕获监听兼容列表重建，且不需要 CSP 禁止的内联处理器。
document.addEventListener('load', event => {
  const image = event.target;
  if (!image.matches?.('img[data-cover]')) return;
  image.parentElement.classList.add('has-art');
}, true);
document.addEventListener('error', event => {
  const image = event.target;
  if (!image.matches?.('img[data-cover]')) return;
  if (image.dataset.coverVersion === String(coverVersion)) missingCovers.add(image.dataset.cover);
  image.remove();
}, true);

/** 异步结果只更新发起请求的弹窗，避免切换歌曲后出现上一首的信息。 */
export async function showTrackInfo(track, openModal) {
  if (!track) return;
  openModal('歌曲信息', `<div class="track-info-heading"><span class="cover art-${track.art}">${coverImage(track)}</span><div><strong>${esc(track.title)}</strong><p class="note">${esc(track.artist)}</p></div></div><p class="track-file">${esc(track.filename)}</p><div id="track-info-fields" aria-live="polite"><p class="note">正在读取…</p></div><div class="dialog-footer"><button class="btn" data-action="track-more" data-id="${esc(track.id)}">返回更多</button></div>`);
  const container = document.querySelector('#track-info-fields');
  try {
    const fields = await invoke('load_track_info', { id: track.id });
    if (!container.isConnected) return;
    container.innerHTML = `<dl class="track-info-fields">${fields.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl><p class="note">仅显示文件中已有的信息，缺失标签不作推测。</p>`;
  } catch (error) {
    console.warn('读取歌曲信息失败', error);
    if (container.isConnected) container.textContent = `读取失败：${String(error)}`;
  }
}
