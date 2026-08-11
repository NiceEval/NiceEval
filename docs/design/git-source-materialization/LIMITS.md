**相关文档**：[README](README.md) · [Goals](GOALS.md) · [Cases](CASES.md) · [Decision](DECISION.md)

# Limits

- **L1：每条题目的 commit 可能不同。** 只按 repository 复用工作树，无法表达不同题目起点。
- **L2：Agent 可以修改 `.git`。** workdir reset 不会自动证明 hook、config、alternate、object 与 workdir 外路径安全。
- **L3：完整 mirror 包含未来对象。** 删除 remote、tag、ref 与 reflog 不能证明 unreachable object 已不存在。
- **L4：Sandbox 复用只恢复 workdir。** `/tmp`、`$HOME` 与其它 workdir 外状态可能跨 Attempt 保留。
- **L5：Git pack 是实现格式，不是隔离证明。** bundle verify 与 fsck 证明结构完整，但不证明没有额外对象。
- **L6：交付文件可能很大。** 宿主到 Sandbox 的通道必须分块传输，不能要求把整个历史同时装入 JS heap 或单次 Provider 请求。
- **L7：SourcePool 会增长。** 获取新 commit 会改变 SourcePool；已经发布的题目投影必须保持不可变，并能脱离 SourcePool 独立使用。
- **L8：当前公开入口是 prepare command。** `checkout()` 仍位于 Eval 或 Experiment 的 Sandbox Layer 中，并按每 Attempt cadence 执行。
- **L9：NiceEval 是 beta。** API 应收敛为理想形状，不以保留宽泛但无法安全兑现的 `ref` 输入为约束。

## 候选清单

- [PLAN-1](PLAN-1/README.md)：每台 Sandbox 保存完整 mirror，后续 Attempt 从本地 mirror checkout。
- [PLAN-2](PLAN-2/README.md)：宿主或 Sandbox 共享对象库，通过 mount、hardlink 或 alternate 让工作树借用对象。
- [PLAN-3](PLAN-3/README.md)：把一个 repository 建模成单个可增长的 Cache Manifest entry，并直接用于交付。
- [PLAN-4](PLAN-4/README.md)：宿主维护可增长 SourcePool，再按 commit 发布不可变 SourceProjection。
