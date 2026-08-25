# Provider Cache 生命周期

NiceEval 会为 Sandbox 准备 Agent npm tarball、任务 image 和 provider 原生 build cache。
这些 cache 可以跨 Run 加速准备，但不属于 Eval 结果携带，也不属于留存 Sandbox。
创建者若只会写入而不会解释和回收，用户最终只能把整套 Docker cache 一次删光。

本功能把 provider cache 视为 NiceEval 管理的供给，而不是无名的 Docker 垃圾。
任何由 NiceEval 创建并长期保留的 image、template、snapshot 或 npm tarball 都必须可在库存中发现、说明命中依据，并由 NiceEval 给出安全回收路径。
不能满足这三个条件的临时容器与临时文件只能采用 DestroyOnly 生命周期。

## 两个问题面

- **选择需求**回答冻结的 Experiment × Eval 选择现在需要哪些精确 cache key，哪些已经就绪，哪些缺失。
- **Domain 库存**回答一个 provider backend 上实际存在什么、由谁创建、是否有 lease，以及哪些满足回收策略。

“不在本次选择中”不等于“可以删除”。
选择需求不得把其它项目的冷缓存判成垃圾；Domain 回收也不得靠加载某个项目的代码来猜全局引用。

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

旧配方镜像若能由当前完整 key 算法精确证明永远不会命中，可以生成具名的兼容删除建议。
这类建议仍默认预览，不把镜像创建时间、容器引用数或 repository 名单独作为删除授权。

## 范围

V1 管理 NiceEval 拥有的宿主 Agent artifact cache、任务 build image，以及其 DestroyOnly 临时资源。
Agent 安装固定从宿主内容寻址 cache 注入 Sandbox，不创建 task × Agent image。
共享 Docker BuildKit cache 只作为 `unverified` 容量事实展示，不自动 prune。
Setup Prefix 的普通 Docker exact-image cache 是执行期优化，不进入本页的 Domain 库存、lease、精确失效或 GC 协议。

Sandbox 实例的停驻和销毁归 [Sandbox 默认停驻与回收](../../sandbox-retention/README.md)。
执行容量、reservation 与 admission 归 [Docker 执行配置](../../../feature/sandbox/docker-profiles/README.md)。

- [CLI](cli.md)定义需求反馈，以及 Docker feature 自己拥有的库存与回收命令。
- [Architecture](architecture.md)定义 Cache Manifest、Domain、lease 和删除不变量。
- [并行运行的共享任务镜像](use-case/并行运行的共享任务镜像.md)定义多个 Attempt 怎样等待、命中和复用少量 BuildKey。
- [Setup 前缀缓存](../setup-prefix/README.md)定义 Provider ready 后的身份、执行与支持边界；它不进入本页库存。
- [回收过期任务镜像](use-case/回收过期任务镜像.md)定义 task-build image 的安全淘汰路径。
- [盘点共享 BuildKit 缓存](use-case/盘点共享BuildKit缓存.md)定义未验证容量怎样展示，以及用户自行回收的责任边界。
