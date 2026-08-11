# 执行失败分类 —— 架构

执行失败分类回答两个独立问题：本次 `agent.send` 是否可以安全重试，以及该失败是否足以停止同一 Eval 或 Experiment 的后续派发。

分类不修改 Record 核心。终局执行错误和停止派发原因写入 Attempt 或 Run 的 diagnostic channel；Verdict 根据这些业务数据和 Assertion 规则形成 `errored`。

## 类型

~~~ts
type FailureScope = "attempt" | "eval" | "experiment";

interface FailureClass {
  readonly retryable: boolean;
  readonly scope: FailureScope;
  readonly reason: string;
}

interface SendFailure {
  readonly acceptance: "rejected" | "unknown" | "accepted";
  readonly error: unknown;
}
~~~

`reason` 是稳定、短小的机器词。它可进入当前进程的反馈和 diagnostic 数据，但不能单独决定 Verdict 或退出状态。

## 分类顺序

1. 受理信息优先。只有 `acceptance: "rejected"` 才允许 `retryable: true`。
2. Eval 或 Experiment 作者的明确分类器可声明可证明的共享失败范围。
3. Adapter 分类器可补充其协议特有的重试或范围信息。
4. 保守回退产生 `retryable: false`、`scope: "attempt"`。

分类器必须纯、快速且不抛错。无法确认时返回 `undefined`，让后续规则处理。

## 重试

重试只包一次 `agent.send` 调用。每个 send 最多四次物理尝试；一个 Attempt 合计最多八次重试。退避使用全抖动指数等待，并且不延长 Attempt deadline。

等待重试时释放全局并发位；Experiment 自己的并发限制仍贯穿该 Attempt 的整个生命周期。已被重试吸收的失败只写入该 Attempt 的诊断数据，不进入逻辑会话数据，也不触发停止派发。

重试耗尽或不可重试的失败成为终局执行错误。Runner 将它写入 Attempt diagnostic channel，并让 Verdict 形成 `errored`。

## 停止派发

`scope: "eval"` 停止同一 `(experimentId, evalId)` 的后续派发。`scope: "experiment"` 停止该 Experiment 的后续派发。已在执行的 Attempt 可以完成收尾。

停止派发是一次 Invocation 内的状态。Runner 在对应 Run diagnostic channel 写入 `dispatch-halted`，并保留未派发 expected slots。那些 slot 没有 Member，Sample 将其显示为 `not-recorded`。

此状态不跨 Invocation 保留。修复条件后再次运行，由 carry 与普通规划规则重新决定每个 slot。

## 生命周期边界

Experiment setup 的确定性失败写入 Run diagnostic channel，并阻止该 Run 的 Attempt 派发。Experiment teardown 失败只写入 Run 范围诊断，因为此时已经没有可停止的后续派发。

Attempt teardown 的失败保留为该 Attempt 的诊断；若分类带有可证明的范围，Runner 仍可停止兄弟 slot 的派发。

用户中断、timeout、budget 与首过即停使用各自的 Runner 规则。它们不通过 FailureClass 冒充 Agent send 错误。

## 可见性

当前进程显示重试进度、退避等待和首次 `dispatch-halted` 通知。最终 Record 数据只保存需要事后解释的 diagnostic、Assertion、Verdict 和计时事实。

Reports 只消费 ReportInput 已交付的数据。它们不由当前进程反馈补齐缺失的失败信息。

## 不变量

- 分类器不会制造新的失败，也不会改变原始错误的事实边界。
- 被安全重试吸收的失败不会停止派发。
- 无法证明共享范围时使用 `attempt`。
- 未派发 slot 不制造 Attempt、Member 或 Verdict。
- 重试、停止派发和 channel 写入都不改变 Record 的核心 Run、Member 与 Attempt 协议。

## 相关阅读

- [执行失败分类 Library](library.md)
- [Runner](../../runner.md)
- [Verdict](../verdict/architecture.md)
- [Experiments CLI](../experiments/cli.md)
