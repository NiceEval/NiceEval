---
relations:
  - role: supports
    target: docs/feature/sandbox/architecture/README.md
---

# Provider stop 的 Promise rejection 不能变成 Scope defect

Fresh Sandbox 的 Managed release 曾用 `tryPromiseAsDefect(group.stop)` 关闭 Provider。
外层 runtime 只捕获 typed failure，所以 Provider 拒绝清理时，defect 穿过 Scope，触发 Attempt 的获取失败兜底。
该兜底从默认 errored 的结果重建，覆盖了已经完成的 Assertion 判定。
这类故障可以显示为最后的前向阶段，例如 telemetry.collect，不能据此认定采集逻辑改写了 Verdict。

在 Provider Promise 边界保留 typed failure，再由 Managed stop 的局部 catch 写收尾诊断。
不要在 Attempt 最外层吞掉所有 Cause，也不要为了吞掉错误提前解除 registry 所有权。
错误仍须进入 sharedState 清理账本；否则等待者可能在 Provider 未停止时取得同一份外部状态。
Effect interruption 继续作为 interruption 传播。

实时 JSON 错误事件只展示首行，AggregateError 的标题不能解释 Docker stop、remove 或 network remove 中哪一步失败。
用公开 execution diagnostic 读取保留的子原因，并在写诊断前复用 describeError、脱敏及有界留存。
只有缺少子错误文本，不能证明 Docker daemon 故障或清理竞争。

现有 fresh Provider stop Journey 同时检查公开 Verdict、收尾诊断、sharedState 保留与显式恢复。
仅断言 lease 没被释放，会漏掉“状态保护正确，但已定 Verdict 被覆盖”的错误。
