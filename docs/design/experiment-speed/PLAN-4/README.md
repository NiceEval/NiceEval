# 方案 4（推荐）：Invocation 拥有 Sandbox 池，状态另行租约

**相关文档**：[README](../README.md) · [GOALS](../GOALS.md) · [LIMITS](../LIMITS.md) · [PLAN-1](../PLAN-1/README.md) · [PLAN-2](../PLAN-2/README.md) · [PLAN-3](../PLAN-3/README.md) · [DECISION](../DECISION.md)

---

## 方案

保留方案 3 的单 Invocation Sandbox 池，但把并发宽度与跨 Invocation 正确性分开：

- `sandboxReuse: true` 声明本 Invocation 的多条 Attempt 可共用 Sandbox。
- `maxConcurrency` 只限制本 Invocation 内该 Experiment 的 Attempt 与 Sandbox 池宽。
- 用例锁按 `(experimentId, evalId)` 防止两条 Invocation 双跑同一 Eval。
- `sharedState: { key }` 按外部状态身份独占完整 restore/run/save 窗口。

运行中 Sandbox 不跨 Invocation 共享。
只有 checkpoint、数据库或远程 cohort 这类明确声明的外部状态跨进程协调。

## 数据流

```text
独立状态:
  Invocation A → Sandbox pool A → Eval set A
  Invocation B → Sandbox pool B → Eval set B
  maxConcurrency 各自生效，用例锁避免双跑

共享状态:
  Invocation A → acquire state key → setup → pool A → teardown/save → release
  Invocation B → wait without setup/sandbox/eval lock → replan carry → acquire if needed
```

## 生命周期

共享状态租约在 Experiment `setup`、Sandbox create 与 Sandbox lifecycle `setup()` 之前获取。
它在该 Experiment 的所有 Sandbox lifecycle `teardown()`、Provider finalizer 与 Experiment `teardown` 完成后释放。
这条边界覆盖一份外部状态从恢复到原子回存的完整事务，不以 Attempt 结束为释放点。

等待者不创建 Sandbox、不运行 Experiment Hook、不占全局并发位、不提前持有 Eval 锁。
租约释放后它先重做整个 Experiment 的携带规划；已无工作时直接携带，不建第二个 Sandbox。

## 错误语义

- Sandbox 中途消失时当前 Attempt `errored`，不静默重跑。
- Sandbox lifecycle `teardown()` 早于 Provider finalizer；因 Sandbox 已停止而无法 save 属于收尾顺序违约。
- 持有者强杀后用心跳过期与 rename 接管恢复互斥，并记 `state-lease-taken-over`。
- 租约不证明半次外部写入已回滚。作者无法保证原子 checkpoint 时，必须换新 key 与干净 cohort 重建。
- 文件租约不覆盖不同机器或不同记录根；这些场景使用外部分布式互斥。

## 身份与结果

`sharedState.key` 进入 `configHash` 和 `ExperimentRunInfo`。
换 key 表示换了状态轨迹，旧结果不携带；同 key 的等待者在租约释放后仍按普通指纹门重规划。
`--rerun all` 只关闭携带，不跳过共享状态租约。

## 验收

1. 两条未声明 `sharedState` 的 Invocation 各用 `maxConcurrency: 1` 时，可同时运行两个独立 Sandbox。
2. 两条同 key Invocation 的 Sandbox lifecycle 窗口不重叠。
3. 等待方在对方完成后全量携带时，零 Experiment Hook、零 Sandbox 创建。
4. 两个 Experiment id 的 key 相同时串行，key 不同时可并行。
5. 租约释放晚于 Sandbox teardown 与 Provider finalizer，不出现「save 时 Sandbox 已停止」。
6. 强杀接管、`--rerun all`、不同选择子集、不同 `maxConcurrency` 和全携带均按上述边界运行。

## 为什么取代方案 3 的跨 Invocation 解释

方案 3 正确定义了单 Invocation 的一个或多个 Sandbox 复用池，但没有分开「池宽」和「外部状态事务」。
把 `maxConcurrency` 的 Attempt 名额扩展到跨 Invocation，既会夹低独立 Sandbox 的并发，也没有锁住物理 Sandbox 的完整 restore/save 窗口。
方案 4 保留复用收益，同时让两种所有权各有一个明确声明。
