// 官网静态资源和交互自查，不启动桌面应用，也不读取个人曲库。
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '../site');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
// 结构化数据与正文的平台范围一致；精确授权数据块，不放宽其它内联脚本限制。
const structuredText = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
assert.ok(structuredText, '缺少产品结构化数据');
const structured = JSON.parse(structuredText);
assert.equal(structured['@type'], 'SoftwareApplication');
assert.equal(structured.url, 'https://caravel-music.pages.dev/');
assert.ok(html.includes(`rel="canonical" href="${structured.url}"`));
assert.ok(html.includes(`href="${structured.downloadUrl}"`));
assert.ok(readFileSync(resolve(root, 'robots.txt'), 'utf8').includes(`Sitemap: ${structured.url}sitemap.xml`));
assert.ok(readFileSync(resolve(root, 'sitemap.xml'), 'utf8').includes(`<loc>${structured.url}</loc>`));
const structuredHash = createHash('sha256').update(structuredText).digest('base64');
assert.ok(readFileSync(resolve(root, '_headers'), 'utf8').includes(`'sha256-${structuredHash}'`));
for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (url === '#' || /^https?:/.test(url)) continue;
  if (url.startsWith('#')) assert.ok(html.includes(`id="${url.slice(1)}"`), `缺少锚点：${url}`);
  else assert.ok(existsSync(resolve(root, url)), `缺少资源：${url}`);
}
const elements = new Map(['#preview', '#player-preview', '#skin-caption', '#mac-install'].map(id => [id, { dataset: {}, open: false }]));
const buttons = ['dark', 'light'].map(skin => ({ dataset: {skin}, attributes: {},
  addEventListener(_, listener) { this.click = listener; },
  setAttribute(name, value) { this.attributes[name] = value; }
}));
const handlers = {};
const location = {hash: ''};
runInNewContext(readFileSync(resolve(root, 'app.js'), 'utf8'), {
  document: {querySelector: key => elements.get(key), querySelectorAll: () => buttons},
  location, window: {addEventListener: (event, listener) => { handlers[event] = listener; }}
});
for (const skin of ['dark', 'light', 'dark']) {
  const selected = buttons[skin === 'dark' ? 0 : 1];
  selected.click();
  assert.equal(elements.get('#player-preview').src, `assets/player-${skin}.webp`);
  assert.equal(elements.get('#preview').dataset.skin, skin);
  assert.equal(selected.attributes['aria-pressed'], 'true');
  assert.equal(buttons.find(button => button !== selected).attributes['aria-pressed'], 'false');
  assert.ok(elements.get('#skin-caption').textContent);
}
location.hash = '#mac-install'; handlers.hashchange();
assert.equal(elements.get('#mac-install').open, true);
console.log('PASS: 官网资源与锚点、双皮肤往返切换、可访问状态和安装说明展开');
