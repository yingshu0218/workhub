#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Tauri 构建钩子还要求 Android 平台和 debug 模式，避免 release 继承变量时放行 HTTP。
# 即使调试包具备此能力，使用者仍须对当前 HTTP 地址单独勾选同意。
: "${JAVA_HOME:?Set JAVA_HOME to JDK 21}"
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK}"
: "${NDK_HOME:?Set NDK_HOME to the installed Android NDK}"
test -x "$JAVA_HOME/bin/javac" || { echo "JAVA_HOME must contain a JDK (javac missing)" >&2; exit 1; }
test -f "$NDK_HOME/source.properties" || { echo "NDK_HOME is not an Android NDK" >&2; exit 1; }
test -d "$ANDROID_HOME/platforms/android-36" || { echo "Android SDK platform 36 is missing" >&2; exit 1; }
command -v cargo >/dev/null
command -v npm >/dev/null

# NDK r27 默认生成 4 KiB ELF LOAD 对齐；16 KiB 页设备需要两个链接参数。
# Cargo 的 RUSTFLAGS 会覆盖目标 rustflags，因此要保留 Tauri 原本链接的 Android 系统库。
if [[ -n "${CARGO_ENCODED_RUSTFLAGS:-}" ]]; then
  echo "Unset CARGO_ENCODED_RUSTFLAGS before this build" >&2
  exit 1
fi
export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }-Clink-arg=-landroid -Clink-arg=-llog -Clink-arg=-lOpenSLES -Clink-arg=-Wl,-z,max-page-size=16384 -Clink-arg=-Wl,-z,common-page-size=16384"

export VITE_WORKHUB_ANDROID_DEBUG_HTTP=1
npm ci --no-audit --no-fund
npm run tauri -- android build --debug --target aarch64 --apk --ci
