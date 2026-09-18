// 菜单栏只暴露实际可执行的队列操作，跳过离线或已移除的歌曲。
export function playbackSnapshot(store, queue, currentId, playing, reducedMotion) {
  const track = store.tracks.find(item => item.id === currentId);
  const available = new Set(store.tracks.filter(item => item.available).map(item => item.id));
  const index = queue.indexOf(currentId);
  return {
    title: (track?.title || '留声').slice(0, 1024), artist: (track?.artist || (track ? '未知歌手' : '选一首喜欢的音乐')).slice(0, 1024),
    skin: store.skin, mode: store.mode || 'order', playing, animate: playing && !reducedMotion,
    canPlay: playing || !!track?.available || queue.some(id => available.has(id)),
    canPrevious: index > 0 && queue.slice(0, index).some(id => available.has(id)),
    canNext: queue.slice(index + 1).some(id => available.has(id)),
  };
}
