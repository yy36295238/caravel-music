/** 普通文本原样展示；LRC 支持重复时间标签、毫秒、offset 和同一时间的译文。 */
export function parseLyrics(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > 10000) throw new Error('歌词行数超过 10,000 行');
  const offset = Number([...text.matchAll(/\[offset:([+-]?\d+)\]/gi)].at(-1)?.[1] || 0) / 1000;
  const timed = [];
  const stamp = /\[(\d{1,4}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;
  for (const line of lines) {
    const times = [...line.matchAll(stamp)];
    const words = line.replace(stamp, '').replace(/<\d+:[0-5]\d(?:\.\d{1,3})?>/g, '').trim();
    for (const time of times) {
      if (timed.length >= 10000) throw new Error('歌词时间点超过 10,000 个');
      timed.push({ time: Math.max(0, Number(time[1]) * 60 + Number(time[2]) + Number(`0.${time[3] || 0}`) - offset), text: words || '…' });
    }
  }
  timed.sort((a, b) => a.time - b.time);
  const merged = [];
  for (const line of timed) {
    const previous = merged.at(-1);
    if (previous?.time === line.time) previous.text += `\n${line.text}`;
    else merged.push({ ...line });
  }
  return { lines: merged, text: lines.filter(line => !/^\[(ar|ti|al|by|offset|length|re|ve):.*\]$/i.test(line.trim())).join('\n').trim() };
}

/** 二分定位当前歌词；倒退、拖动进度和第一句之前都使用同一规则。 */
export function activeLyricIndex(lines, position) {
  let low = 0, high = lines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].time <= position) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/** 将当前句居中并限制到滚动范围，首尾句不会反复请求越界位置。 */
export function lyricScrollTop(lineTop, lineHeight, viewHeight, scrollHeight) {
  return Math.min(Math.max(0, scrollHeight - viewHeight), Math.max(0, lineTop + lineHeight / 2 - viewHeight / 2));
}
