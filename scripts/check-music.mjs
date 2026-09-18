// 可运行自查：只使用内存样本，不访问个人音乐文件或应用数据。
import assert from 'node:assert/strict';
import { matching, collections, albumKey } from '../src/library.js';
import { parseLyrics, activeLyricIndex, lyricScrollTop } from '../src/lyrics.js';
import { playbackSnapshot } from '../src/menu-state.js';

const tracks = [
  { id: '1', title: '歌曲一', artist: '甲', album: '同名专辑', groups: ['通勤'], tags: ['安静'], favorite: true },
  { id: '2', title: '歌曲二', artist: '乙', album: '同名专辑', groups: [], tags: [], favorite: false },
  { id: '3', title: '歌曲三', artist: '甲', album: '同名专辑', groups: [], tags: [], favorite: false },
  { id: '4', title: '无信息', artist: '', album: '', groups: [], tags: [], favorite: false },
];
const filter = { favorite: false, group: '', tags: [], query: '', artist: '', album: '' };
const snapshot = JSON.stringify(tracks);
assert.equal(collections(tracks, 'albums').length, 3);
assert.equal(collections(tracks, 'artists').find(item => item.title === '甲').count, 2);
assert.equal(collections(tracks, 'albums', '乙').length, 1);
assert.deepEqual(matching(tracks, { ...filter, album: albumKey(tracks[0]) }).map(t => t.id), ['1', '3']);
assert.equal(matching(tracks, { ...filter, query: '同名专辑' }).length, 3);
assert.equal(matching(tracks, { ...filter, artist: '甲', favorite: true, group: '通勤', tags: ['安静'] }).length, 1);
assert.equal(JSON.stringify(tracks), snapshot);
const parsed = parseLyrics('\uFEFF[ti:歌名]\n[offset:+500]\n[00:03.250][00:01.50]一句\n[00:01.500]译文\n[00:05]尾句');
assert.deepEqual(parsed.lines, [{ time: 1, text: '一句\n译文' }, { time: 2.75, text: '一句' }, { time: 4.5, text: '尾句' }]);
assert.equal(activeLyricIndex(parsed.lines, 0.9), -1);
assert.equal(activeLyricIndex(parsed.lines, 2.75), 1);
assert.equal(activeLyricIndex(parsed.lines, 1.1), 0);
assert.equal(activeLyricIndex(parsed.lines, 999), 2);
assert.equal(activeLyricIndex([], 2), -1);
assert.deepEqual(parseLyrics('[ar:歌手]\n普通歌词\n第二行'), { lines: [], text: '普通歌词\n第二行' });
assert.equal(parseLyrics('[offset:-1000]\n[00:00.01]一句').lines[0].time, 1.01);
assert.equal(parseLyrics('[00:75]无效时间').lines.length, 0);
assert.equal(parseLyrics('[00:00]<img src=x onerror=alert(1)>').lines[0].text, '<img src=x onerror=alert(1)>');
assert.throws(() => parseLyrics('\n'.repeat(10001)));
assert.throws(() => parseLyrics('[00:01]'.repeat(10001)));
console.log('PASS: 专辑隔离、歌手聚合、组合筛选、LRC 时间与译文、偏移、倒退定位及输入边界');

const menuStore = { skin: 'light', tracks: tracks.map(track => ({ ...track, available: track.id !== '2' })) };
let menu = playbackSnapshot(menuStore, ['1', '2', '3'], '1', true, false);
assert.equal(menu.canPrevious, false);
assert.equal(menu.canNext, true);
assert.equal(menu.animate, true);
assert.equal(menu.skin, 'light');
menu = playbackSnapshot(menuStore, ['1', '2', '3'], '3', false, false);
assert.equal(menu.canPrevious, true);
assert.equal(menu.canNext, false);
assert.equal(menu.animate, false);
assert.equal(playbackSnapshot(menuStore, ['1'], '1', true, true).animate, false);
menu = playbackSnapshot({ skin: 'dark', tracks: [] }, [], null, false, false);
assert.equal(menu.canPlay, false);
assert.equal(menu.canPrevious, false);
assert.equal(menu.canNext, false);
assert.equal(playbackSnapshot(menuStore, ['2'], '2', false, false).canPlay, false);
console.log('PASS: 菜单栏空曲库、队列边界、跳过离线歌曲、暂停与减少动态效果');

assert.equal(lyricScrollTop(200, 40, 200, 800), 120);
assert.equal(lyricScrollTop(0, 40, 200, 800), 0);
assert.equal(lyricScrollTop(760, 40, 200, 800), 600);
assert.equal(lyricScrollTop(30, 60, 200, 120), 0);
console.log('PASS: 歌词居中、首尾边界与短歌词无需滚动');

for (const mode of ['order', 'single', 'shuffle']) {
  assert.equal(playbackSnapshot({ ...menuStore, mode }, ['1'], '1', false, false).mode, mode);
}
assert.equal(playbackSnapshot(menuStore, [], null, false, false).mode, 'order');
console.log('PASS: 菜单栏顺序 / 单曲 / 随机模式快照及旧状态回退');
