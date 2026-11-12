---
relations:
  - role: supports
    target: docs/feature/assertions/architecture/README.md
---

# 已封口 operation 联合新增能力时使用独立 criterion identity

已知 builtin criterion 的 data 由 exact schema 解码。往 `sandbox-result/v1` 的封闭 operation 联合添加值，会让旧 reader 把新条目判为 invalid，不能借“envelope 没变”宣称安全扩展。

`changedOnlyWithin` 因此使用独立的 `sandbox-change-scope/v1`。旧 reader 不认识此 identity 时走已有的 builtin-unknown 分支，只把这一条标为 unsupported；新 reader 需同时补 model、writer、exact codec 与 known identity 集。仅改 TypeScript 联合或 writer 不足以让当前 reader 认出条目。

验证应通过安装候选运行公开作者 API，再用 `attempt.assertion.detail` 确认持久 criterion 的 available 状态；运行期间断言求值成功不能替代这条读回证据。既有 criterion 的 schema、bytes 和 envelope 版本不因这一扩展改变。
