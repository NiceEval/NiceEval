# Materialization Cache 生命周期

下游题组常让多道 Eval 从同一个 GitHub repository 的不同 base commit 开始。
官方 `checkout({ repository, commit })` API 让这些 Eval 在宿主复用已经下载的 Git objects，只补齐切换 commit 所缺的部分，不再为每道题完整 clone。
每条 Attempt 仍取得全新 `.git`，并且只能读取自己 base commit 及其祖先。

NiceEval 会在宿主准备 Agent artifact、任务 image、Git repository 投影和 Provider 原生 build cache。
这些供给可以跨 Run 加速准备，但不属于 Eval 结果携带，也不属于留存 Sandbox。

本功能让 NiceEval 创建并长期保留的供给可发现、可解释、可安全回收。
任何受管资源都必须说明精确需求、不可变身份、活动 lease 与删除证据；不能满足这些条件的临时资源只能采用 DestroyOnly 生命周期。

## 两个问题面

- **选择需求**回答冻结的 Experiment × Eval 需要哪些精确 key、哪些已经就绪、哪些缺失。
- **Domain 库存**回答一个 backend 上实际存在什么、由谁创建、谁正在使用，以及哪些满足回收策略。

“不在本次选择中”不等于“可以删除”。
选择需求不得把其它项目的冷缓存判成垃圾，Domain 回收也不得靠加载某个项目的代码猜全局引用。

## Git repository 的双实体

同一个 Git repository 的复用分成两个实体：

- SourcePool 是宿主私有、可增长的 acquisition 状态，永不成为 Sandbox consumer。
- SourceProjection 是针对一个 commit 发布的不可变安全投影，也是 checkout 唯一交付给 Sandbox 的材料。

这项边界的选型依据见 [Git repository 安全交付 Design](../../design/git-source-materialization/README.md)。
作者只使用 [Library](library.md) 中的 `checkout({ repository, commit, into? })`；cache key、pool 与 projection 没有公开开关。

## 状态词表

| 状态 | 含义 | 删除行为 |
|---|---|---|
| `required-present` | 当前选择的精确 key 已存在 | 保留 |
| `required-missing` | 当前选择需要该 key，但库存没有 | 后续会产生写入 |
| `active-leased` | 正被 Run、构建操作或留存实例使用 | 禁止删除 |
| `cold-reusable` | 不在活动 lease 中，仍可被兼容请求命中 | 仅按显式容量策略回收 |
| `evictable` | 满足 Domain 策略且删除前复核仍成立 | 可由 `gc --apply` 删除 |
| `legacy` | NiceEval 能识别命名，但缺少受管清单 | 不自动删除 |
| `foreign` | 不属于 NiceEval | 不操作 |
| `unverified` | 清单、backend 或 lease 无法验证 | 不自动删除 |

## 范围

V1 管理宿主 Agent artifact、任务 build image、Git SourcePool、Git SourceProjection 与 DestroyOnly 临时资源。
Agent artifact 与 SourceProjection 从宿主内容寻址存储注入 Sandbox，不创建 task × Agent image，也不把 SourcePool mount 给 Sandbox。

共享 Docker BuildKit cache 只作为 `unverified` 容量事实展示，不自动 prune。
Sandbox 实例的停驻和销毁归 [Sandbox 默认停驻与回收](../sandbox-retention/README.md)，执行容量归 [Docker 执行配置](../docker-profiles/README.md)。

- [Library](library.md) 定义 checkout 的作者调用面。
- [CLI](cli.md) 定义需求、库存与回收命令。
- [Architecture](architecture.md) 定义 manifest、Domain、SourcePool、SourceProjection、lease 与删除不变量。
- [Lifecycle](lifecycle.md) 定义从 planning 到每 Attempt 交付和回收的完整时序。
- [Use Case](use-case/README.md) 用完整示例展示不同题组怎样声明与运行。
