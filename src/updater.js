import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

// 更新任务独立于设置页，离开页面不会丢失下载进度或重复安装。
const state = { version: '', update: null, busy: false, downloaded: false, installed: false, message: '启动时自动检查更新，安装前会保存播放进度。', percent: null };
let prepareInstall;

/** 复用播放器自己的保存流程；自动检查失败只显示在设置中，不打断播放。 */
export async function initUpdater(beforeInstall) {
  prepareInstall = beforeInstall;
  try {
    state.version = await getVersion();
    await checkForUpdates();
  } catch (error) {
    fail('读取当前版本', error);
  }
}

/** 用文本节点展示远端版本说明，避免更新清单中的内容注入页面。 */
export function renderUpdater() {
  const entry = document.querySelector('.settings-entry');
  entry?.classList.toggle('has-update', !!state.update || state.installed);
  entry?.setAttribute('aria-label', state.update || state.installed ? '设置，有可用更新' : '设置');
  const section = document.querySelector('#software-update');
  if (!section) return;
  section.querySelector('[data-update-version]').textContent = state.version ? `当前版本 ${state.version}` : '正在读取版本…';
  section.querySelector('[data-update-message]').textContent = state.message;
  const notes = section.querySelector('[data-update-notes]');
  notes.textContent = state.update?.body || '';
  notes.hidden = !notes.textContent;
  const progress = section.querySelector('progress');
  progress.hidden = state.percent === null;
  progress.value = state.percent ?? 0;
  const checkButton = section.querySelector('[data-action="check-update"]');
  checkButton.disabled = state.busy || state.installed;
  const installButton = section.querySelector('[data-action="install-update"]');
  installButton.hidden = !state.update && !state.installed;
  installButton.disabled = state.busy;
  installButton.textContent = state.installed ? '重启应用' : '下载并安装更新';
}

/** 自动和手动检查共享互斥状态；资源关闭后再请求，避免重复持有安装包。 */
export async function checkForUpdates() {
  if (state.busy || state.installed) return;
  state.busy = true;
  state.message = '正在检查更新…';
  state.percent = null;
  renderUpdater();
  console.info('检查软件更新', { current: state.version });
  try {
    await state.update?.close();
    state.update = null;
    state.downloaded = false;
    state.update = await check({ timeout: 15000 });
    state.message = state.update ? `发现新版本 ${state.update.version}，安装后将重启应用。` : '已是最新版本';
    console.info('软件更新检查完成', { available: !!state.update, version: state.update?.version });
  } catch (error) {
    fail('检查更新', error);
  } finally {
    state.busy = false;
    renderUpdater();
  }
}

/** 插件负责 HTTPS 下载及签名校验，校验完成后才暂停播放并安装。 */
export async function installUpdate() {
  if (state.busy || (!state.update && !state.installed)) return;
  state.busy = true;
  state.percent = null;
  renderUpdater();
  try {
    if (!state.installed) {
      if (!state.downloaded) {
        let received = 0, total = 0;
        console.info('下载软件更新', { version: state.update.version });
        state.message = '正在下载更新…';
        renderUpdater();
        await state.update.download(event => {
          if (event.event === 'Started') { total = event.data.contentLength || 0; received = 0; }
          if (event.event === 'Progress') received += event.data.chunkLength;
          state.percent = total ? Math.min(100, Math.floor(received / total * 100)) : null;
          state.message = total ? `正在下载更新… ${state.percent}%` : '正在下载更新…';
          renderUpdater();
        }, { timeout: 120000 });
        // 保存失败后重试时复用已经校验过的包，避免重复下载和遗留原生资源。
        state.downloaded = true;
      }
      state.message = '正在保存播放进度并安装…';
      state.percent = null;
      renderUpdater();
      // Windows 安装器会退出进程，必须在调用 install 之前确认保存成功。
      await prepareInstall();
      await state.update.install();
      state.installed = true;
      console.info('软件更新安装完成', { version: state.update.version });
    }
    state.message = '更新已安装，正在重启…';
    renderUpdater();
    await relaunch();
  } catch (error) {
    fail(state.installed ? '重启应用' : '安装更新', error);
  } finally {
    state.busy = false;
    state.percent = null;
    renderUpdater();
  }
}

/** 保留可重试入口，详细失败原因只进入日志，页面提示不暴露内部路径。 */
function fail(action, error) {
  console.error(`${action}失败`, error);
  state.message = state.installed ? '更新已安装，重启失败。请点击重启应用重试。' : `${action}失败，请检查网络或稍后重试。`;
  renderUpdater();
}
