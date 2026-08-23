# 自定义 Benchmark 网页接入面 —— Design Decision

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [DECISION](DECISION.md)

用户会在自己的项目中完整编写 benchmark 页面、路由、样式、图表与交互。这里比较 NiceEval 应当把什么作为稳定公共接入面：闭合数据、可 import 组件，还是两层都提供。

本主题与本地 [Insight](../cli-insight/README.md) 分离。Insight 是 NiceEval 固定维护的 debug UI；它的页面、RPC 与 session 不能成为外部网站接口。

## 三个候选

| 候选 | 稳定公共承诺 | 用户主要工作 | 长期成本 |
|---|---|---|---|
| [PLAN-1：data-first](PLAN-1/README.md) | Framework-neutral closed data API | 自己写全部 UI | 数据 schema / transport ABI。 |
| [PLAN-2：components-first](PLAN-2/README.md) | 可 import 组件 props 与行为 | 组合和定制组件 | Framework、DOM、CSS 与组件 ABI。 |
| [PLAN-3：layered](PLAN-3/README.md) | 数据核心 + 可选组件层 | 按项目选择层次 | 同时承担两层 ABI 与一致性。 |

## 当前裁决状态

[Decision](DECISION.md) 明确暂缓选择公开接入面。三个 PLAN 都是完整候选，不是当前 Feature 承诺。静态与动态、server 与 browser、identity、缓存、预算、Astro hydration、React adapter 和公共 HTTP server 都要由候选分别证明，不能写进共同前提。
