# CLI、Insight 与 Benchmark Web —— Design Decision

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [DECISION](DECISION.md)

本决策重划运行后结果的三个消费面。CLI 是独立的查询与快速查看工具，Insight 是 NiceEval 自己维护的排障界面，用户网站则完全由用户拥有。

```text
Record → AnalysisMaterializer
           ├─ CLI：query / show
           ├─ Insight：第一方动态 debug UI
           └─ BenchmarkBundle
                ├─ 任意框架与图表库
                └─ 可选的无样式 React adapter
```

三个面只共享 Analysis 的统计语义与闭合 codec，不共享 Page、路由、组件树或 renderer。CLI 不为网页降级，Insight 不成为网页作者平台，BenchmarkBundle 也不携带 NiceEval 页面。

## 已固定的产品边界

- `view` 改为 `insight`。Insight 只服务交互式排障，不接受用户 Page、组件、路由、主题或静态导出。
- `niceeval query` 是 AI-native 公共机器协议。它能发现合法能力、执行自由比较，并返回可直接修正的结构化错误。
- `niceeval show` 只保留人类快速查看。它与 Human query formatter 消费同一次 materialization，不保留第二套机器协议。
- 用户 benchmark 网站拥有页面、样式、图表、交互、鉴权和部署。NiceEval 不生成用户网站。
- 框架中立的 `BenchmarkBundle` 是网页公共能力的稳定核心。可选 React adapter 只帮助安全消费 Bundle。

## 四个候选

| 候选 | 公共网页核心 | 静态 / 动态 | 主要代价 |
|---|---|---|---|
| [PLAN-1](PLAN-1/README.md) | Astro integration 与 island | Astro build / adapter | 把框架编译现场变成数据协议。 |
| [PLAN-2](PLAN-2/README.md) | React 组件库 | component loader | 容易重新吸收查询、路由与样式。 |
| [PLAN-3](PLAN-3/README.md) | 只有 framework-neutral data | 同一 Bundle materializer | React 用户重复处理 revision 与完整度。 |
| [PLAN-4](PLAN-4/README.md)（推荐） | Bundle contract + 有界 React adapter | static-first，同一 materializer 支持用户 server | 必须机械限制 React ABI 不再膨胀。 |

## 被替换的设计

本决策替换 [Report authoring](../report-authoring/README.md) 的双面组件裁决，也取消 [Report 图表语义内核](../../roadmap/report-chart-kernel/README.md) 的公共三面 renderer 方向。旧文档只保留形成历史，不再约束本决策。

当前 Feature 尚未迁移时，仍可能描述 `Report`、`view` 与 `ClosedSiteRevision`。产品采用本决策前必须完成 [Decision · 迁移门](DECISION.md#迁移门)，不能把旧 Feature 与本设计拼成长期双轨。
