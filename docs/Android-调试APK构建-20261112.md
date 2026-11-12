# Android 调试 APK 构建与验收

本轮只构建自用 arm64 调试包，不发布或部署。首次启动由使用者填写服务器根 URL；HTTP 只在明确的 Android debug 构建中、且对该地址勾选同意后可用。release 构建的前端拒绝持久化 HTTP 地址，Android Manifest 也关闭明文流量。不要在源码、构建脚本或包内预置生产/测试服务器地址。

## 环境

需要完整 JDK 21（`javac` 必须存在）、Android SDK platform 36、build-tools 36.0.0、platform-tools、NDK r27d、Rust 1.90+ 与 `aarch64-linux-android` target，以及 Node/npm。仓库自带 Gradle wrapper 9.6.1，`npm ci` 和 `Cargo.lock` 固定依赖；不需要安装 Android Studio。

设置 `JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`，将 JDK、Rust、SDK build-tools/platform-tools 加入 `PATH`。Android SDK 的 `ANDROID_USER_HOME` 可指向独立目录，以免调试签名密钥落在默认的 `~/.android`。本任务的隔离工具链环境入口是仓库外的 `../toolchains/env.sh`。

```bash
source ../toolchains/env.sh
./scripts/build-android-debug.sh
```

脚本执行 `npm ci`，设置 `VITE_WORKHUB_ANDROID_DEBUG_HTTP=1`，然后用 `tauri android build --debug --target aarch64 --apk --ci` 打包。Tauri 同时给前端构建钩子设置 `TAURI_ENV_PLATFORM=android`、`TAURI_ENV_DEBUG=true`；三者同时满足才编入 HTTP 调试能力。`src-tauri/tauri.conf.json` 的 `frontendDist` 指向 `../dist`，因此包内使用构建出的前端资源，而非本机 Vite 开发地址。脚本还给 NDK r27 的 Rust 链接设置 16 KiB 页对齐参数。

默认产物在 `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`。它用本机调试证书签名，包名应为 `fun.fpigeon.nexus.debug`，只含 `arm64-v8a`，最低 SDK 24。调试证书不能当作 release 签名或上架凭据。

## 静态验收

使用 SDK 工具和 NDK 检查最终产物：

```bash
apk=src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
aapt dump badging "$apk"
aapt dump xmltree "$apk" AndroidManifest.xml
apksigner verify --verbose --print-certs "$apk"
zipalign -c -P 16 -v 4 "$apk"
"$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf" -lW src-tauri/target/aarch64-linux-android/debug/libapp_lib.so
sha256sum "$apk"
```

确认 `applicationId` 后缀 `.debug`、`debuggable=true`、`usesCleartextTraffic=true`、v2 签名校验通过、ZIP 16 KiB 对齐成功；`libapp_lib.so` 的所有 `LOAD` 行 `Align` 应为 `0x4000` 或更高。release 的 Manifest 明文占位值是 `false`，需另行核对合并后的 release Manifest。若 APK 内 ELF 仍为 `0x1000`，只能视作 4 KiB 页设备已通过静态包校验，不能宣称原生兼容 16 KiB 页设备。

当前构建机没有连接 Android 设备，也没有 `/dev/kvm`。APK 静态验收不等同于真机安装、首启、连接或同步验收；后续设备测试只使用授权的合成数据和用户手填地址。
