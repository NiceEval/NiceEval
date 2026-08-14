# Git 检出隔离

源码检出是一次有破坏性的 Sandbox prepare。它必须把精确的 Git 内容交给 Agent，同时不能把 branch、tag、cache、credential、旧 worktree 或另一个 Attempt 的状态一并交出去。

本 Roadmap 以精确 commit 取代可移动 ref。checkout 只交付声明 commit 的可达历史与该历史所需对象，并把 cache、credential 和 staging 留在 Agent namespace 之外。

## 解决的 Frog / DX

Frog 中的检出摩擦来自不稳定 ref、难以解释的 mirror 命中、复用 Sandbox 中的脏工作树，以及 Agent 可观察到的远端配置与凭据痕迹。作者无法从一次失败判断拿到的是哪一个源版本，也无法确认隔离是否真实发生。

checkout 让作者只声明仓库、commit 和目标目录。命令收敛其余 Git 操作，并在失败时给出精确的阶段与修法，而不是把通用资源、未封装 clone 或 cache 路径暴露给 Eval。

## 核心心智

checkout 是 SandboxLayer 的 StableSandboxCommand，不是 generic Resource，也不是 test 期 clone API。它拥有一个目标目录，并在每次 Attempt 开始时破坏性地替换该目录为精确 commit 的干净 detached checkout。

cache 只服务同一物理 Sandbox 内的命令执行。它不在 Agent namespace、不会作为 mount 或 Git alternate 暴露，也不跨 Sandbox、Provider、Run 或机器共享。

Agent 可见 Git 历史只包含声明 commit、其全部祖先以及这些 commit 可达的 tree 与 blob。远端 refs、tags、工作分支、cache 中的其它对象、credential 配置和远端凭据都不进入 Agent 可见 checkout。

prepare 失败由 command receipt 以稳定 code 公开。目标归属或删除分别是 `checkout.target-ownership-failed` 与 `checkout.target-cleanup-failed`。

credential 不可用或被拒绝分别是 `checkout.credentials-unavailable` 与 `checkout.credentials-rejected`。其它远端问题是 `checkout.transport-failed`；完整集合与对应安全修法见 [Library](library.md)。

## 范围

本方向包含：

- checkout 的精确 commit API、目标目录所有权与破坏性替换；
- 私有 object cache、private staging、credential 隔离与并发锁；
- detached HEAD、祖先闭包、无 alternates、clean worktree 的验证；
- 对 submodule 与 Git LFS 内容的明确拒绝；
- 既有 dry command plan、执行 receipt 与 show 审计。

本方向不包含：

- generic Resource、跨 Provider cache、可恢复的 Git workspace 或 test 期 clone API；
- 浮动 branch、tag、短 SHA、任意按 ref 名查找或由运行结果补写的 commit；
- 自动初始化 submodule、Git LFS 下载、将 credential 交给 Agent 或为它配置 remote；
- 新的 Assertion、CLI 命令或 flag。

## Assertion 决策

checkout 不新增 Assertion。它的公开 owner 是 Eval 或 Experiment SandboxLayer 的 prepare 链；成功、失败与隔离验证属于 sandbox.prepare.<owner> command receipt。

t.sandbox 不得到 checkedOut、cloneRepo、Git cache 或 credential 入口。判定 Agent 完成任务继续使用既有 Sandbox、diff 与 Assertion 契约。

## 所有权与身份

| 事实 | owner | identity |
| --- | --- | --- |
| repo、commit、into 声明 | SandboxLayer command | 规范化 repo + full commit + into |
| private object cache 与 fetch lock | 当前物理 Sandbox | 规范化 repo + full commit |
| staging、目标目录与删除 receipt | Attempt | attemptId + command occurrence |
| Git credentials 与 transport material | runner / provider private boundary | 不进入公开 identity 或 Record |
| Agent 可见 checkout | Agent workspace | 精确 commit 的验证过对象闭包 |

into 影响命令 identity，因为它决定 Agent 工作目录中的公开位置。cache 命中不是新的 identity，也不能让旧的 repo、commit 或安全策略继续有效。

## 入口

- [Library](library.md) — checkout 的唯一声明形状、删除项与命令边界。
- [CLI](cli.md) — 既有 check、dry、运行、JSON、退出码与审计输出。
- [Architecture](architecture.md) — fetch、删除、隔离、并发与生产验收。
