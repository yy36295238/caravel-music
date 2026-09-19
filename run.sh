#!/usr/bin/env bash
# 从任意工作目录调用，开发和打包始终使用本项目的依赖与配置。
set -euo pipefail
cd "$(dirname "$0")"

print_help() {
  cat <<'HELP'
留声开发与打包

用法：
  ./run.sh                     启动桌面开发模式，支持前端热更新
  ./run.sh dev                 同上，按 Ctrl+C 停止
  ./run.sh build               macOS 生成当前架构 .app；Windows 生成 NSIS
  ./run.sh build dmg           macOS 额外生成 DMG
  ./run.sh build universal     macOS 生成 Apple Silicon + Intel 双架构 .app
  ./run.sh build universal dmg macOS 双架构 .app + DMG，参数顺序不限
  ./run.sh build nsis          Windows（Git Bash）生成 NSIS 安装包
  ./run.sh clean               清理编译产物和 dist，保留 artifacts 中的安装包
  ./run.sh help                查看帮助

首次运行缺少 node_modules 时执行 npm ci。
需要 Node.js 22+、Rust 和当前平台的原生构建工具。
只打包当前操作系统；版本沿用项目配置，不自动升版。
APP：src-tauri/target/[universal-apple-darwin/]release/bundle/macos/
DMG：artifacts/；Windows 安装包：src-tauri/target/release/bundle/nsis/
HELP
}
fail() { echo "错误：$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || fail "未找到 ${1}，请先安装 $2"; }

# 参数错误必须先退出，不能触发依赖安装或构建。
command_name="${1:-dev}"
if [ "$#" -gt 0 ]; then shift; fi
case "$command_name" in
  help|-h|--help) [ "$#" -eq 0 ] || fail 'help 不接受其他参数'; print_help; exit 0 ;;
  dev) [ "$#" -eq 0 ] || fail 'dev 不接受其他参数' ;;
  build) ;;
  clean)
    [ "$#" -eq 0 ] || fail 'clean 不接受其他参数'
    # 仅清理项目内可重建的输出；不依赖构建工具，也不触及安装包、依赖或用户曲库。
    echo '清理 src-tauri/target 和 dist（包含 target 内的 .app / NSIS 产物）…'
    rm -rf -- src-tauri/target dist
    echo '清理完成，artifacts 安装包已保留；下次启动或打包会重新编译。'
    exit 0 ;;
  *) fail "未知命令：${command_name}，查看 ./run.sh help" ;;
esac

platform=$(uname -s)
universal=0
want_dmg=0
want_nsis=0
for arg in "$@"; do
  case "$arg" in
    universal) universal=1 ;;
    dmg) want_dmg=1 ;;
    nsis) want_nsis=1 ;;
    *) fail "未知打包参数：${arg}，支持 universal / dmg / nsis" ;;
  esac
done
case "$platform" in
  Darwin) [ "$want_nsis" -eq 0 ] || fail 'NSIS 需要在 Windows 上构建' ;;
  MINGW*|MSYS*|CYGWIN*)
    [ "$universal" -eq 0 ] && [ "$want_dmg" -eq 0 ] || fail 'universal / dmg 仅支持 macOS'
    ;;
  *) fail '当前仅支持 macOS 和 Windows（Git Bash），WSL 不属于 Windows 原生构建环境' ;;
esac

require_command node 'Node.js 22 或以上版本'
require_command npm 'Node.js（包含 npm）'
require_command cargo 'Rust stable'
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || fail '需要 Node.js 22 或以上版本'
if [ "$platform" = Darwin ]; then
  require_command xcode-select 'Xcode Command Line Tools'
  xcode-select -p >/dev/null 2>&1 || fail '请先执行 xcode-select --install'
fi
if [ "$universal" -eq 1 ]; then require_command rustup 'rustup'; fi

# 实际探测 Vite 使用的 IPv4 地址，避免把其他项目仅监听 IPv6 的服务误判为冲突。
if [ "$command_name" = dev ]; then
  node -e '
    const server = require("node:net").createServer();
    server.once("error", error => {
      console.error(`错误：无法监听开发地址 127.0.0.1:1420（${error.code}），请检查端口占用或权限`);
      process.exitCode = 1;
    });
    server.listen({ host: "127.0.0.1", port: 1420, exclusive: true }, () => server.close());
  '
fi
if [ ! -d node_modules ]; then
  echo '首次运行，安装锁定版本的前端依赖…'
  npm ci
fi
if [ "$command_name" = dev ]; then
  echo '启动留声开发模式，按 Ctrl+C 停止；macOS 关窗仅隐藏应用。'
  exec npm run app:dev
fi

if [ "$platform" = Darwin ]; then
  # 复用同一套 .app 签名和 DMG 打包逻辑，旧 npm 入口保持可用。
  exec bash scripts/package-mac.sh app "$@"
fi
echo '构建 Windows NSIS 安装包…'
npm run app:build -- --bundles nsis
echo "打包完成：$(pwd)/src-tauri/target/release/bundle/nsis/"
