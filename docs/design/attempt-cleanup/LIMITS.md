# 约束与现状

runner/attempt.ts 由同一 deadline owner 裁定执行超时，但 deadlineAbort.abort() 没有领域原因。
父取消只透传任意 reason。AdapterCreateContext.signal 的公开类型为 AbortSignal。
AdapterAttemptResources 已保存 handoff、LIFO cleanup 和三态采集接纳时段。
cleanupAdapterResources 在变更前给整个 Adapter 时段固定 30000 ms。
资源排空可能超过该值：实际消费者声明 70000 ms 物理 drain，另有归档工作。

CLI 首次 SIGINT/SIGTERM 等待收尾，第二次强制结束进程。增加 cleanup 时限不能承诺抵抗强杀。
现有 deadline 到点先关闭断言与 app 方法，再中止执行，后续 cleanup 仍可提交用量、附件与 trace。
普通 JavaScript Promise 不能被强制终止；超过资源释放时段只能拒绝迟到采集并报告未完成。
