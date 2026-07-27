# 决策

**相关文档**：[README](README.md) · [GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) ·
[PLAN-2](PLAN-2.md) · [PLAN-3](PLAN-3.md)

---

## 结论

实验加速采用分层方案：

1. 先用结果沿用、选择与首过即停减少不必派发的 Attempt。
2. 默认使用[方案 1](PLAN-1.md)：保留有界并发，稳定依赖进入预制环境，
   每 Attempt 使用全新 Sandbox。
3. Sandbox 预热可以移动创建时间，但真实记录中 `sandbox.create` 只占约 0.5%–0.6%，
   因此不作为第一优先级。
4. 需要快速反馈时，显式使用[方案 3](PLAN-3.md)：
   `--reuse-sandbox[=<n>]` 让 Attempt 共用一个或多个 Sandbox。
5. [方案 2](PLAN-2.md)不是独立 Feature；
   裸 `--reuse-sandbox` 等价于 `--reuse-sandbox=1`。

这不是一种机制承接所有提速需求。
默认路径优先保证隔离与并行，Sandbox 复用只分摊准备工作。

## 为什么这样选

### 不把所有实验改成串行

MemoryBench 和 NiceEval-Eval 的 Agent 执行占总耗时约 68.8%–87.6%，
Sandbox 创建只占约 0.5%–0.6%。
对可以并行的 Attempt，强制串行很可能损失更多 Agent 执行的并行收益。

### 先移动稳定安装

MemoryBench 可直接识别的 Node 包安装占总耗时 8.2%，Rust build 或 fetch 占 4.2%。
这些工作多数发生在 `eval.run`，只复用 Sandbox 不会自动省掉。
稳定依赖进入预制环境或 SandboxSpec `setup`，才能直接减少重复安装。

### 同时保留串行与并行场景

一个 Sandbox 内一次只执行一条 Attempt，避免同一 workdir 并发写入。
当 Experiment 本来要求 `maxConcurrency: 1` 时，Sandbox 复用仍保持串行。
当 Experiment 允许并行时，可以同时维护多个 Sandbox。

## Feature 形状

入口为 `--reuse-sandbox[=<n>]`：

- 裸 CLI flag 等价于 `--reuse-sandbox=1`。
- N 是本次 Invocation 最多同时维护的 Sandbox 数，必须是正整数。
- 每个 Sandbox 内串行，多个 Sandbox 之间可以并行。
- 实际同时执行数取 N、全局并发位和 Experiment `maxConcurrency` 的最小值。
- Runner 按需创建 Sandbox，不预先创建不会使用的数量。

选中的 Eval 必须共享同一个 sandbox spec 与 environment profile。
不满足时，在创建 Sandbox 前列出分组并报错。

## 生命周期

每个 Sandbox：

- `createSandbox`、SandboxSpec `setup` / `teardown`、题间重置点与 `stop` 各执行一次；
- Agent 与 Eval `setup` / `teardown` 仍逐 Attempt 成对执行；
- 每次派发前确认 Sandbox 能覆盖 Attempt deadline 与收尾；
- 不能续期时停止旧 Sandbox，创建并准备替代 Sandbox。

Provider 通过 `SandboxReuseCapability.ensureLifetime(minRemainingMs)` 提供中立能力。
Runner 不按 Provider 名字或固定分钟数分支。

Sandbox 在 Attempt 中途消失时，该 Attempt 记为 `errored`，不得静默重跑。

## 结果边界

Sandbox 复用只用于快速反馈：

- 不消费结果沿用；
- 复用结果不供后续 Run 沿用，也不进入 CI；
- workdir reset 不等同于全新 Sandbox；
- 与 `--keep-sandbox` 和 `localSandbox()` 互斥。

需要正式结果时，去掉 `--reuse-sandbox`，按默认路径复验。

## 实施顺序

1. 先把稳定安装迁入预制环境或 SandboxSpec `setup`。
2. 为内置 Provider 增加 Sandbox 复用寿命能力。
3. 让一个 Sandbox 完成复用、reset、续期与更换流程。
4. 扩展到 N 个 Sandbox，并接入现有并发限制。
5. 最后评估 Sandbox 预热；只有在创建较慢的 Provider 上证明总耗时收益后才实现。
