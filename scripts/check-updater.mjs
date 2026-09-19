// node scripts/check-updater.mjs：执行真实更新流程，模拟原生下载/安装，禁止替换本机应用。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const elements = new Map();
const node = selector => {
  if (!elements.has(selector)) elements.set(selector, { textContent: '', hidden: false, disabled: false });
  return elements.get(selector);
};
let mode = 'none', saveFails = false, restartFails = false, releaseDownload;
const calls = [];
const update = {
  version: '0.2.0', body: '<img src=x onerror=alert(1)>',
  close: async () => { calls.push('close'); },
  download: async onEvent => {
    calls.push('download');
    if (mode === 'bad-signature') throw new Error('Signature verification failed');
    onEvent({ event: 'Started', data: { contentLength: 100 } });
    onEvent({ event: 'Progress', data: { chunkLength: 25 } });
    assert.equal(node('progress').value, 25);
    if (mode === 'pending') await new Promise(resolve => { releaseDownload = resolve; });
  },
  install: async () => { calls.push('install'); },
};
const context = vm.createContext({
  document: { querySelector: selector => selector === '#software-update' ? { querySelector: node } : null },
  console: { info() {}, error() {} },
  getVersion: async () => '0.1.0',
  check: async () => {
    calls.push('check');
    if (mode === 'offline') throw new Error('offline');
    return mode === 'none' ? null : update;
  },
  relaunch: async () => { calls.push('restart'); if (restartFails) throw new Error('restart failed'); },
});
const source = readFileSync(new URL('../src/updater.js', import.meta.url), 'utf8');
vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
await context.initUpdater(async () => { calls.push('save'); if (saveFails) throw new Error('disk full'); });
assert.equal(node('[data-update-version]').textContent, '当前版本 0.1.0');
assert.equal(node('[data-update-message]').textContent, '已是最新版本');
mode = 'offline';
await context.checkForUpdates();
assert.match(node('[data-update-message]').textContent, /检查更新失败/);
assert.equal(node('[data-action="check-update"]').disabled, false);
mode = 'bad-signature';
await context.checkForUpdates();
assert.equal(node('[data-update-notes]').textContent, update.body);
await context.installUpdate();
assert.ok(!calls.includes('install') && !calls.includes('save'), '签名失败不得暂停或安装');
mode = 'pending';
calls.length = 0;
const installing = context.installUpdate();
await context.installUpdate();
await context.checkForUpdates();
assert.deepEqual(calls, ['download'], '下载中必须拒绝重复安装和检查');
saveFails = true;
releaseDownload();
await installing;
assert.deepEqual(calls, ['download', 'save'], '保存失败不得安装或重启');
saveFails = false;
restartFails = true;
await context.installUpdate();
assert.deepEqual(calls, ['download', 'save', 'save', 'install', 'restart'], '重试应复用已验证的包，先保存再安装');
assert.equal(node('[data-action="install-update"]').textContent, '重启应用');
assert.equal(node('[data-action="check-update"]').disabled, true);
restartFails = false;
await context.installUpdate();
assert.equal(calls.filter(call => call === 'install').length, 1, '重启失败不得重复安装');
assert.equal(calls.at(-1), 'restart');
console.log('PASS: 自动检查、无更新、网络失败、纯文本说明、签名失败、重复点击、保存失败、安装顺序与重启重试');
