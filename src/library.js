// 专辑按歌手与专辑名共同识别，避免不同歌手的同名专辑混在一起。
export const artistName = track => track.artist?.trim() || '未知歌手';
export const albumName = track => track.album?.trim() || '未知专辑';
export const albumKey = track => JSON.stringify([artistName(track), albumName(track)]);

/** 使用同一筛选规则建立列表和队列，浏览分类不会修改已开始的队列。 */
export function matching(tracks, filter) {
  const query = filter.query.toLocaleLowerCase().trim();
  return tracks.filter(track =>
    (!filter.favorite || track.favorite) && (!filter.group || track.groups.includes(filter.group)) &&
    (!filter.artist || artistName(track) === filter.artist) && (!filter.album || albumKey(track) === filter.album) &&
    filter.tags.every(tag => track.tags.includes(tag)) &&
    `${track.title} ${artistName(track)} ${albumName(track)} ${track.filename || ''}`.toLocaleLowerCase().includes(query));
}

/** 一次遍历汇总分类，不为每个专辑重复扫描整个曲库。 */
export function collections(tracks, kind, query = '') {
  const items = new Map();
  for (const track of tracks) {
    const artist = artistName(track), album = albumName(track);
    const key = kind === 'artists' ? artist : albumKey(track);
    if (!items.has(key)) items.set(key, { key, title: kind === 'artists' ? artist : album, artist, count: 0, albums: new Set(), art: track.art });
    const item = items.get(key);
    item.count++; item.albums.add(album);
  }
  const term = query.trim().toLocaleLowerCase();
  return [...items.values()].filter(item => `${item.title} ${item.artist}`.toLocaleLowerCase().includes(term))
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN') || a.artist.localeCompare(b.artist, 'zh-CN'));
}
