# Cases

C1：两条事件分别满足 NPC 和发言条件；and 必须判定零命中。

C2：同一事件满足全部条件；存在性成功，评分只收到命中事件。

C3：完整空 collection；Boolean 存在性失败，评分为 measured 0，模型零调用。

C4：collection 不完整或任一候选无法判定；无充分正向见证时存在性 unavailable，评分 unavailable 且模型零调用。

C5：多个命中事件按原始顺序保留 eventId；登记后的应用数据变更不能改变材料。

C6：普通便捷方法只返回 Boolean handle，核心 closeQA 返回 measurement handle；gate 参数和 Pass/Score 能力准确。

C7：Agent 工具 partial、pending、负断言和 vector cut 与现有契约相同，selection 不能绕过 sidecar。

C8：模型失败、取消、材料容量不足和晚到 callback 不伪造成 measured 0 或完整成绩。

C9：上一 Attempt 的 managed selector 在新 Attempt 拒绝；静态 source 定义可复用且读取当前 Attempt。

C10：空、unknown、捕获失败和中断的 selection receipt 均通过公开 detail 读回，不依赖模型请求或 explanation。
