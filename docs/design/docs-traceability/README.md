---
format: niceeval.docs-node/v1
kind: design
relations:
  selectedPlan: docs/design/docs-traceability/PLAN-2/README.md
  decides:
    - docs/engineering/docs-traceability/README.md
---

# 仓库文档追溯 —— Design Decision

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md) · [工程契约](../../engineering/docs-traceability/README.md)

本决策设计同源的 `pnpm run repo docs feature`、`pnpm run repo docs test` 与关系/文档结构命令。它让维护者从 Feature 或测试文件出发，找到 Use Case、页面、Roadmap、Design、Engineering、E2E owner、Feedback、Memory 与 Issue provenance。

争议不在于能否搜索 Markdown，而在于关系由谁拥有。方案还必须让创建、移动和 Roadmap 采用保持同一套模板与引用规则。

## 候选

- [PLAN-1：中央 Trace Registry](PLAN-1/README.md) —— 把节点和双向边集中登记，查询直接，写入会形成第二真源。
- [PLAN-2：owner-local typed links 与动态编译](PLAN-2/README.md)（推荐）—— 边留在现有 owner，每次查询编译有限投影。

本决策继承[原生 E2E 裁决](../user-readable-testing/DECISION.md)：不建立 Behavior、Proof 或逐 `test()` Registry。
测试动作、expected、fixture 和标题仍只存在于原生测试文件。

<!-- niceeval.docs-index/v1:start -->
## 候选方案索引（生成）

- [PLAN-1](PLAN-1/README.md)
- [PLAN-2（已选择）](PLAN-2/README.md)

裁决：[PLAN-2](PLAN-2/README.md)。
<!-- niceeval.docs-index/v1:end -->
