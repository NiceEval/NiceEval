# 目标与要求

**相关文档**：[README](README.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1.md) · [PLAN-2](PLAN-2.md) · [PLAN-3](PLAN-3.md) · [DECISION](DECISION.md)

---

## 目的

缩短从发起 Invocation 到拿到结果的总耗时，同时保留实验声明的串行或并行要求。
这项设计覆盖 Runner 派发、Sandbox 准备与 Sandbox 复用。

实验总耗时由派发量、排队、Sandbox 准备、Agent 执行和评分共同决定。
选型必须先看阶段耗时；Sandbox 创建次数减少，不等于实验一定更快。

## 设计原则

- 默认运行保持 Attempt 间隔离，并允许结果进入结果沿用、CI 和正式报告。
- Sandbox 复用必须由 Experiment 显式声明，并进入配置哈希。
  结果不得进入结果沿用，但可以按该 Experiment 的声明进入 CI。
- Experiment 的 `maxConcurrency` 表达业务正确性时，任何加速方式都不能绕开它。
- 可以并行的 Attempt 不应因为 Sandbox 复用被强制改成整批串行。
- Runner 只依赖 Provider 能力，不按 Docker、E2B 或 Vercel 的名字分支。
- 生命周期 Hook 的次数由所属层决定，不能为了提速改变 Agent 或 Eval Hook 的次数。

## 需求

### 正确性

1. 默认模式继续为每个 Attempt 使用全新 Sandbox。
2. 同一个 Sandbox 在同一时刻最多承接一条 Attempt。
3. Sandbox 复用只重置明确覆盖的 workdir 状态，不宣称等同于全新 Sandbox。
4. Sandbox 复用的结果不参与结果沿用；CI 按签入的 Experiment 生命周期运行。
5. Agent 与 Eval `setup` / `teardown` 每 Attempt 成对执行。

### 效率

6. 先用结果沿用、选择与首过即停减少不必派发的 Attempt。
7. 稳定依赖可以移入预制环境或 SandboxSpec `setup`。
8. 如果采用 Sandbox 预热，只能在计划确定后按近期派发量创建。
9. 如果采用 Sandbox 复用，必须能说明实际分摊了哪些阶段。
10. 候选方案必须分别说明只用一个 Sandbox 与同时使用多个 Sandbox 的并行影响。

### Sandbox 寿命

11. 采用 Sandbox 复用时，Runner 派发前要确认 Sandbox 能覆盖 Attempt deadline 与收尾。
12. 候选方案必须说明不能续期时是更换 Sandbox，还是停止 Run。
13. Provider 无法确认 Sandbox 复用寿命时，候选方案不能假设它会持续存活。
14. reset、续期或 SandboxSpec `setup` 失败后，该 Sandbox 不再承接 Attempt。

### 反馈

15. 计划与结束反馈至少展示少跑数量、实际并行数、Sandbox 创建数和复用次数。
16. Attempt 时间树只记录本 Attempt 的工作；共用的创建与 SandboxSpec `setup` 记为 Run 级开销。
17. 基准至少区分 Sandbox 创建、SandboxSpec `setup`、Agent 准备、Agent 执行与评分。

## 不在范围内

- 不重新设计结果沿用的指纹与资格门；它们归 [Experiments 缓存](../../feature/experiments/cache.md)。
- 不改变 `timeoutMs` 的 Attempt deadline 口径；它归 [Runner](../../runner.md)。
- 不设计跨 Run 常驻 daemon。
  共用的 Sandbox 只活在一次 Invocation 内。
- 不承诺消除 Provider 上限，只在可确认的上限到来前续期或更换 Sandbox。
