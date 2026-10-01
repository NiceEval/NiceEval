---
format: concord.document/v1
id: judge-physical-usage
title: Judge 物理调用与费用
createdAt: 2026-09-30T10:13:33.756Z
kind: design
alternatives:
  - plan-1
  - plan-2
decision:
  selected: plan-1
  reason: |-
    GPT-6 Astra 独立审查及定点复核已完成，原七项 P1 在设计层面全部关闭，无剩余 P0/P1；据此选择 plan-1。
    消费者随后确认仅持有 Responses 费用回执，Vercel Chat reported 映射因此不启用，维持未知并以显式 pricing 验收估价。

    物理请求由 Attempt 所属账本登记，费用完整性不应依赖评分结果、材料大小或审计正文解码。
    同一公共投影供应用与 Agent 使用，应用 costUSD 保持独立，裁判与总费用显式呈现缺项。

    G1: 物理传输的登记与取消封存已定义，仍待安装候选验证失败和重试。

    G2: Query 与展示共用投影已定义，仍待两个应用路径和两个 Show 入口验收。

    G3: 身份、回执、容量已定义，仍待边界与完整性验证。

    G4: 已取得消费者离线红证据，上游正式 fixture 与可靠性验收尚待完成。
  at: 2026-09-30T10:43:48.005Z
  targets: []
---

# Judge 物理调用与费用 —— Design Decision

**相关文档**:[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

决定 Judge 物理请求、费用证据和完整性应由 Attempt 独立账本拥有，还是依赖 Assertion 审计汇总。候选需要同时满足失败重试、旧 Record未知和统一公开展示。

<!-- concord.design-index/v1:start -->
## 候选方案索引（生成）

- [plan-1（已选择）](plans/plan-1/README.md)
- [plan-2](plans/plan-2/README.md)

裁决：[plan-1](plans/plan-1/README.md)。
<!-- concord.design-index/v1:end -->
