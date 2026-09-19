#!/usr/bin/env bash
# 在隔离副本中验证参数与命令分发，禁止触及真实构建产物和应用数据。
set -euo pipefail
cd "$(dirname "$0")/.."
check_dir=$(mktemp -d)
trap 'rm -rf "$check_dir"' EXIT
mkdir -p "$check_dir/project with spaces/scripts" "$check_dir/bin"
cp run.sh "$check_dir/project with spaces/run.sh"
cat > "$check_dir/bin/npm" <<'STUB'
#!/usr/bin/env bash
printf 'npm %s\n' "$*" >> "$CHECK_LOG"
[ "$PWD" = "$CHECK_PROJECT" ] || exit 10
if [ "$*" = ci ]; then mkdir node_modules; fi
STUB
cat > "$check_dir/bin/uname" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$CHECK_PLATFORM"
STUB
cat > "$check_dir/bin/node" <<'STUB'
#!/usr/bin/env bash
if [[ "$*" == *createServer* ]] && [ "${CHECK_PORT_BUSY:-0}" = 1 ]; then exit 1; fi
exit 0
STUB
for tool in cargo xcode-select rustup; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$check_dir/bin/$tool"
done
cat > "$check_dir/project with spaces/scripts/package-mac.sh" <<'STUB'
#!/usr/bin/env bash
printf 'package-mac %s\n' "$*" >> "$CHECK_LOG"
STUB
chmod +x "$check_dir/bin/"*
export PATH="$check_dir/bin:$PATH"
export CHECK_PROJECT="$check_dir/project with spaces"
export CHECK_LOG="$check_dir/calls"
export CHECK_PLATFORM=Darwin
: > "$CHECK_LOG"
# 帮助及错误参数不应执行安装、启动或打包命令。
bash "$CHECK_PROJECT/run.sh" help >/dev/null
for args in 'unknown' 'dev extra' 'build unknown' 'build nsis' 'help extra' 'clean extra'; do
  if bash "$CHECK_PROJECT/run.sh" $args >/dev/null 2>&1; then
    echo "FAIL: 应拒绝 $args" >&2; exit 1
  fi
done
[ ! -s "$CHECK_LOG" ]
# 清理兼容用户的 sh 调用；只删除构建目录，保留安装包、依赖和其它数据，重复执行也成功。
mkdir -p "$CHECK_PROJECT/src-tauri/target/release" "$CHECK_PROJECT/dist" "$CHECK_PROJECT/artifacts" "$CHECK_PROJECT/node_modules" "$CHECK_PROJECT/music"
touch "$CHECK_PROJECT/src-tauri/target/release/cache" "$CHECK_PROJECT/dist/index.html" "$CHECK_PROJECT/artifacts/player.dmg" "$CHECK_PROJECT/node_modules/keep" "$CHECK_PROJECT/music/song.mp3"
sh "$CHECK_PROJECT/run.sh" clean >/dev/null
sh "$CHECK_PROJECT/run.sh" clean >/dev/null
[ ! -e "$CHECK_PROJECT/src-tauri/target" ] && [ ! -e "$CHECK_PROJECT/dist" ]
[ -f "$CHECK_PROJECT/artifacts/player.dmg" ] && [ -f "$CHECK_PROJECT/node_modules/keep" ] && [ -f "$CHECK_PROJECT/music/song.mp3" ]
[ ! -s "$CHECK_LOG" ]
rm -rf "$CHECK_PROJECT/node_modules"
if CHECK_PORT_BUSY=1 bash "$CHECK_PROJECT/run.sh" dev >/dev/null 2>&1; then
  echo 'FAIL: 占用端口应阻止启动' >&2; exit 1
fi
[ ! -s "$CHECK_LOG" ]
# 首次默认启动执行 npm ci，后续使用已有依赖；路径含空格且工作目录在项目外。
cd "$check_dir"
bash "$CHECK_PROJECT/run.sh" >/dev/null
bash "$CHECK_PROJECT/run.sh" dev >/dev/null
bash "$CHECK_PROJECT/run.sh" build >/dev/null
bash "$CHECK_PROJECT/run.sh" build universal dmg >/dev/null
bash "$CHECK_PROJECT/run.sh" build dmg universal >/dev/null
export CHECK_PLATFORM=MINGW64_NT-10.0
for arg in dmg universal; do
  if bash "$CHECK_PROJECT/run.sh" build "$arg" >/dev/null 2>&1; then
    echo "FAIL: Windows 应拒绝 $arg" >&2; exit 1
  fi
done
bash "$CHECK_PROJECT/run.sh" build >/dev/null
bash "$CHECK_PROJECT/run.sh" build nsis >/dev/null
cat > "$check_dir/expected" <<'EXPECTED'
npm ci
npm run app:dev
npm run app:dev
package-mac app
package-mac app universal dmg
package-mac app dmg universal
npm run app:build -- --bundles nsis
npm run app:build -- --bundles nsis
EXPECTED
diff -u "$check_dir/expected" "$CHECK_LOG"
echo 'PASS: 清理范围与成品保留、重复清理、参数拒绝、端口占用、首次安装、默认启动、带空格路径及 macOS / Windows 命令分发'
