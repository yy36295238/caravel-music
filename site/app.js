// 只切换真实截图，不模拟音频播放，避免官网预览与播放器功能混淆。
const preview = document.querySelector('#preview');
const screenshot = document.querySelector('#player-preview');
const caption = document.querySelector('#skin-caption');
const skins = { dark: ['深色红', '给夜晚的旋律'], light: ['清新绿', '给明亮的日常'] };
for (const button of document.querySelectorAll('[data-skin]')) {
  button.addEventListener('click', () => {
    const skin = button.dataset.skin;
    if (!Object.hasOwn(skins, skin)) return;
    screenshot.src = `assets/player-${skin}.webp`;
    screenshot.alt = `留声${skins[skin][0]}皮肤：专辑歌曲列表、文件夹筛选、右侧歌词与底部播放器`;
    preview.dataset.skin = skin;
    caption.textContent = `${skins[skin][0]} · ${skins[skin][1]}`;
    for (const option of document.querySelectorAll('.skin-switch button')) option.setAttribute('aria-pressed', String(option === button));
  });
}
// 安装说明的锚点跳转同时展开对应问答，避免链接落在折叠内容上。
function openLinkedQuestion() {
  if (location.hash === '#mac-install') document.querySelector('#mac-install').open = true;
}
window.addEventListener('hashchange', openLinkedQuestion);
openLinkedQuestion();
