// 运行：node prototypes/check.cjs；覆盖组合筛选、文件重选标识及输出转义。
const assert = require('node:assert/strict');
const { esc, duration, fileId, matching, shuffled, resolveSkin } = require('./app.js');
const tracks = [
  { id: 'a', title: '雨后', artist: 'Artist', filename: '雨后.MP3', favorite: true, groups: ['通勤'], tags: ['轻快', '中文'] },
  { id: 'b', title: '晚风', artist: 'Band', filename: '晚风.mp3', favorite: false, groups: ['通勤'], tags: ['中文'] }
];
const filter = { favorite: false, group: '', tags: [], query: '' };
assert.deepEqual(matching(tracks, { ...filter, query: 'ARTIST' }).map(t => t.id), ['a']);
assert.deepEqual(matching(tracks, { ...filter, tags: ['轻快', '中文'], group: '通勤' }).map(t => t.id), ['a']);
assert.equal(matching(tracks, { ...filter, favorite: true, query: '晚风' }).length, 0);
assert.equal(matching(tracks, { ...filter, query: '<script>' }).length, 0);
assert.equal(esc('<img title="x">&'), '&lt;img title=&quot;x&quot;&gt;&amp;');
assert.equal(duration(125.9), '2:05');
const file = { name: 'test.mp3', size: 1200, lastModified: 100 };
assert.equal(fileId(file), fileId({ ...file }));
assert.notEqual(fileId(file), fileId({ ...file, size: 1201 }));
assert.notEqual(fileId(file), fileId({ ...file, webkitRelativePath: 'album/test.mp3' }));
const ids = tracks.map(t => t.id);
assert.deepEqual(shuffled(ids).sort(), [...ids].sort());
assert.deepEqual(ids, ['a', 'b']);
assert.equal(resolveSkin('light').id, 'light');
assert.equal(resolveSkin('dark', 'light').id, 'dark');
assert.equal(resolveSkin(undefined, 'light').id, 'light');
assert.equal(resolveSkin('removed').id, 'dark');
assert.equal(resolveSkin('__proto__', 'unknown').id, 'dark');
console.log('通过：皮肤选择与旧设置回退、搜索、收藏/分组/多标签组合筛选、文件重选标识、HTML 转义、随机队列完整性。');
