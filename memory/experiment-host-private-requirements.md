# 公共消费问题

从 niceeval/experiment/host 导入 experimentHost 后，invocation.plan/run 返回的 Effect 要求四个私有 Service。公开包没有相应 Layer 或 tag，正常消费者不能直接 runPromise/runFork，阻断了无父 AbortSignal 的 fiber 中断验收。

## 收敛方案

按 [Host 组合边界](../docs/architecture.md#cli-feature-composition)提供具名 Node edge，内部 raw runtime 保留要求，CLI 继续由 bootstrap 组合。初始化期间的 worker 也必须由 Scope 终止；不能只等待 ready 才释放。

## 验收

安装候选只导入公共包和 Effect，检查 plan/run 类型及正常运行；直接中断无 signal 的 invocation fiber，观察取消原因、authoring 关闭、有界清理及原 Cause。静态类型或源码审查不替代公开运行证据。
