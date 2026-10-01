---
format: concord.document/v1
id: model-usage-roles
title: 模型用途配置与实际用量
createdAt: 2026-09-30T08:36:55.242Z
kind: design
alternatives:
  - plan-1
  - plan-2
decision:
  selected: plan-1
  reason: |-
    采用普通 Adapter 的命名模型用途切片。阶段一包括配置、物理关联、全账本统计与 Show/View，Judge 与 Agent 多模型执行后置。
    应用成本维持既有口径；Judge unavailable，合计只给带缺口的已知金额。

    G2: 阶段一仅有应用物理账本；Judge 明示不可用，合计保留缺口。完整 Judge 费用后置，不伪造总金额。

    实际模型分组无法区分共享模型的用途，也无法表达实验只修改一个用途。必须保存配置意图和调用事实两份不同含义的数据。
    复用物理 callId、reported cost 与封存价格证据，无需复制应用 journal。单模型简写只归一到同一 default 配置，不形成另一套执行语义。

    GPT-6 Astra 独立审查的四项 P1 已修订：默认归一、Agent 粒度边界、origin 持久身份、正式读取与费用缺口。
    定点复核再指出预览缺席不能证明未调用，现以配置行的全账本 recordedCalls 解决；129/1/0 反例进入 C9。
    审查结论允许修正后分派阶段一实现，未以源码或文档检查代替公开验收。
  at: 2026-09-30T09:09:00.747Z
  targets: []
---

# 模型用途配置与实际用量 —— Design Decision

**相关文档**:[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

比较显式命名模型用途与仅按实际模型汇总。配置身份、物理调用事实和裁判费用需要分别保持可核对。

<!-- concord.design-index/v1:start -->
## 候选方案索引（生成）

- [plan-1（已选择）](plans/plan-1/README.md)
- [plan-2](plans/plan-2/README.md)

裁决：[plan-1](plans/plan-1/README.md)。
<!-- concord.design-index/v1:end -->
