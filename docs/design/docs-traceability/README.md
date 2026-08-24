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

本决策设计同源的 `pnpm feature`、`pnpm test` 与文档结构命令。它让维护者从 Feature 或测试文件出发，找到 Use Case、Roadmap、Design、Engineering、E2E owner 与 Memory。

争议不在于能否搜索 Markdown，而在于关系由谁拥有。方案还必须让创建、移动和 Roadmap 采用保持同一套模板与引用规则。

## 候选

- [PLAN-1：中央 Trace Registry](PLAN-1/README.md) —— 把节点和双向边集中登记，查询直接，写入会形成第二真源。
- [PLAN-2：owner-local typed links 与动态编译](PLAN-2/README.md)（推荐）—— 边留在现有 owner，每次查询编译有限投影。

本决策继承[原生 E2E 裁决](../user-readable-testing/DECISION.md)：不建立 Behavior、Proof 或逐 `test()` Registry。
测试动作、expected、fixture 和标题仍只存在于原生测试文件。
