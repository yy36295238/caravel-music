import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './mini-player.css';

const $ = selector => document.querySelector(selector);
// 所有文字来自本地标签，用 textContent 避免文件内标签被解释成 HTML。
function render(snapshot) {
  document.body.dataset.theme = snapshot.skin;
  document.body.classList.toggle('playing', snapshot.playing);
  $('#title').textContent = snapshot.title;
  $('#title').title = snapshot.title;
  $('#artist').textContent = snapshot.artist;
  $('#artist').title = snapshot.artist;
  $('#status').textContent = snapshot.playing ? '正在播放' : '已暂停';
  $('#toggle').disabled = !snapshot.canPlay;
  $('#toggle').setAttribute('aria-label', snapshot.playing ? '暂停' : '播放');
  $('#toggle').title = snapshot.playing ? '暂停' : '播放';
  $('#toggle-icon').setAttribute('d', snapshot.playing ? 'M7 5h3v14H7zM14 5h3v14h-3z' : 'm9 5 10 7-10 7Z');
  $('[data-action="previous"]').disabled = !snapshot.canPrevious;
  $('[data-action="next"]').disabled = !snapshot.canNext;
  const mode = ['order', 'single', 'shuffle'].includes(snapshot.mode) ? snapshot.mode : 'order';
  const modeLabel = { order: '顺序播放', single: '单曲循环', shuffle: '随机播放' }[mode];
  $('#mode').dataset.mode = mode;
  $('#mode').title = `${modeLabel}，点击切换`;
  $('#mode').setAttribute('aria-label', `${modeLabel}，点击切换`);
  $('#mode-icon').setAttribute('d', mode === 'shuffle'
    ? 'M3 5h3c5 0 7 14 12 14h3m-4-4 4 4-4 3M3 19h3c2 0 3-2 4-4m4-6c1-2 2-4 4-4h3m-4-3 4 3-4 4'
    : 'm17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3');
  $('#single-mark').textContent = mode === 'single' ? '1' : '';
  if (!snapshot.canPlay) $('#status').textContent = '待播放';
}
function report(error) {
  console.error('菜单栏播放器操作失败', error);
  $('#error').textContent = '暂时无法操作，请打开留声重试';
  $('#error').hidden = false;
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  $('#error').hidden = true;
  invoke('menu_player_action', { action: button.dataset.action }).catch(report);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') invoke('menu_player_action', { action: 'hide' }).catch(report);
  if (event.code === 'Space' && !event.target.closest('button')) {
    event.preventDefault(); if (!$('#toggle').disabled) $('#toggle').click();
  }
});
// 先订阅再读取快照，冷启动和窗口隐藏期间都不丢失主播放器状态。
async function initialize() {
  await listen('menu-state', event => render(event.payload));
  render(await invoke('menu_player_snapshot'));
}
initialize().catch(report);
