#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# 不传参数保留原有 npm run app:build:mac 生成 DMG 的行为。
universal=0
want_dmg=0
if [ "$#" -eq 0 ]; then want_dmg=1; fi
for arg in "$@"; do
  case "$arg" in
    app) ;;
    universal) universal=1 ;;
    dmg) want_dmg=1 ;;
    *) echo "错误：未知 macOS 打包参数：$arg" >&2; exit 1 ;;
  esac
done
[ "$(uname -s)" = Darwin ] || { echo '错误：此脚本只能在 macOS 上运行' >&2; exit 1; }
build_args=(--bundles app)
release_dir='src-tauri/target/release'
arch_tag=$(uname -m)
if [ "$universal" -eq 1 ]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
  build_args+=(--target universal-apple-darwin)
  release_dir='src-tauri/target/universal-apple-darwin/release'
  arch_tag=universal
fi

echo "构建留声 macOS 应用（${arch_tag}）…"
npm run app:build -- "${build_args[@]}"
app_path="$release_dir/bundle/macos/留声.app"
[ -d "$app_path" ] || { echo "错误：未找到应用 $app_path" >&2; exit 1; }
# 本地包使用 ad-hoc 签名，检查完整性；不等同于开发者签名或公证。
codesign --force --deep --sign - "$app_path"
codesign --verify --deep --strict "$app_path"
echo "APP：$(pwd)/$app_path"
[ "$want_dmg" -eq 1 ] || exit 0

# 直接从暂存目录生成镜像，不挂载磁盘，也不依赖 Finder 排版。
staging_dir=$(mktemp -d "${TMPDIR:-/tmp}/liusheng-package.XXXXXX")
trap 'rm -rf "$staging_dir"' EXIT
mkdir "$staging_dir/payload"
ditto "$app_path" "$staging_dir/payload/留声.app"
ln -s /Applications "$staging_dir/payload/Applications"
mkdir -p artifacts
app_version=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")
output_path="artifacts/留声_${app_version}_macOS_${arch_tag}.dmg"
# 先验证临时镜像再替换成品，打包失败时保留上一份有效安装包。
hdiutil create -volname '留声' -srcfolder "$staging_dir/payload" -format UDZO "$staging_dir/output.dmg"
hdiutil verify "$staging_dir/output.dmg"
mv -f "$staging_dir/output.dmg" "$output_path"
echo "DMG：$(pwd)/$output_path"
