# 声明外部服务失败的影响范围

在应用或 Adapter 调用边界，先依据结构化协议确认失败事实，再决定是否停止同一 Eval 或 Experiment 的后续派发。
确定只影响单个 Eval 时抛出 `EvalFatalError`；确定共享依赖失效时抛出 `ExperimentFatalError`，并通过 cause 保留原始错误。
不能确认范围时保持 Attempt 失败。Experiment 不接受 `classifyFailure`。

Adapter 可通过 `classifySendFailure` 补充协议分类；只有能够证明请求未被受理时才声明可重试。
具体语义见 [Library](../library.md)。
