# Android 调试 APK 构建与验收

本轮只构建自用 arm64 调试包，不发布或部署。首次启动由使用者填写服务器根 URL；HTTP 只在明确的 Android debug 构建中、且对该地址勾选同意后可用。release 构建的前端拒绝持久化 HTTP 地址，Android Manifest 也关闭明文流量。不要在源码、构建脚本或包内预置生产/测试服务器地址。

## 环境

需要完整 JDK 21（`javac` 必须存在）、Android SDK platform 36、build-tools 36.0.0、platform-tools、NDK r27d、Rust 与 `aarch64-linux-android` target，以及 Node/npm。本轮实际验证 Rust 1.99.1；`src-tauri/Cargo.toml` 声明的 1.90 下限未单独构建验证。仓库自带 Gradle wrapper 9.6.1，`npm ci` 和 `Cargo.lock` 固定依赖；不需要安装 Android Studio。

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

确认 `applicationId` 后缀 `.debug`、`debuggable=true`、`usesCleartextTraffic=true`、v2 签名校验通过、ZIP 16 KiB 对齐成功；`libapp_lib.so` 的所有 `LOAD` 行 `Align` 应为 `0x4000` 或更高。release 的 Manifest 明文值是 `false`，需另行核对合并后的 release Manifest。若 APK 内 ELF 仍为 `0x1000`，只能确认 4 KiB ELF 对齐的静态事实，不能宣称 16 KiB 页设备兼容或任何设备已安装通过。

## 本轮结果

冻结源码 `7eba6f9da2d19a7a8c31dcfd6fd02d4d861036a0`，独立构建分支代码提交 `6b28deaaf0d4dc458bfc77f3531ee4764ef7a823`。逐项核对 `src/`、`public/`、`src-tauri/`、`scripts/`、Vite/TypeScript 配置、`CHANGELOG.md`、入口 HTML 与 npm 清单/锁文件的 Git blob SHA 及模式一致，构建输入工作树干净。最终已签包位于任务隔离目录 `deliverables/Workhub-Android-debug-7eba6f9-arm64.apk`，160,225,211 字节，SHA256 为 `db3248fa07a0be2203052929ae2635511bb5b85246bdd99bf3dedf6462d36754`。首次增量打包曾包含无引用旧字节，执行 `:app:clean` 后用相同源码重建，以上数值仅指干净构建的交付包。

交付包实测 `fun.fpigeon.nexus.debug`、minSdk 24、targetSdk 36，仅含 arm64 原生库；`apksigner` v2 验签通过，调试证书 SHA256 指纹 `844bdfa42f2b14c8844079914e3e4fe06ba8f8dd6e252f72add2579ef82c2480`；`zipalign -c -P 16 -v 4` 通过，APK 内原生库四个 `LOAD` 对齐均为 `0x4000`。debug Manifest 的 `debuggable` 与 `usesCleartextTraffic` 均为 true；单独运行 release Manifest 合并任务后，`usesCleartextTraffic=false`。未生成 release APK。

实际 Android debug 前端输出的 HTTP 能力为 true，Android release 前端即使继承 `VITE_WORKHUB_ANDROID_DEBUG_HTTP=1` 仍为 false。Tauri 编译记录 `cargo:dev=false`，以打包前端启动；`devUrl` 的 localhost 字面仍在通用配置中，但不是此 build 运行入口。APK 内 Brotli 前端主 JS 解压后 SHA256 为 `4534fae29c04aab1669eb1fd3a158d622e1a9d9713fa28ea803988a71303060a`，与保留的 debug dist 一致；实际嵌入的前端资源解压扫描未命中旧正式/测试服务器地址。构建机 `adb devices -l` 列表为空，未执行安装、首启、地址输入、登录或同步真机测试。

当前构建机没有连接 Android 设备，也没有 `/dev/kvm`。APK 静态验收不等同于真机安装、首启、连接或同步验收；后续设备测试只使用授权的合成数据和用户手填地址。
