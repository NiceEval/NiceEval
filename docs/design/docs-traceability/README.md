---
format: concord.document/v1
id: docs-traceability
title: 仓库文档追溯 —— Design Decision
createdAt: 2026-08-23T23:19:02+08:00
kind: design
alternatives:
  - plan-1
  - plan-2
decision:
  selected: plan-2
  reason: PLAN-2 保留现有 ownership：产品语义归 Feature，测试组合身份归 Engineering owner anchor，测试动作归原生 test/spec，历史证据归 Memory。它只给这些 owner 增加可机器辨认的正向指针，反向列表每次编译，不签入中央 graph。
  at: 2026-08-24T19:33:21+08:00
  targets:
    - docs/engineering/docs-traceability/README.md
---

# 仓库文档追溯 —— Design Decision

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md) · [工程契约](../../engineering/docs-traceability/README.md)

本决策设计同源的 `pnpm run repo docs feature`、`pnpm run repo docs test` 与关系/文档结构命令。它让维护者从 Feature 或测试文件出发，找到 Use Case、页面、Roadmap、Design、Engineering、E2E owner、Feedback、Memory 与 Issue provenance。

争议不在于能否搜索 Markdown，而在于关系由谁拥有。方案还必须让创建、移动和 Roadmap 采用保持同一套模板与引用规则。

## 候选

- [PLAN-1：中央 Trace Registry](plans/plan-1/README.md) —— 把节点和双向边集中登记，查询直接，写入会形成第二真源。
- [PLAN-2：owner-local typed links 与动态编译](plans/plan-2/README.md)（推荐）—— 边留在现有 owner，每次查询编译有限投影。

本决策继承[原生 E2E 裁决](../user-readable-testing/DECISION.md)：不建立 Behavior、Proof 或逐 `test()` Registry。
测试动作、expected、fixture 和标题仍只存在于原生测试文件。

<!-- concord.design-index/v1:start -->
## 候选方案索引（生成）

- [plan-1](plans/plan-1/README.md)
- [plan-2（已选择）](plans/plan-2/README.md)

裁决：[plan-2](plans/plan-2/README.md)。
<!-- concord.design-index/v1:end -->
