import { lyricScrollTop } from './lyrics.js';

// 每个歌词视图最多运行一个滚动任务，切歌和手动浏览必须取消旧任务。
const animations = new WeakMap();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// 单句滚动留出减速尾段，不用回弹，以免时间轴稳定时文字仍上下摆动。
const scrollDuration = 760;

export function stopLyricScroll(view) {
  cancelAnimationFrame(animations.get(view));
  animations.delete(view);
}

/** 切歌时清除旧动画和首尾留白，纯文本、加载和错误提示沿用普通排版。 */
export function resetLyricView(view) {
  stopLyricScroll(view);
  view.style.removeProperty('padding-top');
  view.style.removeProperty('padding-bottom');
  delete view.dataset.timed;
}

/** 首尾留出半屏空间，让第一句和最后一句也能落在歌词视口中央。 */
function padLyrics(view) {
  const first = view.firstElementChild, last = view.lastElementChild;
  if (!view.clientHeight || !first?.classList.contains('lyric-line')) return;
  view.dataset.timed = 'true';
  view.style.paddingTop = `${Math.max(0, (view.clientHeight - first.offsetHeight) / 2)}px`;
  view.style.paddingBottom = `${Math.max(0, (view.clientHeight - last.offsetHeight) / 2)}px`;
}

/** 用可中断的缓动代替 WebView 默认滚动，连续切句从当前视觉位置开始。 */
export function centerLyric(view, line, immediate = false) {
  stopLyricScroll(view);
  if (!view.clientHeight || !line?.classList.contains('lyric-line')) return;
  padLyrics(view);
  const target = lyricScrollTop(line.offsetTop, line.offsetHeight, view.clientHeight, view.scrollHeight);
  const start = view.scrollTop, distance = target - start;
  if (immediate || reducedMotion.matches || Math.abs(distance) < 1) {
    view.scrollTop = target;
    return;
  }
  const started = performance.now();
  const frame = now => {
    if (!view.clientHeight || document.hidden || view.dataset.follow === 'false') {
      stopLyricScroll(view);
      return;
    }
    const progress = reducedMotion.matches ? 1 : Math.min(1, (now - started) / scrollDuration);
    // 临界阻尼曲线：起步速度为零，接近目标时缓慢收敛；归一化确保准确落位。
    const eased = (1 - (1 + 8 * progress) * Math.exp(-8 * progress)) / (1 - 9 * Math.exp(-8));
    view.scrollTop = start + distance * eased;
    if (progress < 1) animations.set(view, requestAnimationFrame(frame));
    else animations.delete(view);
  };
  animations.set(view, requestAnimationFrame(frame));
}

/** 窗口伸缩或歌词节点切换布局后重算留白，只在跟随状态下重居中。 */
export function observeLyricView(view) {
  const observer = new ResizeObserver(() => {
    if (!view.clientHeight) { stopLyricScroll(view); return; }
    padLyrics(view);
    if (view.dataset.follow !== 'false') {
      centerLyric(view, view.querySelector('.active') || view.firstElementChild, true);
    }
  });
  observer.observe(view, { box: 'border-box' });
}
