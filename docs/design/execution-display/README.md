---
format: concord.document/v1
id: execution-display
title: 执行轨迹的应用展示
createdAt: 2026-10-01T01:15:44.542Z
kind: design
alternatives:
  - plan-1
  - plan-2
decision:
  selected: plan-1
  reason: |-
    Adapter 写入时为 `recordTrace` 事件附加封闭展示块，随事件封存。
    `attempt.trace` 按 source family 分为 Events、Conversation、Commands 与 Diagnostics 四个 section，各有独立预算与状态。

    G2: 设计保留了 C8 断言依赖的全部输出：section 标题与状态、每行一个 identity、五种稳定 ID 的展开，以及对位置 handle 的拒绝。Agent 体验在运行时是否退化，要在实现后用 C8 现有断言加大 outline、分页与 partial 空页回归证明，因此 G2 保持 pending。

    - G3、G5 与 L1、L2 拉开差距。PLAN-1 读取路径不执行作者代码，Snapshot 换机后展示不变；PLAN-2 两者都不满足。
    - G2 两个候选在 section 结构上相同，Agent 体验不取决于展示在哪里计算。
    - PLAN-1 不需要对 [CLI Insight 裁决](../cli-insight/DECISION.md)翻案：作者交付数据而非 renderer，新增展示形状只能扩展 NiceEval 的穷尽 `kind` union。
    - 外部轨迹（C9）用 `partial` collection、`external-trace` limitation 与 `text` 加 `code` 指引即可表达，不需要专门 kind。
  at: 2026-10-01T02:10:24.517Z
  targets: []
---

# 执行轨迹的应用展示 —— Design Decision

**相关文档**:[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [DECISION](DECISION.md)

`niceeval show @<locator> --execution` 和 View 的 Attempt debugger 对 Agent 有专用投影：用户消息、助手回答、工具调用和命令都按语义呈现。
自定义应用经 [`recordTrace`](../../feature/adapters/library.md#保存通用执行轨迹) 交付的领域事件只能显示 `type`、`actor`、
512 字节 `summary` 和原始 JSON。游戏里 NPC 说的一段话、HTTP 应用的一次请求、生图应用的一张图，都没有可读形式。

本决策比较“把应用事件转换成人读展示”这一步放在哪里执行：Adapter 写入时把展示随事件封存，还是读取时调用 Adapter 提供的 formatter。
两者都保持 Agent 现有的 Conversation 与 Commands 呈现，只给通用轨迹补人读形式；区别在历史可读性、读取侧是否执行作者代码，以及与
[CLI Insight 裁决](../cli-insight/DECISION.md)的关系，因此摊开比较。

外部用户自建 benchmark 网页的接入面属于 [Benchmark Web 消费](../benchmark-web-consumption/README.md)，不在本决策范围。

<!-- concord.design-index/v1:start -->
## 候选方案索引（生成）

- [plan-1（已选择）](plans/plan-1/README.md)
- [plan-2](plans/plan-2/README.md)

裁决：[plan-1](plans/plan-1/README.md)。
<!-- concord.design-index/v1:end -->
