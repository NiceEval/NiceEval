# 准入健康（Admission health）

## 要消除的 Frog / DX 摩擦

一个 Agent 或外部执行者在开始前可能已不可用。把这件事放入 Plugin、Eval Assertion 或 Verdict，会把
资源可用性误写成生命周期回调、评测事实或评分结果。调用者也无法知道哪些 slot 从未开始，以及为什么。

准入健康把这条检查放在 **producer occurrence**。它在每个 fresh slot 的 `agent.setup` 之前运行一次。
健康检查通过才会建立 Attempt；检查不健康、抛出异常或超时都不会建立 Attempt。

## 核心心智

一个 producer definition 可以在一个选中的 Agent、Sandbox 或外部执行者位置形成一个 occurrence。
occurrence 有稳定 identity，且拥有自己的健康声明。它不是 Plugin occurrence，也不属于 Eval。

Run 为全部需要准入健康的 fresh target slot 保存一份 `AdmissionHealthRunReceiptV1`。这份 Run-owned
回执穷尽说明每个 slot 是 `evaluated`、`errored` 还是 `not-run`。它不伪造 Attempt、Assertion 或 Verdict。

`evaluated` 的健康值可以是 `healthy` 或 `unhealthy`。只有 `healthy` 才允许后续创建 Attempt。
同一 occurrence 首次得到 `unhealthy`、异常或超时后，Runner 隔离该 occurrence 尚未开始的 slot。

## 范围

- 每个 fresh slot 在 `agent.setup` 前进行一次健康探测。
- Runner 不缓存健康值，不设 TTL，也不自动重试。
- health declaration、探测回执、隔离原因和 slot 归属进入 Run-owned 事实，供人读与机器审计。
- `--dry` 只展示已声明的 occurrence，不执行探测。

准入健康不判断任务答案，不创建新的 Assertion，不折叠 Verdict，也不替代 Provider 的资源创建失败。
它不提供后台健康监看、跨 Invocation 共享结果或全局熔断。

## Owner 与身份

| 对象 | Owner | 身份规则 |
|---|---|---|
| 健康 definition | producer 作者 | `namespace`、`name` 与 `behaviorRevision` |
| 健康 occurrence | 被选中的 producer 位置 | definition identity、`occurrenceKey` 与已求值配置 digest |
| slot 探测 | Runner | Run ID、slot ID 与 occurrence identity |
| Run 回执 | Evaluation producer | Run ID；一条 slot 恰有一项结果 |

Eval、Plugin、Assertion collector 与 Verdict producer 都只能读取这份边界事实，不能重写它。

## Assertion 决策

本方向不新增 Assertion。真实公开 owner 是 producer occurrence 的 admission declaration；它决定能否进入
`agent.setup`，而不是 Eval 作者的评测规则。Assertion 仍由 `test(t)` 在已建立的 Attempt 内登记，Verdict
仍由 sealed Assertion 与执行结果折叠。

生产可观察验收使用真实 lifecycle、`niceeval exp` 的人读与 JSON 反馈，以及涉及健康、不健康、超时和并发
隔离的 E2E。它不把同一套 Runner 逻辑复制进 unit fake。

## 兼容与移除

公开面不提供 `Plugin.health`、Eval health Assertion、健康 Verdict 或 `--health-retry`。这些旧式入口没有
翻译层；健康归属必须迁至 producer occurrence。无 health declaration 的 producer 保持没有准入探测，不能由
全局默认检查补上。

## 入口

- [Library](library.md) —— producer 如何声明 occurrence 与健康探测。
- [CLI](cli.md) —— `niceeval exp` 的 dry、人读、JSON 与退出码。
- [Architecture](architecture.md) —— 回执形状、身份、隔离与持久边界。
- [Lifecycle](lifecycle.md) —— fresh slot 的准确时序与失败收尾。
- [Experiments](../../feature/experiments/README.md) —— slot、Run 与 Invocation 的 owner。
