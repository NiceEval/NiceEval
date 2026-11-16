---
relations:
  - role: supports
    target: docs/feature/adapters/library/streaming.md
---

# waiting 回调结束不能成为 SSE transport 的结束

SSE cursor 用 `null` 表示 EOF 会吞掉合法 JSON null；仅换泛型无法修复这个问题。
数据与终态必须分开：使用 `IteratorResult` 的 `done`，Schema 推导数据类型。
无服务 Schema 仍可能异步；同步解码入口应区分输入失败与 decoder defect，避免把后者误报成坏帧。

更隐蔽的问题是资源所有权：send 正常返回 waiting 后，回调 Scope 会取消 ctx.signal。
即使 typed slot 留住 cursor，绑定该 signal 的 HTTP 响应仍已关闭，下一轮无法恢复。
由 Attempt 登记纯 holder 后再 open，请求使用独立 signal；当前回调仅在获取响应和驱动帧期间监听取消。
take 只消费暂停现场，不转移最终清理责任；审批失败立即关闭，放弃回答则由 Attempt 最终清理兜底。

关闭操作先同步终态化、取消 reader、释放锁，再等待幂等回执。
清理 signal 已取消时仍需先发起关闭，否则串行资源 registry 会漏掉较早获取的资源。
超时只结束等待，不能伪称底层关闭完成；迟到拒绝也必须被观察，原操作错误优先于清理错误。

本地 source E2E 还有独立陷阱：Node 的自定义 export conditions 不会自动进入 Vite。
Vitest 5 会重设环境条件，需在 `configEnvironment` 追加 `niceeval-source` 并保留环境默认条件。
验收时检查解析日志确认加载 src，不能用旧 dist 的结果判断当前源码是否修好。
