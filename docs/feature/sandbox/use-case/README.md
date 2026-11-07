# Sandbox —— CLI 用例

本目录是 Sandbox 配置与 CLI 的用例文档（体裁约定见[功能文档](../../README.md)）：一篇讲一个真实用例的全流程。
契约单源在 [CLI](../cli.md)、[Sandbox 复用](../library/reuse.md)、[Sandbox Layer](../library/layers.md) 与[三方准备时序](../architecture/lifecycle.md)，这里只做叙事串联，不复制契约定义。

## 起点与准备(Sandbox Layer)

契约单源始终在 [Sandbox Layer](../library/layers.md)、[三方准备时序](../architecture/lifecycle.md)与[内置 before action](../library/prepare-commands.md)。
下面的用例展示同一套契约怎样承载真实迁移路径:

- [Terminal-Bench:Eval 带 template](sandbox-terminal-bench.md) —— 每道题自带 Compose,Experiment 保持 command-only。
- [MemoryBench:Experiment 带 template](sandbox-memorybench-preparation.md) —— 实验预装实例提供起点,Eval 逐 Attempt checkout 题目仓库。
- [共享分支准备](sandbox-shared-branch-preparation.md) —— 两个 Eval×Experiment 配对共享长前缀，再并行完成彼此的末段准备。
- [云 Sandbox 只准备一次](sandbox-cloud-before-cache.md) —— E2B、OpenSandbox 或 Instabox 上的一批并发 Attempt 共用一次 before 准备。

## Nested Docker

- [Nested Docker 用例索引](../../sandbox-nested-docker/use-case/README.md)

## `sandboxReuse: true`（Sandbox 复用）

Experiment 声明 `sandboxReuse: true` 后，指纹匹配的终态 Attempt 会照常由后续 Run 沿用，不创建 Sandbox。
未沿用的 Attempt 才共用 Sandbox，分摊创建和公共准备。
每条 Attempt 都按 occurrence schedule 满足 before action；缓存命中 restore，miss replay，Provider 不支持时真实执行。

| 目标 | 用例 |
|---|---|
| 当前 lockfile 的依赖每题都要安装 | [每个复用 Sandbox 只真实安装一次](sandbox-reuse-shared-dependency.md) |
| 本地快速冒烟一批 Eval | [把 N 次冷启动折成一次](sandbox-reuse-batch-smoke.md) |
| 保留有限并发 | [用多个 Sandbox 分摊一批 Attempt](sandbox-reuse-batch-smoke.md) |
| 多开 Invocation 时决定 Sandbox 与 checkpoint 是否共享 | [并行 Invocation 与状态边界](sandbox-reuse-parallel-invocations.md) |
| 批次超过一个 Sandbox 的寿命 | [在派发前更换 Sandbox](sandbox-reuse-rotate.md) |
| 同一题重复运行并观察稳定性 | [昂贵安装只真实付一次](sandbox-reuse-repeatability.md) |
| 选中的 Eval 各带不同 template | [复用池按物理身份分组](sandbox-reuse-heterogeneous-batch.md) |
| 实验声明了原生 Plugin | [声明了原生 Plugin 的实验开复用](sandbox-reuse-plugin-experiment.md) |
| 现有 Eval 还不能使用 Sandbox 复用 | [准备可复用的 Eval](sandbox-reuse-preparable-evals.md) |
| Docker image 或远端 snapshot 无法验证或恢复 | [从更短前缀或 Base 重新执行准备](sandbox-reuse-clean-start.md) |

完整契约见 [Sandbox 复用](../library/reuse.md)。

## `--keep-sandbox`(留存现场)

`--keep-sandbox` 为某次真实 Attempt 留下可进入的 Sandbox 现场。
先按要回答的问题选用例：

| 目标 | 用例 |
|---|---|
| before 或 Agent 安装阶段报错，落盘证据不足 | [进入现场重跑 before action](sandbox-retain-run-condition-error.md) |
| 怀疑 agent 修改了 workdir 之外的状态 | [检查全局运行态](sandbox-retain-outside-workdir.md) |
| 一个失败有多个假设，不想每次冷启动 | [在同一现场反复验证](sandbox-retain-validate-scene.md) |
| 项目配置已经损坏，仍需查看或销毁留存现场 | [配置损坏时仍能管理现场](sandbox-retain-broken-config.md) |

完整 CLI 契约见[留存现场](../cli.md)。
