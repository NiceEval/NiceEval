**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

# Limits

- **L1 — Reader 是 Host capability。** CLI、View 前端和普通作者代码不能由 path 构造 reader。
- **L2 — Query stdout 只能是协议。** 成功或协议级领域失败恰好写一个 `niceeval.query/v1` document；进度与进程失败写 stderr。
- **L3 — View 不替代 query。** View 没有 machine inspection document，`--json` 也只能输出 lifecycle NDJSON。
- **L4 — 比较不是 Delivery glue。** 多集合选择、对齐和原子失败由一个 Inspection operation 决定。
- **L5 — Snapshot 输入必须具名。** `--record` 只接受 `artifactKind: record-snapshot`，有 schema/format revision、content identity、export provenance、logical closure identity 和 exact Seal 的 artifact。
- **L6 — ordinary copy 不可冒充 Snapshot。** operational SQLite copy、checkpoint 后的文件、cache 与未密封 closure 都被拒绝。
- **L7 — Inspection 不隐式迁移。** predecessor、future 或无效 Snapshot 在读取操作前失败；用户必须明确 maintenance。
- **L8 — View 只监听可信入口。** loopback 仍需要 session、Host 与 Origin 验证；credential 脱敏且不进入 receipt、Snapshot 或持久化状态。
- **L9 — source 决定刷新能力。** operational source 可 watch 和 refresh；Snapshot source 不 refresh、不 watch。
- **L10 — beta 删除旧面。** `show`、`insight`、`view --out`、static export 和兼容别名不保留。

## 候选清单

- [PLAN-1](PLAN-1/README.md)：历史 Report / Page 作者树。
- [PLAN-2](PLAN-2/README.md)：历史 Analysis、show 与 Insight 组合。
- [PLAN-3](PLAN-3/README.md)：已选的 fixed Inspection operations、query 与 runtime View。
