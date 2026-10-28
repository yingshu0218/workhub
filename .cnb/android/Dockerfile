# 寻鸽工作台 · Android 构建环境（CNB 用）
#
# 用途：在 CNB 流水线上出 Android APK。只在 **本文件变更时** 重建（见 .cnb.yml），
# 平时 tag 流水线直接复用制品库里的镜像，不再重复拉 SDK/NDK。
#
# ⚠️ 为什么 compileSdk/targetSdk 钉 36 而不是 Tauri 模板默认的 37：
#    腾讯云镜像站（国内 CI 可达）目前只同步到 platforms;android-36；
#    37 只能走 dl.google.com，国内流水线大概率下不下来。
#    36 与 37 对本应用没有行为差异（edge-to-edge 自 35 起就强制）。
#    将来镜像站补齐 37、或 CI 能稳定访问 Google 时，改这里 + build.gradle.kts 一起升。
#
# 为什么预装而不是每次装：SDK+NDK 约 3 GB，每次流水线重下既慢又费流量；
#    做成镜像后单次构建只拉增量层。

FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    NDK_HOME=/opt/android-sdk/ndk/27.0.12077973 \
    ANDROID_SDK_MIRROR=https://mirrors.cloud.tencent.com/AndroidSDK/ \
    RUSTUP_DIST_SERVER=https://mirrors.aliyun.com/rustup \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    PATH=/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:/root/.cargo/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      openjdk-17-jdk-headless unzip curl git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Android 命令行工具：走腾讯云镜像（dl.google.com 国内不可达）
RUN mkdir -p "$ANDROID_HOME/cmdline-tools" /tmp/sdk \
    && curl -fsSL -o /tmp/sdk/cmdline-tools.zip \
         "${ANDROID_SDK_MIRROR}commandlinetools-linux-11076708_latest.zip" \
    && unzip -q /tmp/sdk/cmdline-tools.zip -d "$ANDROID_HOME/cmdline-tools" \
    && mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest" \
    && rm -rf /tmp/sdk

# 非交互环境必须先把 license 写进 $ANDROID_HOME/licenses，否则 install 会静默跳过
RUN yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses > /dev/null \
    && SDK_TEST_BASE_URL="$ANDROID_SDK_MIRROR" sdkmanager --sdk_root="$ANDROID_HOME" \
         "platform-tools" \
         "platforms;android-36" \
         "build-tools;36.0.0" \
         "ndk;27.0.12077973" \
    && rm -rf "$ANDROID_HOME/.temp" "$ANDROID_HOME/.downloadIntermediates"

# Rust + Android target。rustup 走阿里云镜像（官方源在 CI 上常被限速）
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path \
    && rustup target add aarch64-linux-android

# cargo 走 rsproxy 稀疏索引：crates.io 在国内 CI 上常被限速到几 KB/s，
# 首次构建要拉几百个 crate，不限速会把 2 小时的单任务预算吃光。
# ⚠️ 构建任务**不要**挂 /root/.cargo 缓存卷 —— 空卷会盖掉这份配置。
RUN mkdir -p /root/.cargo && cat > /root/.cargo/config.toml <<'EOF'
[source.crates-io]
replace-with = 'rsproxy-sparse'

[source.rsproxy-sparse]
registry = "sparse+https://rsproxy.cn/index/"

[net]
git-fetch-with-cli = true
EOF

# 自检：镜像构建阶段就暴露缺件，而不是等到 tag 那天才发现
RUN java -version && node -v && rustc -V \
    && sdkmanager --sdk_root="$ANDROID_HOME" --list_installed | sed -n '1,12p'
