# pb_setup · 寻鸽工作台自托管 PocketBase 服务端套件

本目录包含前端同步功能所需的全部服务端物料。数据真源是一台由你自己掌控的云服务器上的 PocketBase（单二进制 + SQLite），不依赖任何第三方云服务。

| 文件 | 用途 |
|---|---|
| `collections.json` | 14 张 collection 定义（13 张业务镜像表 + `sync_state` 预留），可直接导入 |
| `pb_hooks/main.pb.js` | 可选 JS 钩子：server_received_at 服务端兜底盖戳 + tombstonePushed 墓碑标记 + 每日墓碑 cron 清理 + 简单共享令牌校验示例 |
| `backup.sh` | SQLite 主库 + 附件目录的定时备份脚本（含恢复方法与 cron 示例） |

完整云服务器部署步骤（systemd / Nginx / HTTPS）见 **docs/部署指南.md**，本文件只讲 PocketBase 自身。

## 1. 安装与启动

```bash
# 1. 下载（替换为 docs/部署指南.md 校对时的最新版本号）
PB_VERSION=0.28.0
wget https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip
unzip pocketbase_${PB_VERSION}_linux_amd64.zip -d /opt/nexus/pocketbase
cd /opt/nexus/pocketbase

# 2. 把本套件就位
cp -r pb_setup/pb_hooks /opt/nexus/pocketbase/      # 可选钩子
cp pb_setup/backup.sh /opt/nexus/pocketbase/

# 3. 创建管理员（超管，仅用于管理后台，不是同步账号）
./pocketbase superuser create admin@example.com <你的管理员密码>

# 4. 启动（生产环境用 systemd 托管，见部署指南）
./pocketbase serve --http=127.0.0.1:8090
```

要求 PocketBase **>= 0.23**（collections.json 使用新版 fields 字段结构；主键为 text 类型，直接沿用前端 `ws-main:xxx:nanoid` 形态的记录 id，两端天然对齐）。

## 2. 导入 collections（两种方式任选）

**方式 A · 管理后台导入（推荐）**

1. 打开 `http://<服务器IP>:8090/_/`，用超管账号登录；
2. Settings → **Import collections**；
3. 粘贴 `collections.json` 全文 → 确认导入（会列出新增的 **19 张业务表**，confirm 后落库）。

> ⚠️ **`collections.json` 只含业务集合（19 张），不含认证集合 `users`** —— 而前端登录用的就是这个 `users`（见第 3 节）。
> 它不在文件里的原因是：它是 PocketBase 的**标准认证集合**（`type: auth`），字段基本是内置的
> （`email` / `password` / `tokenKey` / `verified` …）；`username` 是首启时 best-effort 补的**展示字段**，
> 不参与登录。故当初没有纳入快照。
> **重建环境时务必先建它**（管理后台 → New collection → **Auth**，名称填 `users`），
> 并按下表核对四项设置 —— 少一项都会让登录链路断掉：
>
> | 项 | 线上实测值 |
> |---|---|
> | `passwordAuth` | `{ enabled: true, identityFields: ["email"] }`（登录标识**只有 email**；用户名在前端补成 `<用户名>@workhub.local` 再提交） |
> | `listRule` / `viewRule` / `updateRule` / `deleteRule` | `id = @request.auth.id`（仅本人可读写） |
> | `createRule` | 空（不允许自行注册；首个账号由首启引导 `/setup/user` 用**超管凭据**创建） |
>
> ⚠️ **不要给 `identityFields` 加 `username`**（2026-11-02 修正）：PB 0.40 的文本字段没有 UNIQUE 约束，
> 加进去会被 `validation_missing_unique_constraint` 拒绝。登录走邮箱映射，所以登录框写「用户名或邮箱」
> 仍然成立；`username` 字段只用于展示，不参与登录。
> **已有部署无需做任何 patch**；旧的 `patch:users-auth` 脚本已删除（它按旧口径写 `identityFields`，
> 在 0.40 上会失败）。
>
> 演示账号 `demo@nexus.local` 与各成员的同步账号都落在这一集合里。
>
> 之所以**不把它写进 `collections.json`**：部署脚本在「schema 有变更」时会导入该文件，
> 一旦把认证集合的快照并进去，将来线上对登录设置做的任何调整都会在下次 `--full` 部署时**被快照回滚**。
> 宁可在这里写清楚，也不给未来埋一个「部署把登录设置冲掉」的坑。

**方式 B · pb migrate（命令行）**

`pb migrate` 的标准用法是基于当前库生成迁移文件或执行已有迁移：

```bash
cd /opt/nexus/pocketbase
# 若你选择手写迁移，可执行后按提示在 pb_migrations/ 生成空模板，
# 参照 collections.json 里的字段定义用 $app.newCollection() 填写 19 张业务表
# （另有认证集合 users 需单独创建，见上方 ⚠️ 说明）
./pocketbase migrate create init_sync_collections
./pocketbase migrate up     # serve 启动时也会自动执行未应用的迁移
```

> 推荐方式 A：collections.json 已经是可直接导入的完整定义，无需手写迁移代码。

## 3. 创建同步账号

前端通过 PocketBase 内置 `users` collection 鉴权：

1. 管理后台 → Collections → `users` → New record；
2. 填入邮箱/密码（前端设置页要填的账号密码就是它）；
3. 每个使用同步的成员各建一个账号（本期语义：2 成员 × 多端登录同一份团队数据）。

## 4. 验证

```bash
# 健康检查
curl http://127.0.0.1:8090/api/health

# 用同步账号登录（返回 token 即鉴权链路 OK）
curl -X POST http://127.0.0.1:8090/api/collections/users/auth-with-password \
  -H 'Content-Type: application/json' \
  -d '{"identity":"you@example.com","password":"<同步账号密码>"}'

# 空表列表（应返回 200 与空 items）
curl 'http://127.0.0.1:8090/api/collections/todos/records?perPage=1' \
  -H "Authorization: <上一步的token>"
```

然后在前端：设置 → 云端同步 → 填服务器地址与账号 → 「保存并连接」→「全量推送」。

## 5. 备份与恢复

```bash
chmod +x backup.sh
./backup.sh                                   # 手动执行一次
crontab -e                                    # 加入定时（每 4 小时）
# 0 */4 * * * /opt/nexus/pocketbase/backup.sh >> /var/log/nexus-backup.log 2>&1
```

恢复步骤已写在 `backup.sh` 底部注释：停服务 → 拷回 `data.db`（删 `-wal/-shm`）→ 拷回 `storage/` → 起服务。
