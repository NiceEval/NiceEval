---
format: concord.document/v1
id: benchmark-web-consumption
title: 自定义 Benchmark 网页接入面 —— Design Decision
createdAt: 2026-08-23T11:33:47+08:00
createdAtSource:
  kind: first-recorded
  path: docs/design/benchmark-web-consumption/README.md
  commit: 520f50f168c3ca09e31f641eb40e57540ddfec93
kind: design
alternatives:
  - plan-1
  - plan-2
  - plan-3
deferral:
  reason: DECISION.md 明确暂缓，未选择候选
  source:
    path: docs/design/benchmark-web-consumption/DECISION.md
    commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
    digest: sha256:2c1e07c4ab1e8f921e21635d9891f79254c10ce2ed24bb055027fa460d2404a8
---
# 自定义 Benchmark 网页接入面 —— Design Decision

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](plans/plan-1/README.md) · [PLAN-2](plans/plan-2/README.md) · [PLAN-3](plans/plan-3/README.md) · [DECISION](DECISION.md)

用户会在自己的项目中完整编写 benchmark 页面、路由、样式、图表与交互。这里比较 NiceEval 应当把什么作为稳定公共接入面：闭合数据、可 import 组件，还是两层都提供。

本主题与本地 [Insight](../cli-insight/README.md) 分离。Insight 是 NiceEval 固定维护的 debug UI；它的页面、RPC 与 session 不能成为外部网站接口。

## 三个候选

| 候选 | 稳定公共承诺 | 用户主要工作 | 长期成本 |
|---|---|---|---|
| [PLAN-1：data-first](plans/plan-1/README.md) | Framework-neutral closed data API | 自己写全部 UI | 数据 schema / transport ABI。 |
| [PLAN-2：components-first](plans/plan-2/README.md) | 可 import 组件 props 与行为 | 组合和定制组件 | Framework、DOM、CSS 与组件 ABI。 |
| [PLAN-3：layered](plans/plan-3/README.md) | 数据核心 + 可选组件层 | 按项目选择层次 | 同时承担两层 ABI 与一致性。 |

## 当前裁决状态

[Decision](DECISION.md) 明确暂缓选择公开接入面。三个 PLAN 都是完整候选，不是当前 Feature 承诺。静态与动态、server 与 browser、identity、缓存、预算、Astro hydration、React adapter 和公共 HTTP server 都要由候选分别证明，不能写进共同前提。
