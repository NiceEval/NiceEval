# 执行失败分类 —— 库用法

重试参数不暴露给 Eval 或 Experiment 作者。作者只在拥有明确事实时声明失败的影响范围；Adapter 作者只在协议能够证明请求未被受理时声明可重试。

## Eval 与 Experiment 作者

共享服务、凭据或 Fixture 缺失等可证明会影响兄弟 slot 的问题，可以直接抛出范围明确的错误：

~~~ts
import { ExperimentFatalError } from "niceeval";

throw new ExperimentFatalError(
  "共享服务不可用；检查服务地址和凭据后重跑",
);
~~~

`ExperimentFatalError` 停止该 Experiment 的后续派发。只影响单个 Eval 的确定性条件使用 `EvalFatalError`。

错误 message 应包含现象和下一步。Runner 将终局错误写入相应 diagnostic channel；Run 或 Attempt 的详情页可以据此展示反馈。

不要仅凭“像基础设施问题”扩大范围。拿不准时，让失败保持在单个 Attempt，避免错误地停止有效 slot。

## Experiment 分类器

第三方错误可能在执行中出现，而不是在作者能提前检查的位置。Experiment 可以为自己掌握的共享资源提供 `classifyFailure({ text })`。

当文本明确包含该共享服务的地址和拒绝连接代码时，分类器可返回 `{ retryable: false, scope: "experiment", reason: "shared_service_unavailable" }`。其它输入返回 `undefined`。

分类器只返回决策和 reason。退避时长、重试上限、并发行为与停止派发的写入由 Runner 统一管理。

## Adapter 作者

Adapter 在 `classifySendFailure` 中补充协议信息。只有明确拒绝受理的请求才可标为可重试。

例如，`failure.acceptance` 为 `"rejected"` 且错误文本含 `QUEUE_FULL` 时，可返回可重试分类。

返回值为 `{ retryable: true, scope: "attempt", reason: "queue_full" }`。其它输入返回 `undefined`。

流中断、半截响应和含糊的文本通常不能证明未被受理，应返回 `undefined`。Adapter 只有能证明共享范围时才使用 `eval` 或 `experiment`。

## 调用后会看到什么

- 当前进程在重试时显示短暂进度；重试成功不会产生新的逻辑 Turn。
- 重试耗尽后，Attempt 写入终局 diagnostic，Verdict 为 `errored`。
- 停止派发时，Run 写入 `dispatch-halted`；后续 expected slots 保留为 `not-recorded`。
- 修复后再次运行。carry planner 读取当前 Verdict、eligibility 和 identity，再决定是否执行。

## 相关阅读

- [Architecture](architecture.md)
- [Runner](../../runner.md)
- [Record 通道](../record/architecture.md#channel-identity-与局部演进)
- [缓存与携带](../experiments/cache.md)
