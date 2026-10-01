# Lifecycle

正常路径：create → 原生输入与观察 → 应用停止接收新输入 → 排空 → 封存事实 → check/judge → test 返回 → 框架 cleanup → 采集关闭 → 发布。
应用可以在 waitUntil 返回后做阶段检查；最终质量裁判应读取已明确封存的事实。
框架不替应用推断世界停止时间，也不自动调用名为 finalize 的方法。

超时或外部取消：固定取消原因 → 关闭 authoring → 通知 Attempt signal → 中断执行 → 封存现有断言 → 独立 cleanup → 采集关闭 → 发布。
cleanup 可等待共享的应用 finalization Promise，但其等待仍受 cleanup deadline 限制。
物理请求是否结清必须由应用回执证明；abort 仅表示停止请求，不产生完成证据。

cleanup 成功提前关闭时段。deadline 耗尽则先拒绝新采集，再中止 cleanup signal，报告 adapter-cleanup-timeout。
仍在运行的 JavaScript Promise 不能修改已关闭的采集器或已封存断言。
首次 OS 取消不提前扣减 cleanup 预算；时段只在 cleanup 开始时起算。再次 OS 取消遵守强制退出语义。

验收从安装候选公开 CLI 进入，沿现有 custom-application-lifecycle 与 adapter-capture owner 扩展。
强制验证超过旧 30 秒的真实资源延迟，以及小预算截止拒绝，不能用源码调用或假时钟替代两项公开结果。
