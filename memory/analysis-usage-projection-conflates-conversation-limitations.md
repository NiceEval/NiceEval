---
relations:
  - role: supports
    target: docs/feature/run/architecture/observability-attachments.md#reader-side-views
---

# Analysis usage 投影混入 conversation limitation

## 问题

完整记录 input/output token buckets 的 Attempt 在 Analysis `tokens` Measure 中形成 `analysis-missing — usage collection is incomplete`。Report 因而把 Tokens 显示为无数据，并在 Data notes 中逐 Attempt 重复暴露错误缺口。

## 根因

`niceeval.agent-turns` 同时承载 conversation items 与 usage observations，collection limitation 以 `target` 区分子通道。Preview 的确定性 Direct Agent 发出 `thinking`、`compaction` 等不持久化 conversation 事件，因此 source 合法带有 `unsupported-input(target=turn-item)` 并处于 `partial`；它的 usage observations 仍完整包含 input/output token buckets。

Analysis 的 `attemptTokens` projector 和 Attempt Observability usage view 直接复用了整个 source 的 `partial` 状态，没有按 `usage-observation` target 投影。前者拒绝已有 token buckets 后又找不到 usage-specific limitation，错误回退为 `usage collection is incomplete`；后者也把完整 usage 显示为 partial。

## 修复边界

从一个多通道 source 派生输入或 DomainView 时，只让属于该子通道 target 的 limitation 决定其 collection 状态；其它 target 的 limitation 仍保留在 source dependency 和对应 conversation/command view 中。Record bytes、source family schema 与采集策略不变。

回归由安装后 Report E2E 的静态站公开结果拥有，先证明含 unsupported conversation item 且完整 usage 的 Attempt 不再产生 usage 缺失，并继续保留 conversation partial limitation。
