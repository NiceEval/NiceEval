**相关文档**：[README](README.md) · [Limits](LIMITS.md) · [Cases](CASES.md) · [Decision](DECISION.md)

# Goals

## 目的与范围

- **G1：减少 origin 流量。** 同一宿主已经取得某个 commit 的完整历史后，fresh Sandbox 与并行 Attempt 不再为同一需求重复访问 origin。
- **G2：对象级隔离。** Agent 即使知道未来 commit 或 object OID，也不能从初始 workspace、Sandbox 其它路径或 Git 配置取得该对象。
- **G3：题间无继承。** 每条 Attempt 都从全新 Git metadata 开始，上一题写入的 hook、config、ref、reflog、alternate 与 object 不得进入下一题。
- **G4：作者面保持简单。** 作者只声明 repository、commit 与可选目标目录，不声明缓存键、镜像路径、传输方式或 Provider 差异。
- **G5：并发与失败可收束。** 相同需求 single-flight，不同需求可并行；中断、损坏与部分传输不会发布可命中资源，也不会把受污染 Sandbox 放回复用池。
- **G6：库存可治理。** 长期保留的 acquisition 状态与投影都能解释身份、容量、活动 lease 和回收资格。

这个决策不设计 branch 跟踪、私有凭据、submodule、Git LFS、跨宿主共享或远端代理服务。

## 设计原则

1. 性能优化不能扩大 Agent 可见信息。
2. 可增长的 acquisition 状态与不可变交付文件使用不同实体和状态机。
3. planning 只处理纯声明；文件、网络、进程与 lease 进入受管运行边界。
4. 缓存命中是运行事实，不是作者配置。
5. 删除授权来自受管清单、lease 与复核，不来自目录名或年龄猜测。

## 可验证要求

验收以 [Cases](CASES.md) 的 C1 至 C8 为准。
其中 C2、C3 与 C6 是安全门；任一候选不能完整兑现时，不得因流量收益被采纳。
