# CNB → GitHub 单向镜像

> 一句话：`cnb.cool/blueteam0715/workhub` 是**唯一主仓库**；每次 push 到 `main`（外加每日 03:00 兜底）自动把
> `main` 分支与全部 tag 镜像到私有仓库 `github.com/yingshu0218/workhub`。GitHub 侧是**只读副本**，不要在那里提交。

## 配置在哪

| 东西 | 位置 |
|---|---|
| 流水线定义 | 仓库根 `.cnb.yml` |
| GitHub 写入凭据（PAT） | CNB **密钥仓库** `blueteam0715/keystore` 的 `github-sync.yml` |
| 目标仓库 | `https://github.com/yingshu0218/workhub.git` |

**凭据为什么不在这个仓库里**：密钥仓库禁止 clone 到本地、禁止本地 push，只能网页编辑 —— PAT 不会出现在任何人的磁盘上。
`.cnb.yml` 里只写变量名 `${GIT_USERNAME}` / `${GIT_ACCESS_TOKEN}`，由 `imports` 在构建时注入。

> ⚠️ 变量优先级是「仓库 CI 环境变量 > `env` > `imports`」。所以 `.cnb.yml` 里**绝不能**再定义同名的 `env`，否则会压过密钥仓库的值。

### 密钥仓库文件照抄（`github-sync.yml`，放仓库根目录）

```yaml
GIT_USERNAME: yingshu0218
GIT_ACCESS_TOKEN: <GitHub PAT>

allow_slugs:
  - blueteam0715/workhub
```

> ⚠️ **绝对不要在这里声明 `allow_images`** —— 踩过一次（构建 `cnb-p0g-1k4fe3p6p`）：
> 一旦声明 `allow_images`，CNB 就认为该文件**只能被「插件任务」引用**，而本项目把 `imports` 放在 **pipeline 级**
> （因为 `verify-github-mirror` 是脚本任务，也要用这两个变量），于是 `Prepare` 阶段直接失败：
>
> ```
> Pipeline init error: The file: ... declares allow_images and can only be referenced by plugin tasks.
> ```
>
> 官方两个示例也印证了这条：环境变量引用那节给的例子**只有 `allow_slugs`**（配 pipeline 级 `imports`）；
> 带 `allow_images` 的例子配的是**插件任务自己的 `imports`**（npm 插件）。
> 只留 `allow_slugs` 时，引用范围已经锁死到本仓库，安全性足够。

## 流水线结构

```
main:
  push:                      -> 同一条流水线
  "crontab: 0 3 * * *":      -> 同上（YAML 锚点 .mirror-to-github + <<: 合并键引用，不复制两遍）
```

一条流水线含三个 stage，顺序执行：

1. `ensure-local-main` —— `git checkout -B main HEAD`。
2. `sync-to-github` —— 官方 Git Sync 插件（`tencentcom/git-sync`）：`branch: main` + `push_tags: true` + `force: true`。
3. `verify-github-mirror` —— 读 GitHub 真实 ref，与本次 HEAD 比对，不一致就 `exit 1`。

## 为什么有 ①③ 两个「多余」的 stage

读插件 `entrypoint.sh` 源码发现：指定 `branch: main` 时，它的判据是

```sh
if git rev-parse --verify "$PLUGIN_BRANCH" >/dev/null 2>&1; then
  git push target "$PLUGIN_BRANCH" ...
else
  echo "Warning: Branch $PLUGIN_BRANCH does not exist locally, skipping push"
fi
```

**本地没有 `main` 引用时它只打印一句 Warning，然后 `exit 0`** —— 流水线全绿，GitHub 上什么都没有。
这是本仓库最忌讳的「假阳性成功」，所以：

- `ensure-local-main` 显式建出本地 `main` 引用，让那个 `else` 分支永不成立；
- `verify-github-mirror` **不信任插件退出码**，直接读远端真实 SHA 比对 —— 这是唯一不依赖插件行为的判据。

同理，`lock`（`wait: true`）是用来防「连续两次 push 触发并发 force-push，若旧构建最后落地则 GitHub 静默停在旧提交」。

## 故意没做的事

- **不用 `tag_push` 事件触发**：tag_push 检出的是该 tag 所在提交，`ensure-local-main` 会把 `main` 重置到那个（可能更旧的）
  提交并 force-push，**会把 GitHub 的 main 推回退**。tag 同步由「每日兜底 + 通常伴随 push」覆盖。
- **不推 `auto/*` 等临时分支**：`branch: main` 是显式指定；若删掉它，插件会执行 `git push --all`，把远端 70+ 个临时分支全推上去。

## 出问题怎么查

| 现象 | 先看 |
|---|---|
| 流水线绿但 GitHub 没更新 | 不可能 —— 校验 stage 会转红。若真出现，说明校验 stage 也被跳过了，先看构建日志里有没有走到第 3 个 stage |
| `verify` 转红 | 构建日志里会打印 `CNB HEAD=` 与 `GitHub main=` 两个 SHA，对比即可判断是没推上去还是推错了 |
| 认证失败 | 密钥仓库 `github-sync.yml` 里的 PAT 是否过期；PAT 权限是否够（私有仓库需 classic `repo` 或 fine-grained `Contents: RW`） |
| `Prepare` 阶段失败，报 `GetFileContent: not found` | 密钥仓库里**文件不存在或路径不对**。核对：文件名一字不差 `github-sync.yml`、放在**仓库根目录**（不是子目录）、在 `main` 分支上。也可直接在浏览器打开那个 imports URL 看 |
| `Prepare` 阶段失败，报 `declares allow_images and can only be referenced by plugin tasks` | 密钥仓库文件里**删掉 `allow_images`** 整段（见上文「密钥仓库文件照抄」） |
| `imports` 取不到变量（变量为空/字面量） | 密钥仓库是否声明了 `allow_slugs: blueteam0715/workhub`；引用者是否对密钥仓库有读权限 |
| 推送**偶发**失败，报 `Post .../info/lfs/locks/verify: EOF` | 插件每次都会 `git lfs install` 装上 pre-push 钩子，该钩子会去调远端 LFS 锁定 API；本仓库**没有任何 LFS 文件**，纯属被拖累。已在 `ensure-local-main` 里 `git config lfs.locksverify false` 关掉它（写进 `.git/config`，与插件容器共享同一工作区，无需额外提交 `.lfsconfig`），并给 `sync-to-github` 加了 `retry: 2` —— 该任务幂等（force 推同一提交），重试安全 |
| `verify` 转红但插件日志显示推送成功 | 极少见；`verify` 打印的 `CNB HEAD` 与 `GitHub main` 两个 SHA 会直接给出答案。注意 GitHub 有推送延迟时一般不会导致不一致（`ls-remote` 读的是已确认的 ref） |

## 已知的偶发失败（不是配置问题）

推 GitHub 走公网，实测遇到过**一次** `Post .../info/lfs/locks/verify: EOF`（LFS 锁定 API 的偶发失败），
随后重跑即成功、未能稳定复现。处置：关掉 LFS 锁校验 + 任务级 `retry: 2`。
真出现持续失败时，不要急着改配置，先看是不是 GitHub 侧故障。
| 定时同步不再执行 | CNB 仓库页「定时任务」看负责人：定时任务以**最后修改并推送该 crontab 配置的用户**身份执行，该用户被移出仓库任务即失败 |

## 怎么临时停掉

删掉或注释 `.cnb.yml` 里 `main:` 下的两个触发器并 push；或在 CNB 上直接停用该流水线。
**不要**为了停同步去改写 git 历史。

## 验收（改完配置后照这个查）

```bash
# 1. 两边 main 必须同 SHA
git ls-remote https://github.com/yingshu0218/workhub.git refs/heads/main
git ls-remote origin main

# 2. 全部 tag 都在且指向一致（annotated tag 会有 ^{} 行，两边都要对上）
git ls-remote --tags https://github.com/yingshu0218/workhub.git
git ls-remote --tags origin

# 3. 反向校验：GitHub 上不该有 auto/* —— 只应出现 main
git ls-remote --heads https://github.com/yingshu0218/workhub.git
```
