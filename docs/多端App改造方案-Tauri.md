# 寻鸽工作台 · 多端 App 改造方案（Tauri v2）

> **状态**：方案稿，待拍板。本文**不改动任何业务代码**，只定义目标结构、迁移顺序与风险。
> **范围**：在**当前仓库**内把 Web 应用扩展出 Windows / macOS / Android 三个原生端。
> 生成日期：2026-10-09

---

## 1. 结论

1. **留在当前仓库做 monorepo，不另起仓库。**
2. **原生壳选 Tauri v2**（一套前端产物同时出 Windows / macOS / Android / iOS）。
3. **分 3 个阶段推进，阶段 1 只加壳、不换存储** —— 先拿到「能构建、能安装、能跑通同步」的确定性，再把 Dexie 换成 SQLite。

理由（逐条对应本仓库既有设计）：

- `AGENTS.md` §4 已声明 `src/repositories/` 是**存储无关的唯一写入口**（`Dexie / TauriSqlite 可替换`），技术栈里也预留了 `SQLite WASM 迁移口`。**这套设计的前提就是同一份代码跑在两个平台**；拆仓会把这个接口降级成「跨仓版本契约」。
- App 还要复用 `src/domain/` 的编排口径、`src/agent/skillSource.ts` 的 34 个 Agent 工具 schema、`relay/` 的桥、`AGENTS.md` 的规则。拆仓后只能复制或做私有包。
- 同步协议（LWW + `syncQueue` + 心跳）两端必须**同版本**，否则出现「App 写进去、Web 认不出」的静默数据问题。同 commit 是唯一结构性保证。

---

## 2. 选型对比

| 方案 | 代码复用 | 覆盖端 | 主要代价 |
|---|---|---|---|
| **Tauri v2**（选定） | ~95% | Windows / macOS / Linux / **Android / iOS** | 需 Rust 工具链；Android 需 JDK + SDK + NDK；CI 需自建镜像 |
| Capacitor | ~95% | Android / iOS | **无桌面端**，与「终态含 Win/macOS」冲突 |
| Electron | ~95% | Win / macOS / Linux | **无移动端**；包体大 |
| React Native / Flutter | 20~30% | Android / iOS | 等于重写 UI 与状态层，与 IndexedDB 数据模型冲突 |
| 纯 PWA（现状） | 100% | 全平台（安装受限） | 无原生能力；iOS 体验差 —— 定位为**过渡形态**，保留 |

结论：目标端是「Android + Windows + macOS」，只有 Tauri v2 能一套代码全覆盖、且直接复用现有 Vite 产物。

---

## 3. 现状盘点（2026-10-09 核对）

| 项 | 现状 |
|---|---|
| 结构 | 单一 Vite 应用：`src/`（app / modules / domain / repositories / db / sync / agent / queries / stores / shared / design-system / styles）、`relay/`、`scripts/`、`pb_setup/`、`design/`、`docs/` |
| 构建 | `npm run build` = `check-icons` + `tsc -b` + `vite build` |
| 存储 | Dexie(IndexedDB)，`src/repositories/{index,repository}.ts` |
| PWA | `public/{manifest.webmanifest,sw.js,pwa-icon-*.png}` |
| 原生壳 | **无**（没有 `src-tauri/`、`apps/`、`packages/`） |
| CI | `.cnb.yml` = CNB → GitHub 单向镜像；发布流程另走 CNB 构建 docker 镜像 |
| 基线 | `main` @ `2eb2676` |

---

## 4. 目标代码结构

### 4.1 近期（阶段 1~3 用，改动最小）

```
src-tauri/            # 新增：Tauri 壳（Rust + 配置 + capabilities）
  ├─ tauri.conf.json
  ├─ Cargo.toml
  ├─ capabilities/    # v2 权限声明
  └─ src/main.rs
src/platform/         # 新增：平台自适应层（阶段 2 才建）
  ├─ index.ts         # 运行时探测 + 工厂
  ├─ web.ts           # DexieRepository
  └─ native.ts        # TauriSqliteRepository
src/                  # 其余全部不动
```

### 4.2 远期（等 `src/` 里出现大量 `if (isNative)` 时再抽，**现在不做**）

```
packages/core/         # types + repository 接口 + domain + agentOps schema
packages/ui/           # 组件 + 页面（平台无关）
packages/platform-web/ # Dexie + relay 桥 + PWA
packages/platform-native/
apps/web/  apps/desktop/  apps/mobile/
```

⚠️ 现在不要拆。2 人团队提前拆 workspace 只会增加构建与调试成本，且当前平台差异还很少。

---

## 5. 分阶段迁移

### 阶段 0 · 环境准备（不改代码）

- 安装 Rust（rustup）、目标平台 target；Android 侧装 JDK 17 + Android SDK + NDK
- 新增 devDependency：`@tauri-apps/cli`；runtime：`@tauri-apps/api`
- **拍板：桌面优先还是移动优先**（建议桌面优先 —— 构建链最短，能最快拿到可见成果）

> 破坏面：无。回滚：无。

### 阶段 1 · 只加壳，存储不动（**建议下一步就做**）

- `npx tauri init` 生成 `src-tauri/`
- `tauri.conf.json` 关键项：
  - `build.frontendDist = "../dist"`
  - `build.devUrl = "http://localhost:5173"`
  - `build.beforeBuildCommand = "npm run build"`
  - `identifier`、窗口默认尺寸、`bundle.targets`
- **继续使用 Dexie/IndexedDB**（WebView 支持），先证明「能构建 → 能安装 → 能跑 → 能同步」
- **停用 service worker**：原生环境里 SW 只会导致「代码改了界面没变」。按环境变量或 Tauri 探测结果跳过注册，Web 端行为不变
- 新增脚本：`app:dev` / `app:build` / `app:android`
- 验收：
  1. `npm run app:dev` 能起原生窗口，登录页与工作台正常
  2. `npm run app:build` 产出可安装包（macOS `.dmg` / Windows `.msi`）
  3. 完成一次真实同步（本地写入 → 测试站 PB 有记录）
  4. 现有 `npm test` / `npm run lint` / `npm run build` **保持全绿**

> 破坏面：**接近零** —— 只新增 `src-tauri/` 与 script，`src/` 一行不改。
> 回滚：删 `src-tauri/` + 还原 `package.json`。

### 阶段 2 · 存储抽象落地（真正的工作量在这里）

- 新建 `src/platform/`，实现三件事：
  - `web.ts` → 现有 Dexie 实现
  - `native.ts` → `TauriSqliteRepository`（`@tauri-apps/plugin-sql`）
  - `index.ts` → 运行时探测工厂
- `src/repositories/repository.ts` 的**接口保持不变**，只加实现与工厂 —— 这是既定设计的兑现，不是重构
- 数据迁移：首次启动时从 IndexedDB 全量导出 → 写入 SQLite，迁移完成前不启动同步
- 需要重做的部分（容易被低估）：**索引、事务语义、`updatedAt` 排序口径、`syncQueue` 表结构**
- 验收：`npm test` 全绿（现有测试基于 `fake-indexeddb`，需改成可注入实现）；原生端 CRUD + 同步全通

> 破坏面：中等（所有 repository 调用点要从「直接用 Dexie」改为「经工厂取」）。
> 回滚：双实现并存，工厂切回 `web` 即可。

### 阶段 3 · 原生能力补齐

| 能力 | 插件 | 备注 |
|---|---|---|
| 附件 / 凭证文件 | `tauri-plugin-fs` + `tauri-plugin-dialog` | Web 端仍走 File API |
| 通知与提醒 | `tauri-plugin-notification` | 替代 Web Notification |
| 全局快捷键（桌面） | `tauri-plugin-global-shortcut` | 对应设置页的快捷键 |
| 应用更新 | `tauri-plugin-updater` | 桌面端需要更新源 |
| 网络 | `tauri-plugin-http` 或保留 fetch | 需评估 CORS 与自托管证书信任 |

### 阶段 4 · 工程治理

- 目录抽象（见 §4.2），条件：`src/` 内平台分支开始变多
- CI 增加 app job；**CNB 现有 node 镜像不含 Android SDK**，需要自建镜像，或先本地出包、CI 后置
- 版本策略：Web 与 App 同一 tag；产物用 `v1.3.0`（Web）/ `app-v1.3.0`（App）区分

---

## 6. 风险与对策

| # | 风险 | 对策 |
|---|---|---|
| 1 | **手边没有手机** | Android 用模拟器，或出 apk 给同事装；iOS 无真机只能停在「构建通过」。**这会决定 App 线能验收到哪一步** |
| 2 | **Dexie → SQLite 被低估** | 阶段 1 与阶段 2 **必须拆开**；阶段 2 单独排期，先做迁移脚本 + 双实现并存 |
| 3 | **Agent 桥在原生下的语义** | 桥要求「页面在线且已在设置里启用桥」。桌面端可常驻；**移动端后台会被系统杀 → 是否保留桥需要拍板** |
| 4 | 附件历史数据 | IndexedDB 存 Blob vs 原生文件系统，迁移要单独写脚本并做校验（条目数 + 校验和） |
| 5 | PWA 缓存导致「改了没生效」 | 原生环境禁用 SW 注册（阶段 1 就做） |
| 6 | CNB 构建 Android 缺 SDK | 先本地出包，CI 后置；不要为它阻塞阶段 1 |
| 7 | 自托管证书 / HTTPS | 原生请求自签证书需要额外信任配置，测试阶段建议走已签发的正式域名 |
| 8 | 两端版本错配 → 静默数据问题 | 同仓同 commit 出包；发布时两端一起发 |

---

## 7. 本方案明确不做

- ❌ 不引入 React Native / Flutter（等于重写，复用率 < 30%）
- ❌ 不引入任何第三方云服务（与项目硬前提冲突）
- ❌ 阶段 1 **不改 `src/` 任何业务代码**
- ❌ 不在反向代理层加访问控制
- ❌ 现在不拆 npm workspaces（等平台分支变多再说）

---

## 8. 决策记录（2026-10-09 用户拍板）

| # | 问题 | 决策 |
|---|---|---|
| 1 | 先做桌面还是先做移动端？ | **桌面优先**（构建链最短、反馈最快） |
| 2 | 阶段 1 与阶段 2 是否合并？ | **拆开** —— 先拿到「能装能跑」的确定性，再换存储 |
| 3 | 移动端是否保留 Agent 桥？ | **不保留**。`relay` 只在 Web / 桌面生效；移动端 WebView 进后台会被系统回收，桥无法可靠工作 |
| 4 | App 构建进 CNB CI，还是先本地出包？ | **先本地出包**（CNB 现成 node 镜像不含 Android SDK，不为它阻塞阶段 1） |

## 9. 阶段 1 实施记录（2026-10-09）

### 落地内容

| 文件 | 变更 |
|---|---|
| `src-tauri/` | **新增** Tauri v2 壳（tauri-cli 2.12.1 / `@tauri-apps/api` 2.12.2）：`tauri.conf.json`、`Cargo.toml`、`capabilities/default.json`、图标全套（由 `public/pwa-icon-512.png` 生成，含 `.icns` / `.ico` / Android / iOS） |
| `scripts/vite-tauri-plugin.mjs` + `.d.mts` | **新增**：Tauri 构建时给页面 CSP 的 `connect-src` 追加 `ipc:` / `http://ipc.localhost`；锚点缺失时**直接让构建失败** |
| `vite.config.ts` | 注册 `tauriCspPlugin()` |
| `src/platform/env.ts` | **新增**：`isTauri()` / `isWeb()` 环境探测 |
| `src/main.tsx` | Service Worker 注册条件追加 `!isTauri()` |
| `package.json` | 新增 `app:dev` / `app:build` / `app:android` |
| `tsconfig.node.json` | `include` 补 `scripts/vite-tauri-plugin.d.mts` |

### 为什么需要那个 CSP 插件

`index.html` 的 CSP 是 `connect-src 'self' blob: https: http:`，而 Tauri v2 的 IPC 走 `ipc://localhost`（macOS/Linux）与 `http://ipc.localhost`（Windows），都不在放行范围内。漏掉不会报错，只会**静默失效**（界面正常、所有 `invoke` 被拦），所以放行项按构建环境注入，并在锚点缺失时让构建失败。

### 本机一次性环境

- **Rust 1.96.0**（`aarch64-apple-darwin`）—— 走**阿里云镜像**安装。官方 `static.rust-lang.org` 实测被限速到 ~37 KB/s（剩余 77 MiB 要 40 分钟以上），阿里云 1.82 MB/s、**25 秒完成**
- `~/.cargo/config.toml` 配 crates.io 镜像（rsproxy sparse）—— 否则 `tauri build` 拉数百 crate 会极慢
- `~/.zshrc` 追加 `. "$HOME/.cargo/env"`（安装时用了 `--no-modify-path`，不补的话 `npm run app:build` 找不到 cargo）
- ⚠️ 阿里云 rustup 镜像的 channel 清单略旧（装到 1.96.0，官方当时已是 1.99.0）；`Cargo.toml` 要求 `rust-version = "1.90"`，够用

### 验收结果

| 项 | 结果 |
|---|---|
| `npm run build` | ✅ 通过 |
| `npm test` | ✅ **671 passed / 6 skipped**，未回归 |
| `npm run lint` | ✅ 通过 |
| `npm run app:build -- --bundles app` | ✅ 产出 `Nexus Workspace.app`（8.91 MiB / arm64 / ad-hoc 签名 / Rust 编译 1m12s） |
| 包元信息 | ✅ `CFBundleIdentifier = fun.fpigeon.nexus`、版本 0.1.0 |
| 打包产物的 CSP | ✅ `dist/index.html` 含 `ipc: http://ipc.localhost` |
| 应用启动 | ✅ 进程存活、LaunchServices 已注册、WebKit 为该应用建好独立 origin 数据目录 |
| **页面是否正常渲染** | ⚠️ **未能独立确认**（读不到 GUI 画面）→ **仍待人工看一眼窗口**（2026-10-12 重打后未验，清单见 §11） |
| **原生端 IndexedDB 是否可用** | ✅ **已确认可用**：`IndexedDB.sqlite3` 落盘 94 KB，内含 4 个数据库 / **22 个对象库** / 87 条索引记录 → 阶段 2 保持「优化」定位，**不阻塞** |
| **一次真实同步** | ⏸ 未做 —— 待人工在客户端内填 **`https://team.fpigeon.fun`**（正式站）+ 账号密码后测（清单见 §11） |

### 遗留问题

1. **Agent 桥（relay）在桌面端不可用**：`relay` 由 Vite dev server / `scripts/serve.mjs` 提供，而 Tauri 生产包从 `tauri://localhost` 提供静态资源，**没有 HTTP 服务** → `/relay` 不存在。桥默认关闭（`settings.ai` 缺省关），所以不会报错，但桌面端若要保留桥，就得单独给它起一个本地 HTTP/WS 端点。**待拍板**。
2. ~~**`.dmg` 未打**~~ → **已打（2026-10-12）**：`npm run app:build -- --bundles dmg` 在图形会话下**一次成功**（3.76 MiB，`hdiutil verify` 通过）。注意**打 dmg 会把 `bundle/macos/` 下的 `.app` 清掉**，之后需补跑一次 `--bundles app`。详见 §11。
3. ~~**Android 未构建**~~ → **已构建（2026-10-27）**：release APK 已出包并验签，工程落盘与适配口径见 **§12**；仍**未真机验收**（构建机无设备、无 KVM）。
4. ~~**未提交**~~ → **已于 2026-10-10 提交并推送**（`20dac51`）。该 commit 同时含「Tauri 加壳」与「同步中心连通性探测」两条独立工作线 —— 违反 AGENTS.md §7「一次提交只做一件事」，系**并发会话合并工作区所致**；已推送，故不改写历史。
5. `productName` 用 ASCII `Nexus Workspace`（窗口标题与 PWA 名仍是中文）；若要让访达/程序坞显示中文名，需后续做本地化。

### 施工踩坑

- **构建脚本必须手写 `.d.mts` 并加进 `tsconfig.node.json` 的 `include`**：仓库既有约定（`vite-relay-plugin.d.mts` / `agent-setup.d.mts`）。漏了会让 `vite.config.ts` 引用 `.mjs` 时报 `TS7016`，**整个 `npm run build` 挂掉**。
- **沙箱内不能做跨工作区安装**：装 Rust 要写 `~/.cargo` / `~/.rustup`，在沙箱里会静默空转（本次白等了 1 小时），必须显式申请非沙箱执行。

---

## 10. 桌面端窗口生命周期（2026-10-09 追加）

### 需求（用户原话）

点窗口关闭按钮**不退出应用**：
- **macOS** → 收进菜单栏（状态栏）
- **Windows** → 收进系统托盘
- **Android** → **不接管**，交给系统自己的后台管理机制

### 为什么移动端刻意不接管

Android / iOS 的窗口生命周期由系统管（返回键、后台回收、电池优化白名单）。硬留一个「隐藏窗口」在移动端既没有产品意义，也不符合平台习惯。因此所有托盘/关闭拦截代码都带 `#[cfg(desktop)]`，移动端编译进去的就是一份「什么都不做」的壳。

### 实现（`src-tauri/src/lib.rs`）

| 位置 | 做了什么 |
|---|---|
| `on_window_event` | 拦 `WindowEvent::CloseRequested` → `api.prevent_close()` + `window.hide()`。桌面端点关闭不再退出应用 |
| `setup_tray` | `TrayIconBuilder`（id `main-tray`）：托盘图标 + 菜单「显示主窗口」/「退出寻鸽工作台」；`show_menu_on_left_click(false)` → **左键唤起窗口、右键出菜单**，macOS 与 Windows 手感统一 |
| `RunEvent::Reopen` | **macOS 专用**：窗口隐藏后点 Dock 图标唤回窗口。少了这段，「收进菜单栏」会变成一个点不回来的壳 |
| `Cargo.toml` | `tauri` 加 `features = ["tray-icon"]` |
| `tauri.conf.json` | 窗口显式加 `"label": "main"` —— `get_webview_window("main")` 依赖它，不依赖 Tauri 的默认 label |

### 为什么做成「常驻」而不是「关掉」

这是个常驻工作台：同步引擎跑 30s 心跳、Agent 桥要求页面在线。一关窗口就杀进程，会让「后台同步」彻底失效。真正退出走托盘菜单的「退出寻鸽工作台」，或 macOS 的 ⌘Q。

### 托盘图标（2026-10-09 二次修订）

第一版直接复用了应用图标（32×32 彩色）—— 在菜单栏里就是一块有色方块，与系统及其它应用的图标风格不搭。已改为**单色 template 图**：

| 项 | 做法 |
|---|---|
| 字形来源 | `public/favicon.svg` 的两条 path（白色主体 + 绿色叶子），合起来就是「芽 / 鸽」mark |
| 生成器 | `scripts/gen-tray-icon.py` —— 手工展平贝塞尔 + Pillow 多边形填充，**零第三方 SVG 渲染依赖**；超采样 4× 再 LANCZOS 降采样得到平滑边缘；**遇到未支持的 SVG 命令会直接报错退出**，避免 favicon 改了却悄悄生成过时图标 |
| 产物 | `src-tauri/icons/tray-icon.png`（22×22、透明底、不透明区纯 `#000`） |
| 渲染 | `Image::from_bytes(include_bytes!(...))` 编进二进制 + `icon_as_template(true)` → macOS 按菜单栏明暗主题自动渲染成白 / 黑 |
| 预览 | `src-tauri/icons/tray-icon-preview.png`（9× 放大、深/浅底对照，仅供 review，可删） |

⚠️ `tauri::image::Image` **只有 `rgba` / `width` / `height`，没有 DPI 字段** → 像素尺寸 = 点尺寸。菜单栏标准是 22pt，所以图标固定按 22×22 生成；视网膜屏上会被系统放大一点，属已知取舍。

### 其它取舍

- 窗口隐藏后 WebView 仍在运行，JS 定时器可能被系统节流，但 30s 心跳的粒度不受影响。
- 目前在 macOS 上**保留 Dock 图标**（点 Dock 可唤回）。若要「纯菜单栏应用」（不占 Dock），需把 activation policy 设为 `Accessory`。

### 验证状态

- ✅ 构建通过（20 秒、零 error 零 warning）、应用能启动
- ⏸ **交互行为待人工验证**：点关闭按钮是否真的收进托盘，需要手动点一次。键盘无法代点，且不该为验证擅自触发 AppleScript 的辅助功能授权弹窗。

---

## 11. macOS 收尾记录（2026-10-12）

### 产物

| 项 | 结果 |
|---|---|
| `Nexus Workspace.app` | ✅ **9.42 MiB** / Mach-O thin (arm64) / `Signature=adhoc` / `TeamIdentifier=not set` / `CFBundleIdentifier = fun.fpigeon.nexus` / 版本 0.1.0 |
| `Nexus Workspace_0.1.0_aarch64.dmg` | ✅ **3.76 MiB**；`hdiutil verify` → **checksum VALID**；挂载后含 `Nexus Workspace.app` + `Applications` 软链（标准拖拽安装布局） |
| 产物新鲜度证据 | ✅ 包内嵌资源名 `assets/index-DzzIBqeR.js` 与当前 `dist/assets/` **逐字一致** |

⚠️ **不要在 `.app` 二进制里 `strings \| grep` 校验 CSP**：实测对 `connect-src` / `default-src` 命中 **0**（Tauri 把资源压缩内嵌），只能查到资源名。**CSP 一律以 `dist/index.html` 为准。**

### 命令与三条不可省的判据

```bash
source "$HOME/.cargo/env"                 # ~/.cargo/bin 不在非交互 shell 的 PATH
npm run build                             # 硬判据：必须看到 ✓ built in <N>s
npm run app:build -- --bundles app        # beforeBuildCommand 会再跑一次 build（注入 TAURI_ENV_PLATFORM）
grep -o "connect-src 'self' blob: https: http: ipc: http://ipc.localhost" dist/index.html
npm run app:build -- --bundles dmg
npm run app:build -- --bundles app        # ← 补回被 dmg 清理掉的 .app
```

1. **`npm run build` 失败会静默留下上一版 `dist/`**（`check-icons` / `tsc -b` 挂掉时 `vite build` 根本不跑）→ **必须看到 `✓ built in` 才继续**。
2. **`--bundles` 必须显式传**：`bundle.targets: "all"` 在 macOS 上含 `dmg`，裸跑会顺带打 dmg。
3. **打 dmg 会清掉 `.app`**：日志里 `Running bundle_dmg.sh` 之后是 `Cleaning …/bundle/macos/Nexus Workspace.app`（实测 `bundle/macos/` 变空）→ 需要 `.app` 就得再补一次 `--bundles app`。

### dmg 卡死判别与兜底（本次未触发）

`bundle_dmg.sh` 用 AppleScript 驱动 Finder 排版，无图形会话时可能阻塞。**判别挂住**：`ps -axo pid,ppid,etime,%cpu,command | grep -Ei 'tauri|osascript|hdiutil'` —— 出现 `osascript` 且 **%CPU≈0、etime>90s、日志不再新增任何行** = 挂住。
**兜底**：① `CI=true npm run app:build -- --bundles dmg`（跳过 GUI 排版）；② `hdiutil create -volname "Nexus Workspace" -srcfolder "<app>" -ov -format UDZO <out>.dmg`（无 GUI 依赖，代价是没有拖拽箭头/背景图）。本次在图形会话下**一次成功**，走的是 Tauri 内置 create-dmg（`bundle/share/create-dmg`）。

### 分发出货口径

本客户端走 **ad-hoc 签名**（自用路径）：本机双击即开；拷到别的 Mac 后因带 quarantine，需**右键→打开**，或 `xattr -dr com.apple.quarantine "…/Nexus Workspace.app"`。
要给别人无感安装才需要完全签名 + 公证（`notarize` + `stapler`）+ hardened runtime，**当前不做** —— 项目自述「开发阶段、不可用于生产」，2 人团队自用不为此引入年费与流水线。`tauri.conf.json` 因此**未加任何 `bundle.macOS` 签名块**。

### 人工验收（**尚待执行**，键盘代替不了点击）

在**重打后的包**上逐项确认：

- [ ] 双击能起窗口、标题 `寻鸽工作台 · Nexus Workspace`、默认 1440×900；**工作台正常渲染**（不是白屏、不卡在"加载中"）
- [ ] 托盘**左键**唤起/聚焦窗口；**右键**菜单含「显示主窗口」「退出寻鸽工作台」
- [ ] 点关闭按钮 → 窗口收起、**应用不退出**（Dock 与托盘图标仍在）；点 **Dock 图标** → 窗口唤回；菜单退出 → 进程真退出
- [ ] 原生端**未注册 Service Worker**：`find ~/Library/WebKit ~/Library/Containers ~/Library/Application\ Support -iname '*ServiceWorker*' -path '*fpigeon*'` 期望**无输出**
- [ ] 原生端 IndexedDB 可用（`fun.fpigeon.nexus` 数据目录下有 `IndexedDB.sqlite3` 且含对象库）
- [ ] **一次真实同步**：设置 → 同步中心填 **`https://team.fpigeon.fun`**（**正式站，不是测试站** `http://8.153.19.221:9001`；且**地址每台设备本地各填一次、无编译期默认值**）→ 用正式站账号登录 → 新建/改一条记录 → 在 Web 端确认已落地

### 本机环境插曲（**非项目缺陷**）

一次 `npm run build` 以 `error during build: [safe-delete][SAFE_DELETE_BULK_GUARD_ERROR] state lock timeout` 失败，栈指向运行时注入的 `node-safe-delete-shim.cjs`（把 `fs.rmSync` 改成移入回收站）在 vite `emptyOutDir` 清理 `dist/` 时取锁超时。**同一命令在同一会话内已成功 4 次**（含两次作为 `app:build` 的 `beforeBuildCommand`）→ 属**环境侧**问题；遇到时重开一次运行上下文即可，**不要误判成项目回归**。




---

## 12. Android 客户端实施记录（2026-10-27，B 范围）

> 用户拍板：**走正式站 `https://team.fpigeon.fun`**（HTTPS，因此**不**放行明文 HTTP）、范围 = 「构建链 + 平台适配 + 可安装 APK」，**存储迁移（阶段 2）不在本轮**。

### 12.1 产物与判据（实测）

| 项 | 结果 |
|---|---|
| 产物 | `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk` |
| 体积 | **11 MB**（debug 包 141 MB，差异来自未裁剪符号与未优化） |
| 包名 / 版本 | `fun.fpigeon.nexus`（release 无 `.debug` 后缀）/ versionName `0.1.0`（取自 `package.json`）/ versionCode `1000` |
| SDK | minSdk **24** / targetSdk **37** / compileSdk **37** |
| ABI | 仅 `arm64-v8a`（未出 armv7 / x86_64） |
| 签名 | APK Signature Scheme **v2 通过**（自签 release 证书）；`apksigner verify` 输出 `Verifies` |
| 对齐 | `zipalign -c -v 4` → `Verification successful` |
| 资源新鲜度 | 包内 `.so` 内嵌 `assets/index-CaN84uyD.js` 与 `dist/assets/` **同名同哈希**（与 macOS 的判据一致） |

### 12.2 工具链（本机实测版本）

JDK **17**（Dragonwell 17.0.19）· Android SDK：`platforms;android-37.0` + `build-tools;37.0.0` + `platform-tools` · NDK **27.0.12077973** · Rust **1.96.0** + `aarch64-linux-android` / `armv7-linux-androideabi` / `i686-linux-android` / `x86_64-linux-android` · Gradle **9.6.1**（Tauri 模板自带 wrapper）。

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-...
export ANDROID_HOME=$HOME/Android/Sdk        # 或 /opt/android-sdk
export NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973

npm run app:android -- --target aarch64 --apk   # release
npm run app:android -- --target aarch64 --debug # debug（包名带 .debug，可与正式包共存）
```

### 12.3 工程落盘

`src-tauri/gen/android/` **入库**（这是后续定制图标、Manifest、签名的唯一入口）。已被 `.gitignore` 挡掉、不会入库的：`build/`、`src/main/**/generated`、`src/main/jniLibs/**/*.so`、`assets/tauri.conf.json`、`keystore.properties`、`tauri.properties`。

### 12.4 必须改的一处（否则 Gradle 报错看不懂）

Gradle 的 `:app:rustBuildArm64Release` 执行的是 **`npm run -- tauri android android-studio-script`**，读根 `package.json` 的 `tauri` 脚本。本仓是**手工加壳**，原本没有这个脚本 → 失败信息只有 `Process 'command 'npm'' finished with non-zero exit value 1`，真正的 `Missing script: "tauri"` 藏在上面几十行。已补：

```json
"tauri": "tauri"
```

⚠️ 另一个坑：`tauri android android-studio-script` **不能脱离 `tauri android build` 单独跑**（它要读 `gen/android/.tauri/cli-options-server.json`）。所以**不要**指望用 `./gradlew app:assembleRelease` 绕开 CLI —— 要么走 `npm run app:android`，要么在 Android Studio 里由 CLI 会话拉起。

### 12.5 平台适配清单（B 范围）

| 项 | 做法 | 为什么 |
|---|---|---|
| 安全区 | `MainActivity` 给 `android.R.id.content` 监听 `systemBars + displayCutout` 并加 padding | `targetSdk 35+` **强制 edge-to-edge**，WebView 会铺到状态栏/手势条下；`env(safe-area-inset-*)` 在 Android WebView 不可靠，故原生侧兜底 |
| 键盘 | Manifest `android:windowSoftInputMode="adjustResize"` | 不加则输入框会被键盘遮挡（登录页首当其冲） |
| 返回键 | **零代码**：Wry 的 `OnBackPressedCallback` 已实现 `canGoBack() → goBack()`，栈底才交回系统退出 | 与 react-router 的 history 天然一致；不要重复注册回调 |
| 文件选择 | **零代码**：`RustWebChromeClient.onShowFileChooser` 已实现 | 附件/凭证上传直接可用 |
| 明文 HTTP | **刻意不做**：release `usesCleartextTraffic=false` | 走正式站 HTTPS；测试站是明文 HTTP，真要联调请出 **debug** 包（模板已默认放行 debug） |
| 图标 | `tauri icon` 已生成全套 mipmap | 未改视觉 |
| 闪屏 | 用 Android 12+ 默认（图标 + windowBackground） | 未引入额外依赖；深色模式下与 App 内主题可能不一致，属已知小瑕疵 |

### 12.6 签名与分发口径

- 密钥与口令**只在仓库外**：`~/.workhub/android/nexus-release.jks` + `keystore.properties`（`chmod 600`）。
- `gen/android/keystore.properties`（gitignore）不存在时，**release 仍能构建，但产物未签名**（装不上）。这是刻意的：CI / 别人的机器不会因为缺密钥而挂。
- 安装：`adb install -r app-universal-release.apk`；或拷到手机点击安装（需允许「未知来源」）。
- 分发走**自用**，不做 AAB、不上架、不做 Play 签名托管。

### 12.7 未验证 / 已知限制（如实标注）

1. **未做真机验收**：构建机无 Android 设备、无 `/dev/kvm`（模拟器起不来）→ **安装、首启、登录、同步四项都还没被真机点过**。下一步必须在一台 arm64 真机上走一遍：设置 → 同步中心填 `https://team.fpigeon.fun` → 登录 → 新建一条记录 → Web 端确认。
2. **系统返回键栈底会退出 App**（Wry 默认行为）；若将来要「栈底二次确认退出」，需在前端监听 `back-button` 事件（Wry 已预留）。
3. **后台同步不可靠**：Android 会冻后台 WebView，30s 心跳在后台基本停摆；打开 App 时会补拉，属已知取舍（与「移动端不保留 Agent 桥」同源）。
4. **仅 arm64**：老设备（armeabi-v7a）与 x86_64 模拟器装不上；需要时加 `--target` 重出。
5. **存储仍是 Dexie**：阶段 2 的 SQLite 迁移未做，WebView 的 IndexedDB 仍可用（macOS 已实证）。
6. **构建很慢**：2 核构建机首次 release 约 30~40 分钟（Rust 全量 + Gradle 依赖），增量 2~5 分钟；Gradle 发行包下载**不会自动续传**（中断即从 0 开始），必要时用 `curl -C -` 预置到 wrapper 缓存。

### 12.8 CNB 上出包（仅在打 tag 时）

> 目标：不用本机也能出 APK。**只在 `v*` tag 触发**——一次构建约 1~1.5 核时，每次 push 都跑会吃掉 160 核时/月 的免费额度。

#### 三个文件

| 文件 | 作用 |
|---|---|
| `.cnb/android/Dockerfile` | 构建环境镜像：JDK 17 + Android SDK/NDK + Rust + Node |
| `.cnb.yml` 的 `.android-builder-image` | 仅当上面 Dockerfile 变更时重建镜像（main push 触发） |
| `.cnb.yml` 的 `.android-apk` | tag 流水线：写入签名 → 构建 → 建 Release → 挂 APK |

#### 为什么钉 SDK 36

腾讯云镜像站（`mirrors.cloud.tencent.com/AndroidSDK/`，国内 CI 可达）**只同步到 `platforms;android-36`**，37 只能走 `dl.google.com`（国内不可达）。因此把 `compileSdk`/`targetSdk` 钉到 36，全链路可走镜像。36 与 37 对本应用无行为差异（edge-to-edge 自 35 起强制）。

⚠️ 将来镜像站补齐 37、或 CI 能稳定访问 Google 时，两处一起升：`.cnb/android/Dockerfile` 的 `sdkmanager` 参数 + `gen/android/app/build.gradle.kts`。

#### Gradle 发行包

`gradle-wrapper.properties` 的 `distributionUrl` 改为腾讯镜像
`https://mirrors.cloud.tencent.com/gradle/gradle-9.6.1-bin.zip`（已验证可下；官方地址会 302 到 GitHub，国内 CI 大概率失败）。

#### 密钥：需要人工在 CNB 网页做一次

在密钥仓库 `blueteam0715/keystore` 新建 `android-signing.yml`：

```yaml
ANDROID_KEYSTORE_B64: "<nexus-release.jks 的 base64，一行>"
ANDROID_KEY_ALIAS: "nexus"
ANDROID_KEY_PASSWORD: "<keystore.properties 里的 password>"
```

- 生成 base64：`base64 -w0 ~/.workhub/android/nexus-release.jks`
- 密钥仓库禁止本地 clone，只能在网页编辑
- **不要把 jks 或密码提交进本仓库**；`gen/android/keystore.properties` 已被 gitignore

#### 首次启用顺序（顺序错了 tag 会失败）

1. 把 `.cnb/android/Dockerfile` 与 `.cnb.yml` 推到 `main` → 触发镜像构建（约 10~15 分钟，8~10 GiB 上传）
2. 在 CNB 确认镜像已出现在制品库：`docker.cnb.cool/blueteam0715/workhub/android-builder:latest`
3. 打 tag：`git tag v1.2.2 && git push origin v1.2.2`
4. 构建完成后，Release 页会出现 `app-universal-release.apk` 附件，手机直接下载安装

#### 额度

| 项 | 估算 |
|---|---|
| 单次 tag 构建 | 1~1.5 核时（4 核 × 15~20 分钟，冷缓存） |
| 有缓存 | 约 0.5 核时 |
| 镜像 | 占对象存储 8~10 GiB（一次性） |
| 免费额度 | 160 核时/月；按 tag 触发，一个月几个版本，占用可忽略 |

#### 未验证项（如实标注）

- **本地打包只走单 ABI**：`assembleUniversalRelease` 会逐个编 4 个 ABI（arm/arm64/x86/x86_64），2 核机上 >20 分钟；单 ABI 实测 **6 分 17 秒**。Rust 产物已存在时用
  `./gradlew app:assembleArm64Release -x rustBuildArm64Release`（`-x` 的前提是 `jniLibs` 里已有 `.so`，否则会打出没有原生库的空壳）。
- **CNB 网络未实测**：镜像站可达性是在本机（阿里云）验证的，与 CNB 构建节点可能不同；首次镜像构建若卡在 `sdkmanager`，把 `ANDROID_SDK_MIRROR` 换成清华/阿里源再试。
- **Release 附件需要 release 已存在**：流水线已加 `git:release` 在前，顺序不要调换。
