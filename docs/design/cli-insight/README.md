# CLI 与 Insight —— Design Decision

**相关文档**：[GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [CASES](CASES.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [DECISION](DECISION.md)

本决策只裁决 NiceEval 自己维护的运行后入口。CLI 是独立的 AI-native 查询工具与人类快捷诊断入口，Insight 是固定的本地交互式排障界面。

```text
Record → Analysis
           ├─ niceeval query：机器发现、查询、解释与自由比较
           ├─ niceeval show：第一方人类诊断 recipe
           └─ niceeval insight：第一方本地 debug UI
```

外部用户怎样在自己的网站中使用 NiceEval，属于独立的[自定义 Benchmark 网页接入面](../benchmark-web-consumption/README.md)决策。本主题不选择公共数据 transport、组件库、网页框架、静态发布或动态服务方案。

## 已定边界

- `niceeval query` 是 machine-only 协议。它不经过 React、网页组件或 Human formatter。
- `niceeval show` 保留 Run → Attempt locator → exact detail 的快捷诊断链，不提供 `--json`。
- `view` 改为 `insight`。Insight 固定由 NiceEval 维护，只监听 loopback，不接受用户 Page、route、theme、组件或静态导出。
- 多集合选择、Population、alignment、comparability 与闭合结果由 Analysis 拥有。CLI 与 Insight 不另写统计语义。
- 浏览器 transport、Insight revision 与授权都是第一方私有实现，不构成外部网页 API。

## 候选

| 候选 | Machine 面 | 人类面 | 主要代价 |
|---|---|---|---|
| [PLAN-1](PLAN-1/README.md) | 从 Report / Page 派生 | `show`、`view` 与网页共享作者树 | CLI 和本地 debug 被网页作者模型限制。 |
| [PLAN-2](PLAN-2/README.md)（推荐） | 独立 query protocol | 具名 `show` recipes + 固定 Insight | Analysis 必须先补齐 selection catalog 与 multi-set comparison。 |
